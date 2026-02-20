import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData } from 'chart.js';
import { toSignal } from '@angular/core/rxjs-interop';
import { CustomerInsightsService } from '../../../../../services/customer-insights.service';
import { ChartCardComponent, TableColumn } from '../../../../../shared/components/chart-card/chart-card.component';
import { MetricChartComponent } from '../../../../../shared/components/metric-chart/metric-chart.component';
import { CHART_THEME } from '../../../../../core/config/chart-theme';

import { CommandCenterContextService } from '../../../services/command-center-context.service';
import { switchMap, map } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-marketing-roi-widget',
    standalone: true,
    imports: [CommonModule, ChartCardComponent, MetricChartComponent],
    template: `
    <app-chart-card 
        [title]="'Marketing ROI'" 
        subtitle="Customer Acquisition Source (LTV)"
        [tableData]="tableData()"
        [tableColumns]="tableColumns">
        <app-metric-chart
            type="doughnut"
            [data]="chartData()"
            [options]="chartOptions"
            [height]="300">
        </app-metric-chart>
    </app-chart-card>
  `,
    styles: [`:host { display: block; height: auto; min-height: 100%; }`]
})
export class MarketingRoiWidgetComponent {
    private insightsService = inject(CustomerInsightsService);
    private contextService = inject(CommandCenterContextService);

    tableColumns: TableColumn[] = [
        { key: 'channel', label: 'Source' },
        { key: 'revenue', label: 'Revenue', format: 'currency' },
        { key: 'ltv', label: 'Avg LTV', format: 'currency' }
    ];

    // We don't have channel filtering in insights yet, so strict filtering is skipped for V1
    // But we re-trigger on context change
    private metrics$ = toObservable(this.contextService.dateRange).pipe(
        switchMap(() => this.insightsService.getAcquisitionMetrics())
    );

    metrics = toSignal(this.metrics$, { initialValue: [] });

    chartData = computed<ChartData<'doughnut'>>(() => {
        const data = this.metrics();
        // Sort by LTV for better viz
        return {
            labels: data.map(d => `${d.channel} ($${Math.round(d.avgLTV)})`),
            datasets: [
                {
                    data: data.map(d => d.totalRevenue), // Share of Wallet
                    backgroundColor: [
                        CHART_THEME.colors.primary,
                        CHART_THEME.colors.success,
                        CHART_THEME.colors.warning,
                        CHART_THEME.colors.danger,
                        CHART_THEME.colors.info,
                        '#64748b'
                    ],
                    borderWidth: 0
                }
            ]
        };
    });

    tableData = computed(() => {
        return this.metrics().map(m => ({
            channel: m.channel,
            revenue: m.totalRevenue,
            ltv: m.avgLTV
        }));
    });

    chartOptions: any = {
        responsive: true,
        plugins: {
            legend: { position: 'right' }
        }
    };
}
