
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { Observable, combineLatest, map, of, switchMap, from } from 'rxjs';
import { OrderService } from './order.service';
import { ProductService } from './product.service';
import { AnalyticsService } from '../../services/analytics.service';
import { MetricsBigqueryService } from '../../pages/operations/metrics/services/metrics-bigquery.service';
import {
    RevenueMetrics,
    MarginMetrics,
    ProfitabilityAnalysis,
    FinancialForecast,
    CategoryRevenue,
    BrandRevenue,
    ProductRevenue,
    CategoryMargin,
    BrandMargin,
    ProductMargin,
    DateRange,

    FinancialPeriod,
    BostonMatrixData,
    BostonMatrixPoint
} from '../models/financial.model';

@Injectable({
    providedIn: 'root'
})
export class FinancialService {
    private firestore = inject(Firestore); // Keep for now if needed, though AnalyticsService handles data
    private orderService = inject(OrderService);
    private productService = inject(ProductService);
    private analyticsService = inject(AnalyticsService);

    /**
     * Get date range for a financial period
     */
    getDateRangeForPeriod(period: FinancialPeriod): DateRange {
        const now = new Date();
        const today = new Date(now.setHours(0, 0, 0, 0));

        switch (period) {
            case 'today':
                return {
                    startDate: today,
                    endDate: new Date(),
                    label: 'Today'
                };

            case 'yesterday':
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                return {
                    startDate: yesterday,
                    endDate: today,
                    label: 'Yesterday'
                };

            case 'last7days':
                const last7 = new Date(today);
                last7.setDate(last7.getDate() - 7);
                return {
                    startDate: last7,
                    endDate: new Date(),
                    label: 'Last 7 Days'
                };

            case 'last30days':
                const last30 = new Date(today);
                last30.setDate(last30.getDate() - 30);
                return {
                    startDate: last30,
                    endDate: new Date(),
                    label: 'Last 30 Days'
                };

            case 'mtd':
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                return {
                    startDate: monthStart,
                    endDate: new Date(),
                    label: 'Month to Date'
                };

            case 'lastMonth':
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                return {
                    startDate: lastMonthStart,
                    endDate: lastMonthEnd,
                    label: 'Last Month'
                };

            case 'ytd':
                const yearStart = new Date(now.getFullYear(), 0, 1);
                return {
                    startDate: yearStart,
                    endDate: new Date(),
                    label: 'Year to Date'
                };

            case 'lastYear':
                const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
                const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
                return {
                    startDate: lastYearStart,
                    endDate: lastYearEnd,
                    label: 'Last Year'
                };

            default:
                return {
                    startDate: today,
                    endDate: new Date(),
                    label: 'Custom'
                };
        }
    }

    private bqService = inject(MetricsBigqueryService);

    private formatDate(d: Date): string {
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    }

    /**
     * Get all financial dashboard data in a single optimized pass using BigQuery
     */
    getFinancialDashboardData(startDate: Date, endDate: Date): Observable<{
        revenue: RevenueMetrics & { trends?: any[] };
        margin: MarginMetrics & { trends?: any[] };
        profitability: ProfitabilityAnalysis[];
        bostonMatrix: BostonMatrixData;
    }> {
        return from(Promise.all([
            new Promise<{ start: Date, end: Date }>(resolve => {
                const periodDuration = endDate.getTime() - startDate.getTime();
                const prevStart = new Date(startDate.getTime() - periodDuration);
                resolve({ start: prevStart, end: new Date(startDate.getTime() - 1) });
            })
        ])).pipe(
            switchMap(([prevRange]) => {
                return from(Promise.all([
                    this.bqService.querySummaryKpisBetween(this.formatDate(startDate), this.formatDate(endDate)),
                    this.bqService.querySummaryKpisBetween(this.formatDate(prevRange.start), this.formatDate(prevRange.end)),
                    this.bqService.queryProductRevenueBetween(this.formatDate(startDate), this.formatDate(endDate), 5000),
                    this.bqService.queryProductRevenueBetween(this.formatDate(prevRange.start), this.formatDate(prevRange.end), 5000),
                    this.analyticsService.fetchSharedProductData(),
                    this.bqService.queryDailyTrendBetween(this.formatDate(startDate), this.formatDate(endDate))
                ])).pipe(
                    map(([currentKpis, prevKpis, currentData, prevData, products, dailyTrend]) => {
                        return { currentKpis, prevKpis, currentData, prevData, products: this.analyticsService.getSharedProducts(), dailyTrend };
                    })
                );
            }),
            switchMap(({ currentKpis, prevKpis, currentData, prevData, products, dailyTrend }) => {
                return new Observable<{
                    revenue: RevenueMetrics & { trends?: any[] };
                    margin: MarginMetrics & { trends?: any[] };
                    profitability: ProfitabilityAnalysis[];
                    bostonMatrix: BostonMatrixData;
                }>(observer => {
                    setTimeout(() => {
                        try {
                            const currentStart = startDate;
                            const currentEnd = endDate;

                            let totalRevenue = currentKpis.reduce((sum, row) => sum + row.revenue, 0);
                            let orderCount = currentKpis.reduce((sum, row) => sum + row.orders, 0);
                            let prevTotalRevenue = prevKpis.reduce((sum, row) => sum + row.revenue, 0);
                            
                            let totalCost = 0;

                            const categoryMap = new Map<string, { name: string; revenue: number; cost: number }>();
                            const brandMap = new Map<string, { name: string; revenue: number; cost: number }>();
                            const productMap = new Map<string, {
                                product: any;
                                unitsSold: number;
                                revenue: number;
                                cost: number
                            }>();

                            currentData.forEach(row => {
                                const pid = row.sku;
                                if (!pid) return;

                                const product = products.find(p => p['sku'] === pid || p['id'] === pid) || { name: { es: row.product_name }, categoryId: 'uncategorized', brand: row.brand || 'Unknown' };
                                const quantity = row.total_units;
                                const itemRevenue = row.total_revenue;
                                const costPrice = (product as any)?.costPrice || 0;
                                const itemCost = costPrice * quantity;

                                totalCost += itemCost;

                                let catId = product['categoryId'];
                                if (!catId || catId === 'undefined' || catId === 'null') catId = 'uncategorized';

                                const catEntry = categoryMap.get(catId) || { name: catId, revenue: 0, cost: 0 };
                                catEntry.revenue += itemRevenue;
                                catEntry.cost += itemCost;
                                categoryMap.set(catId, catEntry);

                                const brand = product['brand'] || row.brand || 'Unknown';
                                const brandEntry = brandMap.get(brand) || { name: brand, revenue: 0, cost: 0 };
                                brandEntry.revenue += itemRevenue;
                                brandEntry.cost += itemCost;
                                brandMap.set(brand, brandEntry);

                                const prodEntry = productMap.get(pid) || {
                                    product,
                                    unitsSold: 0,
                                    revenue: 0,
                                    cost: 0
                                };
                                prodEntry.unitsSold += quantity;
                                prodEntry.revenue += itemRevenue;
                                prodEntry.cost += itemCost;
                                productMap.set(pid, prodEntry);
                            });

                            const prevProductRev = new Map<string, number>();
                            prevData.forEach(row => {
                                prevProductRev.set(row.sku, row.total_revenue);
                            });

                            const growthAmount = totalRevenue - prevTotalRevenue;
                            const growthPercentage = prevTotalRevenue > 0 ? (growthAmount / prevTotalRevenue) * 100 : 0;

                            const revenueMetrics = {
                                period: this.determinePeriod(startDate, endDate),
                                startDate,
                                endDate,
                                totalRevenue,
                                averageOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
                                orderCount,
                                previousPeriodRevenue: prevTotalRevenue,
                                growthAmount,
                                growthPercentage,
                                byCategory: Array.from(categoryMap.entries()).map(([id, d]) => ({
                                    categoryId: id,
                                    categoryName: d.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue),
                                byBrand: Array.from(brandMap.entries()).map(([id, d]) => ({
                                    brandId: id,
                                    brandName: d.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue),
                                byProduct: Array.from(productMap.entries()).map(([id, d]) => ({
                                    productId: id,
                                    productName: d.product.name?.es || d.product.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
                                trends: dailyTrend || []
                            } as any;

                            const grossProfit = totalRevenue - totalCost;
                            const marginMetrics = {
                                period: this.determinePeriod(startDate, endDate),
                                startDate,
                                endDate,
                                totalCost,
                                totalRevenue,
                                grossProfit,
                                grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
                                byCategory: Array.from(categoryMap.entries()).map(([id, d]) => ({
                                    categoryId: id,
                                    categoryName: d.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin),
                                byBrand: Array.from(brandMap.entries()).map(([id, d]) => ({
                                    brandId: id,
                                    brandName: d.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin),
                                byProduct: Array.from(productMap.entries()).map(([id, d]) => ({
                                    productId: id,
                                    productName: d.product.name?.es || d.product.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin).slice(0, 10),
                                trends: dailyTrend || []
                            } as any;

                            const profitability: ProfitabilityAnalysis[] = [];
                            let totalProfit = 0;

                            productMap.forEach((data, pid) => {
                                const pProfit = data.revenue - data.cost;
                                totalProfit += pProfit;
                                profitability.push({
                                    productId: pid,
                                    productName: data.product.name?.es || data.product.name,
                                    sku: data.product.sku || pid,
                                    unitsSold: data.unitsSold,
                                    totalRevenue: data.revenue,
                                    averagePrice: data.unitsSold > 0 ? data.revenue / data.unitsSold : 0,
                                    unitCost: (data.product as any)?.costPrice || 0,
                                    totalCost: data.cost,
                                    grossProfit: pProfit,
                                    grossMargin: data.revenue > 0 ? (pProfit / data.revenue) * 100 : 0,
                                    profitPerUnit: data.unitsSold > 0 ? pProfit / data.unitsSold : 0,
                                    rank: 0,
                                    contribution: 0
                                });
                            });

                            profitability.forEach(p => {
                                p.contribution = totalProfit > 0 ? (p.grossProfit / totalProfit) * 100 : 0;
                            });
                            profitability.sort((a, b) => b.grossProfit - a.grossProfit);
                            profitability.forEach((p, i) => p.rank = i + 1);

                            const points: BostonMatrixPoint[] = [];
                            const categoryCounts = new Map<string, number>();
                            productMap.forEach((p, _) => {
                                let c = p.product.categoryId || 'uncategorized';
                                if (c === 'undefined' || c === 'null') c = 'uncategorized';
                                categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
                            });

                            productMap.forEach((data, pid) => {
                                const curRev = data.revenue;
                                if (curRev === 0) return;

                                const prevRev = prevProductRev.get(pid) || 0;
                                let growth = 0;
                                if (prevRev > 0) growth = ((curRev - prevRev) / prevRev) * 100;
                                else if (curRev > 0) growth = 100;

                                let catId = data.product.categoryId;
                                if (!catId || catId === 'undefined' || catId === 'null') catId = 'uncategorized';

                                const catTotal = categoryMap.get(catId)?.revenue || 0;
                                const catCount = categoryCounts.get(catId) || 1;
                                const avgRev = catTotal / catCount;

                                const share = avgRev > 0 ? (curRev / avgRev) : 0;

                                const isHighGrowth = growth >= 10;
                                const isHighShare = share >= 1.0;

                                let quadrant: 'stars' | 'cows' | 'questions' | 'dogs';
                                if (isHighGrowth && isHighShare) quadrant = 'stars';
                                else if (!isHighGrowth && isHighShare) quadrant = 'cows';
                                else if (isHighGrowth && !isHighShare) quadrant = 'questions';
                                else quadrant = 'dogs';

                                const r = Math.min(Math.max(Math.sqrt(curRev) / 5, 5), 40);

                                points.push({
                                    productId: pid,
                                    productName: data.product.name?.es || data.product.name,
                                    categoryName: categoryMap.get(catId)?.name || catId,
                                    x: share,
                                    y: growth,
                                    r,
                                    quadrant,
                                    revenue: curRev,
                                    growth,
                                    share
                                });
                            });

                            observer.next({
                                revenue: revenueMetrics,
                                margin: marginMetrics,
                                profitability: profitability.slice(0, 20),
                                bostonMatrix: { period: 'current', points }
                            });
                            observer.complete();
                        } catch (err) {
                            observer.error(err);
                        }
                    }, 50); // Small delay to unblock UI
                });
            })
        );
    }

    /**
     * Get profitability analysis
     */
    getProfitabilityAnalysis(
        startDate: Date,
        endDate: Date,
        sortBy: 'revenue' | 'profit' | 'margin' = 'profit',
        limit: number = 20
    ): Observable<ProfitabilityAnalysis[]> {
        return combineLatest([
            this.orderService.getOrders(),
            this.productService.getProducts()
        ]).pipe(
            map(([orders, products]) => {
                // Filter orders in date range
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                // Aggregate by product
                const productMap = new Map<string, {
                    product: any;
                    unitsSold: number;
                    totalRevenue: number;
                    totalCost: number;
                }>();

                periodOrders.forEach(order => {
                    order.items?.forEach(item => {
                        const product = products.find(p => p.id === item.productId);
                        if (!product) return;

                        const existing = productMap.get(item.productId) || {
                            product,
                            unitsSold: 0,
                            totalRevenue: 0,
                            totalCost: 0
                        };

                        const price = typeof item.price === 'number' ? item.price : 0;
                        const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
                        const costPrice = (product as any)?.costPrice || 0;

                        existing.unitsSold += quantity;
                        existing.totalRevenue += price * quantity;
                        existing.totalCost += costPrice * quantity;

                        productMap.set(item.productId, existing);
                    });
                });

                // Calculate profitability
                const analysis: ProfitabilityAnalysis[] = [];
                let totalProfit = 0;

                productMap.forEach((data, productId) => {
                    const grossProfit = data.totalRevenue - data.totalCost;
                    totalProfit += grossProfit;

                    analysis.push({
                        productId,
                        productName: data.product.name.es,
                        sku: data.product.sku,
                        unitsSold: data.unitsSold,
                        totalRevenue: data.totalRevenue,
                        averagePrice: data.totalRevenue / data.unitsSold,
                        unitCost: (data.product as any).costPrice || 0,
                        totalCost: data.totalCost,
                        grossProfit,
                        grossMargin: data.totalRevenue > 0 ? (grossProfit / data.totalRevenue) * 100 : 0,
                        profitPerUnit: grossProfit / data.unitsSold,
                        rank: 0,
                        contribution: 0
                    });
                });

                // Calculate contribution percentage
                analysis.forEach(a => {
                    a.contribution = totalProfit > 0 ? (a.grossProfit / totalProfit) * 100 : 0;
                });

                // Sort
                analysis.sort((a, b) => {
                    switch (sortBy) {
                        case 'revenue':
                            return b.totalRevenue - a.totalRevenue;
                        case 'margin':
                            return b.grossMargin - a.grossMargin;
                        default:
                            return b.grossProfit - a.grossProfit;
                    }
                });

                // Assign ranks
                analysis.forEach((a, index) => {
                    a.rank = index + 1;
                });

                return analysis.slice(0, limit);
            })
        );

    }

    /**
     * Get financial forecast
     */
    getFinancialForecast(periods: number = 6, method: 'linear' = 'linear'): Observable<FinancialForecast[]> {
        return this.orderService.getOrders().pipe(
            map(orders => {
                // Get last 12 months of data
                const now = new Date();
                const monthlyData: { month: Date; revenue: number; cost: number }[] = [];

                for (let i = 11; i >= 0; i--) {
                    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

                    const monthOrders = orders.filter(o => {
                        const orderDate = this.getOrderDate(o);
                        return orderDate >= monthStart && orderDate <= monthEnd;
                    });

                    const revenue = monthOrders.reduce((sum, o) => sum + o.total, 0);

                    monthlyData.push({
                        month: monthStart,
                        revenue,
                        cost: revenue * 0.65 // Estimate 65% cost ratio if no cost data
                    });
                }

                // Simple linear regression
                const forecasts: FinancialForecast[] = [];
                const avgRevenue = monthlyData.reduce((sum, d) => sum + d.revenue, 0) / monthlyData.length;

                // Calculate trend
                const trend = this.calculateLinearTrend(monthlyData.map(d => d.revenue));

                for (let i = 1; i <= periods; i++) {
                    const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
                    const predictedRevenue = avgRevenue + (trend * (monthlyData.length + i));
                    const predictedCost = predictedRevenue * 0.65;
                    const predictedProfit = predictedRevenue - predictedCost;
                    const predictedMargin = (predictedProfit / predictedRevenue) * 100;

                    forecasts.push({
                        period: 'monthly',
                        forecastDate,
                        predictedRevenue,
                        predictedCost,
                        predictedProfit,
                        predictedMargin,
                        confidenceLevel: Math.max(50, 90 - (i * 5)), // Decrease confidence over time
                        method,
                        historicalPeriods: monthlyData.length,
                        baselineRevenue: avgRevenue
                    });
                }

                return forecasts;
            })
        );
    }


    // Helper methods
    private getOrderDate(order: any): Date {
        if (!order.createdAt) return new Date();
        const createdAt: any = order.createdAt;
        if (typeof createdAt.toDate === 'function') {
            return createdAt.toDate();
        }
        return new Date(createdAt);
    }

    private determinePeriod(startDate: Date, endDate: Date): 'daily' | 'weekly' | 'monthly' | 'yearly' {
        const diff = endDate.getTime() - startDate.getTime();
        const days = diff / (1000 * 60 * 60 * 24);

        if (days <= 1) return 'daily';
        if (days <= 7) return 'weekly';
        if (days <= 31) return 'monthly';
        return 'yearly';
    }

    private calculateCategoryRevenue(orders: any[], products: any[], totalRevenue: number): CategoryRevenue[] {
        const categoryMap = new Map<string, { name: string; revenue: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                let categoryId = product.categoryId;
                // Handle edge cases where "undefined" or "null" is stored as a string
                if (!categoryId || categoryId === 'undefined' || categoryId === 'null') {
                    categoryId = 'uncategorized';
                }

                const existing = categoryMap.get(categoryId) || { name: categoryId, revenue: 0 };
                const price = typeof item.price === 'number' ? item.price : 0;
                const quantity = typeof item.quantity === 'number' ? item.quantity : 0;

                existing.revenue += price * quantity;
                categoryMap.set(categoryId, existing);
            });
        });

        return Array.from(categoryMap.entries()).map(([id, data]) => ({
            categoryId: id,
            categoryName: data.name,
            revenue: data.revenue,
            percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
        })).sort((a, b) => b.revenue - a.revenue);
    }

    private calculateBrandRevenue(orders: any[], products: any[], totalRevenue: number): BrandRevenue[] {
        const brandMap = new Map<string, { name: string; revenue: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                const existing = brandMap.get(product.brand) || { name: product.brand, revenue: 0 };
                existing.revenue += item.price * item.quantity;
                brandMap.set(product.brand, existing);
            });
        });

        return Array.from(brandMap.entries()).map(([id, data]) => ({
            brandId: id,
            brandName: data.name,
            revenue: data.revenue,
            percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
        })).sort((a, b) => b.revenue - a.revenue);
    }

    private calculateProductRevenue(orders: any[], products: any[], totalRevenue: number): ProductRevenue[] {
        const productMap = new Map<string, { name: string; revenue: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                const existing = productMap.get(item.productId) || { name: product.name.es, revenue: 0 };
                existing.revenue += item.price * item.quantity;
                productMap.set(item.productId, existing);
            });
        });

        return Array.from(productMap.entries()).map(([id, data]) => ({
            productId: id,
            productName: data.name,
            revenue: data.revenue,
            percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
        })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    }

    private calculateCategoryMargin(orders: any[], products: any[]): CategoryMargin[] {
        const categoryMap = new Map<string, { name: string; revenue: number; cost: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                const existing = categoryMap.get(product.categoryId) || { name: product.categoryId, revenue: 0, cost: 0 };
                const price = typeof item.price === 'number' ? item.price : 0;
                const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
                const costPrice = (product as any)?.costPrice || 0;

                existing.revenue += price * quantity;
                existing.cost += costPrice * quantity;
                categoryMap.set(product.categoryId, existing);
            });
        });

        return Array.from(categoryMap.entries()).map(([id, data]) => ({
            categoryId: id,
            categoryName: data.name,
            revenue: data.revenue,
            cost: data.cost,
            margin: data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0
        })).sort((a, b) => b.margin - a.margin);
    }

    private calculateBrandMargin(orders: any[], products: any[]): BrandMargin[] {
        const brandMap = new Map<string, { name: string; revenue: number; cost: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                const existing = brandMap.get(product.brand) || { name: product.brand, revenue: 0, cost: 0 };
                const price = typeof item.price === 'number' ? item.price : 0;
                const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
                const costPrice = (product as any)?.costPrice || 0;

                existing.revenue += price * quantity;
                existing.cost += costPrice * quantity;
                brandMap.set(product.brand, existing);
            });
        });

        return Array.from(brandMap.entries()).map(([id, data]) => ({
            brandId: id,
            brandName: data.name,
            revenue: data.revenue,
            cost: data.cost,
            margin: data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0
        })).sort((a, b) => b.margin - a.margin);
    }

    private calculateProductMargin(orders: any[], products: any[]): ProductMargin[] {
        const productMap = new Map<string, { name: string; revenue: number; cost: number }>();

        orders.forEach(order => {
            order.items?.forEach((item: any) => {
                const product = products.find(p => p.id === item.productId);
                if (!product) return;

                const existing = productMap.get(item.productId) || { name: product.name.es, revenue: 0, cost: 0 };
                const price = typeof item.price === 'number' ? item.price : 0;
                const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
                const costPrice = (product as any)?.costPrice || 0;

                existing.revenue += price * quantity;
                existing.cost += costPrice * quantity;
                productMap.set(item.productId, existing);
            });
        });

        return Array.from(productMap.entries()).map(([id, data]) => ({
            productId: id,
            productName: data.name,
            revenue: data.revenue,
            cost: data.cost,
            margin: data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0
        })).sort((a, b) => b.margin - a.margin).slice(0, 10);
    }

    private calculateLinearTrend(data: number[]): number {
        const n = data.length;
        const sumX = (n * (n + 1)) / 2;
        const sumY = data.reduce((sum: number, val: number) => sum + val, 0);
        const sumXY = data.reduce((sum: number, val: number, i: number) => sum + val * (i + 1), 0);
        const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;

        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }
}
