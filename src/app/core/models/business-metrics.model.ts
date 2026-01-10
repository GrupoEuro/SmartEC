import { Timestamp } from '@angular/fire/firestore';

/**
 * Daily aggregated business metrics
 * Stored in Firestore collection: business_metrics
 */
export interface DailyMetrics {
    date: string;  // YYYY-MM-DD format
    revenue: number;
    orders: number;
    averageOrderValue: number;
    newCustomers: number;
    returningCustomers: number;
    grossMargin: number;  // percentage (0-1)
    netMargin: number;    // percentage (0-1)
    inventoryValue: number;
    slaCompliance: number;  // percentage (0-1)
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * KPI Card data structure for dashboard
 */
export interface KPICard {
    title: string;
    value: number | string;
    change: number;  // percentage change
    changeLabel: string;  // "vs yesterday", "vs last month", etc.
    icon: string;
    trend: 'up' | 'down' | 'neutral';
    format: 'currency' | 'number' | 'percentage';
    loading?: boolean;
}

/**
 * Chart data structure for Chart.js
 */
export interface MetricChartData {
    labels: string[];
    datasets: {
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string;
        borderWidth?: number;
        fill?: boolean;
    }[];
}

/**
 * Revenue trend data point
 */
export interface RevenueTrendPoint {
    date: string;
    revenue: number;
    orders: number;
}

/**
 * Order status distribution
 */
export interface OrderStatusCount {
    status: string;
    count: number;
    percentage: number;
}

/**
 * Top product data
 */
export interface TopProduct {
    name: string;
    revenue: number;
    quantity: number;
}
