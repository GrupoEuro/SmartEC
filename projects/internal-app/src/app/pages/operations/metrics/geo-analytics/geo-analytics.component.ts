import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
    MetricsBigqueryService, GeoBreakdownRow,
} from '../services/metrics-bigquery.service';
import { DATE_RANGES, DateRange } from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';

const CHANNEL_LABELS: Record<string, string> = {
    MELI_FULL:    'MeLi Full',
    MELI_CLASSIC: 'MeLi Clásica',
    WEB:          'Tienda Web',
    POS:          'Punto Venta',
    ON_BEHALF:    'A cuenta',
    AMAZON_FBA:   'Amazon FBA',
    AMAZON_MFN:   'Amazon MFN',
};

// Rough MX state population weights for display (not used in calc, just reference)
const STATE_EMOJIS: Record<string, string> = {
    'Estado de México':       '🏙️',
    'Ciudad de México':       '🏛️',
    'Jalisco':                '🌵',
    'Nuevo León':             '🏭',
    'Puebla':                 '🌄',
    'Guanajuato':             '⛰️',
    'Veracruz':               '🌊',
    'Chihuahua':              '🏜️',
    'Michoacán':              '🌺',
    'Baja California':        '🌅',
};

@Component({
    selector:    'app-geo-analytics',
    standalone:  true,
    imports:     [CommonModule, CurrencyPipe, DecimalPipe, RouterModule],
    templateUrl: './geo-analytics.component.html',
    styleUrls:   ['./geo-analytics.component.scss'],
})
export class GeoAnalyticsComponent implements OnInit {

    private bqSvc = inject(MetricsBigqueryService);
    private tf    = inject(MetricsTimeframeService);

    readonly dateRanges    = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    isLoading       = signal(true);
    geoRows         = signal<GeoBreakdownRow[]>([]);
    selectedChannel = signal('');

    // ── Computed ──────────────────────────────────────────────────────────────

    readonly totalRevenue = computed(() =>
        this.geoRows().reduce((s, r) => s + r.total_revenue, 0)
    );

    readonly totalOrders = computed(() =>
        this.geoRows().reduce((s, r) => s + r.total_orders, 0)
    );

    readonly maxRevenue = computed(() =>
        Math.max(...this.geoRows().map(r => r.total_revenue), 1)
    );

    readonly top3 = computed(() => this.geoRows().filter(r => r.state !== '(Sin estado)').slice(0, 3));

    /** Orders bucketed as '(Sin estado)' — typically MeLi Full (logistics by platform) */
    readonly noStateRow = computed(() => this.geoRows().find(r => r.state === '(Sin estado)') ?? null);

    /** Real state rows only (excludes the catch-all bucket) */
    readonly knownStateRows = computed(() => this.geoRows().filter(r => r.state !== '(Sin estado)'));

    readonly channelOptions = Object.entries(CHANNEL_LABELS).map(([id, label]) => ({ id, label }));

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async ngOnInit() { await this.load(); }

    async selectRange(r: DateRange) {
        this.tf.set(r);
        await this.load();
    }

    async setChannel(ch: string) {
        this.selectedChannel.set(ch);
        await this.load();
    }

    private async load() {
        this.isLoading.set(true);
        try {
            const ch = this.selectedChannel() || undefined;
            const rows = await this.bqSvc.queryGeoBreakdown(this.tf.selected(), ch);
            this.geoRows.set(rows);
        } catch (err) {
            console.error('[GeoAnalytics] Query failed:', err);
        } finally {
            this.isLoading.set(false);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    barWidth(rev: number): number {
        return (rev / this.maxRevenue()) * 100;
    }

    revenueShare(rev: number): number {
        const t = this.totalRevenue();
        return t > 0 ? (rev / t) * 100 : 0;
    }

    stateEmoji(state: string): string {
        return STATE_EMOJIS[state] ?? '📍';
    }

    fmtMoney(n: number): string {
        if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
        if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
        return '$' + Math.round(n).toLocaleString('es-MX');
    }
}
