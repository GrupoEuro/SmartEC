import { Component, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { KPICard } from '../../../core/models/business-metrics.model';
import { KpiCardComponent } from '../../../shared/components/kpi-card/kpi-card.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { MetricChartComponent } from '../../../shared/components/metric-chart/metric-chart.component';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { ChartData, ChartConfiguration } from 'chart.js';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { RevenueMetrics, MarginMetrics, ProfitabilityAnalysis, BostonMatrixData } from '../../../core/models/financial.model';
import { CHART_THEME } from '../../../core/config/chart-theme';

@Component({
    selector: 'app-financial-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        TranslateModule,
        KpiCardComponent,
        MetricChartComponent,
        ChartCardComponent,
        AppIconComponent,
        DashboardDiagnosticsComponent
    ],
    templateUrl: './financial-dashboard.component.html',
    styleUrls: ['./financial-dashboard.component.css']
})
export class FinancialDashboardComponent {
    @ViewChild('matrixChart') matrixChart!: MetricChartComponent;

    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);
    private translate = inject(TranslateService);

    // Convert observable to signal - automatic updates!
    private financialData = toSignal(this.dataService.financialData$, {
        initialValue: null
    });

    isLoading = toSignal(this.dataService.isLoading$, {
        initialValue: false
    });

    // State
    isTableLoading = signal(false);
    lastUpdated = signal<Date | null>(null);
    sortBy = signal<'revenue' | 'profit' | 'margin'>('profit');

    // Metrics - derived from financialData
    revenueMetrics = computed(() => this.financialData()?.revenue ?? null);
    marginMetrics = computed(() => this.financialData()?.margin ?? null);
    profitabilityData = computed(() => {
        const data = this.financialData()?.profitability ?? [];
        const sort = this.sortBy();
        return [...data].sort((a, b) => {
            if (sort === 'revenue') return b.totalRevenue - a.totalRevenue;
            if (sort === 'margin') return b.grossMargin - a.grossMargin;
            return b.grossProfit - a.grossProfit;
        });
    });
    bostonMatrixData = computed(() => this.financialData()?.bostonMatrix ?? null);

    // KPI Cards - computed from metrics
    revenueCard = computed(() => {
        const revenue = this.revenueMetrics();
        if (!revenue) return null;
        return {
            title: 'COMMAND_CENTER.FINANCIALS.KPI.REVENUE',
            value: revenue.totalRevenue,
            change: revenue.growthPercentage,
            changeLabel: 'COMMAND_CENTER.FINANCIALS.PREVIOUS_PERIOD',
            icon: 'wallet',
            trend: revenue.growthPercentage > 0 ? 'up' : revenue.growthPercentage < 0 ? 'down' : 'neutral',
            format: 'currency'
        } as KPICard;
    });

    profitCard = computed(() => {
        const margin = this.marginMetrics();
        if (!margin) return null;
        return {
            title: 'COMMAND_CENTER.FINANCIALS.KPI.PROFIT',
            value: margin.grossProfit,
            change: 0,
            changeLabel: 'COMMAND_CENTER.FINANCIALS.PREVIOUS_PERIOD',
            icon: 'trending-up',
            trend: 'neutral',
            format: 'currency'
        } as KPICard;
    });

    marginCard = computed(() => {
        const margin = this.marginMetrics();
        if (!margin) return null;
        return {
            title: 'COMMAND_CENTER.FINANCIALS.KPI.MARGIN',
            value: margin.grossMargin,
            change: 0,
            changeLabel: 'COMMAND_CENTER.FINANCIALS.PREVIOUS_PERIOD',
            icon: 'chart-pie',
            trend: 'neutral',
            format: 'percentage'
        } as KPICard;
    });

    aovCard = computed(() => {
        const revenue = this.revenueMetrics();
        if (!revenue) return null;
        return {
            title: 'COMMAND_CENTER.FINANCIALS.KPI.AOV',
            value: revenue.averageOrderValue,
            change: 0,
            changeLabel: 'COMMAND_CENTER.FINANCIALS.PREVIOUS_PERIOD',
            icon: 'cart',
            trend: 'neutral',
            format: 'currency'
        } as KPICard;
    });

    // Chart data - computed from metrics
    revenueTrendData = computed(() => {
        const revenue = this.revenueMetrics();
        if (!revenue) return null;
        return this.generateRevenueTrendChart(revenue);
    });

    marginTrendData = computed(() => {
        const margin = this.marginMetrics();
        if (!margin) return null;
        return this.generateMarginTrendChart(margin);
    });

    topProductsData = computed(() => {
        const data = this.profitabilityData();
        if (!data.length) return null;
        return this.generateTopProductsChart(data);
    });

    categoryPerformanceData = computed(() => {
        const revenue = this.revenueMetrics();
        if (!revenue) return null;
        return this.generateCategoryPerformanceChart(revenue);
    });

    // Table Configurations
    // Table Configurations
    revenueTableColumns: TableColumn[] = [
        { key: 'startDate', label: 'From', format: 'date' },
        { key: 'endDate', label: 'To', format: 'date' },
        { key: 'totalRevenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' },
        { key: 'orderCount', label: 'COMMAND_CENTER.SALES_ANALYTICS.ORDERS', format: 'number' }
    ];

    marginTableColumns: TableColumn[] = [
        { key: 'startDate', label: 'From', format: 'date' },
        { key: 'endDate', label: 'To', format: 'date' },
        { key: 'grossMargin', label: 'COMMAND_CENTER.FINANCIALS.TABLE.MARGIN', format: 'percent' },
        { key: 'grossProfit', label: 'COMMAND_CENTER.FINANCIALS.TABLE.PROFIT', format: 'currency' }
    ];

    categoryTableColumns: TableColumn[] = [
        { key: 'categoryName', label: 'COMMAND_CENTER.FINANCIALS.TABLE.CATEGORY', format: 'category' },
        { key: 'revenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' },
        { key: 'percentage', label: 'COMMAND_CENTER.FINANCIALS.TABLE.SHARE', format: 'percent' }
    ];

    productTableColumns: TableColumn[] = [
        { key: 'productName', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.PRODUCT' },
        { key: 'totalRevenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' },
        { key: 'grossMargin', label: 'COMMAND_CENTER.FINANCIALS.TABLE.MARGIN', format: 'percent' },
        { key: 'grossProfit', label: 'COMMAND_CENTER.FINANCIALS.TABLE.PROFIT', format: 'currency' }
    ];

    // Table Data Accessors
    revenueTableData = computed(() => {
        const m = this.revenueMetrics();
        return m ? [m] : [];
    });

    marginTableData = computed(() => {
        const m = this.marginMetrics();
        return m ? [m] : [];
    });

    categoryTableData = computed(() => this.revenueMetrics()?.byCategory ?? []);

    productTableData = computed(() => this.profitabilityData());

    bostonMatrixPoints = computed(() => {
        // Access payload from the resource that feeds the chart
        // Based on `productStrategyData`, we use `this.financialsResource.value()?.bostonMatrix`
        // I need to check exactly what `productStrategyData` uses.
        // It likely uses `this.data()` or `this.financialData()`.
        // Let's assume there is a `financialData` signal or equivalent.
        // Checking previous file read... `productStrategyData` uses `this.financialData()?.bostonMatrix`.
        const data = this.financialData();
        return data?.bostonMatrix?.points || [];
    });

    productStrategyData = computed(() => {
        const data = this.financialData();
        // Removed hoveredProduct dependency from here to prevent re-renders
        if (!data?.bostonMatrix) return null;
        return this.generateBostonMatrixChart(data.bostonMatrix);
    });

    private generateTopProductsChart(data: ProfitabilityAnalysis[]): ChartData<'bar'> {
        const top5 = data.slice(0, 5);
        const chartData: ChartData<'bar'> = {
            labels: top5.map(p => p.productName),
            datasets: [{
                label: this.translate.instant('COMMAND_CENTER.FINANCIALS.KPI.PROFIT'),
                data: top5.map(p => p.grossProfit),
                backgroundColor: [
                    CHART_THEME.palette[0],
                    CHART_THEME.palette[1],
                    CHART_THEME.palette[2],
                    CHART_THEME.palette[3],
                    CHART_THEME.palette[4]
                ],
                borderColor: [
                    CHART_THEME.palette[0],
                    CHART_THEME.palette[1],
                    CHART_THEME.palette[2],
                    CHART_THEME.palette[3],
                    CHART_THEME.palette[4]
                ],
                borderWidth: 1
            }]
        };
        return chartData;
    }

    private generateCategoryPerformanceChart(metrics: RevenueMetrics): ChartData<'doughnut'> {
        const top5Categories = metrics.byCategory.slice(0, 5);
        const data: ChartData<'doughnut'> = {
            labels: top5Categories.map(c => {
                const key = 'CATEGORIES.' + c.categoryName.toUpperCase();
                const translated = this.translate.instant(key);
                return translated !== key ? translated : c.categoryName.replace('cat_', '').replace('_', ' ').toUpperCase();
            }),
            datasets: [{
                data: top5Categories.map(c => c.revenue),
                backgroundColor: [
                    CHART_THEME.palette[0],
                    CHART_THEME.palette[1],
                    CHART_THEME.palette[2],
                    CHART_THEME.palette[3],
                    CHART_THEME.palette[4]
                ],
                borderColor: [
                    CHART_THEME.palette[0],
                    CHART_THEME.palette[1],
                    CHART_THEME.palette[2],
                    CHART_THEME.palette[3],
                    CHART_THEME.palette[4]
                ],
                borderWidth: 2
            }]
        };
        return data;
    }

    // Helper for formatting currency
    formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(value);
    }

    // Helper for formatting percentage
    formatPercentage(value: number): string {
        return `${value.toFixed(1)}%`;
    }

    private generateRevenueTrendChart(metrics: RevenueMetrics): ChartData<'line'> {
        // For now, simple placeholder - would need historical data
        return {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            datasets: [{
                label: 'Revenue',
                data: [
                    metrics.totalRevenue * 0.7,
                    metrics.totalRevenue * 0.85,
                    metrics.totalRevenue * 0.95,
                    metrics.totalRevenue
                ],
                borderColor: CHART_THEME.colors.primary,
                backgroundColor: CHART_THEME.colors.bg.primary,
                tension: 0.4,
                fill: true
            }]
        };
    }

    private generateMarginTrendChart(metrics: MarginMetrics): ChartData<'line'> {
        // Placeholder margin trend
        return {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            datasets: [{
                label: 'Margin %',
                data: [
                    metrics.grossMargin * 0.95,
                    metrics.grossMargin * 0.98,
                    metrics.grossMargin * 1.02,
                    metrics.grossMargin
                ],
                borderColor: CHART_THEME.colors.success,
                backgroundColor: CHART_THEME.colors.success + '1A', // 10% opacity hex hack, or use helper if needed. But chart-theme has rba helpers or just use hardcoded transparent version if needed.
                // Wait, colors.success is hex. I need an alpha version. 
                // Let's check chart-theme again. It defines hexes. 
                // I will use a simple rgba string since I don't have a helper imported.
                // Actually I can just use transparent success color. 
                // Let's use 'rgba(52, 211, 153, 0.1)' matching #34d399
                tension: 0.4,
                fill: true
            }]
        };
    }

    // Explanation State
    showBostonMatrixInfo = signal(false);
    showBostonMatrixTable = signal(false);
    hoveredProduct = signal<string | null>(null); // Track hovered product

    toggleBostonMatrixInfo() {
        this.showBostonMatrixInfo.update(v => !v);
    }

    toggleBostonMatrixTable() {
        this.showBostonMatrixTable.update(v => !v);
    }

    setHoveredProduct(productName: string | null) {
        this.hoveredProduct.set(productName);

        // Direct ViewChild interaction to avoid re-rendering chart
        if (this.matrixChart) {
            if (productName) {
                this.matrixChart.highlightDataPoint(productName);
            } else {
                this.matrixChart.resetHighlight();
            }
        }
    }

    bostonMatrixOptions = computed<ChartConfiguration['options']>(() => {
        return {
            scales: {
                x: {
                    title: {
                        display: true,
                        text: this.translate.instant('COMMAND_CENTER.FINANCIALS.MATRIX.AXIS_X'), // Relative Market Share
                        color: CHART_THEME.colors.text.secondary
                    },
                    reverse: true, // BCG standard: High share on left
                    grid: { color: CHART_THEME.colors.grid },
                    ticks: { color: CHART_THEME.colors.text.secondary }
                },
                y: {
                    title: {
                        display: true,
                        text: this.translate.instant('COMMAND_CENTER.FINANCIALS.MATRIX.AXIS_Y'), // Market Growth Rate
                        color: CHART_THEME.colors.text.secondary
                    },
                    grid: { color: CHART_THEME.colors.grid },
                    ticks: { color: CHART_THEME.colors.text.secondary }
                }
            },
            plugins: {
                legend: {
                    display: false // Hide default legend as we have a custom explanation panel
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fbbf24',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: (items: any[]) => {
                            if (!items.length) return '';
                            const point = items[0].raw;
                            return point.productName || 'Unknown Product';
                        },
                        label: (context: any) => {
                            const point = context.raw;
                            const rev = this.formatCurrency(point.revenue || 0);
                            return `Revenue: ${rev} `;
                        },
                        afterLabel: (context: any) => {
                            const point = context.raw;
                            const growth = point.y;
                            const share = point.x;

                            let strategy = '';
                            if (point.quadrant === 'stars') strategy = 'Strategy: Invest for growth 🚀';
                            else if (point.quadrant === 'cows') strategy = 'Strategy: Milk for cash flow 💰';
                            else if (point.quadrant === 'questions') strategy = 'Strategy: Decide (Invest/Divest) 🤔';
                            else if (point.quadrant === 'dogs') strategy = 'Strategy: Reposition or Liquidate ⚠️';

                            return [
                                `Growth: ${growth}% | Relative Share: ${Number(share).toFixed(2)}x`,
                                strategy
                            ];
                        }
                    }
                }
            }
        };
    });

    private generateBostonMatrixChart(data: BostonMatrixData): ChartData<'scatter'> {
        const points = data.points;
        // DEBUG: verifying data passed to chart
        console.log(`FinancialDashboard: Generating Boston Matrix Chart with ${points.length} points.`);

        const createDataset = (label: string, quadrant: string, color: string, borderColor: string, emoji: string) => {
            const quadrantPoints = points.filter(p => p.quadrant === quadrant);
            // console.log(`Dataset ${label}: ${quadrantPoints.length} points.`);

            return {
                label,
                data: quadrantPoints,
                backgroundColor: color,
                // Simplify to standard shape for debugging
                // pointStyle: 'circle',
                pointStyle: (ctx: any) => {
                    return this.createEmojiIcon(emoji, color);
                },
                borderColor: borderColor,
                pointRadius: (ctx: any) => {
                    const p = ctx.raw || {};
                    return (p.r || 5) * 1.5; // Base size
                },
                pointHoverRadius: (ctx: any) => {
                    const p = ctx.raw || {};
                    const baseRadius = (p.r || 5) * 1.5;
                    return baseRadius * 1.5; // Standard hover pop
                }
            };
        };

        return {
            datasets: [
                createDataset('Stars', 'stars', CHART_THEME.colors.warning, 'rgba(0,0,0,0.1)', '⭐'),
                createDataset('Cash Cows', 'cows', CHART_THEME.colors.secondary, 'rgba(0,0,0,0.1)', '🐄'),
                createDataset('Question Marks', 'questions', CHART_THEME.colors.purple, 'rgba(0,0,0,0.1)', '❓'),
                createDataset('Dogs', 'dogs', CHART_THEME.colors.text.secondary, 'rgba(0,0,0,0.1)', '🐕')
            ]
        };
    }

    private createEmojiIcon(emoji: string, color: string): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '32px Arial'; // Large emoji font
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, 24, 24);
        }
        return canvas;
    }

    refreshData() {
        this.dataService.refresh();
    }

    sortProfitability(metric: 'revenue' | 'profit' | 'margin') {
        this.sortBy.set(metric);
    }
}
