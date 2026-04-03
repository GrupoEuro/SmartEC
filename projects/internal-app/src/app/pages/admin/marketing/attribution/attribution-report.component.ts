import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AttributionReportService, AttributionSummary, AttributionRow } from './attribution-report.service';

type SortCol = 'sessions' | 'cartAdds' | 'orders' | 'revenue' | 'conversionRate' | 'avgOrderValue';
type SortDir = 'asc' | 'desc';

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

    // Date range (default: last 30 days)
    fromDate  = signal(this.daysAgo(30));
    toDate    = signal(new Date());

    readonly datePresets = [
        { label: '7d',  days: 7  },
        { label: '30d', days: 30 },
        { label: '90d', days: 90 },
    ];
    activePreset = signal(30);

    // ── Computed ─────────────────────────────────────────────────────────────
    readonly sortedRows = computed<AttributionRow[]>(() => {
        const s = this.summary();
        if (!s) return [];
        const col = this.sortCol();
        const dir = this.sortDir() === 'asc' ? 1 : -1;
        return [...s.rows].sort((a, b) => (a[col] - b[col]) * dir);
    });

    readonly totalConvRate = computed(() => {
        const s = this.summary();
        if (!s || s.totalSessions === 0) return 0;
        return s.totalOrders / s.totalSessions;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() { this.load(); }

    async load() {
        this.isLoading.set(true);
        try {
            const result = await this.svc.loadReport(this.fromDate(), this.toDate());
            this.summary.set(result);
        } catch (e) {
            console.error('[AttributionReport] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    setPreset(days: number) {
        this.activePreset.set(days);
        this.fromDate.set(this.daysAgo(days));
        this.toDate.set(new Date());
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

    // ── Formatters ────────────────────────────────────────────────────────────
    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
    }

    fmtPct(v: number): string {
        return `${(v * 100).toFixed(1)}%`;
    }

    channelIcon(channel: string): string {
        const c = channel.toLowerCase();
        if (c === 'direct')    return 'bookmark';
        if (c.includes('google') || c.includes('goog')) return 'search';
        if (c.includes('facebook') || c.includes('fb') || c.includes('instagram') || c.includes('ig')) return 'social';
        if (c.includes('whatsapp') || c.includes('wa')) return 'whatsapp';
        if (c.includes('email') || c.includes('mail')) return 'mail';
        if (c.includes('qr') || c.includes('coupon'))  return 'qr';
        return 'link';
    }

    private daysAgo(n: number): Date {
        const d = new Date();
        d.setDate(d.getDate() - n);
        d.setHours(0, 0, 0, 0);
        return d;
    }
}
