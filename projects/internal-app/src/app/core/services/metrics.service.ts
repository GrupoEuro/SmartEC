import { Injectable, inject } from '@angular/core';
import { Observable, from, map, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { MetricsBigqueryService } from '../../pages/operations/metrics/services/metrics-bigquery.service';
import { KPICard, MetricChartData, RevenueTrendPoint } from '../models/business-metrics.model';
import { ProductService } from './product.service';
import { CustomerInsightsService } from '../../services/customer-insights.service';

@Injectable({
    providedIn: 'root'
})
export class MetricsService {
    private bqService = inject(MetricsBigqueryService);
    private translate = inject(TranslateService);
    private productService = inject(ProductService);
    private customerInsightsService = inject(CustomerInsightsService);

    private formatDate(d: Date): string {
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    }

    /**
     * Get all KPI cards for the dashboard
     */
    getKPICards(startDate?: Date, endDate?: Date): Observable<KPICard[]> {
        if (!startDate || !endDate) {
            startDate = new Date(new Date().setHours(0,0,0,0));
            endDate = new Date();
        }

        const diffTime = endDate.getTime() - startDate.getTime();
        const priorStart = new Date(startDate.getTime() - diffTime);
        const priorEnd = new Date(startDate.getTime() - 1);

        return from(Promise.all([
            this.bqService.querySummaryKpisBetween(this.formatDate(startDate), this.formatDate(endDate)),
            this.bqService.querySummaryKpisBetween(this.formatDate(priorStart), this.formatDate(priorEnd))
        ])).pipe(
            map(([currentData, priorData]) => {
                const currentRev = currentData.reduce((sum, row) => sum + row.revenue, 0);
                const currentOrd = currentData.reduce((sum, row) => sum + row.orders, 0);
                const currentUnits = currentData.reduce((sum, row) => sum + row.units, 0);
                const currentAov = currentOrd > 0 ? currentRev / currentOrd : 0;

                const priorRev = priorData.reduce((sum, row) => sum + row.revenue, 0);
                const priorOrd = priorData.reduce((sum, row) => sum + row.orders, 0);
                const priorUnits = priorData.reduce((sum, row) => sum + row.units, 0);
                const priorAov = priorOrd > 0 ? priorRev / priorOrd : 0;

                const revChange = priorRev > 0 ? ((currentRev - priorRev) / priorRev) * 100 : (currentRev > 0 ? 100 : 0);
                const ordChange = priorOrd > 0 ? ((currentOrd - priorOrd) / priorOrd) * 100 : (currentOrd > 0 ? 100 : 0);
                const unitsChange = priorUnits > 0 ? ((currentUnits - priorUnits) / priorUnits) * 100 : (currentUnits > 0 ? 100 : 0);
                const aovChange = priorAov > 0 ? ((currentAov - priorAov) / priorAov) * 100 : (currentAov > 0 ? 100 : 0);

                return [
                    {
                        title: 'COMMAND_CENTER.KPI.REVENUE',
                        value: currentRev,
                        change: revChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_PREVIOUS',
                        icon: 'wallet',
                        trend: revChange > 0 ? 'up' : revChange < 0 ? 'down' : 'neutral',
                        format: 'currency'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.ORDERS',
                        value: currentOrd,
                        change: ordChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_PREVIOUS',
                        icon: 'box',
                        trend: ordChange > 0 ? 'up' : ordChange < 0 ? 'down' : 'neutral',
                        format: 'number'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.UNITS',
                        value: currentUnits,
                        change: unitsChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_PREVIOUS',
                        icon: 'chart-bar',
                        trend: unitsChange > 0 ? 'up' : unitsChange < 0 ? 'down' : 'neutral',
                        format: 'number'
                    },
                    {
                        title: 'COMMAND_CENTER.KPI.AOV',
                        value: currentAov,
                        change: aovChange,
                        changeLabel: 'COMMAND_CENTER.TRENDS.VS_PREVIOUS',
                        icon: 'cart',
                        trend: aovChange > 0 ? 'up' : aovChange < 0 ? 'down' : 'neutral',
                        format: 'currency'
                    }
                ];
            })
        );
    }

    /**
     * Get revenue trend data
     */
    getRevenueTrend(days: number = 30, startDate?: Date, endDate?: Date): Observable<MetricChartData> {
        if (!startDate || !endDate) {
            endDate = new Date();
            startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
        }
        
        return from(this.bqService.queryDailyTrendBetween(this.formatDate(startDate), this.formatDate(endDate))).pipe(
            map(data => {
                const dateMap = new Map<string, number>();
                data.forEach(row => {
                    dateMap.set(row.order_date, (dateMap.get(row.order_date) || 0) + row.revenue);
                });

                const sortedDates = Array.from(dateMap.keys()).sort();
                const revenues = sortedDates.map(d => dateMap.get(d) || 0);

                const labels = sortedDates.map(d => {
                    const dateObj = new Date(d + 'T12:00:00'); 
                    return dateObj.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
                });

                return {
                    labels,
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.REVENUE'),
                        data: revenues,
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
     * Get order status distribution. Uses BigQuery Channel split.
     */
    getOrderDistribution(startDate?: Date, endDate?: Date): Observable<MetricChartData> {
        if (!startDate || !endDate) {
            startDate = new Date(new Date().setHours(0,0,0,0));
            endDate = new Date();
        }

        return from(this.bqService.querySummaryKpisBetween(this.formatDate(startDate), this.formatDate(endDate))).pipe(
            map(data => {
                const labels = data.map(d => d.source_channel);
                const values = data.map(d => d.orders);

                return {
                    labels,
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.ORDERS'),
                        data: values,
                        backgroundColor: [
                            '#fbbf24', '#3b82f6', '#10b981', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899'
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
        if (!startDate || !endDate) {
            startDate = new Date(new Date().setHours(0,0,0,0));
            endDate = new Date();
        }
        
        return from(this.bqService.queryProductRevenueBetween(this.formatDate(startDate), this.formatDate(endDate), limitCount)).pipe(
            map(data => {
                const labels = data.map(d => d.product_name || d.sku);
                const values = data.map(d => d.total_revenue);

                return {
                    labels,
                    datasets: [{
                        label: this.translate.instant('COMMAND_CENTER.KPI.REVENUE'),
                        data: values,
                        backgroundColor: [
                            '#fbbf24', '#f59e0b', '#d97706', '#ea580c', '#c2410c'
                        ]
                    }]
                };
            })
        );
    }

    getCustomerComposition(startDate: Date, endDate: Date): Observable<MetricChartData> {
        return this.customerInsightsService.getInsights().pipe(
            map(data => {
                let newCount = 0;
                let returningCount = 0;
                
                data.profiles.forEach(p => {
                    // Check if they had any orders in this period
                    if (p.lastOrderDate >= startDate && p.lastOrderDate <= endDate) {
                        // If their first order was also in this period, they are new
                        if (p.firstOrderDate >= startDate) {
                            newCount++;
                        } else {
                            returningCount++;
                        }
                    }
                });

                return {
                    labels: [
                        this.translate.instant('COMMAND_CENTER.KPI.NEW_CUSTOMERS') || 'New',
                        this.translate.instant('COMMAND_CENTER.KPI.RETURNING_CUSTOMERS') || 'Returning'
                    ],
                    datasets: [{
                        label: 'Customers',
                        data: [newCount, returningCount],
                        backgroundColor: ['#3b82f6', '#10b981']
                    }]
                };
            })
        );
    }
}
