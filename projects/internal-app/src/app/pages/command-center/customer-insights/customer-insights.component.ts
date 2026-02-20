import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ChartConfiguration, ChartData } from 'chart.js';
import { CustomerInsightsService, InsightsData, CustomerProfile } from '../../../services/customer-insights.service';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { MetricChartComponent } from '../../../shared/components/metric-chart/metric-chart.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, tap, map, shareReplay } from 'rxjs/operators';

import { TourService } from '../../../core/services/tour.service';

@Component({
    selector: 'app-customer-insights',
    standalone: true,
    imports: [
        CommonModule,
        TranslateModule,
        AppIconComponent,
        AppIconComponent,
        ChartCardComponent,
        MetricChartComponent,
        DashboardDiagnosticsComponent
    ],
    templateUrl: './customer-insights.component.html',
    styleUrls: ['./customer-insights.component.css']
})
export class CustomerInsightsComponent {
    private insightsService = inject(CustomerInsightsService);
    public contextService = inject(CommandCenterContextService);
    private tourService = inject(TourService);

    isLoading = signal(true);

    // UI State
    showRFMInfo = signal(false);
    showRFMTable = signal(false);
    showCohortInfo = signal(false);

    // Reactive Data Source
    // We fetch full insights (Lifetime) but trigger on date range change to allow potential future filtering
    // For now, RFM/Cohorts are lifetime, but we'll compute "Acquisition" based on the range.
    private insightsStream$ = toObservable(this.contextService.dateRange).pipe(
        tap(() => this.isLoading.set(true)),
        switchMap(() => this.insightsService.getInsights()),
        tap(() => this.isLoading.set(false)),
        shareReplay(1)
    );

    insightsData = toSignal(this.insightsStream$.pipe(
        map(data => data) // Identity map for now, can transform
    ));

    // Computed Metrics based on Date Range
    newCustomersInPeriod = computed(() => {
        const data = this.insightsData();
        const range = this.contextService.dateRange();
        if (!data || !range) return 0;

        return data.profiles.filter(p =>
            p.firstOrderDate >= range.start && p.firstOrderDate <= range.end
        ).length;
    });

    atRiskCustomers = computed(() => {
        const data = this.insightsData();
        if (!data) return [];
        return data.profiles
            .filter(p => p.segment === 'At Risk' || p.segment === 'Lost')
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, 5); // Top 5 high value at risk
    });

    // Charts
    rfmChartData = computed<ChartData<'scatter'>>(() => {
        const data = this.insightsData();
        if (!data) return { datasets: [] };
        return this.setupRFMData(data.profiles);
    });

    segmentChartData = computed<ChartData<'doughnut'>>(() => {
        const data = this.insightsData();
        if (!data) return { labels: [], datasets: [] };
        return this.setupSegmentData(data.profiles);
    });

    // Acquisition Trend (Last 6 Months derived from full history)
    acquisitionChartData = computed<ChartData<'bar'>>(() => {
        const data = this.insightsData();
        if (!data) return { labels: [], datasets: [] };

        // Group by month
        const acquisitionMap = new Map<string, number>();
        data.profiles.forEach(p => {
            const key = p.firstOrderDate.toISOString().slice(0, 7); // YYYY-MM
            acquisitionMap.set(key, (acquisitionMap.get(key) || 0) + 1);
        });

        // Sort keys (months)
        const sortedMonths = Array.from(acquisitionMap.keys()).sort().slice(-12); // Last 12 months

        return {
            labels: sortedMonths,
            datasets: [{
                label: 'New Customers',
                data: sortedMonths.map(m => acquisitionMap.get(m) || 0),
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        };
    });

    // Tables
    rfmTableData = computed<any[]>(() => {
        const data = this.insightsData();
        if (!data) return [];
        return data.profiles.map(p => ({
            name: p.name,
            segment: p.segment,
            recency: Math.round((new Date().getTime() - p.lastOrderDate.getTime()) / (1000 * 3600 * 24)),
            frequency: p.orderCount,
            monetary: p.totalSpent
        })).slice(0, 100); // Limit table for performance
    });

    rfmTableColumns: TableColumn[] = [
        { key: 'name', label: 'Customer', format: 'text' as any },
        { key: 'segment', label: 'Segment', format: 'category' },
        { key: 'recency', label: 'Days Since', format: 'number' },
        { key: 'frequency', label: 'Orders', format: 'number' },
        { key: 'monetary', label: 'LTV', format: 'currency' }
    ];

    segmentTableData = computed<any[]>(() => {
        const data = this.insightsData();
        if (!data) return [];
        const counts = new Map<string, number>();
        data.profiles.forEach(p => counts.set(p.segment, (counts.get(p.segment) || 0) + 1));
        return Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
    });

    segmentTableColumns: TableColumn[] = [
        { key: 'label', label: 'Segment', format: 'category' },
        { key: 'value', label: 'Customers', format: 'number' }
    ];

    // Debugging
    debugData = computed(() => ({
        dateRange: this.contextService.dateRange(),
        profilesLoaded: this.insightsData()?.profiles?.length || 0,
        cohortsLoaded: this.insightsData()?.cohorts?.length || 0,
        isLoading: this.isLoading()
    }));

    // Chart Options
    rfmChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                labels: { color: '#cbd5e1', padding: 20, usePointStyle: true }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#fbbf24',
                bodyColor: '#e2e8f0',
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                    label: (ctx: any) => {
                        const p = ctx.raw as any;
                        return `${p.name}: $${p.monetary.toLocaleString()} (${p.y} orders)`;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                position: 'bottom',
                title: { display: true, text: 'Days Since Last Order', color: '#64748b' },
                ticks: { color: '#64748b' },
                grid: { color: 'rgba(148, 163, 184, 0.05)' }
            },
            y: {
                title: { display: true, text: 'Order Frequency', color: '#64748b' },
                ticks: { color: '#64748b' },
                grid: { color: 'rgba(148, 163, 184, 0.05)' }
            }
        }
    };

    private setupRFMData(profiles: CustomerProfile[]): ChartData<'scatter'> {
        const segments = ['Champion', 'Loyal', 'New', 'At Risk', 'Lost'];
        const colors: any = {
            'Champion': '#10b981', 'Loyal': '#3b82f6', 'New': '#f59e0b',
            'At Risk': '#f43f5e', 'Lost': '#64748b'
        };

        return {
            datasets: segments.map(seg => ({
                label: seg,
                data: profiles.filter(p => p.segment === seg).map(p => ({
                    x: Math.round((new Date().getTime() - p.lastOrderDate.getTime()) / (1000 * 3600 * 24)),
                    y: p.orderCount,
                    monetary: p.totalSpent,
                    name: p.name
                })),
                backgroundColor: colors[seg],
                pointRadius: 5,
                pointHoverRadius: 8
            }))
        };
    }

    private setupSegmentData(profiles: CustomerProfile[]): ChartData<'doughnut'> {
        const counts = new Map<string, number>();
        profiles.forEach(p => counts.set(p.segment, (counts.get(p.segment) || 0) + 1));

        // Fix Order: Champion, Loyal, New, At Risk, Lost
        const order = ['Champion', 'Loyal', 'New', 'At Risk', 'Lost'];
        const colors = ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e', '#64748b'];

        return {
            labels: order,
            datasets: [{
                data: order.map(seg => counts.get(seg) || 0),
                backgroundColor: colors,
                borderWidth: 0
            }]
        };
    }

    getRetentionColor(pct: number): string {
        // Continuous Heatmap Gradient: Emerald-based opacity
        // Higher retention = Higher opacity
        // This creates a cleaner, monochromatic look which is best practice
        const alpha = Math.max(0.1, pct / 100);
        return `rgba(16, 185, 129, ${alpha})`; // Emerald-500 equivalent
    }

    getRiskLevelClass(score: number): string {
        if (score > 80) return 'critical';
        if (score > 50) return 'warning';
        return 'safe';
    }

    toggleRFMInfo() {
        this.showRFMInfo.update(v => !v);
    }

    toggleRFMTable() {
        this.showRFMTable.update(v => !v);
    }

    toggleCohortInfo() {
        this.showCohortInfo.update(v => !v);
    }

    startTour() {
        this.tourService.startTour('customer-insights-tour');
    }
}
