import { Component, computed, inject, Input, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData } from 'chart.js';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { OperationalMetricsService } from '../../../../../services/operational-metrics.service';
import { ChartCardComponent, TableColumn } from '../../../../../shared/components/chart-card/chart-card.component';
import { MetricChartComponent } from '../../../../../shared/components/metric-chart/metric-chart.component';
import { CHART_THEME } from '../../../../../core/config/chart-theme';
import { CommandCenterContextService } from '../../../services/command-center-context.service';
import { switchMap, map } from 'rxjs/operators';

@Component({
    selector: 'app-channel-revenue-widget',
    standalone: true,
    imports: [CommonModule, ChartCardComponent, MetricChartComponent],
    template: `
    <app-chart-card 
        [title]="'Channel Performance'" 
        subtitle="Revenue & Volume Breakdown"
        [tableData]="tableData()"
        [tableColumns]="tableColumns">
        <app-metric-chart
            type="bar"
            [data]="chartData()"
            [options]="chartOptions"
            [height]="300">
        </app-metric-chart>
    </app-chart-card>
  `,
    styles: [`:host { display: block; height: auto; min-height: 100%; }`]
})
export class ChannelRevenueWidgetComponent {
    private metricsService = inject(OperationalMetricsService);
    private contextService = inject(CommandCenterContextService);

    tableColumns: TableColumn[] = [
        { key: 'channel', label: 'Channel' },
        { key: 'revenue', label: 'Revenue', format: 'currency' },
        { key: 'orderCount', label: 'Orders' },
        { key: 'avgOrderValue', label: 'AOV', format: 'currency' }
    ];

    private metrics$ = toObservable(
        computed(() => ({
            range: this.contextService.dateRange(),
            channels: this.contextService.selectedChannels()
        }))
    ).pipe(
        switchMap(({ range, channels }) =>
            this.metricsService.getChannelMetrics(range.start, range.end).pipe(
                map(metrics => {
                    if (channels.length === 0) return metrics;
                    // Filter by selected channels
                    return metrics.filter(m => {
                        // Normalize metrics channel name to match ID format (e.g. "WEB STORE" vs "WEB") -> Wait, logic is ID to Name.
                        // Service returns "WEB", "POS", "AMAZON MFN" (space replaced).
                        // Context uses "WEB", "POS", "AMAZON_MFN".
                        // So we need to match ID.replace('_', ' ') === metric.channel
                        return channels.some(id => id.replace('_', ' ') === m.channel);
                    });
                })
            )
        )
    );

    metrics = toSignal(this.metrics$, { initialValue: [] });

    chartData = computed<ChartData<'bar' | 'line'>>(() => {
        const data = this.metrics();
        return {
            labels: data.map(d => d.channel),
            datasets: [
                {
                    label: 'Revenue',
                    data: data.map(d => d.revenue),
                    backgroundColor: CHART_THEME.colors.primary,
                    // secondary axis? for now just revenue
                    yAxisID: 'y'
                },
                {
                    label: 'Orders',
                    data: data.map(d => d.orderCount),
                    backgroundColor: CHART_THEME.colors.secondary,
                    yAxisID: 'y1',
                    type: 'line' as const
                }
            ]
        };
    });

    tableData = computed(() => {
        const data = this.metrics();
        return data.map(m => ({
            channel: m.channel,
            revenue: m.revenue,
            orderCount: m.orderCount,
            avgOrderValue: m.orderCount > 0 ? m.revenue / m.orderCount : 0
        }));
    });

    chartOptions: any = {
        responsive: true,
        scales: {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                title: { display: true, text: 'Revenue ($)' }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Orders (#)' },
                ticks: {
                    precision: 0,
                    callback: function (value: any) {
                        return value; // Just return the number, no formatting
                    }
                }
            }
        }
    };
}
