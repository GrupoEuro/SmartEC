import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where,
    orderBy, getDocs, Timestamp,
} from '@angular/fire/firestore';
import { MarketingChartsComponent } from './marketing-charts/marketing-charts.component';

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

    isLoading  = signal(true);
    sessions   = signal(0);
    cartAdds   = signal(0);
    orders     = signal(0);
    revenue    = signal(0);
    topSource  = signal('—');
    abandoned  = signal(0);

    timeframe  = signal<DashTimeframe>('MTD');

    convRate = computed(() =>
        this.sessions() > 0 ? (this.orders() / this.sessions() * 100).toFixed(1) + '%' : '0%'
    );

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
            case 'MTD':
                return [new Date(y, m, 1), now];

            case 'PAST_MONTH': {
                const firstOfPrevMonth = new Date(y, m - 1, 1);
                const lastOfPrevMonth  = new Date(y, m, 0, 23, 59, 59, 999);
                return [firstOfPrevMonth, lastOfPrevMonth];
            }

            case 'YTD':
                return [new Date(y, 0, 1), now];
        }
    }

    private async loadKpis() {
        this.isLoading.set(true);

        const [from, to] = this.getDateRange();
        const fromTs = Timestamp.fromDate(from);
        const toTs   = Timestamp.fromDate(to);

        try {
            const [snapsSnap, ordersSnap] = await Promise.all([
                getDocs(query(
                    collection(this.fs, 'cartSnapshots'),
                    where('createdAt', '>=', fromTs),
                    where('createdAt', '<=', toTs),
                    orderBy('createdAt', 'desc'),
                )),
                getDocs(query(
                    collection(this.fs, 'orders'),
                    where('createdAt', '>=', fromTs),
                    where('createdAt', '<=', toTs),
                    orderBy('createdAt', 'desc'),
                )),
            ]);

            const sessionSet = new Set<string>();
            let cartAdds = 0, abandonedCount = 0;
            const sourceMap = new Map<string, number>();

            for (const doc of snapsSnap.docs) {
                const d = doc.data() as any;
                if (d.sessionId) sessionSet.add(d.sessionId);
                if (d.event === 'item_added') cartAdds++;
                if (d.event === 'abandoned_detected') abandonedCount++;
                // cartSnapshots are storefront-only — use UTM/referrer resolution
                const src = d.attribution?.utm?.utm_source
                         ?? d.attribution?.referrerDomain
                         ?? 'direct';
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
            }

            // Count orders by resolved channel (includes ML, POS, On-Behalf)
            const orderChannelMap = new Map<string, number>();
            let totalRev = 0;
            for (const doc of ordersSnap.docs) {
                const d = doc.data() as any;
                totalRev += d.total ?? d.totalAmount ?? 0;
                const ch = this.resolveChannel(d);
                orderChannelMap.set(ch, (orderChannelMap.get(ch) ?? 0) + 1);
            }

            // Merge order channels into sourceMap so topSource reflects all revenue
            for (const [ch, cnt] of orderChannelMap) {
                sourceMap.set(ch, (sourceMap.get(ch) ?? 0) + cnt);
            }

            let topSrc = '—', topCount = 0;
            for (const [src, cnt] of sourceMap) {
                if (cnt > topCount) { topCount = cnt; topSrc = src; }
            }

            this.sessions.set(sessionSet.size);
            this.cartAdds.set(cartAdds);
            this.orders.set(ordersSnap.size);
            this.revenue.set(totalRev);
            this.topSource.set(topSrc);
            this.abandoned.set(abandonedCount);
        } catch (e) {
            console.error('[MarketingDashboard] KPI load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    /** Resolves channel label from an order doc — mirrors attribution-report.service logic */
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
        // storefront or legacy: UTM → referrer → direct
        return d.attribution?.utm?.utm_source
            ?? d.attribution?.referrerDomain
            ?? (d.channel === 'MELI_CLASSIC' ? 'MercadoLibre Classic' : 'direct');
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }
}
