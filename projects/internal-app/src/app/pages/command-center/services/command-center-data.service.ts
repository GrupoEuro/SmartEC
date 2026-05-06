import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, BehaviorSubject, of, timeout, from } from 'rxjs';
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
import { Firestore, collection, getDocs } from '@angular/fire/firestore';

// Services
import { MetricsService } from '../../../core/services/metrics.service';
import { FinancialService } from '../../../core/services/financial.service';
import { ExpenseService } from '../../../core/services/expense.service';
import { IncomeStatementService } from '../../../core/services/income-statement.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { OperationalMetricsService } from '../../../services/operational-metrics.service';
import { CommandCenterContextService } from './command-center-context.service';
import { MetricsBigqueryService } from '../../operations/metrics/services/metrics-bigquery.service';

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
    private bqService = inject(MetricsBigqueryService);
    private operationalMetricsService = inject(OperationalMetricsService);
    private contextService = inject(CommandCenterContextService);
    private firestore = inject(Firestore);

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
            const startStr = range.start.toISOString().split('T')[0];
            const endStr = range.end.toISOString().split('T')[0];

            return from((async () => {
                const [dailyTrend, productRevenue] = await Promise.all([
                    this.bqService.queryDailyTrendBetween(startStr, endStr),
                    this.bqService.queryProductRevenueBetween(startStr, endStr, 1000)
                ]);

                // Map Daily Trends
                const revenueTrends: RevenueTrend[] = dailyTrend.map(row => ({
                    date: row.order_date,
                    revenue: row.revenue,
                    orders: row.orders
                }));

                // Ensure products cache is loaded for categories and mapping
                await this.analyticsService.fetchSharedProductData();
                const products = this.analyticsService.getSharedProducts();
                const productCategoryMap = new Map<string, string>();
                const productBrandMap = new Map<string, string>();
                const skuToIdMap = new Map<string, string>();
                const invalidSkus = new Set<string>();

                products.forEach(p => {
                    const sku = p['sku'] || '';
                    if (sku) {
                        productCategoryMap.set(sku, p['categoryId'] || 'Uncategorized');
                        productBrandMap.set(sku, p['brand'] || 'Unknown');
                        skuToIdMap.set(sku, p['id']);
                        
                        if (p['active'] === false || p['publishStatus'] === 'archived') {
                            invalidSkus.add(sku);
                        }
                    }
                });

                // Filter out test/inactive SKUs from BigQuery revenue
                const validProductRevenue = productRevenue.filter(row => 
                    !invalidSkus.has(row.sku)
                );

                // Map Top Products (take first 10 since BQ sorts by revenue desc)
                const topProducts: TopProduct[] = validProductRevenue.slice(0, 10).map(row => ({
                    productId: skuToIdMap.get(row.sku) || row.sku,
                    productName: row.product_name || 'Unknown',
                    sku: row.sku,
                    totalRevenue: row.total_revenue,
                    totalQuantity: row.total_units,
                    orderCount: row.total_orders
                }));
                
                // Map Category Sales & Brand Sales
                const categoryMap = new Map<string, { revenue: number, orderCount: number }>();
                const brandMap = new Map<string, { revenue: number, orderCount: number }>();
                let totalRevenue = 0;

                validProductRevenue.forEach(row => {
                    totalRevenue += row.total_revenue;
                    
                    // Category
                    const category = productCategoryMap.get(row.sku) || 'Uncategorized';
                    const catData = categoryMap.get(category) || { revenue: 0, orderCount: 0 };
                    catData.revenue += row.total_revenue;
                    catData.orderCount += row.total_orders;
                    categoryMap.set(category, catData);

                    // Brand
                    const brand = row.brand || 'No Brand';
                    const brandData = brandMap.get(brand) || { revenue: 0, orderCount: 0 };
                    brandData.revenue += row.total_revenue;
                    brandData.orderCount += row.total_orders;
                    brandMap.set(brand, brandData);
                });

                const categorySales: CategorySales[] = Array.from(categoryMap.entries())
                    .map(([category, data]) => ({
                        category,
                        revenue: data.revenue,
                        orderCount: data.orderCount,
                        percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
                    }))
                    .sort((a, b) => b.revenue - a.revenue);

                const brandSales: BrandSales[] = Array.from(brandMap.entries())
                    .map(([brand, data]) => ({
                        brand,
                        revenue: data.revenue,
                        orderCount: data.orderCount,
                        percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
                    }))
                    .sort((a, b) => b.revenue - a.revenue);

                return {
                    revenueTrends,
                    topProducts,
                    categorySales,
                    brandSales
                };
            })()).pipe(
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

    private inventoryTrigger$ = combineLatest([
        this.dateRange$,
        this.refresh$,
        toObservable(this.contextService.selectedInventoryChannel)
    ]).pipe(
        map(([range, refresh, channel]) => ({ range: range!, channel })),
        shareReplay(1)
    );

    // ===== INVENTORY ANALYTICS DATA =====

    inventoryData$ = this.inventoryTrigger$.pipe(
        tap(() => this.loadingSubject.next(true)),
        switchMap(({ range, channel }) => {
            const startStr = range.start.toISOString().split('T')[0];
            const endStr = range.end.toISOString().split('T')[0];
            const days = Math.max(1, (range.end.getTime() - range.start.getTime()) / (1000 * 3600 * 24));
            
            // If channel is 'all', pass undefined to BigQuery to get aggregate data
            const bqChannel = channel === 'all' ? undefined : channel;

            return from((async () => {
                const [productRevenue] = await Promise.all([
                    this.bqService.queryProductRevenueBetween(startStr, endStr, 2000, bqChannel)
                ]);

                await this.analyticsService.fetchSharedProductData();
                const products = this.analyticsService.getSharedProducts();

                const meliFullInventory = new Map<string, any>();
                if (channel === 'MELI_FULL' || channel === 'all') {
                    const snap = await getDocs(collection(this.firestore, 'meli_fbm_inventory'));
                    snap.docs.forEach(doc => {
                        const data = doc.data();
                        if (data['sku']) meliFullInventory.set(data['sku'], data);
                        // Also fallback to save by doc ID if SKU is missing
                        else meliFullInventory.set(doc.id, data);
                    });
                }

                const salesMap = new Map<string, { qty: number, revenue: number }>();
                const pidSalesMap = new Map<string, { qty: number, revenue: number }>();
                productRevenue.forEach(row => {
                    if (row.sku) salesMap.set(row.sku, { qty: row.total_units, revenue: row.total_revenue });
                    if (row.product_id) pidSalesMap.set(row.product_id, { qty: row.total_units, revenue: row.total_revenue });
                });

                let lowStockProducts = 0;
                let outOfStockProducts = 0;
                let totalStockValue = 0;
                let deadStockCount = 0;
                let potentialLostRevenue = 0;
                let predictedStockoutCount = 0;
                let totalCOGS = 0;
                let totalRevenueSales = 0;

                const performance: ProductPerformance[] = [];

                const itemsToProcess: any[] = [];

                if (channel === 'MELI_FULL') {
                    // Iterate over MELI_FULL collection directly
                    meliFullInventory.forEach((meliItem) => {
                        const sku = meliItem['sku'] || meliItem['mlItemId'] || '';
                        const product = products.find(p => p['sku'] === sku) || {};
                        
                        const mPrice = Number(meliItem['price']) || 0;
                        const pPrice = Number(product['price']) || 0;
                        const pCost = Number(product['costPrice']) || 0;
                        const finalCost = pCost > 0 ? pCost : ((mPrice > 0 ? mPrice : pPrice) * 0.7);
                        
                        itemsToProcess.push({
                            pid: product['id'] || meliItem['mlItemId'] || sku,
                            sku: sku,
                            name: meliItem['title'] || product['name']?.es || product['name']?.en || 'Unknown',
                            stockQuantity: Number(meliItem['availableQuantity']) || Number(meliItem['fullStock']) || 0,
                            price: mPrice > 0 ? mPrice : pPrice,
                            costPrice: finalCost
                        });
                    });
                } else {
                    products.forEach(product => {
                        if (product['active'] === false || product['publishStatus'] === 'archived') return;
                        
                        const sku = product['sku'] || '';
                        let stockQuantity = 0;
                        let mlItemId = '';
                        
                        if (channel === 'all') {
                            stockQuantity = product['stockQuantity'] || 0;
                            const meliItem = meliFullInventory.get(sku);
                            if (meliItem) {
                                stockQuantity += Number(meliItem['availableQuantity']) || Number(meliItem['fullStock']) || 0;
                                mlItemId = meliItem['mlItemId'] || '';
                            }
                        } else if (channel === 'AMAZON_FBA') {
                            stockQuantity = product['inventory']?.['AMAZON_FBA']?.available || product['inventory']?.['AMAZON_FBA']?.stock || 0;
                        } else {
                            stockQuantity = product['inventory']?.['MAIN']?.available || product['inventory']?.['MAIN']?.stock || product['stockQuantity'] || 0;
                        }

                        // Filter out irrelevant items for specific channels
                        if (channel !== 'all' && stockQuantity === 0) {
                            const sales = salesMap.get(sku);
                            if (!sales || sales.qty === 0) return; // Skip
                        }

                        itemsToProcess.push({
                            pid: mlItemId || product['id'],
                            sku: sku,
                            name: product['name']?.es || product['name']?.en || 'Unknown',
                            stockQuantity: stockQuantity,
                            price: product['price'] || 0,
                            costPrice: product['costPrice'] || ((product['price'] || 0) * 0.7)
                        });
                    });
                    
                    if (channel === 'all') {
                        meliFullInventory.forEach((meliItem) => {
                            const sku = meliItem['sku'] || meliItem['mlItemId'] || '';
                            if (!products.some(p => p['sku'] === sku)) {
                                const mPrice = Number(meliItem['price']) || 0;
                                itemsToProcess.push({
                                    pid: meliItem['mlItemId'] || sku,
                                    sku: sku,
                                    name: meliItem['title'] || 'Unknown',
                                    stockQuantity: Number(meliItem['availableQuantity']) || Number(meliItem['fullStock']) || 0,
                                    price: mPrice,
                                    costPrice: mPrice * 0.7
                                });
                            }
                        });
                    }
                }

                itemsToProcess.forEach(item => {
                    const sku = item.sku;
                    const stockQuantity = item.stockQuantity;
                    const costPrice = item.costPrice;
                    const price = item.price;
                    const name = item.name;
                    const pid = item.pid;

                    let sales = sku ? salesMap.get(sku) : undefined;
                    if (!sales && pid) sales = pidSalesMap.get(pid);
                    sales = sales || { qty: 0, revenue: 0 };
                    const salesVelocity = sales.qty / days;
                    const daysUntilStockout = salesVelocity > 0 ? stockQuantity / salesVelocity : Infinity;
                    const turnoverRate = stockQuantity > 0 ? (sales.qty / stockQuantity) * 100 : 0;
                    const reorderRecommended = daysUntilStockout < 14 && stockQuantity < 10;
                    const cogs = sales.qty * costPrice;
                    
                    const gmroi = (stockQuantity * costPrice) > 0 ? (sales.revenue - cogs) / (stockQuantity * costPrice) : 0;

                    let stockLevel: 'healthy' | 'low' | 'out_of_stock' | 'dead' = 'healthy';
                    if (stockQuantity === 0) stockLevel = 'out_of_stock';
                    else if (salesVelocity === 0) stockLevel = 'dead';
                    else if (stockQuantity < 10) stockLevel = 'low';

                    if (stockQuantity === 0) outOfStockProducts++;
                    else if (stockQuantity < 5) lowStockProducts++;

                    totalStockValue += (stockQuantity * costPrice);
                    totalCOGS += cogs;
                    totalRevenueSales += sales.revenue;

                    if (stockQuantity > 0 && sales.qty === 0) {
                        deadStockCount++;
                    }

                    if (stockQuantity === 0 && salesVelocity > 0) {
                        potentialLostRevenue += (salesVelocity * price);
                    }

                    if (stockQuantity > 0 && salesVelocity > 0 && daysUntilStockout < 7) {
                        predictedStockoutCount++;
                    }

                    let predictedStockoutDate: string | undefined;
                    if (stockQuantity > 0 && salesVelocity > 0) {
                        const today = new Date();
                        today.setDate(today.getDate() + daysUntilStockout);
                        predictedStockoutDate = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }

                    let recommendedReorderQuantity = 0;
                    if (salesVelocity > 0) {
                        const targetStock = salesVelocity * 45;
                        recommendedReorderQuantity = Math.max(0, Math.ceil(targetStock - stockQuantity));
                    }

                    performance.push({
                        productId: pid,
                        productName: name,
                        stockLevel,
                        revenue: sales.revenue,
                        stockQuantity,
                        salesVelocity,
                        daysUntilStockout: daysUntilStockout === Infinity ? -1 : Math.round(daysUntilStockout),
                        predictedStockoutDate,
                        potentialRevenueLoss: salesVelocity * price,
                        turnoverRate: parseFloat(turnoverRate.toFixed(2)),
                        gmroi: parseFloat(gmroi.toFixed(2)),
                        price,
                        stockValue: price * stockQuantity,
                        reorderRecommended,
                        recommendedReorderQuantity
                    });
                });

                performance.sort((a, b) => b.salesVelocity - a.salesVelocity);

                const overallTurnoverRate = (totalStockValue > 0) ? (totalCOGS / totalStockValue) * 100 : 0;
                const overallGmroi = (totalStockValue > 0) ? (totalRevenueSales - totalCOGS) / totalStockValue : 0;

                const metrics: InventoryMetrics = {
                    totalProducts: itemsToProcess.length,
                    lowStockProducts,
                    outOfStockProducts,
                    totalStockValue,
                    averageTurnoverRate: parseFloat(overallTurnoverRate.toFixed(2)),
                    gmroi: parseFloat(overallGmroi.toFixed(2)),
                    sellThroughRate: 0,
                    deadStockCount,
                    abcBreakdown: { a: 0, b: 0, c: 0 },
                    potentialLostRevenue,
                    predictedStockoutCount
                };

                return { metrics, performance };
            })()).pipe(
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
