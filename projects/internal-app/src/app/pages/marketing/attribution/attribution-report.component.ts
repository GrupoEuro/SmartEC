import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AttributionReportService, AttributionSummary, AttributionRow } from './attribution-report.service';

type SortCol = 'sessions' | 'cartAdds' | 'orders' | 'revenue' | 'conversionRate' | 'avgOrderValue';
type SortDir = 'asc' | 'desc';
export type AttrTimeframe = 'MTD' | 'PAST_MONTH' | 'YTD' | 'L6M' | 'L12M' | 'ALL';

@Component({
    selector: 'app-attribution-report',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './attribution-report.component.html',
    styleUrls: ['./attribution-report.component.css'],
})
export class AttributionReportComponent implements OnInit {
    private svc = inject(AttributionReportService);

    // ── State ────────────────────────────────────────────────────────────────
    isLoading = signal(true);
    summary   = signal<AttributionSummary | null>(null);
    sortCol   = signal<SortCol>('revenue');
    sortDir   = signal<SortDir>('desc');
    timeframe = signal<AttrTimeframe>('MTD');

    readonly timeframes: { value: AttrTimeframe; labelKey: string }[] = [
        { value: 'MTD',        labelKey: 'ATTRIBUTION.TF.MTD'        },
        { value: 'PAST_MONTH', labelKey: 'ATTRIBUTION.TF.PAST_MONTH' },
        { value: 'YTD',        labelKey: 'ATTRIBUTION.TF.YTD'        },
        { value: 'L6M',        labelKey: 'ATTRIBUTION.TF.L6M'        },
        { value: 'L12M',       labelKey: 'ATTRIBUTION.TF.L12M'       },
        { value: 'ALL',        labelKey: 'ATTRIBUTION.TF.ALL'        },
    ];

    // ── Computed ─────────────────────────────────────────────────────────────
    readonly sortedRows = computed<AttributionRow[]>(() => {
        const s = this.summary();
        if (!s) return [];
        const col = this.sortCol();
        const dir = this.sortDir() === 'asc' ? 1 : -1;

        // For funnel-only columns (sessions, cartAdds, conversionRate),
        // always keep no-funnel rows at the bottom regardless of sort direction
        // so ML/POS/On-Behalf rows don't float above web-channel rows.
        const funnelOnlyCols: SortCol[] = ['sessions', 'cartAdds', 'conversionRate'];

        return [...s.rows].sort((a, b) => {
            if (funnelOnlyCols.includes(col)) {
                if (!a.hasWebFunnel && b.hasWebFunnel)  return 1;   // a sinks to bottom
                if (a.hasWebFunnel  && !b.hasWebFunnel) return -1;  // b sinks to bottom
            }
            return (a[col] - b[col]) * dir;
        });
    });

    readonly totalConvRate = computed(() => {
        const s = this.summary();
        if (!s || s.totalSessions === 0) return 0;
        return s.totalOrders / s.totalSessions;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() { this.load(); }

    // ── Actions ───────────────────────────────────────────────────────────────
    setTimeframe(tf: AttrTimeframe) {
        if (this.timeframe() === tf) return;
        this.timeframe.set(tf);
        this.load();
    }

    sortBy(col: SortCol) {
        if (this.sortCol() === col) {
            this.sortDir.update(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            this.sortCol.set(col);
            this.sortDir.set('desc');
        }
    }

    async load() {
        this.isLoading.set(true);
        const [from, to] = this.getDateRange();
        try {
            const result = await this.svc.loadReport(from, to);
            this.summary.set(result);
        } catch (e) {
            console.error('[AttributionReport] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    private getDateRange(): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        switch (this.timeframe()) {
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59)];
            case 'YTD':        return [new Date(y, 0, 1), now];
            case 'L6M':        { const d = new Date(now); d.setMonth(d.getMonth() - 6);  return [d, now]; }
            case 'L12M':       { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return [d, now]; }
            case 'ALL':        return [new Date(0), now];
        }
    }

    // ── CSV Export ────────────────────────────────────────────────────────────
    exportCsv() {
        const rows = this.sortedRows();
        if (!rows.length) return;
        const s = this.summary()!;
        const headers = [
            'Canal', 'Medio', 'Campaña', 'Sesiones', 'Carritos',
            'Órdenes', 'Ingresos (MXN)', 'AOV (MXN)', 'Conv. Rate', '% Ingresos'
        ];
        const lines = rows.map(r => [
            `"${r.channel}"`,
            `"${r.medium}"`,
            `"${r.campaign}"`,
            r.hasWebFunnel ? r.sessions : '',
            r.hasWebFunnel ? r.cartAdds : '',
            r.orders,
            r.revenue.toFixed(2),
            r.avgOrderValue.toFixed(2),
            r.hasWebFunnel ? this.fmtPct(r.conversionRate) : 'N/A',
            s.totalRevenue > 0 ? ((r.revenue / s.totalRevenue) * 100).toFixed(1) + '%' : '0%',
        ].join(','));
        const tf   = this.timeframe();
        const date = new Date().toISOString().slice(0, 10);
        const bom  = '\uFEFF';
        const csv  = bom + [headers.join(','), ...lines].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `attribution-${tf}-${date}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Formatters ────────────────────────────────────────────────────────────
    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
    }

    fmtPct(v: number): string {
        return `${(v * 100).toFixed(1)}%`;
    }

    channelIcon(channel: string): string {
        const c = channel.toLowerCase();
        if (c === 'direct')                             return 'bookmark';
        if (c.includes('mercadolibre'))                 return 'shopping-bag'; // covers Full, Classic, Flex
        if (c === 'pos')                                return 'store';
        if (c.includes('on-behalf') || c === 'on_behalf') return 'user-check';
        if (c === 'amazon')                             return 'package';
        if (c.includes('google') || c.includes('goog')) return 'search';
        if (c.includes('facebook') || c.includes('fb') || c.includes('instagram') || c.includes('ig')) return 'social';
        if (c.includes('whatsapp') || c.includes('wa')) return 'whatsapp';
        if (c.includes('tiktok'))                       return 'social';
        if (c.includes('email') || c.includes('mail'))  return 'mail';
        if (c.includes('qr')   || c.includes('coupon')) return 'qr';
        if (c.includes('b2b'))                          return 'briefcase';
        if (c.includes('walk'))                         return 'user';
        return 'link';
    }
}
