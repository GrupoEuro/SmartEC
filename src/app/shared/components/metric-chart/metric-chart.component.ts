import { Component, Input, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, NgZone, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, ChartType, ChartData, registerables } from 'chart.js';
import { CHART_THEME } from '../../../core/config/chart-theme';

// Register Chart.js components
Chart.register(...registerables);

@Component({
    selector: 'app-metric-chart',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="chart-container" [style.height.px]="height">
            <canvas #chartCanvas></canvas>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }
        .chart-container {
            position: relative;
            width: 100%;
            overflow: hidden; /* Prevent spillover */
        }
    `]
})
export class MetricChartComponent implements AfterViewInit, OnDestroy, OnChanges {
    @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
    @Input() type: ChartType = 'line';
    @Input() data!: ChartData;
    @Input() format: 'currency' | 'percentage' | 'number' = 'currency';
    @Input() height: number = 300;
    @Input() options?: ChartConfiguration['options'];
    @Output() chartClick = new EventEmitter<{ label: string, value: any, datasetLabel?: string, index: number }>();

    private chart?: Chart;
    private ngZone = inject(NgZone);

    ngAfterViewInit() {
        this.createChart();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['data'] && !changes['data'].isFirstChange()) {
            this.updateChart();
        }
        if (changes['options'] && !changes['options'].isFirstChange()) {
            // Re-create chart if options change significantly, or just update
            this.createChart();
        }
    }

    ngOnDestroy() {
        this.destroyChart();
    }

    private destroyChart() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = undefined;
        }
    }

    /**
     * Programmatically highlight a data point by label
     * This avoids full chart updates which are expensive
     */
    highlightDataPoint(label: string) {
        if (!this.chart || !this.data) return;

        // Run outside Angular to avoid CD cycling
        this.ngZone.runOutsideAngular(() => {

            // Special handling for Scatter/Bubble where data is array of objects
            let datasetIndex = -1;
            let dataIndex = -1;

            if (this.type === 'scatter' || this.type === 'bubble') {
                // Iterate datasets to find the point with matching product name (assuming checking custom props or raw)
                // The chart.js 'raw' object in our case has 'productName'
                for (let i = 0; i < this.chart!.data.datasets.length; i++) {
                    const dataset = this.chart!.data.datasets[i];

                    const foundIdx = dataset.data.findIndex((d: any) => {
                        // Check strictly for productName if available, or label
                        const pName = d.productName || d.label;
                        return pName === label;
                    });

                    if (foundIdx !== -1) {
                        datasetIndex = i;
                        dataIndex = foundIdx;
                        break;
                    }
                }
            } else {
                // Standard charts (bar, line) use label index
                const index = this.data.labels?.indexOf(label);
                if (index !== undefined && index !== -1) {
                    datasetIndex = 0; // Default to first dataset or could iterate all
                    dataIndex = index;
                }
            }

            if (datasetIndex !== -1 && dataIndex !== -1) {
                const elements = this.chart!.getDatasetMeta(datasetIndex).data;
                if (elements[dataIndex]) {
                    // Activate the element (highlight)
                    this.chart!.setActiveElements([{ datasetIndex, index: dataIndex }]);
                    this.chart!.tooltip?.setActiveElements([{ datasetIndex, index: dataIndex }], { x: 0, y: 0 });
                    this.chart!.update('none'); // 'none' mode updates style without re-animation
                }
            }
        });
    }

    resetHighlight() {
        if (!this.chart) return;
        this.ngZone.runOutsideAngular(() => {
            this.chart!.setActiveElements([]);
            this.chart!.tooltip?.setActiveElements([], { x: 0, y: 0 });
            this.chart!.update('none');
        });
    }

    private updateChart() {
        // Run outside Angular to prevent CD loops during animation
        this.ngZone.runOutsideAngular(() => {
            if (this.chart && this.data) {
                console.log('MetricChart: Updating chart data. Labels:', this.data.labels?.length, 'Datasets:', this.data.datasets.length);
                this.chart.data = this.data;
                this.chart.update();
            } else {
                console.log('MetricChart: Data available but chart missing. Creating.');
                this.createChart();
            }
        });
    }

    private formatValue(value: number): string {
        switch (this.format) {
            case 'currency':
                return new Intl.NumberFormat('es-MX', {
                    style: 'currency',
                    currency: 'MXN'
                }).format(value);
            case 'percentage':
                return `${value.toFixed(1)}%`;
            default:
                return new Intl.NumberFormat('es-MX').format(value);
        }
    }

    private createChart() {
        if (!this.chartCanvas) {
            console.warn('MetricChart: Chart Canvas not found via ViewChild');
            return;
        }
        if (!this.data) {
            console.warn('MetricChart: No data provided to createChart');
            return;
        }

        console.log('MetricChart: Creating Chart. Type:', this.type, 'Datasets:', this.data.datasets.length);

        // Run outside Angular to prevent CD loops during animation
        this.ngZone.runOutsideAngular(() => {
            const ctx = this.chartCanvas.nativeElement.getContext('2d');
            if (!ctx) {
                console.error('MetricChart: Could not get 2D context');
                return;
            }

            this.destroyChart();

            // Apply default theme colors if not specified in dataset
            const datasets = this.data.datasets.map((dataset, index) => {
                const color = dataset.borderColor || dataset.backgroundColor ||
                    (this.type === 'line' || this.type === 'bar' ? CHART_THEME.colors.primary : CHART_THEME.palette[index % CHART_THEME.palette.length]);

                if (this.type === 'line' && !dataset.borderColor) {
                    dataset.borderColor = color;
                    dataset.backgroundColor = (dataset.backgroundColor as string) || CHART_THEME.colors.bg.primary;
                    (dataset as any).pointBackgroundColor = color;
                    (dataset as any).pointBorderColor = color;
                } else if (this.type === 'bar' && !dataset.backgroundColor) {
                    dataset.backgroundColor = color;
                    dataset.borderColor = (dataset.borderColor as string) || color;
                } else if ((this.type === 'doughnut' || this.type === 'pie') && !dataset.backgroundColor) {
                    dataset.backgroundColor = CHART_THEME.palette;
                    dataset.borderColor = CHART_THEME.colors.bg.tooltip; // Use dark border for separation
                    dataset.borderWidth = 2;
                }

                return dataset;
            });

            const defaultOptions: ChartConfiguration['options'] = {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (event, elements, chart) => {
                    if (elements.length > 0) {
                        const firstPoint = elements[0];
                        const datasetIndex = firstPoint.datasetIndex;
                        const index = firstPoint.index;

                        const label = chart.data.labels ? (chart.data.labels[index] as string) : '';
                        const value = chart.data.datasets[datasetIndex].data[index];
                        const datasetLabel = chart.data.datasets[datasetIndex].label;

                        this.ngZone.run(() => {
                            this.chartClick.emit({ label, value, datasetLabel, index });
                        });
                    }
                },
                plugins: {
                    legend: {
                        display: this.type !== 'bar',
                        position: 'bottom',
                        labels: {
                            color: CHART_THEME.colors.text.secondary,
                            font: {
                                family: CHART_THEME.fonts.family,
                                size: 12
                            },
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    tooltip: {
                        backgroundColor: CHART_THEME.colors.bg.tooltip,
                        titleColor: CHART_THEME.colors.text.primary,
                        bodyColor: CHART_THEME.colors.text.secondary,
                        borderColor: CHART_THEME.colors.primary,
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: (context) => {
                                let label = '';
                                if (this.type === 'doughnut' || this.type === 'pie') {
                                    label = context.label ||
                                        (context.chart.data.labels && context.chart.data.labels[context.dataIndex] as string) ||
                                        '';
                                } else {
                                    label = context.dataset.label || '';
                                }

                                if (label) {
                                    label += ': ';
                                }

                                const value = context.raw as number;
                                if (value !== null && value !== undefined) {
                                    label += this.formatValue(value);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: this.type !== 'doughnut' && this.type !== 'pie' ? {
                    x: {
                        grid: {
                            color: CHART_THEME.colors.grid
                        },
                        ticks: {
                            color: CHART_THEME.colors.text.secondary,
                            font: {
                                family: CHART_THEME.fonts.family,
                                size: 11
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: CHART_THEME.colors.grid
                        },
                        ticks: {
                            color: CHART_THEME.colors.text.secondary,
                            font: {
                                family: CHART_THEME.fonts.family,
                                size: 11
                            },
                            callback: (value) => {
                                if (this.format === 'percentage') {
                                    return value + '%';
                                }
                                return new Intl.NumberFormat('es-MX', {
                                    notation: 'compact',
                                    compactDisplay: 'short',
                                    style: this.format === 'currency' ? 'currency' : undefined,
                                    currency: 'MXN'
                                }).format(value as number);
                            }
                        }
                    }
                } : undefined
            };

            // Deep merge defaults with provided options
            // Note: In a real app we might use lodash.merge, but here we can rely on Chart.js to handle some merging
            // or simple spread if structure is simple.
            // However, Chart.js config merging can be tricky.
            // Let's do a basic shallow merge of top-level keys, and let specific plugins override.
            // Actually, best to use the provided options as overrides.

            // We need to be careful not to lose the default plugins/scales if not explicitly overridden.
            // But implementing deep merge manually is verbose. 
            // We will use a strategy: Use defaults, then apply user overrides.

            // Simplified merge strategy:
            const config: ChartConfiguration = {
                type: this.type,
                data: { ...this.data, datasets },
                options: {
                    ...defaultOptions,
                    ...this.options,
                    plugins: {
                        ...defaultOptions.plugins,
                        ...(this.options?.plugins || {})
                    },
                    scales: {
                        ...defaultOptions.scales,
                        ...(this.options?.scales || {})
                    }
                }
            };

            this.chart = new Chart(ctx, config);
        });
    }
}
