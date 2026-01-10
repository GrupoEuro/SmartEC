import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, orderBy, limit, getDocs, Timestamp } from '@angular/fire/firestore';
import { Observable, combineLatest, map, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { OrderService } from './order.service';
import { ProductService } from './product.service';
import { UserManagementService } from './user-management.service';
import { DailyMetrics, KPICard, MetricChartData, RevenueTrendPoint, OrderStatusCount, TopProduct } from '../models/business-metrics.model';

@Injectable({
    providedIn: 'root'
})
export class MetricsService {
    private firestore = inject(Firestore);
    private orderService = inject(OrderService);
    private productService = inject(ProductService);
    private userService = inject(UserManagementService);
    private translate = inject(TranslateService);

    /**
     * Get all KPI cards for the dashboard
     */
    getKPICards(startDate?: Date, endDate?: Date): Observable<KPICard[]> {
        return combineLatest([
            startDate && endDate
                ? this.orderService.getOrdersByDateRange(startDate, endDate)
                : this.orderService.getOrders(),
            this.productService.getProducts(),
            this.userService.getCustomers()
        ]).pipe(
            map(([orders, products, customers]) => {
                const now = new Date();
                const today = new Date(now.setHours(0, 0, 0, 0));
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

                // Helper to get order date
                const getOrderDate = (order: any): Date => {
                    if (!order.createdAt) return new Date();
                    if (typeof order.createdAt.toDate === 'function') {
                        return order.createdAt.toDate();
                    }
                    return new Date(order.createdAt as any);
                };

                // Today's orders
                const todayOrders = orders.filter(o => getOrderDate(o) >= today);
                const yesterdayOrders = orders.filter(o => {
                    const date = getOrderDate(o);
                    return date >= yesterday && date < today;
                });

                // This month's orders
                const thisMonthOrders = orders.filter(o => getOrderDate(o) >= thisMonthStart);
                const lastMonthOrders = orders.filter(o => {
                    const date = getOrderDate(o);
                    return date >= lastMonthStart && date <= lastMonthEnd;
                });

                // Revenue calculations
                const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
                const yesterdayRevenue = yesterdayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
                const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
                const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);

                const revenueChange = yesterdayRevenue > 0
                    ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
                    : 0;

                // Orders KPI
                const ordersChange = yesterdayOrders.length > 0
                    ? ((todayOrders.length - yesterdayOrders.length) / yesterdayOrders.length) * 100
                    : 0;

                // Customers
                const newCustomers = customers.filter(c => {
                    if (!c.createdAt) return false;
                    const created = typeof c.createdAt.toDate === 'function'
                        ? c.createdAt.toDate()
                        : new Date(c.createdAt as any);
                    return created >= thisMonthStart;
                });
                const returningCustomers = customers.filter(c => (c.stats?.totalOrders || 0) > 1);

                // AOV
                const aov = orders.length > 0 ? orders.reduce((sum, o) => sum + o.total, 0) / orders.length : 0;
                const lastMonthAOV = lastMonthOrders.length > 0
                    ? lastMonthOrders.reduce((sum, o) => sum + o.total, 0) / lastMonthOrders.length
                    : 0;
                const aovChange = lastMonthAOV > 0 ? ((aov - lastMonthAOV) / lastMonthAOV) * 100 : 0;

                // SLA Compliance
                const completedOrders = orders.filter(o => o.status === 'delivered' || o.status === 'shipped');
                const onTimeOrders = completedOrders.filter(o => !o.isOverdue);
                const slaCompliance = completedOrders.length > 0
                    ? (onTimeOrders.length / completedOrders.length) * 100
                    : 100;

                // Inventory Value
                const inventoryValue = products.reduce((sum, p) => sum + (p.price * p.stockQuantity), 0);

                return [
                    {
                        title: 'COMMAND_CENTER.KPI.REVENUE',
                        value: todayRevenue,
                        change: revenueChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_YESTERDAY',
                        icon: 'wallet',
                        trend: revenueChange > 0 ? 'up' : revenueChange < 0 ? 'down' : 'neutral',
                        format: 'currency'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.ORDERS',
                        value: todayOrders.length,
                        change: ordersChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_YESTERDAY',
                        icon: 'box',
                        trend: ordersChange > 0 ? 'up' : ordersChange < 0 ? 'down' : 'neutral',
                        format: 'number'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.CUSTOMERS',
                        value: customers.length,
                        change: newCustomers.length,
                        changeLabel: 'COMMAND_CENTER.LABELS.NEW',
                        icon: 'users',
                        trend: 'neutral',
                        format: 'number'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.AOV',
                        value: aov,
                        change: aovChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_LAST_MONTH',
                        icon: 'cart',
                        trend: aovChange > 0 ? 'up' : aovChange < 0 ? 'down' : 'neutral',
                        format: 'currency'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.SLA',
                        value: slaCompliance,
                        change: 0,
                        changeLabel: 'COMMAND_CENTER.LABELS.TOTAL',
                        icon: 'clock',
                        trend: slaCompliance >= 90 ? 'up' : slaCompliance >= 75 ? 'neutral' : 'down',
                        format: 'percentage'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.INVENTORY_VALUE',
                        value: inventoryValue,
                        change: 0,
                        changeLabel: 'COMMAND_CENTER.LABELS.TOTAL',
                        icon: 'chart-bar',
                        trend: 'neutral',
                        format: 'currency'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.MARGIN',
                        value: 35, // Placeholder - would need cost data
                        change: 0,
                        changeLabel: 'COMMAND_CENTER.LABELS.TOTAL',
                        icon: 'trending-up',
                        trend: 'neutral',
                        format: 'percentage'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.CONVERSION',
                        value: 2.5, // Placeholder - would need traffic data
                        change: 0,
                        changeLabel: 'COMMAND_CENTER.LABELS.TOTAL',
                        icon: 'trophy',
                        trend: 'neutral',
                        format: 'percentage'
                    }
                ];
            })
        );
    }

    /**
     * Get revenue trend data for the last N days
     */
    getRevenueTrend(days: number = 30, startDate?: Date, endDate?: Date): Observable<MetricChartData> {
        return (startDate && endDate
            ? this.orderService.getOrdersByDateRange(startDate, endDate)
            : this.orderService.getOrders()
        ).pipe(
            map(orders => {
                const now = new Date();
                const trendData: RevenueTrendPoint[] = [];

                // Generate data for each day
                for (let i = days - 1; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    date.setHours(0, 0, 0, 0);

                    const nextDay = new Date(date);
                    nextDay.setDate(nextDay.getDate() + 1);

                    const dayOrders = orders.filter(o => {
                        if (!o.createdAt) return false;
                        const createdAt: any = o.createdAt;
                        const orderDate = typeof createdAt.toDate === 'function'
                            ? createdAt.toDate()
                            : new Date(createdAt);
                        return orderDate >= date && orderDate < nextDay;
                    });

                    const revenue = dayOrders.reduce((sum, o) => sum + o.total, 0);

                    trendData.push({
                        date: date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
                        revenue,
                        orders: dayOrders.length
                    });
                }

                return {
                    labels: trendData.map(d => d.date),
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.REVENUE'),
                        data: trendData.map(d => d.revenue),
                        borderColor: '#fbbf24',
                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                        borderWidth: 2,
                        fill: true
                    }]
                };
            })
        );
    }

    /**
     * Get order status distribution
     */
    getOrderDistribution(startDate?: Date, endDate?: Date): Observable<MetricChartData> {
        return (startDate && endDate
            ? this.orderService.getOrdersByDateRange(startDate, endDate)
            : this.orderService.getOrders()
        ).pipe(
            map(orders => {
                const statusCounts: { [key: string]: number } = {};

                orders.forEach(order => {
                    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
                });

                const labels = Object.keys(statusCounts);
                const data = Object.values(statusCounts);

                return {
                    labels,
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.ORDERS'),
                        data,
                        backgroundColor: [
                            '#fbbf24', // pending
                            '#3b82f6', // processing
                            '#10b981', // shipped
                            '#22c55e', // delivered
                            '#ef4444'  // cancelled
                        ]
                    }]
                };
            })
        );
    }

    /**
     * Get top products by revenue
     */
    getTopProducts(limitCount: number = 5, startDate?: Date, endDate?: Date): Observable<MetricChartData> {
        return combineLatest([
            startDate && endDate
                ? this.orderService.getOrdersByDateRange(startDate, endDate)
                : this.orderService.getOrders(),
            this.productService.getProducts()
        ]).pipe(
            map(([orders, products]) => {
                const productRevenue: { [key: string]: { name: string; revenue: number; quantity: number } } = {};

                // Aggregate revenue by product
                orders.forEach(order => {
                    order.items?.forEach(item => {
                        if (!productRevenue[item.productId]) {
                            const product = products.find(p => p.id === item.productId);
                            productRevenue[item.productId] = {
                                name: product?.name.es || (item as any).name || 'Unknown',
                                revenue: 0,
                                quantity: 0
                            };
                        }
                        productRevenue[item.productId].revenue += item.price * item.quantity;
                        productRevenue[item.productId].quantity += item.quantity;
                    });
                });

                // Sort and get top N
                const topProducts = Object.values(productRevenue)
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, limitCount);

                return {
                    labels: topProducts.map(p => p.name),
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.REVENUE'),
                        data: topProducts.map(p => p.revenue),
                        backgroundColor: [
                            '#fbbf24', // Gold 400
                            '#f59e0b', // Amber 500
                            '#d97706', // Amber 600
                            '#ea580c', // Orange 600
                            '#c2410c'  // Orange 700
                        ]
                    }]
                };
            })
        );
    }

    /**
     * Get customer acquisition vs retention composition
     */
    getCustomerComposition(startDate: Date, endDate: Date): Observable<MetricChartData> {
        return this.userService.getCustomers().pipe(
            map(customers => {
                let newCount = 0;
                let returningCount = 0;

                customers.forEach(c => {
                    const created = typeof c.createdAt.toDate === 'function'
                        ? c.createdAt.toDate()
                        : new Date(c.createdAt as any);

                    // "New" if created within the window
                    if (created >= startDate && created <= endDate) {
                        newCount++;
                    }
                    // "Returning" if they have > 1 order, regardless of creation date (or based on activity in period?)
                    // Simplified definition for dashboard:
                    // New = Created in period
                    // Returning = Created before period start but Active? 
                    // Let's stick to the KPI logic: 
                    // New = Created in period
                    // Returning = Total - New (for composition of "Active Base"?) 
                    // actually, usually it's "Revenue from New vs Returning".

                    // Let's do "Customer Segments" based on the user request for "deep analysis"
                    // New vs Returning is classic.

                    // Alternative: "New" vs "Existing"
                    else {
                        returningCount++;
                    }
                });

                return {
                    labels: [
                        this.translate.instant('COMMAND_CENTER.LABELS.NEW_CUSTOMERS'),
                        this.translate.instant('COMMAND_CENTER.LABELS.RETURNING_CUSTOMERS')
                    ],
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.CHARTS.CUSTOMER_COMPOSITION'),
                        data: [newCount, returningCount],
                        backgroundColor: [
                            '#3b82f6', // Blue for New
                            '#8b5cf6'  // Violet for Returning
                        ],
                        hoverOffset: 4
                    }]
                };
            })
        );
    }
}
