import {
    Component, OnInit, OnDestroy, OnChanges, SimpleChanges,
    inject, signal, computed, Input, ElementRef, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { isRevenueOrder } from '../../../../core/models/order.model';

Chart.register(...registerables);

export type DashTimeframe = 'MTD' | 'PAST_MONTH' | 'YTD';

interface DayBucket { label: string; sessions: number; orders: number; }
interface SourceBucket { source: string; count: number; }

export interface HeatCell {
    dateKey:   string;    // YYYY-MM-DD
    orders:    number;
    revenue:   number;
    intensity: 0 | 1 | 2 | 3 | 4;
    tooltip:   string;
    bgColor?:  string;    // rgba string used in compare mode
}
export interface HeatWeek {
    weekKey:    string;
    monthLabel: string;
    days:       HeatCell[];
}
export interface HeatMonth {
    label:        string;
    yearMonth:    string;
    days:         HeatCell[];
    offset:       null[];
    totalOrders:  number;
    totalRevenue: number;
}
export interface HeatMonthSummary {
    label:    string;
    orders:   number;
    revenue:  number;
    bgColor:  string;
    tooltip:  string;
}
export interface HeatRow {
    channel:      string;
    rgb:          string;
    totalOrders:  number;
    totalRevenue: number;
    weeks:        HeatWeek[];
    monthSummary: HeatMonthSummary[];
}
export interface HeatDayCellData {
    dateKey: string;
    orders:  number;
    revenue: number;
    bgColor: string;
    tooltip: string;
}
export interface HeatDayRow {
    channel:      string;
    rgb:          string;
    totalOrders:  number;
    totalRevenue: number;
    cells:        HeatDayCellData[];
}
export interface HeatDayHeader {
    dateKey:   string;
    dayNum:    number;
    dow:       string;       // 'Lun', 'Mar'...
    isWeekend: boolean;
}
export interface HeatHourCell {
    hour:    number;   // 0-23
    orders:  number;
    revenue: number;
    bgColor: string;
    tooltip: string;
}
export interface HeatHourRow {
    channel:     string;
    rgb:         string;
    totalOrders: number;
    cells:       HeatHourCell[]; // exactly 24 items
}
export interface HeatDayHourCell {
    dow:     number;   // 0=Mon … 6=Sun
    hour:    number;   // 0-23
    orders:  number;
    revenue: number;
    bgColor: string;
    tooltip: string;
}
export interface HeatDayHourRow {
    channel:     string;
    rgb:         string;
    totalOrders: number;
    /** 7 rows (Mon–Sun) × 24 cols (0h–23h) */
    grid:        HeatDayHourCell[][];
}

/** Per-channel RGB values (r,g,b) for rgba() */
const CHANNEL_COLORS: Record<string, string> = {
    'Directo':              '107,114,128',  // gray-500
    'Google':               '59,130,246',   // blue-500
    'Meta':                 '99,102,241',   // indigo-500
    'Meta-AI':              '139,92,246',   // violet-500
    'TikTok':               '236,72,153',   // pink-500
    'YouTube':              '239,68,68',    // red-500
    'Email':                '245,158,11',   // amber-500
    'WhatsApp':             '34,197,94',    // green-500
    'MercadoLibre':         '234,179,8',    // yellow-500
    'MercadoLibre Full':    '234,88,12',    // orange-600
    'MercadoLibre Flex':    '251,146,60',   // orange-400
    'MercadoLibre Classic': '161,98,7',     // amber-700/gold
    'Amazon':               '234,88,12',    // orange
    'POS':                  '16,185,129',   // emerald-500
    'On-Behalf':            '168,85,247',   // purple-500
};
const DEFAULT_RGB = '107,114,128';

@Component({
    selector: 'app-marketing-charts',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, RouterModule, TranslateModule],
    templateUrl: './marketing-charts.component.html',
    styleUrls: ['./marketing-charts.component.css'],
})
export class MarketingChartsComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
    @Input() timeframe: DashTimeframe = 'MTD';

    @ViewChild('mixCanvas')      mixCanvas!:      ElementRef<HTMLCanvasElement>;
    @ViewChild('trendCanvas')    trendCanvas!:    ElementRef<HTMLCanvasElement>;
    @ViewChild('sessionCanvas')  sessionCanvas!:  ElementRef<HTMLCanvasElement>;

    private fs = inject(Firestore);
    private mixChart?:     Chart;
    private trendChart?:   Chart;
    private sessionChart?: Chart;
    private viewReady = false;

    isLoading = signal(true);
    noData    = signal(false);

    // ── Heatmap state ──────────────────────────────────────────────────────
    heatmapMode        = signal<'compare' | 'single'>('compare');
    heatmapView        = signal<'daily' | 'weekly' | 'monthly' | 'hourly' | 'dayhour'>('daily');
    heatmapWeeks       = signal<HeatWeek[]>([]);
    heatmapMonths      = signal<HeatMonth[]>([]);
    heatmapChannel     = signal<string>('all');
    heatmapChannels    = signal<string[]>([]);
    channelRows        = signal<HeatRow[]>([]);
    channelDayRows     = signal<HeatDayRow[]>([]);
    heatmapDayHeaders  = signal<HeatDayHeader[]>([]);
    channelHourRows         = signal<HeatHourRow[]>([]);
    channelDayHourRows      = signal<HeatDayHourRow[]>([]);
    expandedDayHourChannels = signal<string[]>([]);
    /** Static 0–23 array used in template ngFor for hour column headers */
    readonly hourHeaders = Array.from({ length: 24 }, (_, i) => i);
    /** Spanish single-letter DOW labels Mon–Sun */
    readonly dowLabels = ['L', 'Ma', 'Mi', 'J', 'V', 'Sa', 'D'];
    private lastOrderDocs: any[] = [];

    setHeatmapMode(m: 'compare' | 'single') { this.heatmapMode.set(m); }
    setHeatmapView(v: 'daily' | 'weekly' | 'monthly' | 'hourly' | 'dayhour') { this.heatmapView.set(v); }
    setHeatmapChannel(ch: string) {
        this.heatmapChannel.set(ch);
        this.computeHeatmap(this.lastOrderDocs);
    }
    toggleDayHourChannel(ch: string): void {
        const cur = this.expandedDayHourChannels();
        this.expandedDayHourChannels.set(
            cur.includes(ch) ? cur.filter(c => c !== ch) : [...cur, ch]
        );
    }
    isChannelExpanded(ch: string): boolean {
        return this.expandedDayHourChannels().includes(ch);
    }

    ngOnInit() {
        // MTD / PAST_MONTH → day-per-column view by default; YTD → weekly
        this.heatmapView.set(this.timeframe === 'YTD' ? 'weekly' : 'daily');
        this.loadAndRender();
    }
    ngAfterViewInit() { this.viewReady = true; }
    ngOnChanges(c: SimpleChanges) {
        if (c['timeframe'] && !c['timeframe'].firstChange) {
            this.heatmapView.set(this.timeframe === 'YTD' ? 'weekly' : 'daily');
            this.loadAndRender();
        }
    }
    ngOnDestroy() {
        this.mixChart?.destroy();
        this.trendChart?.destroy();
        this.sessionChart?.destroy();
    }

    private dateRange(): [Date, Date] {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        switch (this.timeframe) {
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59)];
            case 'YTD':        return [new Date(y, 0, 1), now];
        }
    }

    private async loadAndRender() {
        this.isLoading.set(true);
        const [from, to] = this.dateRange();

        try {
            const [snapsSnap, ordersSnap] = await Promise.all([
                getDocs(query(
                    collection(this.fs, 'cartSnapshots'),
                    where('createdAt', '>=', Timestamp.fromDate(from)),
                    where('createdAt', '<=', Timestamp.fromDate(to)),
                    orderBy('createdAt', 'asc'),
                )),
                getDocs(query(
                    collection(this.fs, 'orders'),
                    where('createdAt', '>=', Timestamp.fromDate(from)),
                    where('createdAt', '<=', Timestamp.fromDate(to)),
                    orderBy('createdAt', 'asc'),
                )),
            ]);

            if (snapsSnap.empty && ordersSnap.empty) {
                this.noData.set(true);
                this.isLoading.set(false);
                return;
            }
            this.noData.set(false);

            // ── Revenue-only orders: exclude ghost/void statuses system-wide ──
            // NON_REVENUE_STATUSES: pending_payment, payment_failed, cancelled, refunded, returned
            const revenueOrderDocs = ordersSnap.docs.filter(doc =>
                isRevenueOrder(doc.data()['status'])
            );

            // ── Source map (channel mix) ─────────────────────────────────────
            const sourceMap = new Map<string, number>();
            const sessionsByDay = new Map<string, Set<string>>();

            for (const doc of snapsSnap.docs) {
                const d = doc.data() as any;
                const rawSrc = d.attribution?.utm?.utm_source
                          ?? d.attribution?.referrerDomain
                          ?? 'direct';
                const src = this.normalizeSource(rawSrc);
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);

                // bucket sessions by day
                if (d.sessionId && d.createdAt) {
                    const day = this.toMxKey(d.createdAt.toDate());
                    if (!sessionsByDay.has(day)) sessionsByDay.set(day, new Set());
                    sessionsByDay.get(day)!.add(d.sessionId);
                }
            }

            // ── Orders by day + channel mix from orders (includes ML, POS) ───
            const ordersByDay = new Map<string, number>();
            for (const doc of revenueOrderDocs) {
                const d = doc.data() as any;
                if (d.createdAt) {
                    const day = this.toMxKey(d.createdAt.toDate());
                    ordersByDay.set(day, (ordersByDay.get(day) ?? 0) + 1);
                }
                // Merge resolved channel into sourceMap so Channel Mix includes all orders
                const ch = this.normalizeSource(this.resolveChannel(d));
                sourceMap.set(ch, (sourceMap.get(ch) ?? 0) + 1);
            }

            // ── Build sorted day labels ──────────────────────────────────────
            const allDays = [...new Set([...sessionsByDay.keys(), ...ordersByDay.keys()])].sort();
            const dayLabels = allDays.map(d => {
                const dt = new Date(d + 'T12:00:00');
                return dt.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
            });

            const sessionData = allDays.map(d => sessionsByDay.get(d)?.size ?? 0);
            const orderData   = allDays.map(d => ordersByDay.get(d) ?? 0);

            // ── Top 8 sources ────────────────────────────────────────────────
            const topSources = [...sourceMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8);

            // Reveal the canvas containers FIRST so Angular renders *ngIf blocks,
            // then wait one microtask for the DOM to actually paint before drawing.
            this.isLoading.set(false);
            await new Promise(r => setTimeout(r, 60));

            this.renderMixChart(topSources);
            this.renderTrendChart(dayLabels, orderData);
            this.renderSessionChart(dayLabels, sessionData);
            // Pass revenue-only orders to heatmap — ghost orders excluded
            this.computeHeatmap(revenueOrderDocs);

        } catch (e) {
            console.error('[MarketingCharts] load error:', e);
            this.isLoading.set(false);
        }
    }

    private renderMixChart(sources: [string, number][]) {
        this.mixChart?.destroy();
        const ctx = this.mixCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;
        const COLORS = ['#6366f1','#8b5cf6','#a78bfa','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899'];
        this.mixChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: sources.map(([s]) => s),
                datasets: [{ data: sources.map(([,n]) => n), backgroundColor: COLORS, borderWidth: 2, borderColor: '#18181b' }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#a1a1aa', font: { size: 11 }, padding: 12, boxWidth: 12 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
                },
                cutout: '65%',
            },
        });
    }

    private renderTrendChart(labels: string[], orders: number[]) {
        this.trendChart?.destroy();
        const ctx = this.trendCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(99,102,241,.35)');
        gradient.addColorStop(1, 'rgba(99,102,241,.01)');
        this.trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Orders',
                    data: orders,
                    borderColor: '#6366f1',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: labels.length > 30 ? 0 : 3,
                    pointBackgroundColor: '#6366f1',
                    tension: 0.4,
                    fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,.04)' } },
                    y: { ticks: { color: '#71717a', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
                },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Orders: ${ctx.parsed.y}` } } },
            },
        });
    }

    private renderSessionChart(labels: string[], sessions: number[]) {
        this.sessionChart?.destroy();
        const ctx = this.sessionCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(139,92,246,.35)');
        gradient.addColorStop(1, 'rgba(139,92,246,.01)');
        this.sessionChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Sessions',
                    data: sessions,
                    borderColor: '#8b5cf6',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: labels.length > 30 ? 0 : 3,
                    pointBackgroundColor: '#8b5cf6',
                    tension: 0.4,
                    fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,.04)' } },
                    y: { ticks: { color: '#71717a', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
                },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Sessions: ${ctx.parsed.y}` } } },
            },
        });
    }

    // ── Heatmap engine ─────────────────────────────────────────────────────

    private computeHeatmap(docs: any[]) {
        this.lastOrderDocs = docs;
        const today = new Date();

        // ── Shared date range — all views use these same bounds ────────────
        const [from, to] = this.dateRange();
        const fromDow    = (from.getDay() + 6) % 7;
        const weekStart  = new Date(from);
        weekStart.setDate(from.getDate() - fromDow);
        const toDow     = (to.getDay() + 6) % 7;
        const weekEnd   = new Date(to);
        weekEnd.setDate(to.getDate() + (6 - toDow));

        /** Build ordered week columns between weekStart..weekEnd */
        const buildWeeks = (makeCellFn: (key: string, inRange: boolean) => HeatCell): HeatWeek[] => {
            const weeks: HeatWeek[] = [];
            let prevMonth = '';
            let cur = new Date(weekStart);
            while (cur <= weekEnd) {
                const days: HeatCell[] = [];
                let monthLabel = '';
                for (let d = 0; d < 7; d++) {
                    const key = this.toMxKey(cur);
                    const m   = cur.toLocaleDateString('es-MX', { month: 'short' });
                    if (d === 0 && m !== prevMonth) { monthLabel = m; prevMonth = m; }
                    const inRange = cur >= from && cur <= to && cur <= today;
                    days.push(makeCellFn(key, inRange));
                    cur.setDate(cur.getDate() + 1);
                }
                weeks.push({ weekKey: days[0].dateKey, monthLabel, days });
            }
            return weeks;
        };

        /** Get ordered month labels within the date range (up to 12) */
        const getMonthRange = (): Array<{ y: number; m: number; ym: string; label: string }> => {
            const result = [];
            const startM = new Date(from.getFullYear(), from.getMonth(), 1);
            const nowM   = new Date(today.getFullYear(), today.getMonth(), 1);
            let mCur = new Date(startM);
            while (mCur <= nowM && result.length < 12) {
                const y = mCur.getFullYear(), m = mCur.getMonth();
                result.push({
                    y, m,
                    ym:    `${y}-${String(m + 1).padStart(2, '0')}`,
                    label: mCur.toLocaleDateString('es-MX', { month: 'short' }),
                });
                mCur.setMonth(mCur.getMonth() + 1);
            }
            return result;
        };

        // ── Extract unique channels ───────────────────────────────────────
        const channelSet = new Set<string>();
        for (const doc of docs) {
            const ch = this.normalizeSource(this.resolveChannel(doc.data()));
            if (ch) channelSet.add(ch);
        }
        this.heatmapChannels.set(['all', ...Array.from(channelSet).sort()]);

        // ── Single mode — filter docs by selected channel ─────────────────
        const selectedCh = this.heatmapChannel();
        const filtered = selectedCh === 'all'
            ? docs
            : docs.filter(doc => this.normalizeSource(this.resolveChannel(doc.data())) === selectedCh);

        const singleDayMap = new Map<string, { orders: number; revenue: number }>();
        for (const doc of filtered) {
            const d = doc.data();
            if (!d.createdAt) continue;
            const key = this.toMxKey(d.createdAt.toDate());
            const cur = singleDayMap.get(key) ?? { orders: 0, revenue: 0 };
            singleDayMap.set(key, {
                orders:  cur.orders + 1,
                revenue: cur.revenue + (d.total || d.totalAmount || 0),
            });
        }
        const singleMax = Math.max(1, ...[...singleDayMap.values()].map(v => v.orders));
        const toIntensity = (orders: number, max: number): 0 | 1 | 2 | 3 | 4 => {
            if (orders === 0) return 0;
            const p = orders / max;
            return p < 0.25 ? 1 : p < 0.50 ? 2 : p < 0.75 ? 3 : 4;
        };
        const makeSingleCell = (key: string, inRange: boolean): HeatCell => {
            const v  = inRange ? singleDayMap.get(key) : undefined;
            const n  = v?.orders ?? 0;
            const rv = v?.revenue ?? 0;
            const dt = new Date(key + 'T12:00:00');
            const lbl = dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
            const revStr = rv > 0 ? ` · $${rv.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
            return {
                dateKey: key, orders: n, revenue: rv,
                intensity: (inRange && dt <= today) ? toIntensity(n, singleMax) : 0,
                tooltip: n > 0 ? `${lbl}: ${n} orden${n > 1 ? 'es' : ''}${revStr}` : lbl,
            };
        };
        this.heatmapWeeks.set(buildWeeks(makeSingleCell));

        // Monthly single view
        const months: HeatMonth[] = [];
        for (const { y, m, ym, label } of getMonthRange()) {
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            const firstDOW   = (new Date(y, m, 1).getDay() + 6) % 7;
            let totalOrders = 0, totalRevenue = 0;
            const dayCells: HeatCell[] = [];
            for (let day = 1; day <= daysInMonth; day++) {
                const key  = `${ym}-${String(day).padStart(2, '0')}`;
                const dt   = new Date(key + 'T12:00:00');
                const cell = dt > today
                    ? { dateKey: key, orders: 0, revenue: 0, intensity: 0 as const, tooltip: key }
                    : makeSingleCell(key, true);
                dayCells.push(cell);
                totalOrders  += cell.orders;
                totalRevenue += cell.revenue;
            }
            months.push({
                label: new Date(y, m, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                yearMonth: ym, days: dayCells,
                offset: Array(firstDOW).fill(null),
                totalOrders, totalRevenue,
            });
        }
        this.heatmapMonths.set(months);

        // ── Compare mode — build one HeatRow per channel ─────────────────
        // Each channel is normalized to ITS OWN maximum (research-backed:
        // prevents dominant channels from washing out smaller ones).
        const monthRange = getMonthRange();
        const channelRowsData: HeatRow[] = [];

        for (const ch of Array.from(channelSet).sort()) {
            const rgb   = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const chDocs = docs.filter(doc =>
                this.normalizeSource(this.resolveChannel(doc.data())) === ch
            );

            // Channel day map
            const chDayMap = new Map<string, { orders: number; revenue: number }>();
            let chTotal = 0, chRevenue = 0;
            for (const doc of chDocs) {
                const d = doc.data();
                if (!d.createdAt) continue;
                const key = this.toMxKey(d.createdAt.toDate());
                const cur = chDayMap.get(key) ?? { orders: 0, revenue: 0 };
                const rev = (d.total || d.totalAmount || 0);
                chDayMap.set(key, { orders: cur.orders + 1, revenue: cur.revenue + rev });
                chTotal++; chRevenue += rev;
            }
            const chMax = Math.max(1, ...[...chDayMap.values()].map(v => v.orders));

            // Per-channel bgColor: channel hue at 4 alpha levels
            const bgColorFor = (orders: number, inRange: boolean, dt: Date): string => {
                if (!inRange || dt > today || orders === 0) return 'rgba(255,255,255,.05)';
                const p = orders / chMax;
                const a = p < 0.25 ? .22 : p < 0.50 ? .48 : p < 0.75 ? .74 : 1;
                return `rgba(${rgb},${a})`;
            };

            const makeChCell = (key: string, inRange: boolean): HeatCell => {
                const v   = inRange ? chDayMap.get(key) : undefined;
                const n   = v?.orders ?? 0;
                const rv  = v?.revenue ?? 0;
                const dt  = new Date(key + 'T12:00:00');
                const lbl = dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
                const rvStr = rv > 0 ? ` · $${rv.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
                return {
                    dateKey: key, orders: n, revenue: rv, intensity: 0,
                    bgColor:  bgColorFor(n, inRange, dt),
                    tooltip:  n > 0 ? `${lbl}: ${n} ord${n > 1 ? 's' : ''}${rvStr}` : lbl,
                };
            };

            // Weekly rows for this channel
            const chWeeks = buildWeeks(makeChCell);

            // Monthly summary: 1 block per month, order count inside
            const chMonthMax = Math.max(1,
                ...monthRange.map(({ ym, y, m }) => {
                    const daysInMonth = new Date(y, m + 1, 0).getDate();
                    let total = 0;
                    for (let day = 1; day <= daysInMonth; day++) {
                        total += chDayMap.get(`${ym}-${String(day).padStart(2, '0')}`)?.orders ?? 0;
                    }
                    return total;
                })
            );
            const monthSummary: HeatMonthSummary[] = monthRange.map(({ y, m, ym, label }) => {
                const daysInMonth = new Date(y, m + 1, 0).getDate();
                let mOrders = 0, mRevenue = 0;
                for (let day = 1; day <= daysInMonth; day++) {
                    const v = chDayMap.get(`${ym}-${String(day).padStart(2, '0')}`);
                    mOrders  += v?.orders  ?? 0;
                    mRevenue += v?.revenue ?? 0;
                }
                const p    = mOrders / chMonthMax;
                const a    = mOrders === 0 ? 0 : p < 0.25 ? .22 : p < 0.50 ? .48 : p < 0.75 ? .74 : 1;
                const bgColor = mOrders === 0 ? 'rgba(255,255,255,.05)' : `rgba(${rgb},${a})`;
                const revStr  = mRevenue > 0 ? ` · $${mRevenue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
                return {
                    label, orders: mOrders, revenue: mRevenue, bgColor,
                    tooltip: mOrders > 0
                        ? `${ym}: ${mOrders} órdenes${revStr}`
                        : ym,
                };
            });

            channelRowsData.push({ channel: ch, rgb, totalOrders: chTotal, totalRevenue: chRevenue, weeks: chWeeks, monthSummary });
        }

        // Sort by total orders descending (highest-volume channels at top)
        this.channelRows.set(channelRowsData.sort((a, b) => b.totalOrders - a.totalOrders));

        // ── Daily compare: one column per calendar day in [from..today] ────
        // Builds day headers shared by all channel rows.
        const dayHeaders: HeatDayHeader[] = [];
        let dCur = new Date(from);
        while (dCur <= to && dCur <= today) {
            const key  = this.toMxKey(dCur);
            const dow0 = (dCur.getDay() + 6) % 7; // 0=Mon..6=Sun
            dayHeaders.push({
                dateKey:   key,
                dayNum:    dCur.getDate(),
                dow:       dCur.toLocaleDateString('es-MX', { weekday: 'short' }),
                isWeekend: dow0 >= 5,
            });
            dCur.setDate(dCur.getDate() + 1);
        }
        this.heatmapDayHeaders.set(dayHeaders);

        const channelDayRowsData: HeatDayRow[] = [];
        for (const ch of Array.from(channelSet).sort()) {
            const rgb    = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const chDocs = docs.filter(doc =>
                this.normalizeSource(this.resolveChannel(doc.data())) === ch
            );
            // Build this channel's day map
            const cDayMap = new Map<string, { orders: number; revenue: number }>();
            let cTotal = 0, cRevenue = 0;
            for (const doc of chDocs) {
                const d = doc.data();
                if (!d.createdAt) continue;
                const key = this.toMxKey(d.createdAt.toDate());
                const cur = cDayMap.get(key) ?? { orders: 0, revenue: 0 };
                const rev = (d.total || d.totalAmount || 0);
                cDayMap.set(key, { orders: cur.orders + 1, revenue: cur.revenue + rev });
                cTotal++; cRevenue += rev;
            }
            const cMax = Math.max(1, ...[...cDayMap.values()].map(v => v.orders));

            const cells: HeatDayCellData[] = dayHeaders.map(({ dateKey }) => {
                const v   = cDayMap.get(dateKey);
                const n   = v?.orders  ?? 0;
                const rv  = v?.revenue ?? 0;
                const p   = n / cMax;
                const a   = n === 0 ? 0 : p < 0.25 ? .20 : p < 0.50 ? .45 : p < 0.75 ? .72 : 1;
                const bgColor = n === 0 ? 'rgba(255,255,255,.05)' : `rgba(${rgb},${a})`;
                const dt  = new Date(dateKey + 'T12:00:00');
                const lbl = dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
                const rvStr = rv > 0 ? ` · $${rv.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
                return {
                    dateKey, orders: n, revenue: rv, bgColor,
                    tooltip: n > 0 ? `${lbl}: ${n} orden${n > 1 ? 'es' : ''}${rvStr}` : lbl,
                };
            });
            channelDayRowsData.push({ channel: ch, rgb, totalOrders: cTotal, totalRevenue: cRevenue, cells });
        }
        this.channelDayRows.set(channelDayRowsData.sort((a, b) => b.totalOrders - a.totalOrders));

        // ── Hourly compare: 24 columns (0h–23h), one row per channel ──────
        // Aggregates ALL orders in the period by hour-of-day in MX timezone.
        // Answers: "Does ML Full peak in the morning vs ML Classic in the evening?"
        const channelHourRowsData: HeatHourRow[] = [];
        for (const ch of Array.from(channelSet).sort()) {
            const rgb   = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const chDocs = docs.filter(doc =>
                this.normalizeSource(this.resolveChannel(doc.data())) === ch
            );
            // Bucket by hour 0-23 in America/Mexico_City
            const hourBuckets: { orders: number; revenue: number }[] =
                Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0 }));
            let hTotal = 0;
            for (const doc of chDocs) {
                const d = doc.data();
                if (!d.createdAt) continue;
                const h   = this.toMxHour(d.createdAt.toDate());
                const rev = (d.total || d.totalAmount || 0);
                hourBuckets[h].orders++;
                hourBuckets[h].revenue += rev;
                hTotal++;
            }
            const hMax = Math.max(1, ...hourBuckets.map(b => b.orders));

            const cells: HeatHourCell[] = hourBuckets.map((b, h) => {
                const p   = b.orders / hMax;
                const a   = b.orders === 0 ? 0 : p < 0.25 ? .20 : p < 0.50 ? .45 : p < 0.75 ? .72 : 1;
                const bgColor = b.orders === 0 ? 'rgba(255,255,255,.05)' : `rgba(${rgb},${a})`;
                const hr  = `${String(h).padStart(2, '0')}:00`;
                const rvStr = b.revenue > 0 ? ` · $${b.revenue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
                return {
                    hour: h, orders: b.orders, revenue: b.revenue, bgColor,
                    tooltip: b.orders > 0 ? `${hr}: ${b.orders} orden${b.orders > 1 ? 'es' : ''}${rvStr}` : hr,
                };
            });
            channelHourRowsData.push({ channel: ch, rgb, totalOrders: hTotal, cells });
        }
        this.channelHourRows.set(channelHourRowsData.sort((a, b) => b.totalOrders - a.totalOrders));

        // ── Day × Hour grid: 7 rows (Mon–Sun) × 24 cols (0h–23h), one accordion per channel ──
        const channelDayHourRowsData: HeatDayHourRow[] = [];
        for (const ch of Array.from(channelSet).sort()) {
            const rgb    = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const chDocs = docs.filter(doc =>
                this.normalizeSource(this.resolveChannel(doc.data())) === ch
            );
            // Build 7×24 matrix indexed [dow 0=Mon][hour]
            const matrix: { orders: number; revenue: number }[][] =
                Array.from({ length: 7 }, () =>
                    Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0 }))
                );
            let dhTotal = 0;
            for (const doc of chDocs) {
                const d   = doc.data();
                if (!d.createdAt) continue;
                const dt  = d.createdAt.toDate();
                const dow = this.toMxDow(dt);
                const h   = this.toMxHour(dt);
                const rev = (d.total || d.totalAmount || 0);
                matrix[dow][h].orders++;
                matrix[dow][h].revenue += rev;
                dhTotal++;
            }
            const matMax = Math.max(1, ...matrix.flat().map(c => c.orders));
            const DOW_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

            const grid: HeatDayHourCell[][] = matrix.map((row, dow) =>
                row.map((cell, h) => {
                    const p   = cell.orders / matMax;
                    const a   = cell.orders === 0 ? 0 : p < 0.25 ? .20 : p < 0.50 ? .45 : p < 0.75 ? .72 : 1;
                    const bgColor = cell.orders === 0 ? 'rgba(255,255,255,.05)' : `rgba(${rgb},${a})`;
                    const hr  = `${String(h).padStart(2, '0')}:00`;
                    const rvStr = cell.revenue > 0
                        ? ` · $${cell.revenue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN` : '';
                    return {
                        dow, hour: h,
                        orders: cell.orders, revenue: cell.revenue, bgColor,
                        tooltip: cell.orders > 0
                            ? `${DOW_NAMES[dow]} ${hr}: ${cell.orders} orden${cell.orders > 1 ? 'es' : ''}${rvStr}`
                            : `${DOW_NAMES[dow]} ${hr}`,
                    };
                })
            );
            channelDayHourRowsData.push({ channel: ch, rgb, totalOrders: dhTotal, grid });
        }
        this.channelDayHourRows.set(channelDayHourRowsData.sort((a, b) => b.totalOrders - a.totalOrders));
    }

    /**
     * Returns YYYY-MM-DD in America/Mexico_City (UTC-6/UTC-5 DST).
     * Using toISOString() would give UTC, causing orders placed after
     * 6 PM CST to appear under the NEXT calendar day — fixed here.
     */
    private toMxKey(d: Date): string {
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    }

    /**
     * Extracts the hour (0–23) from a Date in America/Mexico_City.
     * Avoids browser-timezone drift so an 11 PM CST order is correctly
     * counted under hour 23, not hour 5 (UTC) of the next day.
     */
    private toMxHour(d: Date): number {
        const h = parseInt(
            new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Mexico_City',
                hour: '2-digit',
                hour12: false,
            }).format(d),
            10
        );
        return h === 24 ? 0 : h; // normalize midnight edge-case
    }

    /**
     * Returns day-of-week in America/Mexico_City, 0=Monday … 6=Sunday.
     * Uses Intl to avoid browser-local getDay() which would give UTC-based DOW.
     */
    private toMxDow(d: Date): number {
        const short = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Mexico_City',
            weekday: 'short',
        }).format(d); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
        const map: Record<string, number> = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
        return map[short] ?? 0;
    }

    /** Mirrors attribution-report.service channel resolution */
    private resolveChannel(d: any): string {
        const sc = d.sourceChannel;
        if (sc === 'mercadolibre') {
            if (d.fulfillmentType === 'platform') return 'MercadoLibre Full';
            if (d.fulfillmentType === 'flex')     return 'MercadoLibre Flex';
            return 'MercadoLibre Classic';
        }
        if (sc === 'on_behalf') return d.metadata?.source ?? 'On-Behalf';
        if (sc === 'pos')       return 'POS';
        if (sc === 'amazon')    return 'Amazon';
        return d.attribution?.utm?.utm_source
            ?? d.attribution?.referrerDomain
            ?? (d.channel === 'MELI_CLASSIC' ? 'MercadoLibre Classic' : 'direct');
    }
    /** Collapses known aliases into canonical channel names */
    private normalizeSource(raw: string): string {
        if (!raw || raw === 'direct') return 'Directo';
        // ⚠️ Canonical names MUST be checked first — before any generic .includes() tests,
        // because e.g. 'MercadoLibre Full'.toLowerCase() contains 'mercadolibre'
        // and would be wrongly collapsed to 'MercadoLibre' otherwise.
        if (['MercadoLibre Full', 'MercadoLibre Flex', 'MercadoLibre Classic',
             'POS', 'On-Behalf', 'Amazon'].includes(raw)) return raw;
        const s = raw.toLowerCase();
        // Google family
        if (s.includes('google') || s.includes('googlesyndication') || s.includes('googleadservices') || s.includes('doubleclick')) return 'Google';
        // Meta / Facebook
        if (s.includes('facebook') || s.includes('instagram') || s.includes('fb.com') || s.includes('meta')) return 'Meta';
        // Other social
        if (s.includes('tiktok') || s.includes('musical.ly')) return 'TikTok';
        if (s.includes('youtube')) return 'YouTube';
        if (s.includes('twitter') || s.includes('t.co')) return 'Twitter';
        // Ecommerce (generic fallback — only reached if not Full/Flex/Classic above)
        if (s.includes('mercadolibre') || s.includes('mercadopago') || s.includes('meli')) return 'MercadoLibre';
        if (s.includes('amazon')) return 'Amazon';
        // Email
        if (s.includes('email') || s.includes('newsletter') || s.includes('mailchimp') || s.includes('sendgrid')) return 'Email';
        // WhatsApp
        if (s.includes('whatsapp') || s.includes('wa.me')) return 'WhatsApp';
        return raw;
    }
}
