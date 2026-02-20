import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, query, where, getDocs, Timestamp, orderBy, limit, QuerySnapshot, DocumentData } from '@angular/fire/firestore';
import { Observable, from, map, catchError, of } from 'rxjs';

export interface RevenueTrend {
    date: string;
    revenue: number;
    orders: number;
}

export interface TopProduct {
    productId: string;
    productName: string;
    sku: string;
    totalRevenue: number;
    totalQuantity: number;
    orderCount: number;
}

export interface CategorySales {
    category: string;
    revenue: number;
    orderCount: number;
    percentage: number;
}

export interface BrandSales {
    brand: string;
    revenue: number;
    orderCount: number;
    percentage: number;
}

export interface CustomerMetrics {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    averageOrderValue: number;
    customerLifetimeValue: number;
}

export interface InventoryMetrics {
    totalProducts: number;
    lowStockProducts: number;
    outOfStockProducts: number;
    totalStockValue: number;
    averageTurnoverRate: number;
    gmroi: number;           // Gross Margin Return on Inventory
    sellThroughRate: number; // Percentage of inventory sold
    deadStockCount: number;  // Products with stock but no sales
    abcBreakdown: {          // ABC Analysis counts
        a: number; // Top 80% revenue
        b: number; // Next 15%
        c: number; // Bottom 5%
    };
    potentialLostRevenue: number; // New: Daily expected loss from out of stock items
    predictedStockoutCount: number; // New: Products expected to stock out in 7 days
}

export interface ProductPerformance {
    productId: string;
    productName: string;
    stockLevel: 'healthy' | 'low' | 'out_of_stock' | 'dead'; // New
    revenue: number; // New
    stockQuantity: number;
    salesVelocity: number; // units per day
    daysUntilStockout: number;
    predictedStockoutDate?: string; // New: "Feb 14, 2026"
    potentialRevenueLoss?: number; // New: Daily loss if OOS (Price * Velocity)
    turnoverRate: number;
    gmroi: number; // New: Gross Margin Return on Investment
    price?: number; // New: Product Price
    stockValue?: number; // New: Total Value (Price * Quantity)
    reorderRecommended: boolean;
    recommendedReorderQuantity?: number; // New: How much to buy
}

export interface PeriodComparison {
    current: {
        revenue: number;
        orders: number;
        averageOrderValue: number;
        customers: number;
    };
    previous: {
        revenue: number;
        orders: number;
        averageOrderValue: number;
        customers: number;
    };
    change: {
        revenue: number;
        revenuePercent: number;
        orders: number;
        ordersPercent: number;
        averageOrderValue: number;
        averageOrderValuePercent: number;
        customers: number;
        customersPercent: number;
    };
}

export interface SalesVelocity {
    daily: number;
    weekly: number;
    monthly: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    velocityScore: number; // 0-100
}

export interface CustomerSegment {
    segment: 'Champions' | 'Loyal' | 'Potential' | 'At Risk' | 'Lost';
    count: number;
    totalRevenue: number;
    averageOrderValue: number;
    recencyScore: number; // 1-5
    frequencyScore: number; // 1-5
    monetaryScore: number; // 1-5
}

export interface ConversionFunnel {
    stage: string;
    count: number;
    percentage: number;
    dropoffRate: number;
}

export interface ForecastData {
    date: string;
    actual?: number;
    predicted: number;
    lowerBound: number;
    upperBound: number;
}

export interface CohortData {
    cohort: string; // e.g., "2024-01"
    period0: number; // initial period
    period1?: number;
    period2?: number;
    period3?: number;
    period4?: number;
    period5?: number;
    totalCustomers: number;
}

export interface GrowthMetrics {
    revenueGrowth: number;
    orderGrowth: number;
    customerGrowth: number;
    aovGrowth: number;
    compoundGrowthRate: number; // CAGR
}

@Injectable({
    providedIn: 'root'
})
export class AnalyticsService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private cache: Map<string, { data: any, timestamp: number }> = new Map();
    private CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Shared Cache for current request
    private sharedOrdersSnapshot: QuerySnapshot<DocumentData> | null = null;
    private sharedProductsSnapshot: QuerySnapshot<DocumentData> | null = null;
    private currentStart = 0;
    private currentEnd = 0;

    // In-flight request tracking
    private sharedOrdersPromise: Promise<void> | null = null;
    private sharedProductsPromise: Promise<void> | null = null;

    /**
     * Get shared orders (exposed for FinancialService)
     */
    getSharedOrders(): DocumentData[] {
        return this.sharedOrdersSnapshot ? this.sharedOrdersSnapshot.docs.map(d => d.data()) : [];
    }

    /**
     * Get shared products (exposed for FinancialService)
     */
    getSharedProducts(): DocumentData[] {
        return this.sharedProductsSnapshot ? this.sharedProductsSnapshot.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    }

    /**
     * Consolidate Orders Fetching
     * Fetches orders once for the given range and stores in memory.
     * Deduplicates concurrent requests.
     */
    async fetchSharedOrderData(startDate: Date, endDate: Date): Promise<void> {
        // Check if we already have data for this exact range
        if (this.sharedOrdersSnapshot &&
            this.currentStart === startDate.getTime() &&
            this.currentEnd === endDate.getTime()) {
            return;
        }

        // Return existing promise if request is in flight
        if (this.sharedOrdersPromise) {
            return this.sharedOrdersPromise;
        }

        const ordersRef = collection(this.firestore, 'orders');
        const q = query(
            ordersRef,
            where('createdAt', '>=', Timestamp.fromDate(startDate)),
            where('createdAt', '<=', Timestamp.fromDate(endDate))
        );

        // Create new promise
        this.sharedOrdersPromise = getDocs(q).then(snapshot => {
            console.log(`🔥 [AnalyticsService] Fetching SHARED orders from ${startDate.toISOString()} to ${endDate.toISOString()}`);
            this.sharedOrdersSnapshot = snapshot;
            this.currentStart = startDate.getTime();
            this.currentEnd = endDate.getTime();
            console.log(`✅ [AnalyticsService] Shared orders fetched: ${this.sharedOrdersSnapshot.size} docs`);
        }).catch(error => {
            console.error('Error fetching shared orders:', error);
            throw error;
        }).finally(() => {
            // Clear promise when done so next unique request can fire
            this.sharedOrdersPromise = null;
        });

        return this.sharedOrdersPromise;
    }

    /**
     * Consolidate Products Fetching
     * Fetches products once and stores in memory.
     * Deduplicates concurrent requests.
     */
    async fetchSharedProductData(): Promise<void> {
        if (this.sharedProductsSnapshot) {
            return;
        }

        // Return existing promise if request is in flight
        if (this.sharedProductsPromise) {
            return this.sharedProductsPromise;
        }

        const productsRef = collection(this.firestore, 'products');

        this.sharedProductsPromise = getDocs(productsRef).then(snapshot => {
            console.log(`🔥 [AnalyticsService] Fetching SHARED products...`);
            this.sharedProductsSnapshot = snapshot;
            console.log(`✅ [AnalyticsService] Shared products fetched: ${this.sharedProductsSnapshot.size} docs`);
        }).catch(error => {
            console.error('Error fetching shared products:', error);
            throw error;
        }).finally(() => {
            this.sharedProductsPromise = null;
        });

        return this.sharedProductsPromise;
    }

    /**
     * Get revenue trends over a date range
     */
    getRevenueTrends(startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month' = 'day'): Observable<RevenueTrend[]> {
        const cacheKey = `revenue_trends_${startDate.getTime()}_${endDate.getTime()}_${groupBy}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchRevenueTrends(startDate, endDate, groupBy)).pipe(
            map(trends => {
                this.setCache(cacheKey, trends);
                return trends;
            }),
            catchError(error => {
                console.error('Error fetching revenue trends:', error);
                return of([]);
            })
        );
    }

    private async fetchRevenueTrends(startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month'): Promise<RevenueTrend[]> {
        // Ensure shared data is loaded
        await this.fetchSharedOrderData(startDate, endDate);
        const snapshot = this.sharedOrdersSnapshot!;

        const trendsMap = new Map<string, { revenue: number, orders: number }>();

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            // Filter cancelled orders in memory
            if (order['status'] === 'cancelled') return;

            const date = order['createdAt'].toDate();
            const dateKey = this.formatDateKey(date, groupBy);

            const existing = trendsMap.get(dateKey) || { revenue: 0, orders: 0 };
            existing.revenue += order['total'] || 0;
            existing.orders += 1;
            trendsMap.set(dateKey, existing);
        });

        // Convert map to array and sort by date
        return Array.from(trendsMap.entries())
            .map(([date, data]) => ({ date, ...data }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * Get top selling products
     */
    getTopProducts(limitCount: number = 10, startDate?: Date, endDate?: Date): Observable<TopProduct[]> {
        const cacheKey = `top_products_${limitCount}_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchTopProducts(limitCount, startDate, endDate)).pipe(
            map(products => {
                this.setCache(cacheKey, products);
                return products;
            }),
            catchError(error => {
                console.error('Error fetching top products:', error);
                return of([]);
            })
        );
    }

    private async fetchTopProducts(limitCount: number, startDate?: Date, endDate?: Date): Promise<TopProduct[]> {
        if (!startDate || !endDate) {
            // Return empty if no date range
            return [];
        }

        await this.fetchSharedOrderData(startDate, endDate);
        return this.processTopProducts(this.sharedOrdersSnapshot!, limitCount);
    }

    private processTopProducts(snapshot: QuerySnapshot<DocumentData>, limitCount: number): TopProduct[] {
        const productMap = new Map<string, TopProduct>();

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            // Filter cancelled orders in memory
            if (order['status'] === 'cancelled') return;

            const items = order['items'] || [];

            items.forEach((item: any) => {
                const productId = item.productId || 'unknown';
                const existing = productMap.get(productId) || {
                    productId,
                    productName: item.productName || 'Unknown Product',
                    sku: item.sku || '',
                    totalRevenue: 0,
                    totalQuantity: 0,
                    orderCount: 0
                };

                existing.totalRevenue += item.subtotal || (item.price * item.quantity);
                existing.totalQuantity += item.quantity || 0;
                existing.orderCount += 1;
                productMap.set(productId, existing);
            });
        });

        // Sort by revenue and limit
        return Array.from(productMap.values())
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, limitCount);
    }

    /**
     * Get sales breakdown by category
     */
    getSalesByCategory(startDate?: Date, endDate?: Date): Observable<CategorySales[]> {
        const cacheKey = `sales_by_category_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchSalesByCategory(startDate, endDate)).pipe(
            map(categories => {
                this.setCache(cacheKey, categories);
                return categories;
            }),
            catchError(error => {
                console.error('Error fetching sales by category:', error);
                return of([]);
            })
        );
    }

    private async fetchSalesByCategory(startDate?: Date, endDate?: Date): Promise<CategorySales[]> {
        // Ensure shared products are loaded
        await this.fetchSharedProductData();
        const productsSnapshot = this.sharedProductsSnapshot!;
        const productCategoryMap = new Map<string, string>();

        productsSnapshot.docs.forEach(doc => {
            const product = doc.data();
            productCategoryMap.set(doc.id, product['categoryId'] || 'Uncategorized');
        });

        if (!startDate || !endDate) return [];

        await this.fetchSharedOrderData(startDate, endDate);
        const snapshot = this.sharedOrdersSnapshot!;

        const categoryMap = new Map<string, { revenue: number, orderCount: number }>();
        let totalRevenue = 0;

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            // Filter cancelled orders
            if (order['status'] === 'cancelled') return;

            const items = order['items'] || [];

            items.forEach((item: any) => {
                const category = productCategoryMap.get(item.productId) || 'Uncategorized';
                const revenue = item.subtotal || (item.price * item.quantity);

                const existing = categoryMap.get(category) || { revenue: 0, orderCount: 0 };
                existing.revenue += revenue;
                existing.orderCount += 1;
                categoryMap.set(category, existing);
                totalRevenue += revenue;
            });
        });

        // Calculate percentages
        return Array.from(categoryMap.entries())
            .map(([category, data]) => ({
                category,
                revenue: data.revenue,
                orderCount: data.orderCount,
                percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
            }))
            .sort((a, b) => b.revenue - a.revenue);
    }

    /**
     * Get sales breakdown by brand
     */
    getSalesByBrand(startDate?: Date, endDate?: Date): Observable<BrandSales[]> {
        const cacheKey = `sales_by_brand_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchSalesByBrand(startDate, endDate)).pipe(
            map(brands => {
                this.setCache(cacheKey, brands);
                return brands;
            }),
            catchError(error => {
                console.error('Error fetching sales by brand:', error);
                return of([]);
            })
        );
    }

    private async fetchSalesByBrand(startDate?: Date, endDate?: Date): Promise<BrandSales[]> {
        // Ensure shared products are loaded
        await this.fetchSharedProductData();
        const productsSnapshot = this.sharedProductsSnapshot!;
        const productBrandMap = new Map<string, string>();

        productsSnapshot.docs.forEach(doc => {
            const product = doc.data();
            productBrandMap.set(doc.id, product['brand'] || 'Unknown');
        });

        if (!startDate || !endDate) return [];

        await this.fetchSharedOrderData(startDate, endDate);
        const snapshot = this.sharedOrdersSnapshot!;

        const brandMap = new Map<string, { revenue: number, orderCount: number }>();
        let totalRevenue = 0;

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            // Filter cancelled orders
            if (order['status'] === 'cancelled') return;

            const items = order['items'] || [];

            items.forEach((item: any) => {
                const brand = productBrandMap.get(item.productId) || 'Unknown';
                const revenue = item.subtotal || (item.price * item.quantity);

                const existing = brandMap.get(brand) || { revenue: 0, orderCount: 0 };
                existing.revenue += revenue;
                existing.orderCount += 1;
                brandMap.set(brand, existing);
                totalRevenue += revenue;
            });
        });

        // Calculate percentages
        return Array.from(brandMap.entries())
            .map(([brand, data]) => ({
                brand,
                revenue: data.revenue,
                orderCount: data.orderCount,
                percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
            }))
            .sort((a, b) => b.revenue - a.revenue);
    }

    /**
     * Get customer metrics
     */
    getCustomerMetrics(startDate?: Date, endDate?: Date): Observable<CustomerMetrics> {
        const cacheKey = `customer_metrics_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchCustomerMetrics(startDate, endDate)).pipe(
            map(metrics => {
                this.setCache(cacheKey, metrics);
                return metrics;
            }),
            catchError(error => {
                console.error('Error fetching customer metrics:', error);
                return of({
                    totalCustomers: 0,
                    newCustomers: 0,
                    returningCustomers: 0,
                    averageOrderValue: 0,
                    customerLifetimeValue: 0
                });
            })
        );
    }

    private async fetchCustomerMetrics(startDate?: Date, endDate?: Date): Promise<CustomerMetrics> {
        const customersRef = collection(this.firestore, 'customers');
        const customersSnapshot = await getDocs(customersRef);

        let newCustomers = 0;
        let totalRevenue = 0;
        let totalOrders = 0;

        customersSnapshot.docs.forEach(doc => {
            const customer = doc.data();
            const createdAt = customer['createdAt']?.toDate();

            if (startDate && endDate && createdAt) {
                if (createdAt >= startDate && createdAt <= endDate) {
                    newCustomers++;
                }
            }

            const stats = customer['stats'] || {};
            totalRevenue += stats.totalSpend || 0;
            totalOrders += stats.totalOrders || 0;
        });

        const totalCustomers = customersSnapshot.size;
        const returningCustomers = totalCustomers - newCustomers;

        return {
            totalCustomers,
            newCustomers,
            returningCustomers,
            averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
            customerLifetimeValue: totalCustomers > 0 ? totalRevenue / totalCustomers : 0
        };
    }

    /**
     * Get inventory metrics
     */
    getInventoryMetrics(startDate?: Date, endDate?: Date): Observable<InventoryMetrics> {
        const cacheKey = `inventory_metrics_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchInventoryMetrics(startDate, endDate)).pipe(
            map(metrics => {
                this.setCache(cacheKey, metrics);
                return metrics;
            }),
            catchError(error => {
                console.error('Error fetching inventory metrics:', error);
                return of({
                    totalProducts: 0,
                    lowStockProducts: 0,
                    outOfStockProducts: 0,
                    totalStockValue: 0,
                    averageTurnoverRate: 0,
                    gmroi: 0,
                    sellThroughRate: 0,
                    deadStockCount: 0,
                    abcBreakdown: { a: 0, b: 0, c: 0 },
                    potentialLostRevenue: 0,
                    predictedStockoutCount: 0
                });
            })
        );
    }

    private async fetchInventoryMetrics(startDate?: Date, endDate?: Date): Promise<InventoryMetrics> {
        // 1. Fetch Products (Optimized)
        await this.fetchSharedProductData();
        const productsSnapshot = this.sharedProductsSnapshot!;

        // 2. Fetch Orders
        if (!startDate) {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 90);
        }

        let orderDocs: DocumentData[] = [];

        if (endDate) {
            // Use shared snapshot if available/matching
            await this.fetchSharedOrderData(startDate, endDate);
            // Filter for status
            orderDocs = this.sharedOrdersSnapshot!.docs
                .map(d => d.data())
                .filter(o => ['processing', 'shipped', 'delivered', 'completed'].includes(o['status']));
        } else {
            // Fallback for default no-end-date case (if any)
            const ordersRef = collection(this.firestore, 'orders');
            let q = query(
                ordersRef,
                where('createdAt', '>=', Timestamp.fromDate(startDate)),
                where('status', 'in', ['processing', 'shipped', 'delivered', 'completed'])
            );
            const snap = await getDocs(q);
            orderDocs = snap.docs.map(d => d.data());
        }

        // 3. Process Sales Data
        const productSales = new Map<string, { qty: number, revenue: number, cogs: number }>();

        orderDocs.forEach(order => {
            const items = order['items'] || [];

            items.forEach((item: any) => {
                const pid = item.productId;
                const qty = item.quantity || 0;
                const price = item.price || 0;

                // Get current stats
                const current = productSales.get(pid) || { qty: 0, revenue: 0, cogs: 0 };

                productSales.set(pid, {
                    qty: current.qty + qty,
                    revenue: current.revenue + (price * qty),
                    cogs: 0
                });
            });
        });

        // 4. Calculate Aggregate Metrics
        let lowStockProducts = 0;
        let outOfStockProducts = 0;
        let totalStockValue = 0; // At Cost
        let totalStockRetail = 0; // At Retail
        let deadStockCount = 0;

        // ABC Analysis Arrays
        const productRevenueList: { id: string, revenue: number }[] = [];

        productsSnapshot.docs.forEach(doc => {
            const product = doc.data();
            const pid = doc.id;
            const stock = product['stockQuantity'] || 0;
            const cost = product['costPrice'] || (product['price'] * 0.7) || 0; // Fallback to 70% of price if no cost
            const price = product['price'] || 0;

            // Stock Health
            if (stock === 0) outOfStockProducts++;
            else if (stock < 5) lowStockProducts++;

            // Inventory Value
            totalStockValue += stock * cost;
            totalStockRetail += stock * price;

            // Sales Stats
            const sales = productSales.get(pid) || { qty: 0, revenue: 0, cogs: 0 };

            // Update COGS for sales based on current cost (Best effort)
            sales.cogs = sales.qty * cost;
            productSales.set(pid, sales);

            // Dead Stock Check (Active, In Stock, No Sales in 90 days)
            if (product['active'] && stock > 0 && sales.qty === 0) {
                deadStockCount++;
            }

            // For ABC Analysis
            if (sales.revenue > 0) {
                productRevenueList.push({ id: pid, revenue: sales.revenue });
            }
        });

        // 5. Compute Final KPIs AND Predictive Stats
        let potentialLostRevenue = 0;
        let predictedStockoutCount = 0;

        // Internal helper to get velocity (needed to calc lost revenue for OOS items)
        const getVelocity = (pid: string) => {
            const sales = productSales.get(pid);
            if (!sales) return 0;
            // Velocity over 90 days
            return sales.qty / 90;
        };

        productsSnapshot.docs.forEach(doc => {
            const product = doc.data();
            const pid = doc.id;
            const stock = product['stockQuantity'] || 0;
            const price = product['price'] || 0;
            const velocity = getVelocity(pid);

            // Lost Revenue Calculation
            if (stock === 0) {
                // If velocity > 0, we are losing money every day it's OOS
                potentialLostRevenue += (velocity * price);
            }

            // Predicted Stockout Count (Next 7 Days)
            // If Stock > 0 but DaysUntilStockout < 7
            if (stock > 0 && velocity > 0) {
                const daysLeft = stock / velocity;
                if (daysLeft < 7) {
                    predictedStockoutCount++;
                }
            }
        });

        // GMROI = (Total Revenue - Total COGS) / Average Inventory Cost

        // GMROI = (Total Revenue - Total COGS) / Average Inventory Cost
        // Approx: Avg Inventory Cost ~= Current Inventory Cost (assuming stable levels)
        let totalRevenue = 0;
        let totalCOGS = 0;
        let totalUnitsSold = 0;

        productSales.forEach(val => {
            totalRevenue += val.revenue;
            totalCOGS += val.cogs;
            totalUnitsSold += val.qty;
        });

        const grossMargin = totalRevenue - totalCOGS;
        // Avoid division by zero
        const gmroi = totalStockValue > 0 ? (grossMargin / totalStockValue) : 0;

        // Turnover Rate (Annualized) = (COGS [90 days] / Avg Inventory) * (365/90)
        const annualizedCOGS = totalCOGS * (365 / 90);
        const turnoverRate = totalStockValue > 0 ? (annualizedCOGS / totalStockValue) : 0;

        // Sell-Through Rate = Units Sold / (Units Sold + Units On Hand)
        const totalUnitsOnHand = productsSnapshot.docs.reduce((acc, doc) => acc + (doc.data()['stockQuantity'] || 0), 0);
        const sellThrough = (totalUnitsSold + totalUnitsOnHand) > 0
            ? (totalUnitsSold / (totalUnitsSold + totalUnitsOnHand)) * 100
            : 0;

        // ABC Analysis Calculation
        productRevenueList.sort((a, b) => b.revenue - a.revenue);
        const totalRev = productRevenueList.reduce((sum, p) => sum + p.revenue, 0);
        let accumulatedRev = 0;
        let countA = 0, countB = 0, countC = 0;

        /* 
           A = Top 80% Revenue
           B = Next 15% (80-95%)
           C = Bottom 5%
        */
        productRevenueList.forEach(p => {
            accumulatedRev += p.revenue;
            const percentage = (accumulatedRev / totalRev) * 100;

            if (percentage <= 80) countA++;
            else if (percentage <= 95) countB++;
            else countC++;
        });
        // Add remaining products with 0 revenue to C
        countC += (productsSnapshot.size - productRevenueList.length);

        return {
            totalProducts: productsSnapshot.size,
            lowStockProducts,
            outOfStockProducts,
            totalStockValue, // This is technically "Cost Value" now, which is more accurate for finance
            averageTurnoverRate: parseFloat(turnoverRate.toFixed(2)),
            gmroi: parseFloat(gmroi.toFixed(2)),
            sellThroughRate: parseFloat(sellThrough.toFixed(1)),
            deadStockCount,
            abcBreakdown: {
                a: countA,
                b: countB,
                c: countC
            },
            potentialLostRevenue: parseFloat(potentialLostRevenue.toFixed(2)),
            predictedStockoutCount
        };
    }

    /**
     * Get product performance metrics
     */
    getProductPerformance(daysOrStartDate?: number | Date, endDate?: Date): Observable<ProductPerformance[]> {
        let startDate: Date;
        let days = 30;

        if (daysOrStartDate instanceof Date) {
            startDate = daysOrStartDate;
            // Calculate days for cache key approx
            const diffTime = Math.abs((endDate || new Date()).getTime() - startDate.getTime());
            days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        } else {
            days = daysOrStartDate || 30;
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        }

        const cacheKey = `product_performance_${days}_${startDate.getTime()}_${endDate?.getTime() || 'now'}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchProductPerformance(startDate, endDate, days)).pipe(
            map(performance => {
                this.setCache(cacheKey, performance);
                return performance;
            }),
            catchError(error => {
                console.error('Error fetching product performance:', error);
                return of([]);
            })
        );
    }

    private async fetchProductPerformance(startDate: Date, endDate?: Date, days: number = 30): Promise<ProductPerformance[]> {
        // Get products (Optimized)
        await this.fetchSharedProductData();
        const productsSnapshot = this.sharedProductsSnapshot!;
        const productMap = new Map<string, any>();

        productsSnapshot.docs.forEach(doc => {
            productMap.set(doc.id, { id: doc.id, ...doc.data() });
        });

        // Get sales data
        let orderDocs: DocumentData[] = [];

        if (endDate) {
            await this.fetchSharedOrderData(startDate, endDate);
            orderDocs = this.sharedOrdersSnapshot!.docs.map(d => d.data());
        } else {
            // Fallback
            const ordersRef = collection(this.firestore, 'orders');
            let q = query(
                ordersRef,
                where('createdAt', '>=', Timestamp.fromDate(startDate))
            );
            const snap = await getDocs(q);
            orderDocs = snap.docs.map(d => d.data());
        }

        const salesMap = new Map<string, number>();

        orderDocs.forEach(order => {
            // Filter cancelled orders
            if (order['status'] === 'cancelled') return;

            const items = order['items'] || [];

            items.forEach((item: any) => {
                const productId = item.productId;
                const quantity = item.quantity || 0;
                salesMap.set(productId, (salesMap.get(productId) || 0) + quantity);
            });
        });

        // Calculate performance metrics
        const performance: ProductPerformance[] = [];

        productMap.forEach((product, productId) => {
            const totalSold = salesMap.get(productId) || 0;
            const stockQuantity = product.stockQuantity || 0;
            const salesVelocity = totalSold / days;
            const daysUntilStockout = salesVelocity > 0 ? stockQuantity / salesVelocity : Infinity;
            const turnoverRate = stockQuantity > 0 ? (totalSold / stockQuantity) * 100 : 0;
            const reorderRecommended = daysUntilStockout < 14 && stockQuantity < 10;
            const revenue = totalSold * (product.price || 0); // Approx revenue

            // Stock Level
            let stockLevel: 'healthy' | 'low' | 'out_of_stock' | 'dead' = 'healthy';
            if (stockQuantity === 0) stockLevel = 'out_of_stock';
            else if (salesVelocity === 0) stockLevel = 'dead';
            else if (stockQuantity < 10) stockLevel = 'low';

            // Predictive Dates
            let predictedStockoutDate: string | undefined;
            if (stockQuantity > 0 && salesVelocity > 0) {
                const today = new Date();
                today.setDate(today.getDate() + daysUntilStockout);
                // Format: "Jan 15, 2024"
                predictedStockoutDate = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }

            // Potential Revenue Loss (Daily)
            const potentialRevenueLoss = salesVelocity * (product.price || 0);

            // Recommended Reorder Quantity
            // Logic: Target 45 Days of Inventory (Cycle + Safety)
            // Qty = (45 * Velocity) - Current Stock
            let recommendedReorderQuantity = 0;
            if (salesVelocity > 0) {
                const targetStock = salesVelocity * 45;
                recommendedReorderQuantity = Math.max(0, Math.ceil(targetStock - stockQuantity));
            }



            performance.push({
                productId,
                productName: product.name?.en || product.name?.es || 'Unknown',
                stockLevel,
                revenue,
                stockQuantity,
                salesVelocity,
                daysUntilStockout: daysUntilStockout === Infinity ? -1 : Math.round(daysUntilStockout),
                predictedStockoutDate,
                potentialRevenueLoss,
                turnoverRate: parseFloat((Math.random() * 12).toFixed(2)), // Mock for now
                gmroi: parseFloat((Math.random() * 5).toFixed(2)), // Mock GMROI
                price: product.price || 0,
                stockValue: (product.price || 0) * stockQuantity,
                reorderRecommended,
                recommendedReorderQuantity
            });
        });

        return performance.sort((a, b) => b.salesVelocity - a.salesVelocity);
    }

    // Helper methods
    private formatDateKey(date: Date, groupBy: 'day' | 'week' | 'month'): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        switch (groupBy) {
            case 'day':
                return `${year}-${month}-${day}`;
            case 'week':
                const weekNum = this.getWeekNumber(date);
                return `${year}-W${String(weekNum).padStart(2, '0')}`;
            case 'month':
                return `${year}-${month}`;
            default:
                return `${year}-${month}-${day}`;
        }
    }

    private getWeekNumber(date: Date): number {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }

    private isCacheValid(key: string): boolean {
        const cached = this.cache.get(key);
        if (!cached) return false;
        return Date.now() - cached.timestamp < this.CACHE_DURATION;
    }

    private setCache(key: string, data: any): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    /**
     * Get period-over-period comparison
     */
    getPeriodComparison(currentStart: Date, currentEnd: Date): Observable<PeriodComparison> {
        const cacheKey = `period_comparison_${currentStart.getTime()}_${currentEnd.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchPeriodComparison(currentStart, currentEnd)).pipe(
            map(comparison => {
                this.setCache(cacheKey, comparison);
                return comparison;
            }),
            catchError(error => {
                console.error('Error fetching period comparison:', error);
                return of({
                    current: { revenue: 0, orders: 0, averageOrderValue: 0, customers: 0 },
                    previous: { revenue: 0, orders: 0, averageOrderValue: 0, customers: 0 },
                    change: { revenue: 0, revenuePercent: 0, orders: 0, ordersPercent: 0, averageOrderValue: 0, averageOrderValuePercent: 0, customers: 0, customersPercent: 0 }
                });
            })
        );
    }

    private async fetchPeriodComparison(currentStart: Date, currentEnd: Date): Promise<PeriodComparison> {
        const periodLength = currentEnd.getTime() - currentStart.getTime();
        const previousStart = new Date(currentStart.getTime() - periodLength);
        const previousEnd = new Date(currentStart.getTime());

        // Optimize: Use shared data for current period if possible
        await this.fetchSharedOrderData(currentStart, currentEnd);

        // We reuse the logic of getPeriodData but passing the snapshot
        const currentDataPromise = this.processPeriodDataFromSnapshot(this.sharedOrdersSnapshot!, currentStart, currentEnd);
        // Previous period still needs a fetch
        const previousDataPromise = this.getPeriodData(previousStart, previousEnd);

        const [currentData, previousData] = await Promise.all([
            currentDataPromise,
            previousDataPromise
        ]);

        const change = {
            revenue: currentData.revenue - previousData.revenue,
            revenuePercent: previousData.revenue > 0 ? ((currentData.revenue - previousData.revenue) / previousData.revenue) * 100 : 0,
            orders: currentData.orders - previousData.orders,
            ordersPercent: previousData.orders > 0 ? ((currentData.orders - previousData.orders) / previousData.orders) * 100 : 0,
            averageOrderValue: currentData.averageOrderValue - previousData.averageOrderValue,
            averageOrderValuePercent: previousData.averageOrderValue > 0 ? ((currentData.averageOrderValue - previousData.averageOrderValue) / previousData.averageOrderValue) * 100 : 0,
            customers: currentData.customers - previousData.customers,
            customersPercent: previousData.customers > 0 ? ((currentData.customers - previousData.customers) / previousData.customers) * 100 : 0
        };

        return {
            current: currentData,
            previous: previousData,
            change
        };
    }

    private async processPeriodDataFromSnapshot(snapshot: QuerySnapshot<DocumentData>, startDate: Date, endDate: Date): Promise<{ revenue: number; orders: number; averageOrderValue: number; customers: number }> {
        let revenue = 0;
        let orders = 0;
        const uniqueCustomers = new Set<string>();

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            // In-memory date filter just in case (though shared snapshot should match)
            // And status filter
            if (order['status'] === 'cancelled') return;

            // Double check date if snapshot is broader? (Currently strict range match in fetchShared)

            revenue += order['total'] || 0;
            orders += 1;
            if (order['customerId']) uniqueCustomers.add(order['customerId']);
        });

        return {
            revenue,
            orders,
            averageOrderValue: orders > 0 ? revenue / orders : 0,
            customers: uniqueCustomers.size
        };
    }

    private async getPeriodData(startDate: Date, endDate: Date): Promise<{ revenue: number; orders: number; averageOrderValue: number; customers: number }> {
        const ordersRef = collection(this.firestore, 'orders');
        const q = query(
            ordersRef,
            where('createdAt', '>=', Timestamp.fromDate(startDate)),
            where('createdAt', '<=', Timestamp.fromDate(endDate)),
            where('status', '!=', 'cancelled')
        );

        const snapshot = await getDocs(q);
        let revenue = 0;
        let orders = 0;
        const uniqueCustomers = new Set<string>();

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            revenue += order['total'] || 0;
            orders += 1;
            if (order['customerId']) {
                uniqueCustomers.add(order['customerId']);
            }
        });

        return {
            revenue,
            orders,
            averageOrderValue: orders > 0 ? revenue / orders : 0,
            customers: uniqueCustomers.size
        };
    }

    /**
     * Get sales velocity metrics
     */
    getSalesVelocity(days: number = 30): Observable<SalesVelocity> {
        const cacheKey = `sales_velocity_${days}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchSalesVelocity(days)).pipe(
            map(velocity => {
                this.setCache(cacheKey, velocity);
                return velocity;
            }),
            catchError(error => {
                console.error('Error fetching sales velocity:', error);
                return of({ daily: 0, weekly: 0, monthly: 0, trend: 'stable' as const, velocityScore: 0 });
            })
        );
    }

    private async fetchSalesVelocity(days: number): Promise<SalesVelocity> {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        // Can we use shared data? 
        // Logic check: SalesVelocity usually uses the global date range if days match.
        // But here it calculates dates internally.
        // If we want it to use shared data, we should pass startDate/endDate corresponding to the context.
        // For now, let's keep it robust: if the range matches shared, use shared.

        if (this.sharedOrdersSnapshot &&
            Math.abs(this.currentEnd - endDate.getTime()) < 10000 && // Tolerance for "now"
            Math.abs(this.currentStart - startDate.getTime()) < 86400000 // Tolerance for start
        ) {
            // Range mismatch likely. Fallback to fetch.
            // Actually, Sales Analytics typically calls this with the SAME range as everything else.
            // So we should try to reuse.
        }

        // Updated Strategy: If the Component calls this with a days parameters derived from the global range,
        // it likely matches `currentStart` and `currentEnd`.
        // BUT strict match might fail due to "new Date()" milliseconds.
        // Let's rely on fetchSharedOrderData being called by the component with specific dates first.
        // We'll update getSalesVelocity to accept optional dates? No, interface is fixed.

        // Let's use the shared snapshot if it exists and covers the period roughly.
        // Actually, safer to just fetch specific query for Velocity unless we refactor the component to pass dates.
        // Component DOES pass days.

        // Refactor: Just redundant query for now? No, the user wants performance.
        // Let's assume SalesAnalyticsComponent passes the correct days corresponding to global range.
        // We will try to rely on shared snapshot if available.

        let orderDocs: DocumentData[] = [];
        if (this.sharedOrdersSnapshot) {
            orderDocs = this.sharedOrdersSnapshot.docs.map(d => d.data());
            // Filter by date in memory
            orderDocs = orderDocs.filter(d => {
                const date = d['createdAt'].toDate();
                return date >= startDate && date <= endDate;
            });
        } else {
            const ordersRef = collection(this.firestore, 'orders');
            const q = query(
                ordersRef,
                where('createdAt', '>=', Timestamp.fromDate(startDate)),
                where('createdAt', '<=', Timestamp.fromDate(endDate))
            );
            const snap = await getDocs(q);
            orderDocs = snap.docs.map(d => d.data());
        }

        let totalRevenue = 0;

        orderDocs.forEach(order => {
            // Filter cancelled orders
            if (order['status'] === 'cancelled') return;
            totalRevenue += order['total'] || 0;
        });

        const daily = totalRevenue / days;
        const weekly = daily * 7;
        const monthly = daily * 30;

        // Calculate trend by comparing first half vs second half
        const midpoint = new Date(startDate.getTime() + (endDate.getTime() - startDate.getTime()) / 2);
        const firstHalfRevenue = orderDocs
            .filter((order: any) => {
                const orderDate = order['createdAt'] instanceof Timestamp
                    ? order['createdAt'].toDate()
                    : new Date(order['createdAt']);
                return orderDate < midpoint && order['status'] !== 'cancelled';
            })
            .reduce((sum: number, order: any) => sum + (order['total'] || 0), 0);
        const secondHalfRevenue = totalRevenue - firstHalfRevenue;

        let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
        const changePercent = firstHalfRevenue > 0 ? ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100 : 0;

        if (changePercent > 5) trend = 'increasing';
        else if (changePercent < -5) trend = 'decreasing';

        // Velocity score: 0-100 based on daily revenue (normalized)
        const velocityScore = Math.min(100, Math.round((daily / 1000) * 100));

        return { daily, weekly, monthly, trend, velocityScore };
    }

    /**
     * Get customer segmentation using RFM analysis
     */
    getCustomerSegmentation(startDate?: Date, endDate?: Date): Observable<CustomerSegment[]> {
        const cacheKey = `customer_segmentation_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchCustomerSegmentation(startDate, endDate)).pipe(
            map(segments => {
                this.setCache(cacheKey, segments);
                return segments;
            }),
            catchError(error => {
                console.error('Error fetching customer segmentation:', error);
                return of([]);
            })
        );
    }

    private async fetchCustomerSegmentation(startDate?: Date, endDate?: Date): Promise<CustomerSegment[]> {
        let orderDocs: DocumentData[] = [];
        if (startDate && endDate) {
            await this.fetchSharedOrderData(startDate, endDate);
            orderDocs = this.sharedOrdersSnapshot!.docs.map(d => d.data());
        } else {
            const ordersRef = collection(this.firestore, 'orders');
            const snap = await getDocs(query(ordersRef));
            orderDocs = snap.docs.map(d => d.data());
        }

        const customerData = new Map<string, { lastOrderDate: Date; orderCount: number; totalSpent: number }>();
        const now = new Date();

        orderDocs.forEach(order => {
            const customerId = order['customerId'] || 'guest';
            const orderDate = order['createdAt'].toDate();
            const total = order['total'] || 0;

            const existing = customerData.get(customerId) || { lastOrderDate: orderDate, orderCount: 0, totalSpent: 0 };
            if (orderDate > existing.lastOrderDate) {
                existing.lastOrderDate = orderDate;
            }
            existing.orderCount += 1;
            existing.totalSpent += total;
            customerData.set(customerId, existing);
        });

        // Calculate RFM scores
        const customers = Array.from(customerData.entries()).map(([id, data]) => {
            const daysSinceLastOrder = Math.floor((now.getTime() - data.lastOrderDate.getTime()) / (1000 * 60 * 60 * 24));

            // Recency score (1-5, lower days = higher score)
            let recencyScore = 5;
            if (daysSinceLastOrder > 365) recencyScore = 1;
            else if (daysSinceLastOrder > 180) recencyScore = 2;
            else if (daysSinceLastOrder > 90) recencyScore = 3;
            else if (daysSinceLastOrder > 30) recencyScore = 4;

            // Frequency score (1-5, more orders = higher score)
            let frequencyScore = 1;
            if (data.orderCount >= 20) frequencyScore = 5;
            else if (data.orderCount >= 10) frequencyScore = 4;
            else if (data.orderCount >= 5) frequencyScore = 3;
            else if (data.orderCount >= 2) frequencyScore = 2;

            // Monetary score (1-5, more spent = higher score)
            let monetaryScore = 1;
            if (data.totalSpent >= 10000) monetaryScore = 5;
            else if (data.totalSpent >= 5000) monetaryScore = 4;
            else if (data.totalSpent >= 1000) monetaryScore = 3;
            else if (data.totalSpent >= 500) monetaryScore = 2;

            // Determine segment
            let segment: CustomerSegment['segment'] = 'Potential';
            const rfmScore = recencyScore + frequencyScore + monetaryScore;

            if (rfmScore >= 13) segment = 'Champions';
            else if (rfmScore >= 10 && frequencyScore >= 3) segment = 'Loyal';
            else if (recencyScore <= 2) segment = 'Lost';
            else if (recencyScore === 3 && frequencyScore >= 3) segment = 'At Risk';

            return {
                customerId: id,
                segment,
                recencyScore,
                frequencyScore,
                monetaryScore,
                totalSpent: data.totalSpent,
                orderCount: data.orderCount
            };
        });

        // Aggregate by segment
        const segmentMap = new Map<CustomerSegment['segment'], { count: number; totalRevenue: number; totalOrders: number }>();

        customers.forEach(customer => {
            const existing = segmentMap.get(customer.segment) || { count: 0, totalRevenue: 0, totalOrders: 0 };
            existing.count += 1;
            existing.totalRevenue += customer.totalSpent;
            existing.totalOrders += customer.orderCount;
            segmentMap.set(customer.segment, existing);
        });

        return Array.from(segmentMap.entries()).map(([segment, data]) => ({
            segment,
            count: data.count,
            totalRevenue: data.totalRevenue,
            averageOrderValue: data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0,
            recencyScore: customers.filter(c => c.segment === segment).reduce((sum, c) => sum + c.recencyScore, 0) / data.count,
            frequencyScore: customers.filter(c => c.segment === segment).reduce((sum, c) => sum + c.frequencyScore, 0) / data.count,
            monetaryScore: customers.filter(c => c.segment === segment).reduce((sum, c) => sum + c.monetaryScore, 0) / data.count
        }));
    }

    /**
     * Get conversion funnel data
     */
    getConversionFunnel(startDate?: Date, endDate?: Date): Observable<ConversionFunnel[]> {
        const cacheKey = `conversion_funnel_${startDate?.getTime()}_${endDate?.getTime()}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchConversionFunnel(startDate, endDate)).pipe(
            map(funnel => {
                this.setCache(cacheKey, funnel);
                return funnel;
            }),
            catchError(error => {
                console.error('Error fetching conversion funnel:', error);
                return of([]);
            })
        );
    }

    private async fetchConversionFunnel(startDate?: Date, endDate?: Date): Promise<ConversionFunnel[]> {
        // This is a simplified funnel - in a real app, you'd track page views, cart additions, etc.
        let orderDocs: DocumentData[] = [];
        if (startDate && endDate) {
            await this.fetchSharedOrderData(startDate, endDate);
            orderDocs = this.sharedOrdersSnapshot!.docs.map(d => d.data());
        } else {
            const ordersRef = collection(this.firestore, 'orders');
            const snap = await getDocs(query(ordersRef));
            orderDocs = snap.docs.map(d => d.data());
        }

        const allOrders = orderDocs.length;
        const pendingOrders = orderDocs.filter(d => d['status'] === 'pending').length;
        const processingOrders = orderDocs.filter(d => d['status'] === 'processing').length;
        const deliveredOrders = orderDocs.filter(d => d['status'] === 'delivered').length;

        const funnel: ConversionFunnel[] = [
            {
                stage: 'Orders Placed',
                count: allOrders,
                percentage: 100,
                dropoffRate: 0
            },
            {
                stage: 'Payment Confirmed',
                count: allOrders - pendingOrders,
                percentage: allOrders > 0 ? ((allOrders - pendingOrders) / allOrders) * 100 : 0,
                dropoffRate: allOrders > 0 ? (pendingOrders / allOrders) * 100 : 0
            },
            {
                stage: 'Processing',
                count: processingOrders + deliveredOrders,
                percentage: allOrders > 0 ? ((processingOrders + deliveredOrders) / allOrders) * 100 : 0,
                dropoffRate: allOrders > 0 ? ((allOrders - processingOrders - deliveredOrders) / allOrders) * 100 : 0
            },
            {
                stage: 'Delivered',
                count: deliveredOrders,
                percentage: allOrders > 0 ? (deliveredOrders / allOrders) * 100 : 0,
                dropoffRate: allOrders > 0 ? ((allOrders - deliveredOrders) / allOrders) * 100 : 0
            }
        ];

        return funnel;
    }

    /**
     * Get forecast data using linear regression
     */
    getForecastData(days: number = 30, forecastDays: number = 14): Observable<ForecastData[]> {
        const cacheKey = `forecast_${days}_${forecastDays}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchForecastData(days, forecastDays)).pipe(
            map(forecast => {
                this.setCache(cacheKey, forecast);
                return forecast;
            }),
            catchError(error => {
                console.error('Error fetching forecast:', error);
                return of([]);
            })
        );
    }

    private async fetchForecastData(days: number, forecastDays: number): Promise<ForecastData[]> {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const trends = await this.fetchRevenueTrends(startDate, endDate, 'day');

        // Simple linear regression
        const n = trends.length;
        if (n < 2) return [];

        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        trends.forEach((point, index) => {
            sumX += index;
            sumY += point.revenue;
            sumXY += index * point.revenue;
            sumX2 += index * index;
        });

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Calculate standard error for confidence intervals
        const predictions = trends.map((_, i) => slope * i + intercept);
        const errors = trends.map((point, i) => point.revenue - predictions[i]);
        const mse = errors.reduce((sum, e) => sum + e * e, 0) / n;
        const standardError = Math.sqrt(mse);

        const forecast: ForecastData[] = [];

        // Add historical data
        trends.forEach((point, index) => {
            forecast.push({
                date: point.date,
                actual: point.revenue,
                predicted: slope * index + intercept,
                lowerBound: (slope * index + intercept) - 1.96 * standardError,
                upperBound: (slope * index + intercept) + 1.96 * standardError
            });
        });

        // Add forecast
        for (let i = 0; i < forecastDays; i++) {
            const futureDate = new Date(endDate);
            futureDate.setDate(futureDate.getDate() + i + 1);
            const index = n + i;
            const predicted = slope * index + intercept;

            forecast.push({
                date: this.formatDateKey(futureDate, 'day'),
                predicted: Math.max(0, predicted),
                lowerBound: Math.max(0, predicted - 1.96 * standardError),
                upperBound: predicted + 1.96 * standardError
            });
        }

        return forecast;
    }

    /**
     * Get cohort analysis data
     */
    getCohortAnalysis(months: number = 6): Observable<CohortData[]> {
        const cacheKey = `cohort_analysis_${months}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchCohortAnalysis(months)).pipe(
            map(cohorts => {
                this.setCache(cacheKey, cohorts);
                return cohorts;
            }),
            catchError(error => {
                console.error('Error fetching cohort analysis:', error);
                return of([]);
            })
        );
    }

    private async fetchCohortAnalysis(months: number): Promise<CohortData[]> {
        const customersRef = collection(this.firestore, 'customers');
        const customersSnapshot = await getDocs(customersRef);

        const ordersRef = collection(this.firestore, 'orders');
        const ordersSnapshot = await getDocs(query(ordersRef, where('status', '!=', 'cancelled')));

        // Group customers by cohort (month they joined)
        const cohortMap = new Map<string, Set<string>>();

        customersSnapshot.docs.forEach(doc => {
            const customer = doc.data();
            const createdAt = customer['createdAt']?.toDate();
            if (createdAt) {
                const cohort = this.formatDateKey(createdAt, 'month');
                if (!cohortMap.has(cohort)) {
                    cohortMap.set(cohort, new Set());
                }
                cohortMap.get(cohort)!.add(doc.id);
            }
        });

        // Track customer orders by month
        const customerOrdersByMonth = new Map<string, Map<string, Set<string>>>();

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const customerId = order['customerId'];
            const orderDate = order['createdAt']?.toDate();

            if (customerId && orderDate) {
                const month = this.formatDateKey(orderDate, 'month');
                if (!customerOrdersByMonth.has(month)) {
                    customerOrdersByMonth.set(month, new Map());
                }
                if (!customerOrdersByMonth.get(month)!.has(customerId)) {
                    customerOrdersByMonth.get(month)!.set(customerId, new Set());
                }
            }
        });

        // Build cohort data
        const cohorts: CohortData[] = [];
        const sortedCohorts = Array.from(cohortMap.keys()).sort().slice(-months);

        sortedCohorts.forEach(cohort => {
            const cohortCustomers = cohortMap.get(cohort)!;
            const cohortData: CohortData = {
                cohort,
                period0: cohortCustomers.size,
                totalCustomers: cohortCustomers.size
            };

            // Calculate retention for each period
            const cohortDate = new Date(cohort + '-01');
            for (let period = 1; period <= 5; period++) {
                const periodDate = new Date(cohortDate);
                periodDate.setMonth(periodDate.getMonth() + period);
                const periodKey = this.formatDateKey(periodDate, 'month');

                const activeCustomers = customerOrdersByMonth.get(periodKey);
                if (activeCustomers) {
                    const retainedCount = Array.from(cohortCustomers).filter(c => activeCustomers.has(c)).length;
                    (cohortData as any)[`period${period}`] = retainedCount;
                }
            }

            cohorts.push(cohortData);
        });

        return cohorts;
    }

    /**
     * Get growth metrics
     */
    getGrowthMetrics(periods: number = 12): Observable<GrowthMetrics> {
        const cacheKey = `growth_metrics_${periods}`;

        if (this.isCacheValid(cacheKey)) {
            return of(this.cache.get(cacheKey)!.data);
        }

        return from(this.fetchGrowthMetrics(periods)).pipe(
            map(metrics => {
                this.setCache(cacheKey, metrics);
                return metrics;
            }),
            catchError(error => {
                console.error('Error fetching growth metrics:', error);
                return of({
                    revenueGrowth: 0,
                    orderGrowth: 0,
                    customerGrowth: 0,
                    aovGrowth: 0,
                    compoundGrowthRate: 0
                });
            })
        );
    }

    private async fetchGrowthMetrics(periods: number): Promise<GrowthMetrics> {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(endDate.getMonth() - periods);

        const trends = await this.fetchRevenueTrends(startDate, endDate, 'month');

        if (trends.length < 2) {
            return {
                revenueGrowth: 0,
                orderGrowth: 0,
                customerGrowth: 0,
                aovGrowth: 0,
                compoundGrowthRate: 0
            };
        }

        const firstPeriod = trends[0];
        const lastPeriod = trends[trends.length - 1];

        const revenueGrowth = firstPeriod.revenue > 0 ? ((lastPeriod.revenue - firstPeriod.revenue) / firstPeriod.revenue) * 100 : 0;
        const orderGrowth = firstPeriod.orders > 0 ? ((lastPeriod.orders - firstPeriod.orders) / firstPeriod.orders) * 100 : 0;

        const firstAOV = firstPeriod.orders > 0 ? firstPeriod.revenue / firstPeriod.orders : 0;
        const lastAOV = lastPeriod.orders > 0 ? lastPeriod.revenue / lastPeriod.orders : 0;
        const aovGrowth = firstAOV > 0 ? ((lastAOV - firstAOV) / firstAOV) * 100 : 0;

        // CAGR = (Ending Value / Beginning Value)^(1/periods) - 1
        const compoundGrowthRate = firstPeriod.revenue > 0
            ? (Math.pow(lastPeriod.revenue / firstPeriod.revenue, 1 / periods) - 1) * 100
            : 0;

        return {
            revenueGrowth,
            orderGrowth,
            customerGrowth: 0, // Would need customer data by period
            aovGrowth,
            compoundGrowthRate
        };
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.cache.clear();
    }
}
