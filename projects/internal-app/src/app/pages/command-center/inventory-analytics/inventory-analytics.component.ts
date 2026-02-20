import { Component, OnInit, inject, computed, effect, Injector, NgZone, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ChartConfiguration, ChartData } from 'chart.js';
import { AnalyticsService, InventoryMetrics, ProductPerformance } from '../../../services/analytics.service';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CHART_THEME } from '../../../core/config/chart-theme';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';

@Component({
    selector: 'app-inventory-analytics',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent, ChartCardComponent, DashboardDiagnosticsComponent],
    templateUrl: './inventory-analytics.component.html',
    styleUrls: ['./inventory-analytics.component.css']
})
export class InventoryAnalyticsComponent implements OnInit {
    private analyticsService = inject(AnalyticsService);
    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);
    private translate = inject(TranslateService);
    private ngZone = inject(NgZone);

    // Reactive Language Signal to trigger computed re-evaluation
    private currentLang = signal(this.translate.currentLang);

    // Convert observable to signal
    private inventoryData = toSignal(this.dataService.inventoryData$, {
        initialValue: null
    });

    isLoading = toSignal(this.dataService.isLoading$, {
        initialValue: false
    });

    // Data - computed from service
    inventoryMetrics = computed(() => this.inventoryData()?.metrics ?? null);
    productPerformance = computed(() => this.inventoryData()?.performance ?? []);

    // Derived data - computed from productPerformance
    lowStockProducts = computed(() =>
        this.productPerformance().filter(p => p.stockLevel === 'low')
    );

    reorderRecommendations = computed(() =>
        this.productPerformance()
            .filter(p => p.predictedStockoutDate || p.stockLevel === 'low')
            .slice(0, 10)
    );

    topPerformers = computed(() =>
        this.productPerformance()
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5)
    );

    deadStockList = computed(() =>
        this.productPerformance().filter(p => p.stockLevel === 'dead')
    );


    // Stock Distribution Chart
    stockChartData: ChartData<'doughnut'> = {
        labels: [],
        datasets: [{
            data: [0, 0, 0],
            backgroundColor: [
                CHART_THEME.colors.success, // In Stock
                CHART_THEME.colors.warning, // Low Stock
                CHART_THEME.colors.danger   // Out of Stock
            ],
            borderColor: CHART_THEME.colors.bg.tooltip,
            borderWidth: 2
        }]
    };

    // Table Configurations
    stockTableColumns: TableColumn[] = [
        { key: 'status', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.STATUS' },
        { key: 'count', label: 'COMMAND_CENTER.SALES_ANALYTICS.QUANTITY', format: 'number' },
        { key: 'value', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.VALUE_EST', format: 'currency' }
    ];

    turnoverTableColumns: TableColumn[] = [
        { key: 'productName', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.PRODUCT' },
        { key: 'turnoverRate', label: 'COMMAND_CENTER.INVENTORY_ANALYTICS.TURNOVER_RATE', format: 'percent' },
        { key: 'revenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' }
    ];

    // Data Accessors
    stockTableData = computed(() => {
        const m = this.inventoryMetrics();
        this.currentLang(); // Trigger dependency
        if (!m) return [];
        const inStock = m.totalProducts - m.lowStockProducts - m.outOfStockProducts;
        return [
            { status: this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.IN_STOCK'), count: inStock, value: m.totalStockValue * 0.7 }, // Approx
            { status: this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.LOW_STOCK'), count: m.lowStockProducts, value: m.totalStockValue * 0.2 },
            { status: this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.OUT_OF_STOCK'), count: m.outOfStockProducts, value: 0 }
        ];
    });

    turnoverTableData = computed(() => this.topPerformers());


    ngOnInit() {
        // Data automatically loads via toSignal from CommandCenterDataService
    }



    stockChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right',
                labels: {
                    color: CHART_THEME.colors.text.secondary,
                    padding: 15,
                    font: {
                        size: 12,
                        family: CHART_THEME.fonts.family
                    },
                    usePointStyle: true
                }
            },
            tooltip: {
                backgroundColor: CHART_THEME.colors.bg.tooltip,
                titleColor: CHART_THEME.colors.text.primary,
                bodyColor: CHART_THEME.colors.text.secondary,
                borderColor: CHART_THEME.colors.primary,
                borderWidth: 1,
                callbacks: {
                    label: function (context) {
                        const label = context.label || '';
                        const value = context.parsed || 0;
                        const total = context.dataset.data.reduce((a: any, b: any) => a + b, 0);
                        const percent = ((value / total) * 100).toFixed(1);
                        return `${label}: ${value} (${percent}%)`;
                    }
                }
            }
        }
    };

    // Turnover Rate Chart
    turnoverChartData: ChartData<'bar'> = {
        labels: [],
        datasets: [{
            label: 'Turnover Rate (%)',
            data: [],
            backgroundColor: CHART_THEME.colors.primary,
            borderColor: CHART_THEME.colors.warning,
            borderWidth: 1
        }]
    };

    turnoverChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: CHART_THEME.colors.bg.tooltip,
                titleColor: CHART_THEME.colors.text.primary,
                bodyColor: CHART_THEME.colors.text.secondary,
                borderColor: CHART_THEME.colors.primary,
                borderWidth: 1,
                callbacks: {
                    label: function (context) {
                        return (context.parsed.x ?? 0).toFixed(2) + '%';
                    }
                }
            }
        },
        scales: {
            x: {
                beginAtZero: true,
                ticks: {
                    color: CHART_THEME.colors.text.secondary,
                    font: {
                        family: CHART_THEME.fonts.family
                    },
                    callback: function (value) {
                        return value + '%';
                    }
                },
                grid: {
                    color: CHART_THEME.colors.grid
                }
            },
            y: {
                ticks: {
                    color: CHART_THEME.colors.text.secondary,
                    font: {
                        family: CHART_THEME.fonts.family
                    }
                },
                grid: {
                    color: CHART_THEME.colors.grid
                }
            }
        }
    };

    // Stock Efficiency Matrix (Scatter)
    efficiencyChartData: ChartData<'scatter'> = {
        datasets: [{
            label: 'Products',
            data: [],
            backgroundColor: CHART_THEME.colors.primary,
            borderColor: CHART_THEME.colors.primary,
            pointRadius: 6,
            pointHoverRadius: 8
        }]
    };

    efficiencyChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: (context) => {
                        const p = (context.raw as any);
                        return `${p.productName}: Turn ${p.x.toFixed(1)}x, GMROI ${p.y.toFixed(1)}`;
                    }
                }
            },
            // @ts-ignore
            annotation: {
                annotations: {
                    quadrant1: {
                        type: 'box',
                        xMin: 6, xMax: 12, // High Turn
                        yMin: 2, yMax: 5,  // High ROI
                        backgroundColor: 'rgba(75, 192, 192, 0.1)', // Greenish
                        borderWidth: 0,
                        label: { content: 'Winners', position: 'center', color: 'rgba(75, 192, 192, 0.5)', font: { size: 16, weight: 'bold' } }
                    },
                    quadrant2: {
                        type: 'box',
                        xMin: 0, xMax: 6, // Low Turn
                        yMin: 2, yMax: 5, // High ROI
                        backgroundColor: 'rgba(54, 162, 235, 0.1)', // Blueish
                        borderWidth: 0,
                        label: { content: 'Opportunity', position: 'center', color: 'rgba(54, 162, 235, 0.5)', font: { size: 16, weight: 'bold' } }
                    },
                    quadrant3: {
                        type: 'box',
                        xMin: 6, xMax: 12, // High Turn
                        yMin: 0, yMax: 2,  // Low ROI
                        backgroundColor: 'rgba(255, 206, 86, 0.1)', // Yellowish
                        borderWidth: 0,
                        label: { content: 'Volume Movers', position: 'center', color: 'rgba(255, 206, 86, 0.5)', font: { size: 16, weight: 'bold' } }
                    },
                    quadrant4: {
                        type: 'box',
                        xMin: 0, xMax: 6, // Low Turn
                        yMin: 0, yMax: 2,  // Low ROI
                        backgroundColor: 'rgba(255, 99, 132, 0.1)', // Reddish
                        borderWidth: 0,
                        label: { content: 'Dead Stock', position: 'center', color: 'rgba(255, 99, 132, 0.5)', font: { size: 16, weight: 'bold' } }
                    }
                }
            } as any // Cast because annotation types might be tricky or missing in current setup
        },
        scales: {
            x: {
                title: { display: true, text: 'Turnover Rate (Speed)', color: CHART_THEME.colors.text.secondary },
                grid: { color: CHART_THEME.colors.grid },
                ticks: { color: CHART_THEME.colors.text.secondary }
            },
            y: {
                title: { display: true, text: 'GMROI (Profitability)', color: CHART_THEME.colors.text.secondary },
                grid: { color: CHART_THEME.colors.grid },
                ticks: { color: CHART_THEME.colors.text.secondary }
            }
        }
    };

    efficiencyTableColumns: TableColumn[] = [
        { key: 'productName', label: 'Product' },
        { key: 'turnoverRate', label: 'Turnover', format: 'number' },
        { key: 'gmroi', label: 'GMROI', format: 'number' },
        { key: 'classification', label: 'Classification' }
    ];

    efficiencyTableData = computed(() => {
        this.currentLang(); // Trigger dependency
        return this.productPerformance().map(p => ({
            productName: p.productName,
            turnoverRate: p.turnoverRate,
            gmroi: p.gmroi,
            classification: this.classifyProduct(p.turnoverRate, p.gmroi)
        }));
    });

    constructor() {
        // Effects automatically handle signal updates from dataService
        const injector = inject(Injector);

        // Effect to update Stock Chart
        effect(() => {
            const metrics = this.inventoryMetrics();
            if (metrics) {
                const inStock = metrics.totalProducts - metrics.lowStockProducts - metrics.outOfStockProducts;

                // Update chart data immutably to trigger change detection in child component
                this.stockChartData = {
                    ...this.stockChartData,
                    datasets: [{
                        ...this.stockChartData.datasets[0],
                        data: [inStock, metrics.lowStockProducts, metrics.outOfStockProducts]
                    }]
                };
            }
        }, { injector });

        // Effect to update Turnover Chart
        effect(() => {
            const products = this.productPerformance();
            if (products.length > 0) {
                const topTurnover = [...products]
                    .sort((a, b) => b.turnoverRate - a.turnoverRate)
                    .slice(0, 10);

                const labels = topTurnover.map(p => p.productName.length > 30 ? p.productName.substring(0, 30) + '...' : p.productName);
                const data = topTurnover.map(p => p.turnoverRate);

                this.turnoverChartData = {
                    ...this.turnoverChartData,
                    labels: labels,
                    datasets: [{
                        ...this.turnoverChartData.datasets[0],
                        data: data
                    }]
                };

                // Update Efficiency Matrix
                const scatterData = products.map(p => ({
                    x: p.turnoverRate,
                    y: p.gmroi,
                    productName: p.productName // Custom prop for tooltip
                }));

                this.efficiencyChartData = {
                    ...this.efficiencyChartData,
                    datasets: [{
                        ...this.efficiencyChartData.datasets[0],
                        data: scatterData as any
                    }]
                };
            }
        }, { injector });

        // Language change subscription
        this.translate.onLangChange.subscribe((event) => {
            this.currentLang.set(event.lang); // Update signal
            this.updateChartLabels();
            // Force chart update by creating new object reference if needed,
            // though usually labels update is enough if structure changes.
            this.stockChartData = { ...this.stockChartData };
        });

        // Initial labels
        this.updateChartLabels();
    }

    classifyProduct(turnover: number, gmroi: number): string {
        if (turnover >= 6 && gmroi >= 2) return this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CLASSIFICATION.WINNER');
        if (turnover < 6 && gmroi >= 2) return this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CLASSIFICATION.OPPORTUNITY');
        if (turnover >= 6 && gmroi < 2) return this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CLASSIFICATION.VOLUME_MOVER');
        return this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CLASSIFICATION.DEAD_STOCK');
    }

    updateChartLabels() {
        this.stockChartData.labels = [
            this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.IN_STOCK') as string,
            this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.LOW_STOCK') as string,
            this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.CHART.OUT_OF_STOCK') as string
        ];

        if (this.turnoverChartData.datasets[0]) {
            this.turnoverChartData.datasets[0].label = this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.TURNOVER_RATE');
        }
    }

    truncateName(name: string, maxLength: number): string {
        return name.length > maxLength ? name.substring(0, maxLength) + '...' : name;
    }

    refreshData() {
        this.dataService.refresh();
    }

    getStockStatusClass(quantity: number): string {
        if (quantity === 0) return 'out-of-stock';
        if (quantity < 5) return 'critical';
        if (quantity < 10) return 'low';
        return 'healthy';
    }



    getDaysUntilStockoutClass(days: number): string {
        if (days < 0) return 'never';
        if (days < 7) return 'urgent';
        if (days < 14) return 'warning';
        return 'normal';
    }

    exportToCSV() {
        const t = (key: string) => this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.REPORT.' + key);
        const common = (key: string) => this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.COMMON.' + key);

        const csvData = [];
        csvData.push([t('TITLE')]);
        csvData.push([t('GENERATED'), new Date().toLocaleString()]);
        csvData.push([]);

        csvData.push([t('SECTION_METRICS')]);
        csvData.push([this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.TOTAL_PRODUCTS') as string, this.inventoryMetrics()?.totalProducts ?? 0]);
        csvData.push([this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.LOW_STOCK') as string, this.inventoryMetrics()?.lowStockProducts ?? 0]);
        csvData.push([this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.OUT_OF_STOCK') as string, this.inventoryMetrics()?.outOfStockProducts ?? 0]);
        csvData.push([this.translate.instant('COMMAND_CENTER.INVENTORY_ANALYTICS.STOCK_VALUE') as string, '$' + (this.inventoryMetrics()?.totalStockValue ?? 0).toFixed(2)]);
        csvData.push([]);

        csvData.push([t('SECTION_LOW_STOCK')]);
        csvData.push([t('COL_PRODUCT'), t('COL_STOCK'), t('COL_VELOCITY'), t('COL_DAYS_STOCKOUT')]);
        this.lowStockProducts().forEach(p => {
            csvData.push([
                p.productName,
                p.stockQuantity,
                p.salesVelocity.toFixed(2),
                p.daysUntilStockout >= 0 ? p.daysUntilStockout : common('NA')
            ]);
        });
        csvData.push([]);

        csvData.push([t('SECTION_REORDER')]);
        csvData.push([t('COL_PRODUCT'), t('COL_STOCK'), t('COL_VELOCITY'), t('COL_DAYS_STOCKOUT'), t('COL_STOCKOUT_DATE'), t('COL_POTENTIAL_LOSS'), t('COL_TURNOVER')]);
        this.reorderRecommendations().forEach(p => {
            csvData.push([
                p.productName,
                p.stockQuantity,
                p.salesVelocity.toFixed(2),
                p.daysUntilStockout,
                p.predictedStockoutDate || common('NA'),
                p.potentialRevenueLoss ? '$' + p.potentialRevenueLoss.toFixed(2) : '-',
                p.turnoverRate.toFixed(2) + '%'
            ]);
        });

        // Convert to CSV string
        const csvContent = csvData.map(row => row.join(',')).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `inventory-analytics-${Date.now()}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }
}
