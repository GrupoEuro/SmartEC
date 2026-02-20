import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import { OrderService } from '../core/services/order.service';
import { Timestamp } from '@angular/fire/firestore';

// Interfaces
export interface OrderMetrics {
    totalOrders: number;
    fulfilledOrders: number;
    pendingOrders: number;
    processingOrders: number;
    averageFulfillmentTime: number; // hours
    fulfillmentRate: number; // percentage
    ordersToday: number;
    statusBreakdown: Record<string, number>;
}

export interface SLAMetrics {
    complianceRate: number; // percentage
    atRiskOrders: number;
    overdueOrders: number;
    averageResponseTime: number; // hours
    totalOrders: number;
}

export interface StaffPerformance {
    staffId: string;
    staffName: string;
    ordersProcessed: number;
    averageProcessingTime: number; // hours
    activeOrders: number;
    rank: number;
}

export interface ProcessingBreakdown {
    orderNumber: string;
    pendingTime: number; // hours
    processingTime: number; // hours
    shippingTime: number; // hours
    totalTime: number; // hours
    isOverdue: boolean;
}

export interface TrendData {
    date: string;
    value: number;
}

export interface HourlyData {
    hour: number;
    count: number;
}

export interface ChannelMetrics {
    channel: string;
    revenue: number;
    orderCount: number;
    avgOrderValue: number;
}

export interface SLAStatus {
    isCompliant: boolean;
    isAtRisk: boolean;
    isOverdue: boolean;
    hoursRemaining: number;
    deadline: Date;
}

@Injectable({
    providedIn: 'root'
})
export class OperationalMetricsService {
    private orderService = inject(OrderService);
    private cache = new Map<string, { data: any; timestamp: number }>();
    private cacheDuration = 5 * 60 * 1000; // 5 minutes

    /**
     * Get order fulfillment metrics
     */
    getOrderMetrics(startDate: Date, endDate: Date): Observable<OrderMetrics> {
        const cacheKey = `orderMetrics_${startDate.getTime()}_${endDate.getTime()}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                // Filter orders in period
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                // Calculate metrics
                const totalOrders = periodOrders.length;
                const fulfilledOrders = periodOrders.filter(o =>
                    o.status === 'shipped' || o.status === 'delivered'
                ).length;
                const pendingOrders = periodOrders.filter(o => o.status === 'pending').length;
                const processingOrders = periodOrders.filter(o => o.status === 'processing').length;

                // Calculate average fulfillment time
                const fulfilledWithTime = periodOrders.filter(o =>
                    (o.status === 'shipped' || o.status === 'delivered') && o.updatedAt
                );

                let totalFulfillmentTime = 0;
                fulfilledWithTime.forEach(order => {
                    const created = this.getOrderDate(order);
                    const updated = this.getTimestampDate(order.updatedAt);
                    const diff = updated.getTime() - created.getTime();
                    totalFulfillmentTime += diff / (1000 * 60 * 60); // Convert to hours
                });

                const averageFulfillmentTime = fulfilledWithTime.length > 0
                    ? totalFulfillmentTime / fulfilledWithTime.length
                    : 0;

                const fulfillmentRate = totalOrders > 0
                    ? (fulfilledOrders / totalOrders) * 100
                    : 0;

                // Orders today
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const ordersToday = periodOrders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= today;
                }).length;

                const metrics: OrderMetrics = {
                    totalOrders,
                    fulfilledOrders,
                    pendingOrders,
                    processingOrders,
                    averageFulfillmentTime,
                    fulfillmentRate,
                    ordersToday,
                    statusBreakdown: periodOrders.reduce((acc, order) => {
                        const s = (order.status || 'undefined').toLowerCase();
                        acc[s] = (acc[s] || 0) + 1;
                        return acc;
                    }, {} as Record<string, number>)
                };

                this.setCache(cacheKey, metrics);
                return metrics;
            })
        );
    }

    /**
     * Get SLA compliance metrics
     */
    getSLACompliance(startDate: Date, endDate: Date): Observable<SLAMetrics> {
        const cacheKey = `slaMetrics_${startDate.getTime()}_${endDate.getTime()}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                // Filter orders in period
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                let compliantOrders = 0;
                let atRiskOrders = 0;
                let overdueOrders = 0;
                let totalResponseTime = 0;
                let ordersWithResponse = 0;

                periodOrders.forEach(order => {
                    const sla = this.calculateSLA(order);

                    if (sla.isCompliant) compliantOrders++;
                    if (sla.isAtRisk) atRiskOrders++;
                    if (sla.isOverdue) overdueOrders++;

                    // Calculate response time (time to first status change)
                    if (order.updatedAt) {
                        const created = this.getOrderDate(order);
                        const updated = this.getTimestampDate(order.updatedAt);
                        const diff = updated.getTime() - created.getTime();
                        totalResponseTime += diff / (1000 * 60 * 60); // hours
                        ordersWithResponse++;
                    }
                });

                const complianceRate = periodOrders.length > 0
                    ? (compliantOrders / periodOrders.length) * 100
                    : 0;

                const averageResponseTime = ordersWithResponse > 0
                    ? totalResponseTime / ordersWithResponse
                    : 0;

                const metrics: SLAMetrics = {
                    complianceRate,
                    atRiskOrders,
                    overdueOrders,
                    averageResponseTime,
                    totalOrders: periodOrders.length
                };

                this.setCache(cacheKey, metrics);
                return metrics;
            })
        );
    }

    /**
     * Get staff performance metrics
     */
    getStaffPerformance(startDate: Date, endDate: Date): Observable<StaffPerformance[]> {
        const cacheKey = `staffPerformance_${startDate.getTime()}_${endDate.getTime()}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                // Filter orders in period
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                // Group by staff (using assignedTo)
                const staffMap = new Map<string, { orders: any[]; totalTime: number; name: string }>();

                periodOrders.forEach(order => {
                    // Use assignedTo for staff attribution, falling back to 'unassigned'
                    const staffId = order.assignedTo || 'unassigned';
                    const staffName = order.assignedToName || (staffId === 'unassigned' ? 'Unassigned' : `Staff ${staffId.substring(0, 8)}`);

                    if (!staffMap.has(staffId)) {
                        staffMap.set(staffId, { orders: [], totalTime: 0, name: staffName });
                    }

                    const staff = staffMap.get(staffId)!;
                    staff.orders.push(order);

                    // Calculate processing time
                    if (order.updatedAt) {
                        const created = this.getOrderDate(order);
                        const updated = this.getTimestampDate(order.updatedAt);
                        const diff = updated.getTime() - created.getTime();
                        staff.totalTime += diff / (1000 * 60 * 60); // hours
                    }
                });

                // Convert to array and calculate metrics
                const performance: StaffPerformance[] = [];
                staffMap.forEach((data, staffId) => {
                    const ordersProcessed = data.orders.length;
                    const averageProcessingTime = ordersProcessed > 0
                        ? data.totalTime / ordersProcessed
                        : 0;

                    const activeOrders = data.orders.filter(o =>
                        o.status === 'pending' || o.status === 'processing'
                    ).length;

                    performance.push({
                        staffId,
                        staffName: data.name,
                        ordersProcessed,
                        averageProcessingTime,
                        activeOrders,
                        rank: 0 // Will be set after sorting
                    });
                });

                // Sort by orders processed and assign ranks
                performance.sort((a, b) => b.ordersProcessed - a.ordersProcessed);
                performance.forEach((p, index) => p.rank = index + 1);

                this.setCache(cacheKey, performance);
                return performance;
            })
        );
    }

    /**
     * Get fulfillment trend data
     */
    getFulfillmentTrend(days: number): Observable<TrendData[]> {
        const cacheKey = `fulfillmentTrend_${days}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                const trend: TrendData[] = [];
                const now = new Date();

                for (let i = days - 1; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    date.setHours(0, 0, 0, 0);

                    const nextDate = new Date(date);
                    nextDate.setDate(nextDate.getDate() + 1);

                    // Get orders fulfilled on this day
                    const dayOrders = orders.filter(o => {
                        const orderDate = this.getOrderDate(o);
                        return orderDate >= date && orderDate < nextDate &&
                            (o.status === 'shipped' || o.status === 'delivered');
                    });

                    // Calculate average fulfillment time for the day
                    let totalTime = 0;
                    dayOrders.forEach(order => {
                        if (order.updatedAt) {
                            const created = this.getOrderDate(order);
                            const updated = this.getTimestampDate(order.updatedAt);
                            const diff = updated.getTime() - created.getTime();
                            totalTime += diff / (1000 * 60 * 60); // hours
                        }
                    });

                    const avgTime = dayOrders.length > 0 ? totalTime / dayOrders.length : 0;

                    trend.push({
                        date: date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
                        value: avgTime
                    });
                }

                this.setCache(cacheKey, trend);
                return trend;
            })
        );
    }

    /**
     * Get SLA trend data
     */
    getSLATrend(days: number): Observable<TrendData[]> {
        const cacheKey = `slaTrend_${days}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                const trend: TrendData[] = [];
                const now = new Date();

                for (let i = days - 1; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    date.setHours(0, 0, 0, 0);

                    const nextDate = new Date(date);
                    nextDate.setDate(nextDate.getDate() + 1);

                    const dayOrders = orders.filter(o => {
                        const orderDate = this.getOrderDate(o);
                        return orderDate >= date && orderDate < nextDate;
                    });

                    let compliantCount = 0;
                    dayOrders.forEach(order => {
                        if (this.calculateSLA(order).isCompliant) compliantCount++;
                    });

                    const complianceRate = dayOrders.length > 0
                        ? (compliantCount / dayOrders.length) * 100
                        : 0;

                    trend.push({
                        date: date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
                        value: complianceRate
                    });
                }

                this.setCache(cacheKey, trend);
                return trend;
            })
        );
    }

    /**
     * Calculate SLA status for an order
     */
    private calculateSLA(order: any): SLAStatus {
        const now = new Date();
        const orderDate = this.getOrderDate(order);
        const orderAge = now.getTime() - orderDate.getTime();
        const ageInHours = orderAge / (1000 * 60 * 60);

        // SLA targets by priority (default to 48 hours for normal priority)
        const priority = (order as any).priority || 'normal';
        const slaTargets: Record<string, number> = {
            urgent: 4,
            high: 24,
            normal: 48,
            low: 72
        };

        const target = slaTargets[priority];
        const remaining = target - ageInHours;

        return {
            isCompliant: remaining > 0 && (order.status === 'shipped' || order.status === 'delivered'),
            isAtRisk: remaining < target * 0.25 && remaining > 0 && order.status !== 'shipped' && order.status !== 'delivered',
            isOverdue: remaining < 0 && order.status !== 'shipped' && order.status !== 'delivered',
            hoursRemaining: remaining,
            deadline: new Date(orderDate.getTime() + target * 60 * 60 * 1000)
        };
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    // Helper methods
    private getFromCache(key: string): any {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            return cached.data;
        }
        return null;
    }

    private setCache(key: string, data: any): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    private getOrderDate(order: any): Date {
        if (!order.createdAt) return new Date();
        const createdAt: any = order.createdAt;
        if (typeof createdAt.toDate === 'function') {
            return createdAt.toDate();
        }
        return new Date(createdAt);
    }

    private getTimestampDate(timestamp: any): Date {
        if (!timestamp) return new Date();
        if (typeof timestamp.toDate === 'function') {
            return timestamp.toDate();
        }
        return new Date(timestamp);
    }

    /**
     * Get revenue and order counts broken down by Channel
     */
    getChannelMetrics(startDate: Date, endDate: Date): Observable<ChannelMetrics[]> {
        const cacheKey = `channelMetrics_${startDate.getTime()}_${endDate.getTime()}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return of(cached);

        return this.orderService.getOrders().pipe(
            map(orders => {
                console.log(`🔍 [Metrics] Filtering Orders: ${orders.length} total available.`);
                console.log(`🔍 [Metrics] Range: ${startDate.toISOString()} - ${endDate.toISOString()}`);

                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    const inRange = orderDate >= startDate && orderDate <= endDate;
                    if (!inRange && Math.random() < 0.01) {
                        // Sample log for rejected orders
                        console.log(`   [Excluded] Order Date: ${orderDate.toISOString()} (Outside Range)`);
                    }
                    return inRange;
                });

                console.log(`✅ [Metrics] ${periodOrders.length} orders found in range.`);

                const channelMap = new Map<string, { revenue: number; count: number }>();

                periodOrders.forEach(o => {
                    // Normalize channel name
                    const channelRaw = o.channel || 'WEB'; // Default to web if missing
                    const channel = channelRaw.toUpperCase().replace('_', ' ');

                    const current = channelMap.get(channel) || { revenue: 0, count: 0 };

                    channelMap.set(channel, {
                        revenue: current.revenue + (o.total || 0),
                        count: current.count + 1
                    });
                });

                const metrics: ChannelMetrics[] = Array.from(channelMap.entries())
                    .map(([channel, data]) => ({
                        channel,
                        revenue: data.revenue,
                        orderCount: data.count,
                        avgOrderValue: data.count > 0 ? data.revenue / data.count : 0
                    }))
                    .sort((a, b) => b.revenue - a.revenue);

                this.setCache(cacheKey, metrics);
                return metrics;
            })
        );
    }
}
