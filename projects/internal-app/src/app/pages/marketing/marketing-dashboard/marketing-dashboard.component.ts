import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where,
    orderBy, getDocs, Timestamp,
} from '@angular/fire/firestore';
import { MarketingChartsComponent } from './marketing-charts/marketing-charts.component';
import { normalizeReferrerDomain } from '../attribution/attribution-report.service';
import { isRevenueOrder } from '../../../core/models/order.model';
import { GlobalOrderCacheService } from '../../../core/services/global-order-cache.service';
import { firstValueFrom } from 'rxjs';

export type DashTimeframe = 'MTD' | 'PAST_MONTH' | 'YTD';

@Component({
    selector: 'app-marketing-dashboard',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, MarketingChartsComponent],
    templateUrl: './marketing-dashboard.component.html',
    styleUrls: ['./marketing-dashboard.component.css'],
})
export class MarketingDashboardComponent implements OnInit {
    private fs = inject(Firestore);
    private globalOrderCache = inject(GlobalOrderCacheService);

    isLoading  = signal(true);
    hasError   = signal(false);
    sessions   = signal(0);
    cartAdds   = signal(0);
    orders     = signal(0);
    revenue    = signal(0);
    topSource  = signal('—');
    abandoned  = signal(0);

    // AI Visibility
    aiSessions  = signal(0);
    aiBreakdown = signal<{ source: string; count: number; color: string }[]>([]);
    aiPct       = computed(() => {
        const s = this.sessions();
        const a = this.aiSessions();
        return s > 0 ? Math.round((a / s) * 100) : 0;
    });

    // Channel revenue breakdown for the mini bar chart
    channelRevenue = signal<{ channel: string; revenue: number; color: string }[]>([]);

    // KPI deltas vs previous period
    deltas = signal<{
        sessions: number | null;
        orders:   number | null;
        revenue:  number | null;
        abandoned: number | null;
    }>({ sessions: null, orders: null, revenue: null, abandoned: null });

    timeframe  = signal<DashTimeframe>('MTD');

    convRate = computed(() => {
        const s = this.sessions();
        const o = this.orders();
        // Only storefront sessions tracked — cap at 100% to avoid misleading values
        // when ML/POS orders outnumber tracked sessions
        if (s === 0) return '0%';
        const pct = o / s * 100;
        return (pct > 100 ? 100 : pct).toFixed(1) + '%';
    });

    readonly timeframes: { value: DashTimeframe; labelKey: string }[] = [
        { value: 'MTD',        labelKey: 'MARKETING.DASHBOARD.TF.MTD' },
        { value: 'PAST_MONTH', labelKey: 'MARKETING.DASHBOARD.TF.PAST_MONTH' },
        { value: 'YTD',        labelKey: 'MARKETING.DASHBOARD.TF.YTD' },
    ];

    readonly quickLinks = [
        { labelKey: 'MARKETING.DASHBOARD.QUICK.ATTRIBUTION',    route: '/marketing/attribution',    icon: 'bar-chart-2',   color: '#6366f1' },
        { labelKey: 'MARKETING.DASHBOARD.QUICK.ABANDONED_CARTS',route: '/marketing/abandoned-carts', icon: 'shopping-cart', color: '#f59e0b' },
        { labelKey: 'MARKETING.DASHBOARD.QUICK.CAMPAIGNS',      route: '/marketing/campaigns',       icon: 'target',        color: '#10b981' },
        { labelKey: 'MARKETING.DASHBOARD.QUICK.COUPONS',        route: '/marketing/coupons',         icon: 'qr-code',       color: '#8b5cf6' },
        { labelKey: 'MARKETING.DASHBOARD.QUICK.SEGMENTS',       route: '/marketing/segments',        icon: 'users',         color: '#ec4899' },
    ];

    ngOnInit() { this.loadKpis(); }

    setTimeframe(tf: DashTimeframe) {
        if (this.timeframe() === tf) return;
        this.timeframe.set(tf);
        this.loadKpis();
    }

    /** Returns [from, to] Date objects for the selected timeframe */
    private getDateRange(): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();

        switch (this.timeframe()) {
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999)];
            case 'YTD':        return [new Date(y, 0, 1), now];
        }
    }

    /** Returns the equivalent prior period for delta calculation */
    private getPrevDateRange(): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        const dayOfMonth = now.getDate();

        switch (this.timeframe()) {
            // MTD → same days of previous month
            case 'MTD':        return [new Date(y, m - 1, 1), new Date(y, m - 1, dayOfMonth, 23, 59, 59)];
            // PAST_MONTH → 2 months ago
            case 'PAST_MONTH': return [new Date(y, m - 2, 1), new Date(y, m - 1, 0, 23, 59, 59)];
            // YTD → same YTD last year
            case 'YTD':        return [new Date(y - 1, 0, 1), new Date(y - 1, m, dayOfMonth, 23, 59, 59)];
        }
    }

    async loadKpis() {
        this.isLoading.set(true);
        this.hasError.set(false);

        const [from, to]         = this.getDateRange();
        const [prevFrom, prevTo] = this.getPrevDateRange();
        const fromTs    = Timestamp.fromDate(from);
        const toTs      = Timestamp.fromDate(to);
        const prevFromTs = Timestamp.fromDate(prevFrom);
        const prevToTs   = Timestamp.fromDate(prevTo);

        try {
            // Fire AI sessions query concurrently but non-blocking —
            // a missing index on sessionEvents must never break the main KPIs.
            const aiQueryPromise = getDocs(query(
                collection(this.fs, 'sessionEvents'),
                where('timestamp', '>=', fromTs),
                where('timestamp', '<=', toTs),
                where('event', '==', 'session_start'),
                orderBy('timestamp', 'desc'),
            )).then(snap => {
                const aiSourceMap = new Map<string, number>();
                let aiTotal = 0;
                for (const d of snap.docs) {
                    const data = d.data() as any;
                    const src = data.attribution?.aiSource as string | undefined;
                    if (src) {
                        aiTotal++;
                        aiSourceMap.set(src, (aiSourceMap.get(src) ?? 0) + 1);
                    }
                }
                this.aiSessions.set(aiTotal);
                const aiColors: Record<string, string> = {
                    chatgpt:    '#10a37f',
                    perplexity: '#1fb8cd',
                    gemini:     '#4285f4',
                    copilot:    '#0078d4',
                    claude:     '#d97706',
                    'meta-ai':  '#0082fb',
                };
                this.aiBreakdown.set(
                    [...aiSourceMap.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([source, count]) => ({
                            source, count,
                            color: aiColors[source] ?? '#8b5cf6',
                        }))
                );
            }).catch(e => {
                // Missing index or collection not yet created — degrade silently
                console.debug('[AI Visibility] sessionEvents query failed (index may be pending):', e?.message ?? e);
            });

            const [snapsSnap, currentOrders, prevSnapsSnap, prevOrders] = await Promise.all([
                getDocs(query(
                    collection(this.fs, 'cartSnapshots'),
                    where('createdAt', '>=', fromTs),
                    where('createdAt', '<=', toTs),
                    orderBy('createdAt', 'desc'),
                )),
                firstValueFrom(this.globalOrderCache.get(from, to)),
                getDocs(query(
                    collection(this.fs, 'cartSnapshots'),
                    where('createdAt', '>=', prevFromTs),
                    where('createdAt', '<=', prevToTs),
                    orderBy('createdAt', 'desc'),
                )),
                firstValueFrom(this.globalOrderCache.get(prevFrom, prevTo)),
            ]);

            // AI query runs concurrently — we don't await it to keep main KPIs fast
            aiQueryPromise.catch(() => {}); // already handled above, suppress unhandled

            const sessionSet = new Set<string>();
            let cartAdds = 0, abandonedCount = 0;
            const sourceMap = new Map<string, number>();

            for (const doc of snapsSnap.docs) {
                const d = doc.data() as any;
                if (d.sessionId) sessionSet.add(d.sessionId);
                if (d.event === 'item_added') cartAdds++;
                if (d.event === 'abandoned_detected') abandonedCount++;
                const src = d.attribution?.utm?.utm_source
                         ?? d.attribution?.referrerDomain
                         ?? 'direct';
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
            }

            const orderChannelMap = new Map<string, number>();
            const channelRevMap   = new Map<string, number>();
            let totalRev = 0;
            let revenueOrderCount = 0;
            for (const d of currentOrders) {
                // ── Apply the same revenue filter as operations/dashboard ─────
                if (!isRevenueOrder(d.status)) continue;
                // ─────────────────────────────────────────────────────────────
                revenueOrderCount++;
                const rev = d.total ?? 0;
                totalRev += rev;
                const ch = this.resolveChannel(d);
                orderChannelMap.set(ch, (orderChannelMap.get(ch) ?? 0) + 1);
                channelRevMap.set(ch, (channelRevMap.get(ch) ?? 0) + rev);
            }

            for (const [ch, cnt] of orderChannelMap) {
                sourceMap.set(ch, (sourceMap.get(ch) ?? 0) + cnt);
            }

            let topSrc = '—', topCount = 0;
            for (const [src, cnt] of sourceMap) {
                if (cnt > topCount) { topCount = cnt; topSrc = src; }
            }

            this.sessions.set(sessionSet.size);
            this.cartAdds.set(cartAdds);
            this.orders.set(revenueOrderCount);   // revenue orders only — matches operations/dashboard
            this.revenue.set(totalRev);
            this.topSource.set(topSrc);
            this.abandoned.set(abandonedCount);

            const chanRevArr = [...channelRevMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([channel, rev]) => ({
                    channel,
                    revenue: rev,
                    color: this.channelColor(channel),
                }));
            this.channelRevenue.set(chanRevArr);

            // ── Previous period ───────────────────────────────────────────────
            const prevSessionSet = new Set<string>();
            let prevAbandoned = 0;
            for (const doc of prevSnapsSnap.docs) {
                const d = doc.data() as any;
                if (d.sessionId) prevSessionSet.add(d.sessionId);
                if (d.event === 'abandoned_detected') prevAbandoned++;
            }
            let prevRev = 0;
            let prevRevenueOrderCount = 0;
            for (const d of prevOrders) {
                if (!isRevenueOrder(d.status)) continue;  // same filter for fair comparison
                prevRevenueOrderCount++;
                prevRev += d.total ?? 0;
            }

            const pct = (cur: number, prev: number): number | null =>
                prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);

            this.deltas.set({
                sessions: pct(sessionSet.size,       prevSessionSet.size),
                orders:   pct(revenueOrderCount,     prevRevenueOrderCount),
                revenue:  pct(totalRev,              prevRev),
                abandoned: pct(abandonedCount,       prevAbandoned),
            });
        } catch (e) {
            console.error('[MarketingDashboard] KPI load error:', e);
            this.hasError.set(true);
        } finally {
            this.isLoading.set(false);
        }
    }

    /** Resolves channel label from an order doc — uses the shared normalizeReferrerDomain
     *  so topSource and channelRevenue are consistent with the Attribution Report. */
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
        // storefront or legacy: UTM → normalised referrer → direct
        const utmSource = d.attribution?.utm?.utm_source;
        if (utmSource) return utmSource;
        const referrer = d.attribution?.referrerDomain;
        if (referrer) return normalizeReferrerDomain(referrer);
        if (d.channel === 'MELI_CLASSIC') return 'MercadoLibre Classic';
        return 'direct';
    }

    /** Brand-consistent color per channel for the revenue breakdown chart */
    channelColor(ch: string): string {
        const c = ch.toLowerCase();
        if (c.includes('full'))    return '#f59e0b';   // ML Full — amber
        if (c.includes('flex'))    return '#fbbf24';   // ML Flex — yellow
        if (c.includes('classic')) return '#d97706';   // ML Classic — dark amber
        if (c === 'pos')           return '#3b82f6';   // POS — blue
        if (c.includes('on-behalf') || c.includes('whatsapp') || c.includes('instagram')) return '#ec4899'; // Social — pink
        if (c === 'amazon')        return '#f97316';   // Amazon — orange
        if (c === 'direct')        return '#6366f1';   // Direct — indigo
        return '#8b5cf6';                              // Storefront UTM — violet
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }
}
