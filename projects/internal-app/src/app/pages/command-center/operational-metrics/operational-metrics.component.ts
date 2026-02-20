import { Component, OnInit, inject, computed, effect, Injector, afterNextRender, signal, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ChartData } from 'chart.js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    OperationalMetricsService,
    OrderMetrics,
    SLAMetrics,
    StaffPerformance,
    TrendData
} from '../../../services/operational-metrics.service';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CHART_THEME } from '../../../core/config/chart-theme';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { MetricChartComponent } from '../../../shared/components/metric-chart/metric-chart.component';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';

@Component({
    selector: 'app-operational-metrics',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent, DashboardDiagnosticsComponent, MetricChartComponent, ChartCardComponent],
    templateUrl: './operational-metrics.component.html',
    styleUrls: ['./operational-metrics.component.css']
})
export class OperationalMetricsComponent implements OnInit {
    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);
    private destroyRef = inject(DestroyRef);

    // Convert observable to signal
    private operationalData = toSignal(this.dataService.operationalData$, {
        initialValue: null
    });

    isLoading = toSignal(this.dataService.isLoading$, {
        initialValue: false
    });

    // Data - computed from service
    orderMetrics = computed(() => this.operationalData()?.orderMetrics ?? null);
    slaMetrics = computed(() => this.operationalData()?.slaMetrics ?? null);
    staffPerformance = computed(() => this.operationalData()?.staffPerformance ?? []);
    // @ts-ignore
    fulfillmentTrend = computed(() => (this.operationalData() as any)?.fulfillmentTrend ?? []);
    // @ts-ignore
    slaTrend = computed(() => (this.operationalData() as any)?.slaTrend ?? []);

    // Computed Chart Data (Declarative)
    fulfillmentTrendData = computed<ChartData<'line'>>(() => {
        const trend = this.fulfillmentTrend();
        return {
            labels: trend.map((t: any) => t.date),
            datasets: [{
                label: 'Avg Fulfillment Time (hours)',
                data: trend.map((t: any) => t.value),
                borderColor: CHART_THEME.colors.primary,
                backgroundColor: CHART_THEME.colors.bg.primary,
                tension: 0.4,
                fill: true
            }]
        };
    });

    slaTrendData = computed<ChartData<'line'>>(() => {
        const trend = this.slaTrend();
        return {
            labels: trend.map((t: any) => t.date),
            datasets: [{
                label: 'SLA Compliance (%)',
                data: trend.map((t: any) => t.value),
                borderColor: CHART_THEME.colors.success,
                backgroundColor: (CHART_THEME.colors.bg as any).success, // Cast to any to avoid stale type error
                tension: 0.4,
                fill: true
            }]
        };
    });

    statusChartData = computed<ChartData<'doughnut'>>(() => {
        const metrics = this.orderMetrics();
        return {
            labels: ['Pending', 'Processing', 'Fulfilled'],
            datasets: [{
                data: metrics ? [
                    metrics.pendingOrders,
                    metrics.processingOrders,
                    metrics.fulfilledOrders
                ] : [0, 0, 0],
                backgroundColor: [CHART_THEME.colors.danger, CHART_THEME.colors.warning, CHART_THEME.colors.success],
                borderColor: CHART_THEME.colors.bg.tooltip,
                borderWidth: 2
            }]
        };
    });

    staffChartData = computed<ChartData<'bar'>>(() => {
        const staff = this.staffPerformance();
        return {
            labels: staff.map(s => s.staffName),
            datasets: [{
                label: 'Orders Processed',
                data: staff.map(s => s.ordersProcessed),
                backgroundColor: CHART_THEME.colors.primary,
                borderColor: CHART_THEME.colors.warning,
                borderWidth: 1
            }]
        };
    });

    // Table Configurations
    fulfillmentTableColumns: TableColumn[] = [
        { key: 'date', label: 'COMMAND_CENTER.SALES_ANALYTICS.PERIOD', format: 'date' },
        { key: 'value', label: 'Avg Time (Hours)', format: 'number' }
    ];

    slaTableColumns: TableColumn[] = [
        { key: 'date', label: 'COMMAND_CENTER.SALES_ANALYTICS.PERIOD', format: 'date' },
        { key: 'value', label: 'Compliance', format: 'percent' }
    ];

    statusTableColumns: TableColumn[] = [
        { key: 'status', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.STATUS' },
        { key: 'count', label: 'COMMAND_CENTER.SALES_ANALYTICS.QUANTITY', format: 'number' }
    ];

    staffTableColumns: TableColumn[] = [
        { key: 'staffName', label: 'Staff Member' },
        { key: 'ordersProcessed', label: 'COMMAND_CENTER.SALES_ANALYTICS.ORDERS', format: 'number' },
        { key: 'averageProcessingTime', label: 'Avg Time (hrs)', format: 'number' }
    ];

    // Data Accessors
    fulfillmentTableData = computed(() => this.fulfillmentTrend());
    slaTableData = computed(() => this.slaTrend());
    statusTableData = computed(() => {
        const m = this.orderMetrics();
        if (!m) return [];
        return [
            { status: 'Pending', count: m.pendingOrders },
            { status: 'Processing', count: m.processingOrders },
            { status: 'Fulfilled', count: m.fulfilledOrders }
        ];
    });
    staffTableData = computed(() => this.staffPerformance());

    constructor() { }

    ngOnInit() {
        // Debugging via explicit subscription
        this.addLog('🚀 Component Init - Subscribing to data...');

        this.dataService.operationalData$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (data) => {
                    if (data && data.orderMetrics) {
                        const count = data.orderMetrics.totalOrders ?? 0;
                        const staffCount = data.staffPerformance?.length ?? 0;
                        this.addLog(`⚡ Data Stream Emitted: ${count} orders, ${staffCount} staff.`);

                        if (count > 0) {
                            this.addLog('✅ Data successfully loaded into view.');
                            // Debug Status Breakdown
                            const statusStr = Object.entries(data.orderMetrics.statusBreakdown || {})
                                .map(([k, v]) => `${k}: ${v}`).join(', ');
                            this.addLog(`📊 Status Breakdown: ${statusStr}`);
                        } else {
                            this.addLog('⚠️ Data loaded but Empty (0 orders).');
                        }
                    } else {
                        this.addLog('⏳ Stream emitted null or in-progress state...');
                    }
                },
                error: (err) => this.addLog(`❌ Stream Error: ${err}`)
            });
    }

    refresh() {
        this.dataService.refresh();
    }

    formatHours(hours: number): string {
        if (hours < 1) {
            return `${Math.round(hours * 60)} min`;
        }
        return `${hours.toFixed(1)} hrs`;
    }

    getSLAClass(rate: number): string {
        if (rate >= 95) return 'excellent';
        if (rate >= 85) return 'good';
        if (rate >= 75) return 'moderate';
        return 'poor';
    }

    exportStaffData() {
        const staff = this.staffPerformance();
        if (!staff || staff.length === 0) return;

        const headers = ['Rank', 'Staff Name', 'Orders Processed', 'Avg Processing Time (hrs)', 'Active Orders'];
        const rows = staff.map(s => [
            s.rank,
            `"${s.staffName}"`, // Quote name to handle commas
            s.ordersProcessed,
            s.averageProcessingTime.toFixed(2),
            s.activeOrders
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `staff_performance_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Diagnostics (Trigger Recompile)
    buildVersion = 'v1.0.19-OPS-EXPORT';
    logs = signal<string[]>([]);

    private router = inject(Router);

    onStatusChartClick(event: { label: string, value: any, datasetLabel?: string, index: number }) {
        this.addLog(`🖱️ Chart Clicked: ${event.label} (Index: ${event.index})`);

        // Mapping matches statusChartData labels: ['Pending', 'Processing', 'Fulfilled']
        // 0 -> pending, 1 -> processing, 2 -> shipped (for Fulfilled)
        // Note: Fulfilled typically means Shipped + Delivered, but for filtering we pick one indicative status or need complex filter
        const statusMap = ['pending', 'processing', 'shipped'];
        const status = statusMap[event.index];

        if (status) {
            this.addLog(`↪️ Navigating to Order Queue with status: ${status}`);
            this.router.navigate(['/operations/orders'], { queryParams: { status } });
        }
    }

    private addLog(msg: string) {
        this.logs.update((l: string[]) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }
}
