import { Component, inject, computed, OnDestroy, ChangeDetectionStrategy, signal, effect, Injector, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, getDocs, query, limit, where } from '@angular/fire/firestore';
import { KpiCardComponent } from '../../../shared/components/kpi-card/kpi-card.component';
import { ChartCardComponent } from '../../../shared/components/chart-card/chart-card.component';
import { ApprovalStatsComponent } from './widgets/approval-stats/approval-stats.component';
import { ExecutiveBriefingComponent } from './widgets/executive-briefing/executive-briefing.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { MetricsService } from '../../../core/services/metrics.service';
import { AuthService } from '../../../core/services/auth.service';
import { KPICard, MetricChartData } from '../../../core/models/business-metrics.model';
import { TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { catchError, finalize, tap, take } from 'rxjs/operators';
import { of } from 'rxjs';
import { SmartBriefingService } from '../services/smart-briefing.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { TourService } from '../../../core/services/tour.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-command-center-dashboard',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        TranslateModule,
        KpiCardComponent,
        ChartCardComponent,
        ApprovalStatsComponent,
        AppIconComponent,
        ExecutiveBriefingComponent,
        DashboardDiagnosticsComponent
    ],
    templateUrl: './command-center-dashboard.component.html',
    styleUrls: ['./command-center-dashboard.component.css']
})
export class CommandCenterDashboardComponent implements OnDestroy {
    private metricsService = inject(MetricsService);
    private authService = inject(AuthService);
    public contextService = inject(CommandCenterContextService);
    private briefingService = inject(SmartBriefingService);
    private dataService = inject(CommandCenterDataService);
    private tourService = inject(TourService);

    // Auth Debugging
    user$ = this.authService.user$;
    userProfile$ = this.authService.userProfile$;

    // Data Signals
    kpiCards = signal<KPICard[]>([]);
    revenueTrend = signal<MetricChartData | null>(null);
    orderDistribution = signal<MetricChartData | null>(null);
    topProducts = signal<MetricChartData | null>(null);
    customerComposition = signal<MetricChartData | null>(null);

    // Data Streams for Briefing
    salesData = toSignal(this.dataService.salesAnalyticsData$);
    inventoryData = toSignal(this.dataService.inventoryData$);
    operationalData = toSignal(this.dataService.operationalData$);

    // Computed Briefing
    briefing = computed(() => {
        return this.briefingService.generateBriefing(
            this.salesData() || null,
            this.inventoryData() || null,
            this.operationalData() || null
        );
    });

    // Loading State
    isLoading = signal<boolean>(false);

    // safeMode is removed as we are fixing the root cause
    errorLog = signal<string[]>([]);

    // Individual loading states (derived for template compatibility)
    isLoadingKPIs = computed(() => this.isLoading());
    isLoadingRevenue = computed(() => this.isLoading());
    isLoadingOrders = computed(() => this.isLoading());
    isLoadingProducts = computed(() => this.isLoading());
    isLoadingCustomers = computed(() => this.isLoading());

    // Table Configurations
    revenueTableColumns: TableColumn[] = [
        { key: 'label', label: 'COMMAND_CENTER.KPI.DATE', format: 'date' },
        { key: 'value', label: 'COMMAND_CENTER.KPI.REVENUE', format: 'currency' }
    ];

    orderTableColumns: TableColumn[] = [
        { key: 'label', label: 'COMMAND_CENTER.KPI.STATUS', format: 'category' },
        { key: 'value', label: 'COMMAND_CENTER.KPI.COUNT', format: 'number' }
    ];

    productTableColumns: TableColumn[] = [
        { key: 'label', label: 'COMMAND_CENTER.KPI.PRODUCT', format: 'text' as any }, // 'text' not in interface, defaulting or using category
        { key: 'value', label: 'COMMAND_CENTER.KPI.REVENUE', format: 'currency' }
    ];

    // Computed Table Data
    revenueTableData = computed<any[]>(() => {
        const data = this.revenueTrend();
        if (!data) return [];
        return data.labels.map((label, index) => ({
            label,
            value: data.datasets[0].data[index]
        }));
    });

    orderTableData = computed<any[]>(() => {
        const data = this.orderDistribution();
        if (!data) return [];
        return data.labels.map((label, index) => ({
            label,
            value: data.datasets[0].data[index]
        }));
    });

    productTableData = computed<any[]>(() => {
        const data = this.topProducts();
        if (!data) return [];
        return data.labels.map((label, index) => ({
            label,
            value: data.datasets[0].data[index]
        }));
    });

    customerTableData = computed<any[]>(() => {
        const data = this.customerComposition();
        if (!data) return [];
        return data.labels.map((label, index) => ({
            label,
            value: data.datasets[0].data[index]
        }));
    });

    // Table Columns for Customers
    customerTableColumns: TableColumn[] = [
        { key: 'label', label: 'COMMAND_CENTER.KPI.SEGMENT', format: 'category' },
        { key: 'value', label: 'COMMAND_CENTER.KPI.COUNT', format: 'number' }
    ];

    // Build Verification
    readonly buildVersion = 'v1.1.0-AI-ANALYST';
    private firestore = inject(Firestore);
    private cdr = inject(ChangeDetectorRef);

    constructor() {
        console.log(`🚀 [Dashboard] Initialized - Build ${this.buildVersion}`);

        // 1. Force Load Immediately (Safety Net)
        setTimeout(() => {
            const range = this.contextService.dateRange();
            console.log('⚡ [Dashboard] Force-check triggered. Range:', range);

            if (range) {
                this.loadDashboardData(range.start, range.end);
            } else {
                console.warn('⚠️ [Dashboard] Force-check skipped: Range is null');
                this.errorLog.update(l => ['⚠️ System Ready. Please select a date range.', ...l]);
            }
        }, 2500);

        // 2. Main Data Fetching Effect
        effect(() => {
            const range = this.contextService.dateRange();
            console.log('⚡ [Dashboard] Effect Triggered! Range:', range?.start, range?.end);

            if (range) {
                this.loadDashboardData(range.start, range.end);
            } else {
                console.warn('⚠️ [Dashboard] Effect triggered but range is null');
            }
        }, { allowSignalWrites: true });
    }

    async loadDashboardData(start: Date, end: Date) {
        console.log('🔄 [Dashboard] Loading data for:', start, 'to', end);

        // Append log separator
        this.errorLog.update(l => [
            '------------------------------------------------',
            `🔄 LOADING: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`,
            '------------------------------------------------',
            ...l
        ]);

        this.isLoading.set(true);

        // 1. RUN QUERY DIAGNOSTIC (Inline Probe)
        try {
            const ordersRef = collection(this.firestore, 'orders');

            // Check count for this SPECIFIC range manually first
            const q = query(
                ordersRef,
                where('createdAt', '>=', start),
                where('createdAt', '<=', end),
                limit(5)
            );

            const snap = await getDocs(q);
            const count = snap.size;

            this.errorLog.update(l => [
                `🧪 DIAGNOSTIC: Found ${count} orders in this range.`,
                ...l
            ]);

            if (count > 0) {
                const first = snap.docs[0].data();
                const dateVal = first['createdAt']?.toDate ? first['createdAt'].toDate().toISOString() : first['createdAt'];
                this.errorLog.update(l => [`🔎 FOUND SAMPLE: ${dateVal}`, ...l]);
            } else {
                this.errorLog.update(l => ['❌ DIAGNOSTIC: 0 orders found. Checking Global...', ...l]);
                // Fallback: Check if ANY orders exist at all
                const globals = await getDocs(query(ordersRef, limit(1)));
                this.errorLog.update(l => [`🔎 GLOBAL CHECK: Any orders in DB? ${!globals.empty}`, ...l]);
            }

        } catch (e: any) {
            this.errorLog.update(l => [`❌ DIAGNOSTIC ERROR: ${e.message}`, ...l]);
        }

        // 2. PROCEED WITH REGULAR SERVICE LOADING
        const updateDebug = (type: string, count: number) => {
            console.log(`📊 [Dashboard] ${type}: ${count}`);
            this.errorLog.update(logs => [`INFO: Fetched ${count} ${type}`, ...logs]);
        };

        const logError = (prefix: string, err: any) => {
            const msg = `${prefix}: ${err.message || err}`;
            console.error('❌', msg);
            this.errorLog.update(logs => [msg, ...logs]);
            return of(null);
        };

        // 1. KPI Cards
        this.metricsService.getKPICards(start, end)
            .pipe(
                take(1),
                tap(data => updateDebug('KPI Entries', data.length)),
                catchError(err => {
                    logError('KPI Error', err);
                    return of([]);
                })
            )
            .subscribe(data => this.kpiCards.set(data));

        // 2. Revenue Trend
        this.metricsService.getRevenueTrend(30, start, end)
            .pipe(
                take(1),
                tap(data => updateDebug('RevTrend Points', data.labels.length)),
                catchError(err => logError('Revenue Error', err))
            )
            .subscribe(data => this.revenueTrend.set(data));

        // 3. Order Distribution
        this.metricsService.getOrderDistribution(start, end)
            .pipe(
                take(1),
                tap(data => updateDebug('Order Categories', data.labels.length)),
                catchError(err => logError('Orders Error', err))
            )
            .subscribe(data => this.orderDistribution.set(data));

        // 4. Top Products
        this.metricsService.getTopProducts(5, start, end)
            .pipe(
                take(1),
                tap(data => updateDebug('Top Products', data.labels.length)),
                catchError(err => logError('Products Error', err))
            )
            .subscribe(data => this.topProducts.set(data));

        // 5. Customer Composition
        this.metricsService.getCustomerComposition(start, end)
            .pipe(
                take(1),
                tap(data => updateDebug('Customers', data.labels.length)),
                catchError(err => logError('Customer Error', err)),
                finalize(() => {
                    this.isLoading.set(false);
                    this.cdr.markForCheck(); // FORCE UI UPDATE
                    console.log('✅ [Dashboard] Data loading complete');
                })
            )
            .subscribe(data => this.customerComposition.set(data));
    }

    async runDiagnosticProbe() {
        // Obsolete
    }

    refreshData() {
        console.log('🔄 [Dashboard] Manual refresh triggered');
        const range = this.contextService.dateRange();
        if (range) {
            this.loadDashboardData(range.start, range.end);
        }
    }

    startTour() {
        this.tourService.startTour('command-center-orientation');
    }

    ngOnDestroy() {
        console.log('💀 [Dashboard] Component destroyed');
    }
}
