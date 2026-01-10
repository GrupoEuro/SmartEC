import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, BehaviorSubject, of, timeout } from 'rxjs';
import {
    switchMap,
    map,
    shareReplay,
    catchError,
    tap,
    debounceTime,
    distinctUntilChanged,
    filter,
    finalize,
    delay,
    concatMap
} from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

// Services
import { MetricsService } from '../../../core/services/metrics.service';
import { FinancialService } from '../../../core/services/financial.service';
import { ExpenseService } from '../../../core/services/expense.service';
import { IncomeStatementService } from '../../../core/services/income-statement.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { OperationalMetricsService } from '../../../services/operational-metrics.service';
import { CommandCenterContextService } from './command-center-context.service';

// Models
import { KPICard, MetricChartData } from '../../../core/models/business-metrics.model';
import { RevenueMetrics, MarginMetrics, ProfitabilityAnalysis, BostonMatrixData } from '../../../core/models/financial.model';
import { Expense } from '../../../core/models/income-statement.model';
import { IncomeStatement } from '../../../core/models/income-statement.model';
import {
    RevenueTrend,
    TopProduct,
    CategorySales,
    BrandSales,
    InventoryMetrics,
    ProductPerformance
} from '../../../services/analytics.service';
import { OrderMetrics, SLAMetrics, StaffPerformance } from '../../../services/operational-metrics.service';

/**
 * Centralized data loading facade for Command Center
 * 
 * This service provides reactive streams that automatically update when the global
 * date range changes. It uses switchMap to cancel previous requests and prevent
 * memory leaks and infinite loops.
 * 
 * Components should use toSignal() to consume these streams instead of manual subscriptions.
 */
@Injectable({
    providedIn: 'root'
})
export class CommandCenterDataService {
    private metricsService = inject(MetricsService);
    private financialService = inject(FinancialService);
    private expenseService = inject(ExpenseService);
    private incomeStatementService = inject(IncomeStatementService);
    private analyticsService = inject(AnalyticsService);
    private operationalMetricsService = inject(OperationalMetricsService);
    private contextService = inject(CommandCenterContextService);

    // Loading states
    private loadingSubject = new BehaviorSubject<boolean>(false);
    isLoading$ = this.loadingSubject.asObservable();

    // Convert dateRange signal to observable with proper filtering and debouncing
    private dateRange$ = toObservable(this.contextService.dateRange).pipe(
        filter(range => range !== null), // Only emit when initialized
        debounceTime(500), // Prevent rapid-fire requests (increased from 300ms)
        distinctUntilChanged((prev, curr) => {
            if (!prev || !curr) return false;
            return prev.start.getTime() === curr.start.getTime() &&
                prev.end.getTime() === curr.end.getTime();
        }),
        shareReplay(1)
    );

    // Also listen to refresh signal
    private refresh$ = toObservable(this.contextService.refreshSignal);

    // Combined trigger: emit when either date changes OR refresh is triggered
    private trigger$ = combineLatest([this.dateRange$, this.refresh$]).pipe(
        map(([range]) => range!),
        shareReplay(1)
    );

    // Dashboard data streams - Load with proper error handling
    dashboardKPIs$: Observable<KPICard[]> = this.trigger$.pipe(
        switchMap(range => this.metricsService.getKPICards(range.start, range.end).pipe(
            catchError(err => {
                console.error('Error loading KPIs:', err);
                return of([] as KPICard[]);
            })
        )),
        shareReplay(1)
    );

    dashboardRevenueTrend$: Observable<MetricChartData> = this.trigger$.pipe(
        switchMap(range => this.metricsService.getRevenueTrend(30, range.start, range.end).pipe(
            catchError(err => {
                console.error('Error loading revenue trend:', err);
                return of({ labels: [], datasets: [] });
            })
        )),
        shareReplay(1)
    );

    dashboardOrderDistribution$: Observable<MetricChartData> = this.trigger$.pipe(
        switchMap(range => this.metricsService.getOrderDistribution(range.start, range.end).pipe(
            catchError(err => {
                console.error('Error loading order distribution:', err);
                return of({ labels: [], datasets: [] });
            })
        )),
        shareReplay(1)
    );

    dashboardTopProducts$: Observable<MetricChartData> = this.trigger$.pipe(
        switchMap(range => this.metricsService.getTopProducts(5, range.start, range.end).pipe(
            catchError(err => {
                console.error('Error loading top products:', err);
                return of({ labels: [], datasets: [] });
            })
        )),
        shareReplay(1)
    );

    dashboardCustomerComposition$: Observable<MetricChartData> = this.trigger$.pipe(
        switchMap(range => this.metricsService.getCustomerComposition(range.start, range.end).pipe(
            catchError(err => {
                console.error('Error loading customer composition:', err);
                return of({ labels: [], datasets: [] });
            })
        )),
        shareReplay(1)
    );

    // Combined dashboard data
    dashboardData$: Observable<any> = combineLatest({
        kpiCards: this.dashboardKPIs$,
        revenueTrend: this.dashboardRevenueTrend$,
        orderDistribution: this.dashboardOrderDistribution$,
        topProducts: this.dashboardTopProducts$,
        customerComposition: this.dashboardCustomerComposition$
    }).pipe(
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== FINANCIAL DATA =====

    financialData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return this.financialService.getFinancialDashboardData(range.start, range.end).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Financial data error:', err);
                    return of({
                        revenue: {
                            totalRevenue: 0,
                            netRevenue: 0,
                            grossMargin: 0,
                            costOfSales: 0,
                            orderCount: 0,
                            averageOrderValue: 0,
                            growthPercentage: 0,
                            byCategory: [],
                            byBrand: [],
                            byProduct: [],
                            period: 'daily',
                            trends: [],
                            startDate: range.start,
                            endDate: range.end,
                            previousPeriodRevenue: 0,
                            growthAmount: 0
                        } as RevenueMetrics,
                        margin: {
                            grossProfit: 0,
                            grossMargin: 0,
                            totalCost: 0,
                            totalRevenue: 0,
                            byCategory: [],
                            byBrand: [],
                            byProduct: [],
                            period: 'daily',
                            startDate: range.start,
                            endDate: range.end
                        } as MarginMetrics,
                        profitability: [] as ProfitabilityAnalysis[],
                        bostonMatrix: {
                            points: [],
                            averageMargin: 0,
                            averageGrowth: 0,
                            period: 'daily'
                        } as BostonMatrixData
                    });
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== EXPENSE DATA =====

    expenseData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return this.expenseService.getExpenses(range.start, range.end).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Expense data error:', err);
                    return of([] as Expense[]);
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== INCOME STATEMENT DATA =====

    incomeStatementData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return this.incomeStatementService.generateIncomeStatement(range.start, range.end).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Income statement error:', err);
                    return of(null as IncomeStatement | null);
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== SALES ANALYTICS DATA =====

    salesAnalyticsData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return combineLatest({
                revenueTrends: this.analyticsService.getRevenueTrends(range.start, range.end, 'day'),
                topProducts: this.analyticsService.getTopProducts(10, range.start, range.end),
                categorySales: this.analyticsService.getSalesByCategory(range.start, range.end),
                brandSales: this.analyticsService.getSalesByBrand(range.start, range.end)
            }).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Sales analytics error:', err);
                    return of({
                        revenueTrends: [] as RevenueTrend[],
                        topProducts: [] as TopProduct[],
                        categorySales: [] as CategorySales[],
                        brandSales: [] as BrandSales[]
                    });
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== INVENTORY ANALYTICS DATA =====

    inventoryData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return combineLatest({
                metrics: this.analyticsService.getInventoryMetrics(range.start, range.end),
                performance: this.analyticsService.getProductPerformance(range.start, range.end)
            }).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Inventory data error:', err);
                    return of({
                        metrics: {
                            totalProducts: 0,
                            lowStockProducts: 0,
                            outOfStockProducts: 0,
                            totalStockValue: 0,
                            averageTurnoverRate: 0,
                            gmroi: 0,
                            sellThroughRate: 0,
                            deadStockCount: 0,
                            abcBreakdown: { a: 0, b: 0, c: 0 },
                            potentialLostRevenue: 0,
                            predictedStockoutCount: 0
                        } as InventoryMetrics,
                        performance: [] as ProductPerformance[]
                    });
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    // ===== OPERATIONAL METRICS DATA =====

    operationalData$ = this.trigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(range => {
            return combineLatest({
                orderMetrics: this.operationalMetricsService.getOrderMetrics(range.start, range.end),
                slaMetrics: this.operationalMetricsService.getSLACompliance(range.start, range.end),
                staffPerformance: this.operationalMetricsService.getStaffPerformance(range.start, range.end),
                fulfillmentTrend: this.operationalMetricsService.getFulfillmentTrend(7), // Last 7 days trend
                slaTrend: this.operationalMetricsService.getSLATrend(7) // Last 7 days trend
            }).pipe(
                catchError(err => {
                    console.error('❌ [DataService] Operational data error:', err);
                    return of({
                        orderMetrics: {
                            totalOrders: 0,
                            fulfilledOrders: 0,
                            pendingOrders: 0,
                            processingOrders: 0,
                            averageFulfillmentTime: 0,
                            fulfillmentRate: 0,
                            ordersToday: 0,
                            statusBreakdown: {}
                        } as OrderMetrics,
                        slaMetrics: {
                            complianceRate: 0,
                            atRiskOrders: 0,
                            overdueOrders: 0,
                            averageResponseTime: 0,
                            totalOrders: 0
                        } as SLAMetrics,
                        staffPerformance: [] as StaffPerformance[],
                        fulfillmentTrend: [] as any[],
                        slaTrend: [] as any[]
                    });
                })
            );
        }),
        tap(() => this.loadingSubject.next(false)),
        shareReplay(1)
    );

    /**
     * Trigger a manual refresh of all data
     */
    refresh(): void {
        this.contextService.triggerRefresh();
    }

    /**
     * Clear all service caches
     */
    clearCaches(): void {
        this.analyticsService.clearCache();
        this.operationalMetricsService.clearCache();
    }
}
