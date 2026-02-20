
import { Component, inject, computed, effect, Injector, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CHART_THEME } from '../../../core/config/chart-theme';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { AnalyticsService, RevenueTrend, TopProduct, CategorySales, BrandSales, PeriodComparison, SalesVelocity, CustomerSegment, ConversionFunnel, ForecastData, CohortData, GrowthMetrics } from '../../../services/analytics.service';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';

@Component({
    selector: 'app-sales-analytics',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent, ChartCardComponent, DashboardDiagnosticsComponent],
    templateUrl: './sales-analytics.component.html',
    styleUrls: ['./sales-analytics.component.css']
})
export class SalesAnalyticsComponent implements OnDestroy {
    private analyticsService = inject(AnalyticsService);
    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);
    private translateService = inject(TranslateService);


    // Cancellation subject for async operations
    private destroy$ = new Subject<void>();
    private cancelSecondaryMetrics$ = new Subject<void>();

    // Convert observable to signal
    private salesData = toSignal(this.dataService.salesAnalyticsData$, {
        initialValue: null
    });

    // Changed to a writable signal to allow direct control during PDF export
    isLoading = signal(false);

    // Compatibility getters for legacy loading flags
    get isLoadingProducts() { return this.isLoading(); }
    get isLoadingRevenue() { return this.isLoading(); }
    get isLoadingCategories() { return this.isLoading(); }
    get isLoadingBrands() { return this.isLoading(); }
    get isLoadingComparison() { return this.isLoading(); }

    // Additional local state for secondary metrics
    growthMetrics: GrowthMetrics | null = null;
    isLoadingGrowth = false;
    forecastData: ForecastData[] | null = null;
    isLoadingForecast = false;
    conversionFunnel: ConversionFunnel[] | null = null;
    isLoadingFunnel = false;
    customerSegments: CustomerSegment[] | null = null;
    isLoadingSegments = false;
    salesVelocity: SalesVelocity | null = null;
    isLoadingVelocity = false;
    periodComparison: PeriodComparison | null = null;

    // Data - computed from service
    revenueTrends = computed(() => this.salesData()?.revenueTrends ?? []);
    topProducts = computed(() => this.salesData()?.topProducts ?? []);
    categorySales = computed(() => this.salesData()?.categorySales ?? []);
    brandSales = computed(() => this.salesData()?.brandSales ?? []);

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
        this.cancelSecondaryMetrics$.next();
        this.cancelSecondaryMetrics$.complete();
    }

    // ... (KPIs remain same)

    async loadCustomerSegmentation() {
        const range = this.contextService.dateRange();
        if (!range) return;

        this.isLoadingSegments = true;
        try {
            const segments = await firstValueFrom(this.analyticsService.getCustomerSegmentation(range.start, range.end));
            this.customerSegments = segments;
        } catch (error) {
            console.error('Error loading customer segmentation:', error);
        } finally {
            this.isLoadingSegments = false;
        }
    }

    // Table Configurations
    revenueTableColumns: TableColumn[] = [
        { key: 'date', label: 'COMMAND_CENTER.KPIS.DATE', format: 'date' },
        { key: 'revenue', label: 'COMMAND_CENTER.KPIS.REVENUE', format: 'currency' },
        { key: 'orders', label: 'COMMAND_CENTER.KPIS.ORDERS', format: 'number' }
    ];

    categoryTableColumns: TableColumn[] = [
        { key: 'category', label: 'COMMAND_CENTER.FINANCIALS.TABLE.CATEGORY', format: 'category' },
        { key: 'revenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' },
        { key: 'orderCount', label: 'COMMAND_CENTER.SALES_ANALYTICS.ORDERS', format: 'number' },
        { key: 'percentage', label: 'COMMAND_CENTER.FINANCIALS.TABLE.SHARE', format: 'percent' }
    ];

    brandTableColumns: TableColumn[] = [
        { key: 'brand', label: 'COMMAND_CENTER.SALES_ANALYTICS.BRAND' },
        { key: 'revenue', label: 'COMMAND_CENTER.SALES_ANALYTICS.REVENUE', format: 'currency' }
    ];

    // Data Accessors for Tables
    revenueTableData = computed(() => this.revenueTrends());
    categoryTableData = computed(() => this.categorySales());
    brandTableData = computed(() => this.brandSales());

    // KPIs - computed from data
    totalRevenue = computed(() => {
        const trends = this.revenueTrends();
        return trends.reduce((sum, t) => sum + t.revenue, 0);
    });

    totalOrders = computed(() => {
        const trends = this.revenueTrends();
        return trends.reduce((sum, t) => sum + t.orders, 0);
    });

    averageOrderValue = computed(() => {
        const revenue = this.totalRevenue();
        const orders = this.totalOrders();
        return orders > 0 ? revenue / orders : 0;
    });

    topProductRevenue = computed(() => {
        const products = this.topProducts();
        return products.length > 0 ? products[0].totalRevenue : 0;
    });

    // Revenue Trend Chart
    revenueChartData = computed<ChartData<'line'>>(() => {
        const trends = this.revenueTrends();
        return {
            labels: trends.map(t => t.date),
            datasets: [{
                label: this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.REVENUE'),
                data: trends.map(t => t.revenue),
                borderColor: CHART_THEME.colors.primary,
                backgroundColor: CHART_THEME.colors.bg.primary,
                tension: 0.4,
                fill: true
            }]
        };
    });

    revenueChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: true,
                labels: {
                    color: CHART_THEME.colors.text.secondary,
                    font: {
                        family: CHART_THEME.fonts.family
                    }
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: CHART_THEME.colors.bg.tooltip,
                titleColor: CHART_THEME.colors.text.primary,
                bodyColor: CHART_THEME.colors.text.secondary,
                borderColor: CHART_THEME.colors.primary,
                borderWidth: 1
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    color: CHART_THEME.colors.text.secondary,
                    font: {
                        family: CHART_THEME.fonts.family
                    },
                    callback: function (value) {
                        return '$' + value.toLocaleString();
                    }
                },
                grid: {
                    color: CHART_THEME.colors.grid
                }
            },
            x: {
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

    // Category Sales Chart
    categoryChartData = computed<ChartData<'doughnut'>>(() => {
        const categories = this.categorySales();
        return {
            labels: categories.map(c => c.category),
            datasets: [{
                data: categories.map(c => c.revenue),
                backgroundColor: CHART_THEME.palette,
                borderColor: CHART_THEME.colors.bg.tooltip,
                borderWidth: 2
            }]
        };
    });

    categoryChartOptions: ChartConfiguration['options'] = {
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
                        const percentage = context.dataset.data.reduce((a: any, b: any) => a + b, 0);
                        const percent = ((value / percentage) * 100).toFixed(1);
                        return `${label}: $${value.toLocaleString()} (${percent}%)`;
                    }
                }
            }
        }
    };

    // Brand Sales Chart
    brandChartData = computed<ChartData<'bar'>>(() => {
        const brands = this.brandSales();
        return {
            labels: brands.map(b => b.brand),
            datasets: [{
                label: this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CHARTS.REVENUE_BY_BRAND'),
                data: brands.map(b => b.revenue),
                backgroundColor: CHART_THEME.colors.primary,
                borderColor: CHART_THEME.colors.warning, // Slightly different for border
                borderWidth: 0,
                borderRadius: 4
            }]
        };
    });

    brandChartOptions: ChartConfiguration['options'] = {
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
                        return '$' + (context.parsed.x ?? 0).toLocaleString();
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
                        return '$' + value.toLocaleString();
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


    constructor() {
        // Effect to update charts when data changes
        // Using effect allows us to trigger chart updates reactively
        const injector = inject(Injector);

        // Use afterNextRender to ensure charts are initialized before effects run
        // Use afterNextRender to ensure charts are initialized before effects run

        // Load secondary metrics when date range changes
        effect(() => {
            const range = this.contextService.dateRange();
            if (range) {
                // Cancel any in-flight secondary metric requests
                this.cancelSecondaryMetrics$.next();
                this.loadSecondaryMetrics();
            }
        }, { injector });

        // Subscribe to dataService loading state
        this.dataService.isLoading$.subscribe(loading => {
            this.isLoading.set(loading);
        });
    }

    loadSecondaryMetrics() {
        this.loadGrowthMetrics();
        this.loadForecastData();
        this.loadConversionFunnel();
        this.loadCustomerSegmentation();
        // this.loadPeriodComparison(); // Only if property exists
        // this.loadSalesVelocity(); // Only if property exists
    }





    async loadSalesVelocity() {
        const range = this.contextService.dateRange();
        if (!range) return;

        this.isLoadingVelocity = true;
        const diffTime = Math.abs(range.end.getTime() - range.start.getTime());
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        try {
            const velocity = await firstValueFrom(this.analyticsService.getSalesVelocity(days || 30));
            this.salesVelocity = velocity;
        } catch (error) {
            console.error('Error loading sales velocity:', error);
        } finally {
            this.isLoadingVelocity = false;
        }
    }

    async loadConversionFunnel() {
        const range = this.contextService.dateRange();
        if (!range) return;

        this.isLoadingFunnel = true;
        try {
            const funnel = await firstValueFrom(this.analyticsService.getConversionFunnel(range.start, range.end));
            this.conversionFunnel = funnel;
        } catch (error) {
            console.error('Error loading conversion funnel:', error);
        } finally {
            this.isLoadingFunnel = false;
        }
    }

    async loadForecastData() {
        const range = this.contextService.dateRange();
        if (!range) return;

        this.isLoadingForecast = true;
        const diffTime = Math.abs(range.end.getTime() - range.start.getTime());
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        try {
            const forecast = await firstValueFrom(this.analyticsService.getForecastData(days || 30, 14));
            this.forecastData = forecast;
        } catch (error) {
            console.error('Error loading forecast data:', error);
        } finally {
            this.isLoadingForecast = false;
        }
    }

    async exportToPDF(): Promise<void> {
        this.isLoading.set(true);

        try {
            const data = document.querySelector('.sales-analytics-container') as HTMLElement;
            if (!data) throw new Error('Container not found');

            const canvas = await html2canvas(data, {
                scale: 2, // High resolution
                useCORS: true,
                logging: false,
                backgroundColor: '#0f172a' // Match dark theme background
            });

            const imgWidth = 210; // A4 width in mm
            const pageHeight = 297; // A4 height in mm
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            const pdf = new jsPDF('p', 'mm', 'a4');
            let heightLeft = imgHeight;
            let position = 0;

            const contentDataURL = canvas.toDataURL('image/png');

            // First page
            pdf.addImage(contentDataURL, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            // Subsequent pages if needed
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(contentDataURL, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            const fileName = `sales_analytics_${new Date().toISOString().split('T')[0]}.pdf`;
            pdf.save(fileName);

        } catch (error) {
            console.error('PDF Export failed:', error);
        } finally {
            this.isLoading.set(false);
        }
    }
    async loadGrowthMetrics() {
        this.isLoadingGrowth = true;
        try {
            const metrics = await firstValueFrom(this.analyticsService.getGrowthMetrics(12));
            this.growthMetrics = metrics;
        } catch (error) {
            console.error('Error loading growth metrics:', error);
        } finally {
            this.isLoadingGrowth = false;
        }
    }

    refresh() {
        this.dataService.refresh();
        this.loadGrowthMetrics();
    }



    exportToCSV(): void {
        const csvData: any[] = [];

        // Revenue Trends
        csvData.push([this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.REVENUE_TRENDS')]);
        csvData.push([
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.DATE'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.REVENUE'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.ORDERS')
        ]);
        this.revenueTrends().forEach(d => {
            const dateVal = (d.date as any) instanceof Date ? (d.date as unknown as Date).toISOString().split('T')[0] : d.date;
            csvData.push([
                dateVal,
                d.revenue,
                d.orders
            ]);
        });
        csvData.push([]); // Spacer

        // Sales by Category
        csvData.push([this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.SALES_BY_CATEGORY')]);
        csvData.push([
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.CATEGORY'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.REVENUE'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.ORDERS'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.PERCENTAGE')
        ]);
        this.categorySales().forEach(c => {
            csvData.push([c.category, c.revenue, c.orderCount, c.percentage.toFixed(2) + '%']);
        });

        // Convert to CSV string
        const csvContent = csvData.map(row => row.join(',')).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sales_analytics_${this.contextService.selectedPeriod()}_${Date.now()}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }

    exportTopProducts(): void {
        const products = this.topProducts();
        if (!products.length) return;

        // Headers
        const headers = [
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.RANK'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.PRODUCT_NAME'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.SKU'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.REVENUE'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.QUANTITY'),
            this.translateService.instant('COMMAND_CENTER.SALES_ANALYTICS.CSV_EXPORT.ORDERS')
        ];

        // Rows
        const csvData = products.map((p, i) => [
            (i + 1).toString(),
            p.productName,
            p.sku,
            p.totalRevenue.toFixed(2),
            p.totalQuantity.toString(),
            p.orderCount.toString()
        ]);

        // Combine
        const csvContent = [
            headers.join(','),
            ...csvData.map(row => row.join(','))
        ].join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `top_products_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }

    getTrendTranslation(trend: string): string {
        const trendMap: { [key: string]: string } = {
            'increasing': 'COMMAND_CENTER.SALES_ANALYTICS.TRENDING_UP',
            'decreasing': 'COMMAND_CENTER.SALES_ANALYTICS.TRENDING_DOWN',
            'stable': 'COMMAND_CENTER.SALES_ANALYTICS.TRENDING_STABLE'
        };
        return trendMap[trend] || trend;
    }

    getSegmentTranslation(segment: string): string {
        const segmentMap: { [key: string]: string } = {
            'Champions': 'COMMAND_CENTER.SALES_ANALYTICS.SEGMENT_CHAMPIONS',
            'Loyal': 'COMMAND_CENTER.SALES_ANALYTICS.SEGMENT_LOYAL',
            'Potential': 'COMMAND_CENTER.SALES_ANALYTICS.SEGMENT_POTENTIAL',
            'At Risk': 'COMMAND_CENTER.SALES_ANALYTICS.SEGMENT_AT_RISK',
            'Lost': 'COMMAND_CENTER.SALES_ANALYTICS.SEGMENT_LOST'
        };
        return segmentMap[segment] || segment;
    }
}
