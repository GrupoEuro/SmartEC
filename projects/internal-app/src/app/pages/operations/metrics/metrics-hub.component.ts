import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Timestamp } from '@angular/fire/firestore';
import { Chart, registerables, TooltipItem } from 'chart.js';
import {
    MetricsAnalyticsService, AnalyticsDailyDoc, DATE_RANGES, DateRange, ChannelBreakdown
} from './services/metrics-analytics.service';
import { MetricsTimeframeService } from './services/metrics-timeframe.service';
import { MetricsBigqueryService, SummaryKpisRow, DailyTrendRow, CancellationRateRow } from './services/metrics-bigquery.service';
import { MetricsHeatmapComponent } from './shared/metrics-heatmap.component';

Chart.register(...registerables);

// ── Forecast types ─────────────────────────────────────────────────────────────

export interface CalendarDay {
    day:       number;
    label:     string;   // 'Mar 21'
    isActual:  boolean;
    isToday:   boolean;
    isFuture:  boolean;
    isEmpty:   boolean;  // padding cell
    value:     number;
    valueFmt:  string;   // '$4.5K'
    intensity: number;   // 0–1 relative colour scale
    dow:       number;   // 0=Sun…6=Sat (JS Date.getDay())
    dowKey:    string;   // 'L','M','X','J','V','S','D'
}
export interface ForecastSummary {
    mtdActual:      number;
    projected:      number;
    low:            number;
    high:           number;
    currentPace:    number;
    daysIn:         number;
    daysLeft:       number;
    paceVsPrior:    number | null;
    slope:          number;          // LR slope — positive = accelerating
    paceProgress:   number;          // actual / expected-so-far  >1 = ahead
    bestFutureDays: Array<{ label: string; predicted: number; dowKey: string }>;
}
export interface ForecastResult {
    labels:       string[];
    actual:       (number | null)[];
    forecast:     (number | null)[];
    upper:        (number | null)[];
    lower:        (number | null)[];
    calendarDays: CalendarDay[];
    summary:      ForecastSummary;
}

interface ChannelRow {
    id:        string;
    label:     string;
    revenue:   number;
    orders:    number;
    units:     number;
    avgTicket: number;
    share:     number;
    route?:    string;
    color:     string;
}

// ── Compare types ──────────────────────────────────────────────────────────────

export interface CmpKpiItem {
    key:   string;
    label: string;
    icon:  string;
    aVal:  number;
    bVal:  number;
    aFmt:  string;
    bFmt:  string;
    aBar:  number;   // 0-100 (relative bar width %)
    bBar:  number;
    delta: number | null;
    winner: 'A' | 'B' | 'tie';
}

export interface CmpChannelRow {
    id:       string;
    label:    string;
    color:    string;
    route?:   string;
    aRev:     number;
    bRev:     number;
    aOrd:     number;
    bOrd:     number;
    revDelta: number | null;
    ordDelta: number | null;
    revBar:   number;  // 0-100 relative
    winner:   'A' | 'B' | 'tie';
}

type ComparePreset = 'monthVsPrev' | 'prevMonthVs2Mo' | 'sameMonthPrevYear';

@Component({
    selector: 'app-metrics-hub',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule, MetricsHeatmapComponent],
    templateUrl: './metrics-hub.component.html',
    styleUrls:  ['./metrics-hub.component.scss'],
})
export class MetricsHubComponent implements OnInit, OnDestroy {

    private svc    = inject(MetricsAnalyticsService);  // kept for aggregateDocs / pctChange helpers
    private bqSvc  = inject(MetricsBigqueryService);
    private tf     = inject(MetricsTimeframeService);
    private fns    = inject(Functions);
    private fs     = inject(Firestore);

    // ── Standard view state ─────────────────────────────────────────────────
    readonly dateRanges    = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    isLoading        = signal(true);
    isBackfilling    = signal(false);
    isSyncingRecent  = signal(false);
    syncRecentResult = signal<{ ordersWritten: number; itemsWritten: number } | null>(null);
    backfillResult   = signal<{ daysProcessed: number; writeCount: number } | null>(null);
    dailyDocs      = signal<AnalyticsDailyDoc[]>([]);
    priorDocs      = signal<AnalyticsDailyDoc[]>([]);

    // ── Quick Win 1: Cancellation rate ──────────────────────────────────
    cancellationRows = signal<CancellationRateRow[]>([]);

    /** Overall cancellation rate across all channels. */
    readonly overallCancellationRate = computed(() => {
        const rows = this.cancellationRows();
        if (!rows.length) return null;
        const tot = rows.reduce((s, r) => s + r.total_orders, 0);
        const can = rows.reduce((s, r) => s + r.cancelled_orders, 0);
        return tot > 0 ? can / tot : 0;
    });

    // ── Quick Win 3: Last BQ sync status ─────────────────────────────
    lastBqSync = signal<{ lastSyncDate: string; syncedAt: Timestamp; ordersAppended: number; status: string; errorMessage: string | null } | null>(null);

    readonly lastBqSyncLabel = computed(() => {
        const s = this.lastBqSync();
        if (!s) return null;
        const dt = s.syncedAt?.toDate?.() ?? null;
        if (!dt) return s.lastSyncDate;
        const diffMs = Date.now() - dt.getTime();
        const diffH  = Math.floor(diffMs / 3_600_000);
        const diffM  = Math.floor(diffMs / 60_000);
        if (diffH >= 24) return `hace ${Math.floor(diffH / 24)}d`;
        if (diffH >= 1)  return `hace ${diffH}h`;
        return `hace ${diffM}m`;
    });

    // ── Item 2: Abandoned Cart Analytics ─────────────────────────────
    abandonStats = signal<{ daily: Record<string, number> } | null>(null);

    readonly abandonLast7Days = computed(() => {
        const s = this.abandonStats();
        if (!s?.daily) return 0;
        const today = new Date();
        let total = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(/-/g, '_');
            total += s.daily[key] ?? 0;
        }
        return total;
    });

    readonly abandonToday = computed(() => {
        const s = this.abandonStats();
        if (!s?.daily) return 0;
        const key = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(/-/g, '_');
        return s.daily[key] ?? 0;
    });

    /** Last 7 daily values for mini sparkline [ oldest … today ] */
    readonly abandonSparkline = computed(() => {
        const s = this.abandonStats();
        if (!s?.daily) return [] as number[];
        const today = new Date();
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - (6 - i));  // 0 = 6 days ago, 6 = today
            const key = d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(/-/g, '_');
            return s.daily[key] ?? 0;
        });
    });

    // ── Item 3: Avg ticket ranking (sorted high→low for comparison strip) ─────
    readonly avgTicketRanked = computed(() =>
        [...this.channelRows()]
            .filter(r => r.orders > 0)
            .sort((a, b) => b.avgTicket - a.avgTicket)
    );

    // ── Chart + Forecast ─────────────────────────────────────────────────────
    @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;
    private trendChart?: Chart;

    showForecast    = signal(false);
    forecastResult  = signal<ForecastResult | null>(null);

    readonly isMTD = computed(() => this.selectedRange().type === 'MTD');

    constructor() {
        // Re-render chart whenever docs or forecast state change
        effect(() => {
            const docs     = this.dailyDocs();
            const forecast = this.forecastResult();
            if (docs.length > 0 && !this.compareMode()) {
                setTimeout(() => this.buildTrendChart(docs, forecast ?? undefined), 60);
            }
        });
    }

    // ── Compare mode state ────────────────────────────────────────────────────
    compareMode    = signal(false);
    compareLoading = signal(false);

    private readonly _now = new Date();
    periodAKey = signal<string>(this._mkKey(this._now));
    periodBKey = signal<string>(this._mkKey(new Date(this._now.getFullYear(), this._now.getMonth() - 1, 1)));

    docsA = signal<AnalyticsDailyDoc[]>([]);
    docsB = signal<AnalyticsDailyDoc[]>([]);

    readonly periodALabel = computed(() => this._fmtPeriod(this.periodAKey()));
    readonly periodBLabel = computed(() => this._fmtPeriod(this.periodBKey()));

    // ── Standard KPIs ─────────────────────────────────────────────────────────
    readonly kpis = computed(() => {
        const cur  = this.svc.aggregateDocs(this.dailyDocs());
        const prev = this.svc.aggregateDocs(this.priorDocs());
        return {
            revenue:  { value: cur.totalRevenue,  delta: this.svc.pctChange(cur.totalRevenue, prev.totalRevenue) },
            orders:   { value: cur.totalOrders,   delta: this.svc.pctChange(cur.totalOrders,  prev.totalOrders)  },
            avgTicket:{ value: cur.avgTicket,      delta: this.svc.pctChange(cur.avgTicket,    prev.avgTicket)    },
            units:    { value: cur.totalUnits,     delta: this.svc.pctChange(cur.totalUnits,   prev.totalUnits)   },
        };
    });

    readonly CHANNEL_LABELS: Record<string, { label: string; route?: string; color: string }> = {
        MELI_FULL:    { label: 'MercadoLibre Full',    route: '/operations/metrics/meli-full',            color: '#fb923c' },
        MELI_CLASSIC: { label: 'MercadoLibre Clásica', route: '/operations/metrics/channel/MELI_CLASSIC', color: '#ca8a04' },
        WEB:          { label: 'Web (Tienda)',          route: '/operations/metrics/channel/WEB',          color: '#6366f1' },
        POS:          { label: 'Punto de Venta',        route: '/operations/metrics/channel/POS',          color: '#10b981' },
        ON_BEHALF:    { label: 'A cuenta de cliente',  route: '/operations/metrics/channel/ON_BEHALF',    color: '#a78bfa' },
        AMAZON_FBA:   { label: 'Amazon FBA',            route: '/operations/metrics/channel/AMAZON_FBA',  color: '#f59e0b' },
        AMAZON_MFN:   { label: 'Amazon MFN',            route: '/operations/metrics/channel/AMAZON_MFN',  color: '#fbbf24' },
    };

    readonly channelRows = computed((): ChannelRow[] => {
        const cur = this.svc.aggregateDocs(this.dailyDocs());
        const totalRev = cur.totalRevenue || 1;
        return Object.entries(cur.byChannel)
            .map(([id, data]: [string, ChannelBreakdown]) => ({
                id,
                label:     this.CHANNEL_LABELS[id]?.label ?? id,
                revenue:   data.revenue,
                orders:    data.orders,
                units:     data.units,
                avgTicket: data.orders > 0 ? data.revenue / data.orders : 0,
                share:     data.revenue / totalRev,
                route:     this.CHANNEL_LABELS[id]?.route,
                color:     this.CHANNEL_LABELS[id]?.color ?? '#71717a',
            }))
            .sort((a, b) => b.revenue - a.revenue);
    });

    readonly trendData = computed(() => {
        const docs = this.dailyDocs();
        return {
            labels:  docs.map(d => {
                const dt = new Date(d.date + 'T12:00:00');
                return dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
            }),
            revenue: docs.map(d => d.totalRevenue ?? 0),
            orders:  docs.map(d => d.totalOrders  ?? 0),
        };
    });

    // ── Compare KPIs ──────────────────────────────────────────────────────────
    private readonly aggA = computed(() => this.svc.aggregateDocs(this.docsA()));
    private readonly aggB = computed(() => this.svc.aggregateDocs(this.docsB()));

    readonly cmpKpis = computed((): CmpKpiItem[] => {
        const a = this.aggA(), b = this.aggB();
        const maxRev = Math.max(1, a.totalRevenue, b.totalRevenue);
        const maxOrd = Math.max(1, a.totalOrders,  b.totalOrders);
        const maxTkt = Math.max(1, a.avgTicket,    b.avgTicket);
        const maxUnt = Math.max(1, a.totalUnits,   b.totalUnits);

        const mk = (key: string, label: string, icon: string,
                    aV: number, bV: number, maxV: number,
                    fmtA: string, fmtB: string): CmpKpiItem => {
            const delta = this.svc.pctChange(bV, aV);
            return {
                key, label, icon, aVal: aV, bVal: bV,
                aFmt: fmtA, bFmt: fmtB,
                aBar: (aV / maxV) * 100, bBar: (bV / maxV) * 100,
                delta,
                winner: aV === bV ? 'tie' : (bV > aV ? 'B' : 'A'),
            };
        };

        return [
            mk('revenue',   'Ingresos',       '💰', a.totalRevenue, b.totalRevenue, maxRev,
               this._fmtMoney(a.totalRevenue), this._fmtMoney(b.totalRevenue)),
            mk('orders',    'Órdenes',        '🛒', a.totalOrders,  b.totalOrders,  maxOrd,
               a.totalOrders.toLocaleString('es-MX'), b.totalOrders.toLocaleString('es-MX')),
            mk('avgTicket', 'Ticket Promedio','🎫', a.avgTicket,    b.avgTicket,    maxTkt,
               this._fmtMoney(a.avgTicket), this._fmtMoney(b.avgTicket)),
            mk('units',     'Unidades',       '📦', a.totalUnits,   b.totalUnits,   maxUnt,
               a.totalUnits.toLocaleString('es-MX'), b.totalUnits.toLocaleString('es-MX')),
        ];
    });

    // ── Compare channel rows ──────────────────────────────────────────────────
    readonly cmpChannelRows = computed((): CmpChannelRow[] => {
        const a = this.aggA(), b = this.aggB();
        const allChs = new Set([...Object.keys(a.byChannel), ...Object.keys(b.byChannel)]);
        const maxRev = Math.max(1, ...Array.from(allChs).map(id =>
            Math.max(a.byChannel[id]?.revenue ?? 0, b.byChannel[id]?.revenue ?? 0)
        ));

        return Array.from(allChs)
            .map(id => {
                const aCh = a.byChannel[id] ?? { revenue: 0, orders: 0, units: 0 };
                const bCh = b.byChannel[id] ?? { revenue: 0, orders: 0, units: 0 };
                const cfg = this.CHANNEL_LABELS[id];
                const maxChRev = Math.max(aCh.revenue, bCh.revenue, 1);
                return {
                    id, label: cfg?.label ?? id, color: cfg?.color ?? '#71717a', route: cfg?.route,
                    aRev: aCh.revenue, bRev: bCh.revenue,
                    aOrd: aCh.orders,  bOrd: bCh.orders,
                    revDelta: this.svc.pctChange(bCh.revenue, aCh.revenue),
                    ordDelta: this.svc.pctChange(bCh.orders, aCh.orders),
                    revBar:   maxChRev > 0 ? maxChRev / maxRev * 100 : 0,
                    winner:   aCh.revenue === bCh.revenue ? 'tie'
                              : (bCh.revenue > aCh.revenue ? 'B' : 'A') as 'A' | 'B' | 'tie',
                };
            })
            .filter(r => r.aRev > 0 || r.bRev > 0)
            .sort((x, y) => Math.max(x.aRev, x.bRev) > Math.max(y.aRev, y.bRev) ? -1 : 1);
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    async ngOnInit() {
        await this.load();
        // Non-blocking Firestore reads — run in parallel after main data loads
        this._loadBqSyncStatus();
        this._loadAbandonStats();
    }

    private async _loadBqSyncStatus() {
        try {
            const snap = await getDoc(doc(this.fs, 'system_logs', 'bq_sync_status'));
            if (snap.exists()) this.lastBqSync.set(snap.data() as any);
        } catch { /* non-critical */ }
    }

    private async _loadAbandonStats() {
        try {
            const snap = await getDoc(doc(this.fs, 'system_logs', 'abandon_stats'));
            if (snap.exists()) this.abandonStats.set(snap.data() as any);
        } catch { /* non-critical */ }
    }

    async selectRange(r: DateRange) {
        this.tf.set(r);
        await this.load();
    }

    private async load() {
        this.isLoading.set(true);
        const range = this.tf.selected();
        try {
            // Current period
            const { fromDate: curFrom, toDate: curTo } = this.bqSvc.getDateStrings(range);

            // Prior period
            const [prevFrom, prevTo] = this.svc.getPriorRange(range.type);
            const prevFromStr = prevFrom.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
            const prevToStr   = prevTo.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' });

            // Use allSettled so a single query failure doesn't kill the entire dashboard
            const [curTrendR, curKpisR, prevTrendR, prevKpisR, cancelRowsR] = await Promise.allSettled([
                this.bqSvc.queryDailyTrendBetween(curFrom, curTo),
                this.bqSvc.querySummaryKpisBetween(curFrom, curTo),
                this.bqSvc.queryDailyTrendBetween(prevFromStr, prevToStr),
                this.bqSvc.querySummaryKpisBetween(prevFromStr, prevToStr),
                this.bqSvc.queryCancellationRate(range),
            ]);

            const ok    = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
                r.status === 'fulfilled' ? r.value : (console.warn('[MetricsHub] BQ query partial failure:', (r as any).reason), fallback);

            const curTrend   = ok(curTrendR,    []);
            const curKpis    = ok(curKpisR,     []);
            const prevTrend  = ok(prevTrendR,   []);
            const prevKpis   = ok(prevKpisR,    []);
            const cancelRows = ok(cancelRowsR,  []);

            this.dailyDocs.set(this._bqToDocs(curTrend, curKpis));
            this.priorDocs.set(this._bqToDocs(prevTrend, prevKpis));
            this.cancellationRows.set(cancelRows);
        } catch (err) {
            console.error('[MetricsHub] BQ load critical failure:', err);
            this.dailyDocs.set([]);
            this.priorDocs.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }


    /**
     * Converts BQ DailyTrendRow[] + SummaryKpisRow[] into AnalyticsDailyDoc[] shape
     * so all existing computed signals (kpis, channelRows, trendData, forecast) work unchanged.
     *
     * Strategy:
     *  - One AnalyticsDailyDoc per unique order_date from dailyTrend.
     *  - byChannel is reconstructed by distributing each day's revenue proportionally
     *    using the period-level channel shares from summaryKpis.
     *  - This is equivalent to Firestore analytics_daily but sourced from BQ raw orders.
     */
    private _bqToDocs(trend: DailyTrendRow[], kpis: SummaryKpisRow[]): AnalyticsDailyDoc[] {
        const daysMap = new Map<string, AnalyticsDailyDoc>();

        for (const row of trend) {
            let doc = daysMap.get(row.order_date);
            if (!doc) {
                const dt = new Date(row.order_date + 'T12:00:00');
                doc = {
                    date:         row.order_date,
                    month:        row.order_date.slice(0, 7),
                    dayOfWeek:    (dt.getDay() + 6) % 7,
                    totalRevenue: 0,
                    totalOrders:  0,
                    totalUnits:   0,
                    avgTicket:    0,
                    byChannel:    {},
                };
                daysMap.set(row.order_date, doc);
            }
            
            doc.totalRevenue += row.revenue;
            doc.totalOrders  += row.orders;
            doc.totalUnits   += row.units;
            
            if (row.source_channel) {
                doc.byChannel[row.source_channel] = {
                    revenue: row.revenue,
                    orders:  row.orders,
                    units:   row.units
                };
            }
        }

        return Array.from(daysMap.values()).map(doc => {
            doc.avgTicket = doc.totalOrders > 0 ? doc.totalRevenue / doc.totalOrders : 0;
            return doc;
        }).sort((a, b) => a.date.localeCompare(b.date));
    }

    /** Returns a DateRange shifted to the prior period — mirrors MetricsAnalyticsService.getPriorRange() */
    private _priorRange(range: DateRange): DateRange {
        // We reuse the type label; the BQ service uses getDateStrings which calls svc.getDateRange()
        // so we need to produce a synthetic range whose fromDate/toDate are the prior period.
        // Simplest: return a special type that MetricsBigqueryService can interpret.
        // Instead, we call the prior range directly.
        return range; // fallback — replaced by _loadPriorBQ below
    }


    // ── Compare mode methods ──────────────────────────────────────────────────

    async toggleCompare() {
        const next = !this.compareMode();
        this.compareMode.set(next);
        if (next && this.docsA().length === 0) {
            await this.loadCompare();
        }
    }

    async applyPreset(preset: ComparePreset) {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        switch (preset) {
            case 'monthVsPrev':
                this.periodAKey.set(this._mkKey(new Date(y, m, 1)));
                this.periodBKey.set(this._mkKey(new Date(y, m - 1, 1)));
                break;
            case 'prevMonthVs2Mo':
                this.periodAKey.set(this._mkKey(new Date(y, m - 1, 1)));
                this.periodBKey.set(this._mkKey(new Date(y, m - 2, 1)));
                break;
            case 'sameMonthPrevYear':
                this.periodAKey.set(this._mkKey(new Date(y, m, 1)));
                this.periodBKey.set(this._mkKey(new Date(y - 1, m, 1)));
                break;
        }
        await this.loadCompare();
    }

    onPeriodAChange(ev: Event) {
        const val = (ev.target as HTMLInputElement).value;
        if (val) this.periodAKey.set(val);
    }
    onPeriodBChange(ev: Event) {
        const val = (ev.target as HTMLInputElement).value;
        if (val) this.periodBKey.set(val);
    }

    swapPeriods() {
        const tmp = this.periodAKey();
        this.periodAKey.set(this.periodBKey());
        this.periodBKey.set(tmp);
        const tDocs = this.docsA();
        this.docsA.set(this.docsB());
        this.docsB.set(tDocs);
    }

    async loadCompare() {
        this.compareLoading.set(true);
        const [a, b] = await Promise.all([
            this._loadPeriod(this.periodAKey()),
            this._loadPeriod(this.periodBKey()),
        ]);
        this.docsA.set(a);
        this.docsB.set(b);
        this.compareLoading.set(false);
    }

    private async _loadPeriod(key: string): Promise<AnalyticsDailyDoc[]> {
        const parts = key.split('-');
        const y = Number(parts[0]);
        const mo = Number(parts[1]) - 1;  // 0-indexed
        const from = new Date(y, mo, 1);
        const to   = new Date(y, mo + 1, 0, 23, 59, 59); // last day of month
        const fromStr = from.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        const toStr   = to.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' });
        const [trend, kpis] = await Promise.all([
            this.bqSvc.queryDailyTrendBetween(fromStr, toStr),
            this.bqSvc.querySummaryKpisBetween(fromStr, toStr),
        ]);
        return this._bqToDocs(trend, kpis);
    }

    private buildTrendChart(docs: AnalyticsDailyDoc[], forecast?: ForecastResult) {
        this.trendChart?.destroy();
        const canvas = this.trendCanvas?.nativeElement;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use forecast labels (full month) if available, otherwise use actual data labels
        const labels  = forecast
            ? forecast.labels
            : docs.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));

        const revenue = forecast ? forecast.actual : docs.map(d => d.totalRevenue ?? 0);
        const orders  = docs.map(d => d.totalOrders ?? 0);
        // Quick Win 2 — avg ticket per day (null when no orders to avoid division artifacts)
        const avgTicket: (number | null)[] = docs.map(d =>
            (d.totalOrders ?? 0) > 0 ? (d.totalRevenue ?? 0) / d.totalOrders : null
        );

        // Pad orders/avgTicket arrays with nulls for future days if forecast extends the range
        const ordersData: (number | null)[] = forecast
            ? [...orders, ...new Array(labels.length - orders.length).fill(null)]
            : orders;
        const avgTicketData: (number | null)[] = forecast
            ? [...avgTicket, ...new Array(labels.length - avgTicket.length).fill(null)]
            : avgTicket;

        // Orange gradient under the revenue line
        const revGrad = ctx.createLinearGradient(0, 0, 0, 320);
        revGrad.addColorStop(0, 'rgba(251,146,60,.45)');
        revGrad.addColorStop(0.6, 'rgba(251,146,60,.12)');
        revGrad.addColorStop(1,  'rgba(251,146,60,.01)');

        // Indigo gradient for bars
        const barGrad = ctx.createLinearGradient(0, 0, 0, 320);
        barGrad.addColorStop(0, 'rgba(99,102,241,.75)');
        barGrad.addColorStop(1, 'rgba(99,102,241,.20)');

        const many = labels.length > 60;

        const datasets: object[] = [
            {
                // Orders — bars on right axis
                type: 'bar',
                label: 'Órdenes',
                data: ordersData,
                backgroundColor: barGrad,
                borderColor: 'rgba(99,102,241,.5)',
                borderWidth: 1,
                borderRadius: 3,
                yAxisID: 'yOrders',
                order: 3,
            },
            {
                // Revenue actual — smooth line on left axis
                type: 'line',
                label: 'Ingresos MXN',
                data: revenue,
                borderColor: '#fb923c',
                backgroundColor: revGrad,
                borderWidth: 2.5,
                tension: 0.42,
                fill: true,
                pointRadius: many ? 0 : 4,
                pointHoverRadius: 6,
                pointBackgroundColor: '#fb923c',
                pointBorderColor: '#18181b',
                pointBorderWidth: 2,
                yAxisID: 'yRevenue',
                order: 2,
                spanGaps: false,
            },
            {
                // Quick Win 2 — Avg ticket dashed line
                type: 'line',
                label: 'Ticket Promedio',
                data: avgTicketData,
                borderColor: 'rgba(16,185,129,.85)',
                backgroundColor: 'transparent',
                borderWidth: 1.8,
                borderDash: [5, 4],
                tension: 0.38,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointBackgroundColor: '#10b981',
                yAxisID: 'yAvgTicket',
                order: 1,
                spanGaps: true,
            },
        ];

        // ── Forecast datasets ──────────────────────────────────────────────────
        if (forecast) {
            datasets.push(
                {
                    // Lower confidence band (anchor for fill)
                    type: 'line',
                    label: '_lower',
                    data: forecast.lower,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: false,
                    yAxisID: 'yRevenue',
                    order: 5,
                    spanGaps: false,
                },
                {
                    // Upper band — fills down to lower to create confidence band
                    type: 'line',
                    label: '_upper',
                    data: forecast.upper,
                    borderColor: 'rgba(251,146,60,.25)',
                    borderWidth: 1,
                    borderDash: [3, 3],
                    backgroundColor: 'rgba(251,146,60,.08)',
                    fill: '-1',          // fill between this and previous (_lower)
                    pointRadius: 0,
                    yAxisID: 'yRevenue',
                    order: 4,
                    spanGaps: false,
                },
                {
                    // Forecast central line — dashed orange
                    type: 'line',
                    label: 'Pronóstico',
                    data: forecast.forecast,
                    borderColor: 'rgba(251,146,60,.7)',
                    borderWidth: 2,
                    borderDash: [7, 4],
                    backgroundColor: 'transparent',
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    tension: 0.38,
                    yAxisID: 'yRevenue',
                    order: 1,
                    spanGaps: false,
                },
            );
        }

        this.trendChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: '#a1a1aa',
                            font: { size: 11, weight: '600' },
                            padding: 16,
                            boxWidth: 14,
                            boxHeight: 10,
                            filter: (item: any) =>
                                !item.text.startsWith('_'),  // hide internal bands from legend
                        },
                    },
                    tooltip: {
                        backgroundColor: '#1c1c1f',
                        borderColor: 'rgba(255,255,255,.12)',
                        borderWidth: 1,
                        titleColor: '#f4f4f5',
                        titleFont: { size: 12, weight: 'bold' },
                        bodyColor: '#a1a1aa',
                        bodyFont: { size: 11 },
                        padding: 10,
                        callbacks: {
                            title: (items: TooltipItem<'bar'>[]) => items[0]?.label ?? '',
                            label: (item: TooltipItem<'bar'>) => {
                                if (item.dataset.label?.startsWith('_')) return '';
                                if (item.dataset.label === 'Órdenes') {
                                    return item.parsed.y != null ? '  ' + item.parsed.y + ' órdenes' : '';
                                }
                                if (item.dataset.label === 'Ticket Promedio') {
                                    return item.parsed.y != null
                                        ? '  $' + (item.parsed.y as number).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' avg ticket'
                                        : '';
                                }
                                if (item.dataset.label === 'Pronóstico') {
                                    return item.parsed.y != null
                                        ? '  ~$' + (item.parsed.y as number).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' MXN (pronóstico)'
                                        : '';
                                }
                                return item.parsed.y != null
                                    ? '  $' + (item.parsed.y as number).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' MXN'
                                    : '';
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#71717a',
                            font: { size: 10 },
                            maxTicksLimit: many ? 12 : 20,
                            maxRotation: 0,
                        },
                        grid: { color: 'rgba(255,255,255,.04)' },
                    },
                    yRevenue: {
                        position: 'left',
                        beginAtZero: true,
                        ticks: {
                            color: '#fb923c',
                            font: { size: 10 },
                            callback: (v: number | string) => {
                                const n = Number(v);
                                if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
                                if (n >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K';
                                return '$' + n;
                            },
                        },
                        grid: { color: 'rgba(255,255,255,.05)' },
                    },
                    yOrders: {
                        position: 'right',
                        beginAtZero: true,
                        ticks: { color: '#818cf8', font: { size: 10 }, precision: 0 },
                        grid: { drawOnChartArea: false },
                    },
                    yAvgTicket: {
                        // Hidden axis — keeps avg ticket line scaled independently
                        // without cluttering the chart with a 3rd y axis label
                        position: 'left',
                        display: false,
                        beginAtZero: false,
                        grid: { drawOnChartArea: false },
                    },
                },
            },
        } as any);
    }

    // ── Forecast toggle ────────────────────────────────────────────────────────

    toggleForecast() {
        const next = !this.showForecast();
        this.showForecast.set(next);
        if (next) {
            const result = this.computeForecast(this.dailyDocs(), this.priorDocs());
            this.forecastResult.set(result);
        } else {
            this.forecastResult.set(null);
        }
    }

    // ── Forecast engine ────────────────────────────────────────────────────────

    private computeForecast(
        currentDocs: AnalyticsDailyDoc[],
        priorDocs:   AnalyticsDailyDoc[]
    ): ForecastResult {
        const now          = new Date();
        const year         = now.getFullYear();
        const month        = now.getMonth();
        const todayDay     = now.getDate();   // 1-indexed
        const daysInMonth  = new Date(year, month + 1, 0).getDate();

        // ── Build actual-by-day map ────────────────────────────────────────────
        const actualByDay = new Map<number, number>();
        for (const doc of currentDocs) {
            const d = new Date(doc.date + 'T12:00:00').getDate();
            actualByDay.set(d, doc.totalRevenue ?? 0);
        }
        const actualValues = Array.from({ length: todayDay }, (_, i) => actualByDay.get(i + 1) ?? 0);
        const mtdActual    = actualValues.reduce((a, b) => a + b, 0);
        const currentPace  = mtdActual / Math.max(1, todayDay);

        // ── Model 1: Linear Regression ────────────────────────────────────────
        const { slope, intercept } = this._linearRegression(actualValues);
        const lrPredict = (day: number) => Math.max(0, slope * day + intercept);

        // Compute residuals → σ for confidence bands
        const residuals = actualValues.map((v, i) => v - lrPredict(i + 1));
        const variance  = residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, residuals.length);
        const sigma     = Math.sqrt(variance);

        // ── Model 2: Day-of-Week seasonal from prior data ─────────────────────
        const dowSum   = new Array(7).fill(0);
        const dowCount = new Array(7).fill(0);
        for (const doc of priorDocs) {
            const dt  = new Date(doc.date + 'T12:00:00');
            const dow = dt.getDay();
            dowSum[dow]   += doc.totalRevenue ?? 0;
            dowCount[dow] += 1;
        }
        const dowAvg   = dowSum.map((s, i) => dowCount[i] > 0 ? s / dowCount[i] : currentPace);
        const meanDow  = dowAvg.reduce((a, b) => a + b, 0) / 7;
        // Relative weights (1.0 = average day)
        const dowWeight  = dowAvg.map(v => meanDow > 0 ? v / meanDow : 1);
        const dowPredict = (day: number) => {
            const dt  = new Date(year, month, day);
            const dow = dt.getDay();
            return Math.max(0, currentPace * dowWeight[dow]);
        };

        // ── Ensemble: 60% LR trend + 40% DoW seasonal ─────────────────────────
        const predict = (day: number) => 0.60 * lrPredict(day) + 0.40 * dowPredict(day);

        // ── Build output arrays ────────────────────────────────────────────────
        const labels:   string[]            = [];
        const actual:   (number | null)[]   = [];
        const forecast: (number | null)[]   = [];
        const upper:    (number | null)[]   = [];
        const lower:    (number | null)[]   = [];

        let projectedTotal = mtdActual;
        let projLow        = mtdActual;
        let projHigh       = mtdActual;

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            labels.push(date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));

            if (d < todayDay) {
                actual.push(actualByDay.get(d) ?? 0);
                forecast.push(null); upper.push(null); lower.push(null);
            } else if (d === todayDay) {
                // Last actual point is also the start of the forecast (connect the lines)
                const v = actualByDay.get(d) ?? 0;
                actual.push(v);
                forecast.push(v); upper.push(v); lower.push(v);
            } else {
                const p    = predict(d);
                const days = d - todayDay;
                const band = sigma * Math.sqrt(days) * 1.5;  // 1.5σ widening band
                actual.push(null);
                forecast.push(p);
                upper.push(p + band);
                lower.push(Math.max(0, p - band));
                projectedTotal += p;
                projLow        += Math.max(0, p - band);
                projHigh       += (p + band);
            }
        }

        // ── Prior month pace comparison ────────────────────────────────────────
        let priorMtdActual = 0;
        const priorCutoff  = todayDay;
        for (const doc of priorDocs) {
            const d = new Date(doc.date + 'T12:00:00').getDate();
            if (d <= priorCutoff) priorMtdActual += doc.totalRevenue ?? 0;
        }
        const paceVsPrior = priorMtdActual > 0
            ? ((mtdActual - priorMtdActual) / priorMtdActual) * 100
            : null;

        // ── Pace progress (actual vs expected linear share of projected) ────────
        const expectedByNow = projectedTotal * (todayDay / daysInMonth);
        const paceProgress  = expectedByNow > 0 ? mtdActual / expectedByNow : 1;

        // ── Best future days ───────────────────────────────────────────────────
        const DOW_KEYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const futurePredictions: Array<{ label: string; predicted: number; dowKey: string }> = [];
        for (let d = todayDay + 1; d <= daysInMonth; d++) {
            const dt   = new Date(year, month, d);
            const pred = 0.60 * lrPredict(d) + 0.40 * (currentPace * dowWeight[dt.getDay()]);
            futurePredictions.push({
                label:     dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }),
                predicted: pred,
                dowKey:    DOW_KEYS[dt.getDay()],
            });
        }
        const bestFutureDays = futurePredictions
            .sort((a, b) => b.predicted - a.predicted)
            .slice(0, 3);

        // ── Calendar days ──────────────────────────────────────────────────────
        const allValues = [
            ...actualValues,
            ...futurePredictions.map(x => x.predicted),
        ];
        const maxVal = Math.max(...allValues, 1);

        const monthOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0 offset
        const calendarDays: CalendarDay[] = [
            // padding cells before the 1st
            ...Array.from({ length: monthOffset }, (_, i) => ({
                day: 0, label: '', isActual: false, isToday: false, isFuture: false,
                isEmpty: true, value: 0, valueFmt: '', intensity: 0,
                dow: i, dowKey: DOW_KEYS[(i + 1) % 7],
            })),
        ];
        for (let d = 1; d <= daysInMonth; d++) {
            const dt        = new Date(year, month, d);
            const dow       = dt.getDay();
            const isToday   = d === todayDay;
            const isActual  = d <= todayDay;
            const isFuture  = d > todayDay;
            const value     = isActual
                ? (actualByDay.get(d) ?? 0)
                : (0.60 * lrPredict(d) + 0.40 * (currentPace * dowWeight[dow]));
            const intensity = value / maxVal;
            calendarDays.push({
                day: d,
                label: dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
                isActual, isToday, isFuture, isEmpty: false,
                value, intensity,
                valueFmt: this.fmtMoney(value),
                dow, dowKey: DOW_KEYS[dow],
            });
        }

        return {
            labels, actual, forecast, upper, lower, calendarDays,
            summary: {
                mtdActual, projected: projectedTotal,
                low: projLow, high: projHigh,
                currentPace, daysIn: todayDay, daysLeft: daysInMonth - todayDay,
                paceVsPrior, slope, paceProgress, bestFutureDays,
            },
        };
    }

    private _linearRegression(y: number[]): { slope: number; intercept: number } {
        const n = y.length;
        if (n < 2) return { slope: 0, intercept: y[0] ?? 0 };
        const x     = Array.from({ length: n }, (_, i) => i + 1);
        const sumX  = x.reduce((a, b) => a + b, 0);
        const sumY  = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        return { slope, intercept };
    }

    fmtMoney(n: number): string {
        if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
        if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
        return '$' + Math.round(n).toLocaleString('es-MX');
    }

    capAt(value: number, max: number): number {
        return Math.min(value, max);
    }

    sparkBarH(v: number): number {
        const maxBar = Math.max(...this.abandonSparkline(), 1);
        return (v / maxBar) * 28;
    }

    ngOnDestroy() {
        this.trendChart?.destroy();
    }

    // ── Formatting helpers ────────────────────────────────────────────────────

    formatDelta(delta: number | null): string {
        if (delta === null) return '—';
        const sign = delta >= 0 ? '+' : '';
        return `${sign}${delta.toFixed(1)}%`;
    }
    isDeltaPositive(delta: number | null): boolean { return delta !== null && delta > 0; }
    isDeltaNegative(delta: number | null): boolean { return delta !== null && delta < 0; }

    private _mkKey(d: Date): string {
        return d.toLocaleDateString('sv-SE').slice(0, 7);
    }

    _fmtPeriod(key: string): string {
        const parts = key.split('-');
        const y = Number(parts[0]);
        const mo = Number(parts[1]) - 1;
        return new Date(y, mo, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    }

    private _fmtMoney(n: number): string {
        if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
        if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
        return '$' + Math.round(n).toLocaleString('es-MX');
    }

    // ── Backfill ──────────────────────────────────────────────────────────────

    /** Re-syncs the last 5 days into BigQuery (delete + re-insert).
     *  Fixes BQ data gaps without touching older historical data. */
    async runSyncRecent() {
        if (this.isSyncingRecent()) return;
        this.isSyncingRecent.set(true);
        this.syncRecentResult.set(null);
        try {
            const fn = httpsCallable<
                { fromDate?: string; deleteFirst?: boolean },
                { ordersWritten: number; itemsWritten: number; dataset: string }
            >(this.fns, 'backfillOrdersToBigQuery');
            const from = new Date();
            from.setDate(from.getDate() - 5);
            const fromDate = from.toISOString().slice(0, 10);  // YYYY-MM-DD
            const res = await fn({ fromDate, deleteFirst: true });
            this.syncRecentResult.set(res.data);
            await this.load();
        } catch (e) {
            console.error('[MetricsHub] Sync recent (BQ) failed:', e);
        } finally {
            this.isSyncingRecent.set(false);
        }
    }

    async runBackfill() {
        if (this.isBackfilling()) return;
        this.isBackfilling.set(true);
        this.backfillResult.set(null);
        try {
            const fn = httpsCallable<
                { fromDate?: string },
                { daysProcessed: number; writeCount: number }
            >(this.fns, 'backfillAnalytics');
            const res = await fn({});
            this.backfillResult.set(res.data);
            await this.load();
        } catch (e) {
            console.error('[MetricsHub] Backfill failed:', e);
        } finally {
            this.isBackfilling.set(false);
        }
    }
}
