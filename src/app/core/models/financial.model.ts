import { Timestamp } from '@angular/fire/firestore';

/**
 * Product cost tracking
 */
export interface ProductCost {
    productId: string;
    costPrice: number;
    currency: string;
    supplierId?: string;
    supplierName?: string;
    effectiveDate: Timestamp;
    notes?: string;
}

/**
 * Cost history for tracking changes
 */
export interface CostHistory {
    id: string;
    productId: string;
    previousCost: number;
    newCost: number;
    changePercentage: number;
    changedBy: string;
    changedAt: Timestamp;
    reason?: string;
}

/**
 * Revenue metrics
 */
export interface RevenueMetrics {
    period: 'daily' | 'weekly' | 'monthly' | 'yearly';
    startDate: Date;
    endDate: Date;

    // Revenue
    totalRevenue: number;
    averageOrderValue: number;
    orderCount: number;

    // Growth
    previousPeriodRevenue: number;
    growthAmount: number;
    growthPercentage: number;

    // Breakdown
    byCategory: CategoryRevenue[];
    byBrand: BrandRevenue[];
    byProduct: ProductRevenue[];
}

/**
 * Margin metrics
 */
export interface MarginMetrics {
    period: 'daily' | 'weekly' | 'monthly' | 'yearly';
    startDate: Date;
    endDate: Date;

    // Costs
    totalCost: number;
    totalRevenue: number;

    // Margins
    grossProfit: number;
    grossMargin: number; // percentage

    // Breakdown
    byCategory: CategoryMargin[];
    byBrand: BrandMargin[];
    byProduct: ProductMargin[];
}

/**
 * Profitability analysis
 */
export interface ProfitabilityAnalysis {
    productId: string;
    productName: string;
    sku: string;

    // Sales
    unitsSold: number;
    totalRevenue: number;
    averagePrice: number;

    // Costs
    unitCost: number;
    totalCost: number;

    // Profitability
    grossProfit: number;
    grossMargin: number;
    profitPerUnit: number;

    // Performance
    rank: number;
    contribution: number; // % of total profit
}

/**
 * Financial forecast
 */
export interface FinancialForecast {
    period: 'monthly' | 'quarterly' | 'yearly';
    forecastDate: Date;

    // Predictions
    predictedRevenue: number;
    predictedCost: number;
    predictedProfit: number;
    predictedMargin: number;

    // Confidence
    confidenceLevel: number; // 0-100
    method: 'linear' | 'exponential' | 'seasonal';

    // Historical basis
    historicalPeriods: number;
    baselineRevenue: number;
}

/**
 * Revenue target
 */
export interface RevenueTarget {
    id: string;
    period: 'monthly' | 'quarterly' | 'yearly';
    year: number;
    month?: number; // 1-12
    quarter?: number; // 1-4

    // Targets
    revenueTarget: number;
    profitTarget: number;
    marginTarget: number; // percentage

    // Actual
    actualRevenue: number;
    actualProfit: number;
    actualMargin: number;

    // Performance
    revenueAchievement: number; // percentage
    profitAchievement: number; // percentage
    status: 'on-track' | 'at-risk' | 'behind' | 'exceeded';
}

/**
 * Financial snapshot (daily aggregate)
 */
export interface FinancialSnapshot {
    id: string;
    date: Date;

    // Revenue
    revenue: number;
    orderCount: number;
    averageOrderValue: number;

    // Costs
    totalCost: number;

    // Profit
    grossProfit: number;
    grossMargin: number;

    // Metadata
    createdAt: Timestamp;
}

// Helper types for breakdowns
export interface CategoryRevenue {
    categoryId: string;
    categoryName: string;
    revenue: number;
    percentage: number;
}

export interface BrandRevenue {
    brandId: string;
    brandName: string;
    revenue: number;
    percentage: number;
}

export interface ProductRevenue {
    productId: string;
    productName: string;
    revenue: number;
    percentage: number;
}

export interface CategoryMargin {
    categoryId: string;
    categoryName: string;
    revenue: number;
    cost: number;
    margin: number;
}

export interface BrandMargin {
    brandId: string;
    brandName: string;
    revenue: number;
    cost: number;
    margin: number;
}

export interface ProductMargin {
    productId: string;
    productName: string;
    revenue: number;
    cost: number;
    margin: number;
}

/**
 * Period selector type
 */
export type FinancialPeriod = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'mtd' | 'lastMonth' | 'ytd' | 'lastYear' | 'custom';

/**
 * Date range for financial queries
 */
export interface DateRange {
    startDate: Date;
    endDate: Date;
    label: string;
}

/**
 * Boston Matrix Data Point
 */
export interface BostonMatrixPoint {
    productId: string;
    productName: string;
    categoryName: string;

    // Coordinates
    x: number; // Market Share (Relative to Category)
    y: number; // Growth Rate (%)
    r: number; // Revenue (Bubble Radius)

    // Metadata
    quadrant: 'stars' | 'cows' | 'questions' | 'dogs';
    revenue: number;
    growth: number;
    share: number;
}

export interface BostonMatrixData {
    period: string;
    points: BostonMatrixPoint[];
}
