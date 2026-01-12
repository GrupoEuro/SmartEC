import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

/**
 * Demand Statistics for a Product
 */
export interface DemandStats {
    productId: string;
    periodDays: number;

    // Basic Stats
    totalQuantitySold: number;
    totalOrders: number;

    // Daily Metrics
    avgDailyDemand: number;
    maxDailyDemand: number;
    minDailyDemand: number;

    // Variability
    stdDevDemand: number;
    coefficientOfVariation: number; // CV = stdDev / mean

    // Derived
    demandClassification: 'STABLE' | 'VARIABLE' | 'ERRATIC';

    // Time-based
    lastSaleDate: Date | null;
    daysSinceLastSale: number;

    // Calculated at
    calculatedAt: Date;
}

/**
 * Inventory Policy Configuration
 */
export interface InventoryPolicy {
    productId: string;

    // Service Level
    targetServiceLevel: number; // 0.95 = 95%
    zScore: number; // Statistical z-score for service level

    // Safety Stock
    safetyStock: number; // Calculated units

    // Reorder Point
    reorderPoint: number; // ROP = (avg_demand × lead_time) + safety_stock

    // Order Quantity
    orderQuantity: number; // EOQ or MOQ
    maxStockLevel: number; // ROP + Order Qty

    // Lead Time
    leadTimeDays: number;
    leadTimeStdDev: number;

    // Review
    lastReviewDate: Date;
    reviewFrequencyDays: number;
}

/**
 * Forecast Data Point
 */
export interface ForecastPoint {
    date: Date;
    forecastedDemand: number;
    method: 'SMA' | 'WMA' | 'EXP_SMOOTHING' | 'SEASONAL';
    confidence?: number; // 0-1
}

/**
 * Demand Forecasting & Safety Stock Service
 * 
 * Calculates:
 * 1. Historical demand statistics
 * 2. Safety stock based on service levels
 * 3. Demand forecasts using multiple methods
 */
@Injectable({
    providedIn: 'root'
})
export class DemandForecastingService {
    private firestore = inject(Firestore);

    /**
     * Calculate demand statistics for a product over specified period
     */
    async calculateDemandStats(
        productId: string,
        periodDays: number = 90
    ): Promise<DemandStats> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);

        // Fetch orders containing this product
        const ordersQuery = query(
            collection(this.firestore, 'orders'),
            where('items', 'array-contains', { productId }) // Note: Simplified, may need subcollection
        );

        const ordersSnapshot = await getDocs(ordersQuery);

        // Extract daily demand
        const dailyDemand = new Map<string, number>();
        let lastSaleDate: Date | null = null;

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const orderDate = this.getDateFromTimestamp(order['createdAt']);

            if (orderDate >= startDate) {
                const dateKey = orderDate.toISOString().split('T')[0];

                order['items']?.forEach((item: any) => {
                    if (item.productId === productId) {
                        const current = dailyDemand.get(dateKey) || 0;
                        dailyDemand.set(dateKey, current + (item.quantity || 0));

                        if (!lastSaleDate || orderDate > lastSaleDate) {
                            lastSaleDate = orderDate;
                        }
                    }
                });
            }
        });

        // Calculate statistics
        const demandValues = Array.from(dailyDemand.values());
        const totalQuantity = demandValues.reduce((sum, val) => sum + val, 0);
        const avgDailyDemand = demandValues.length > 0 ? totalQuantity / periodDays : 0;

        const stdDev = this.calculateStdDev(demandValues, avgDailyDemand);
        const cv = avgDailyDemand > 0 ? stdDev / avgDailyDemand : 0;

        // Classify demand variability
        let classification: 'STABLE' | 'VARIABLE' | 'ERRATIC' = 'STABLE';
        if (cv > 0.5) classification = 'ERRATIC';
        else if (cv > 0.25) classification = 'VARIABLE';

        const daysSinceLastSale = lastSaleDate
            ? Math.floor((new Date().getTime() - new Date(lastSaleDate).getTime()) / (1000 * 60 * 60 * 24))
            : 999;

        return {
            productId,
            periodDays,
            totalQuantitySold: totalQuantity,
            totalOrders: dailyDemand.size,
            avgDailyDemand,
            maxDailyDemand: demandValues.length > 0 ? Math.max(...demandValues) : 0,
            minDailyDemand: demandValues.length > 0 ? Math.min(...demandValues) : 0,
            stdDevDemand: stdDev,
            coefficientOfVariation: cv,
            demandClassification: classification,
            lastSaleDate,
            daysSinceLastSale,
            calculatedAt: new Date()
        };
    }

    /**
     * Calculate Safety Stock using service level approach
     * 
     * Formula: Safety Stock = Z × σ(demand) × √(lead_time)
     * 
     * Where:
     * - Z = z-score for desired service level
     * - σ(demand) = standard deviation of daily demand
     * - lead_time = supplier lead time in days
     */
    calculateSafetyStock(
        demandStats: DemandStats,
        leadTimeDays: number,
        serviceLevel: number = 0.95
    ): number {
        const zScore = this.getZScore(serviceLevel);

        // Safety stock formula
        const safetyStock = zScore * demandStats.stdDevDemand * Math.sqrt(leadTimeDays);

        return Math.ceil(safetyStock);
    }

    /**
     * Calculate Reorder Point (ROP)
     * 
     * Formula: ROP = (avg_daily_demand × lead_time) + safety_stock
     */
    calculateReorderPoint(
        demandStats: DemandStats,
        leadTimeDays: number,
        safetyStock: number
    ): number {
        const avgDemandDuringLeadTime = demandStats.avgDailyDemand * leadTimeDays;
        return Math.ceil(avgDemandDuringLeadTime + safetyStock);
    }

    /**
     * Calculate Economic Order Quantity (EOQ)
     * 
     * Formula: EOQ = √((2 × D × S) / H)
     * 
     * Where:
     * - D = Annual demand
     * - S = Order cost per PO
     * - H = Holding cost per unit per year
     */
    calculateEOQ(
        annualDemand: number,
        orderCost: number,
        holdingCostPerUnit: number
    ): number {
        if (holdingCostPerUnit <= 0) return 0;

        const eoq = Math.sqrt((2 * annualDemand * orderCost) / holdingCostPerUnit);
        return Math.ceil(eoq);
    }

    /**
     * Generate complete inventory policy for a product
     */
    async generateInventoryPolicy(
        productId: string,
        leadTimeDays: number,
        serviceLevel: number = 0.95,
        orderCost: number = 500, // Default MXN
        holdingCostRate: number = 0.20, // 20% of unit cost
        unitCost: number = 1000 // Default MXN
    ): Promise<InventoryPolicy> {
        // Get demand statistics
        const demandStats = await this.calculateDemandStats(productId);

        // Calculate safety stock
        const safetyStock = this.calculateSafetyStock(demandStats, leadTimeDays, serviceLevel);

        // Calculate ROP
        const reorderPoint = this.calculateReorderPoint(demandStats, leadTimeDays, safetyStock);

        // Calculate EOQ
        const annualDemand = demandStats.avgDailyDemand * 365;
        const holdingCost = unitCost * holdingCostRate;
        const orderQuantity = this.calculateEOQ(annualDemand, orderCost, holdingCost);

        return {
            productId,
            targetServiceLevel: serviceLevel,
            zScore: this.getZScore(serviceLevel),
            safetyStock,
            reorderPoint,
            orderQuantity: Math.max(orderQuantity, 1), // At least 1
            maxStockLevel: reorderPoint + orderQuantity,
            leadTimeDays,
            leadTimeStdDev: 0, // TODO: Calculate from supplier performance
            lastReviewDate: new Date(),
            reviewFrequencyDays: 30
        };
    }

    /**
     * Simple Moving Average (SMA) Forecast
     */
    forecastSMA(
        demandStats: DemandStats,
        periodsAhead: number = 7,
        windowSize: number = 4
    ): ForecastPoint[] {
        const forecast: ForecastPoint[] = [];
        const forecastValue = demandStats.avgDailyDemand; // Simplified for now

        for (let i = 1; i <= periodsAhead; i++) {
            const forecastDate = new Date();
            forecastDate.setDate(forecastDate.getDate() + i);

            forecast.push({
                date: forecastDate,
                forecastedDemand: forecastValue,
                method: 'SMA',
                confidence: this.calculateConfidence(demandStats)
            });
        }

        return forecast;
    }

    /**
     * Exponential Smoothing Forecast
     */
    forecastExponentialSmoothing(
        historicalDemand: number[],
        alpha: number = 0.3,
        periodsAhead: number = 7
    ): ForecastPoint[] {
        if (historicalDemand.length === 0) return [];

        // Initialize with first value
        let forecast = historicalDemand[0];

        // Apply exponential smoothing
        for (let i = 1; i < historicalDemand.length; i++) {
            forecast = alpha * historicalDemand[i] + (1 - alpha) * forecast;
        }

        // Project forward
        const forecasts: ForecastPoint[] = [];
        for (let i = 1; i <= periodsAhead; i++) {
            const forecastDate = new Date();
            forecastDate.setDate(forecastDate.getDate() + i);

            forecasts.push({
                date: forecastDate,
                forecastedDemand: forecast,
                method: 'EXP_SMOOTHING',
                confidence: 0.7
            });
        }

        return forecasts;
    }

    // === Helper Methods ===

    private calculateStdDev(values: number[], mean: number): number {
        if (values.length === 0) return 0;

        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

        return Math.sqrt(variance);
    }

    private getZScore(serviceLevel: number): number {
        // Common service level to z-score mappings
        const zScores: Record<string, number> = {
            '0.50': 0.00,
            '0.80': 0.84,
            '0.85': 1.04,
            '0.90': 1.28,
            '0.95': 1.65,
            '0.97': 1.88,
            '0.98': 2.05,
            '0.99': 2.33,
            '0.995': 2.58,
            '0.999': 3.09
        };

        const key = serviceLevel.toFixed(2);
        return zScores[key] || 1.65; // Default to 95%
    }

    private calculateConfidence(demandStats: DemandStats): number {
        // Confidence inversely related to variability
        const cv = demandStats.coefficientOfVariation;

        if (cv < 0.2) return 0.9; // Highly predictable
        if (cv < 0.4) return 0.75; // Moderately predictable
        if (cv < 0.6) return 0.5; // Variable
        return 0.3; // Erratic
    }

    private getDateFromTimestamp(timestamp: any): Date {
        if (!timestamp) return new Date();
        if (typeof timestamp.toDate === 'function') return timestamp.toDate();
        return new Date(timestamp);
    }
}
