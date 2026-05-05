import {
    Component, OnInit, inject, signal, computed, ViewChild, ElementRef, OnDestroy,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Chart, registerables, TooltipItem } from 'chart.js';
import {
    MetricsBigqueryService, ProductRevenueRow, ChannelSkuRow,
} from '../services/metrics-bigquery.service';
import { MetricsAnalyticsService, DATE_RANGES, DateRange } from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';

Chart.register(...registerables);

const CHANNEL_COLORS: Record<string, string> = {
    MELI_FULL:    '#fb923c',
    MELI_CLASSIC: '#ca8a04',
    WEB:          '#6366f1',
    POS:          '#10b981',
    ON_BEHALF:    '#a78bfa',
    AMAZON_FBA:   '#f59e0b',
    AMAZON_MFN:   '#fbbf24',
};
const CHANNEL_LABELS: Record<string, string> = {
    MELI_FULL:    'MeLi Full',
    MELI_CLASSIC: 'MeLi Clásica',
    WEB:          'Tienda Web',
    POS:          'Punto Venta',
    ON_BEHALF:    'A cuenta',
    AMAZON_FBA:   'Amazon FBA',
    AMAZON_MFN:   'Amazon MFN',
};

interface SkuChannelPivot {
    sku:          string;
    product_name: string;
    total_revenue: number;
    total_units:   number;
    channels:      Record<string, { revenue: number; units: number }>;
    topChannel:    string;
}

type SortCol = 'total_revenue' | 'total_units' | 'total_orders' | 'avg_unit_price';

@Component({
    selector:    'app-product-analytics',
    standalone:  true,
    imports:     [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule],
    templateUrl: './product-analytics.component.html',
    styleUrls:   ['./product-analytics.component.scss'],
})
export class ProductAnalyticsComponent implements OnInit, OnDestroy {

    private bqSvc = inject(MetricsBigqueryService);
    private svc   = inject(MetricsAnalyticsService);
    private tf    = inject(MetricsTimeframeService);

    // ── State ─────────────────────────────────────────────────────────────────
    readonly dateRanges    = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    isLoading         = signal(true);
    isLoadingChannels = signal(false);
    productRows       = signal<ProductRevenueRow[]>([]);
    channelSkuRows    = signal<ChannelSkuRow[]>([]);
    selectedChannel   = signal<string>('');   // '' = all channels
    searchTerm        = signal('');
    sortCol           = signal<SortCol>('total_revenue');
    sortDir           = signal<'asc' | 'desc'>('desc');
    page              = signal(1);
    pageSize          = 25;
    activeTab         = signal<'products' | 'channels'>('products');

    // Backfill state
    isBackfilling  = signal(false);
    backfillResult = signal<{ ordersWritten: number; itemsWritten: number; dataset: string } | null>(null);
    backfillError  = signal<string | null>(null);

    @ViewChild('topChart') topChartRef?: ElementRef<HTMLCanvasElement>;
    private chart?: Chart;

    // ── Computed ──────────────────────────────────────────────────────────────

    readonly channels = computed(() => {
        const seen = new Set<string>();
        this.channelSkuRows().forEach(r => seen.add(r.source_channel));
        return Array.from(seen).sort();
    });

    readonly filteredRows = computed(() => {
        const q   = this.searchTerm().toLowerCase().trim();
        const ch  = this.selectedChannel();
        let rows  = this.productRows();

        if (ch) {
            // Filter to only SKUs that appeared in the selected channel
            const skusInChannel = new Set(
                this.channelSkuRows()
                    .filter(r => r.source_channel === ch)
                    .map(r => r.sku)
            );
            rows = rows.filter(r => skusInChannel.has(r.sku));
        }

        if (q) {
            rows = rows.filter(r =>
                (r.sku ?? '').toLowerCase().includes(q) ||
                (r.product_name ?? '').toLowerCase().includes(q) ||
                (r.brand ?? '').toLowerCase().includes(q)
            );
        }

        const col = this.sortCol();
        const dir = this.sortDir();
        return [...rows].sort((a, b) => {
            const av = (a as any)[col] ?? 0;
            const bv = (b as any)[col] ?? 0;
            return dir === 'desc' ? bv - av : av - bv;
        });
    });

    readonly totalPages = computed(() =>
        Math.max(1, Math.ceil(this.filteredRows().length / this.pageSize))
    );

    readonly pagedRows = computed(() => {
        const p = this.page();
        return this.filteredRows().slice((p - 1) * this.pageSize, p * this.pageSize);
    });

    readonly totalRevenue = computed(() =>
        this.filteredRows().reduce((s, r) => s + r.total_revenue, 0)
    );

    readonly totalUnits = computed(() =>
        this.filteredRows().reduce((s, r) => s + r.total_units, 0)
    );

    /** Channel-pivot view: each unique SKU with revenue broken down by channel */
    readonly channelPivot = computed((): SkuChannelPivot[] => {
        const map = new Map<string, SkuChannelPivot>();
        for (const row of this.channelSkuRows()) {
            const key = row.sku;
            if (!map.has(key)) {
                map.set(key, {
                    sku:           row.sku,
                    product_name:  row.product_name,
                    total_revenue: 0,
                    total_units:   0,
                    channels:      {},
                    topChannel:    '',
                });
            }
            const entry = map.get(key)!;
            entry.total_revenue += row.total_revenue;
            entry.total_units   += row.total_units;
            if (!entry.channels[row.source_channel]) {
                entry.channels[row.source_channel] = { revenue: 0, units: 0 };
            }
            entry.channels[row.source_channel].revenue += row.total_revenue;
            entry.channels[row.source_channel].units   += row.total_units;
        }
        // Find top channel per SKU and sort by total revenue
        return Array.from(map.values())
            .map(e => ({
                ...e,
                topChannel: Object.entries(e.channels)
                    .sort((a, b) => b[1].revenue - a[1].revenue)[0]?.[0] ?? '',
            }))
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 50);
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async ngOnInit() {
        await this.load();
    }

    ngOnDestroy() {
        this.chart?.destroy();
    }

    async selectRange(r: DateRange) {
        this.tf.set(r);
        await this.load();
    }

    private async load() {
        this.isLoading.set(true);
        const range = this.tf.selected();
        try {
            const [products, channelSku] = await Promise.all([
                this.bqSvc.queryProductRevenue(range, undefined, 200),
                this.bqSvc.queryChannelSku(range, undefined, 500),
            ]);
            this.productRows.set(products);
            this.channelSkuRows.set(channelSku);
            this.page.set(1);
        } catch (err) {
            console.error('[ProductAnalytics] BQ query failed:', err);
        } finally {
            this.isLoading.set(false);
            setTimeout(() => this.buildChart(), 80);
        }
    }

    async runBackfill(deleteFirst = false) {
        this.isBackfilling.set(true);
        this.backfillError.set(null);
        this.backfillResult.set(null);
        try {
            const result = await this.bqSvc.runBackfill(undefined, deleteFirst);
            this.backfillResult.set(result);
        } catch (err: any) {
            console.error('[ProductAnalytics] Backfill failed:', err);
            this.backfillError.set(err?.message ?? 'Error desconocido al ejecutar el backfill.');
        } finally {
            this.isBackfilling.set(false);
        }
    }

    async reload() {
        await this.load();
    }

    // ── Interactions ──────────────────────────────────────────────────────────

    setChannel(ch: string) {
        this.selectedChannel.set(ch);
        this.page.set(1);
        setTimeout(() => this.buildChart(), 60);
    }

    setSearch(q: string) {
        this.searchTerm.set(q);
        this.page.set(1);
    }

    sort(col: SortCol) {
        if (this.sortCol() === col) {
            this.sortDir.update(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            this.sortCol.set(col);
            this.sortDir.set('desc');
        }
        this.page.set(1);
    }

    setPage(p: number) {
        this.page.set(Math.max(1, Math.min(p, this.totalPages())));
    }

    sortIcon(col: SortCol): string {
        if (this.sortCol() !== col) return '↕';
        return this.sortDir() === 'desc' ? '↓' : '↑';
    }

    // ── Chart ─────────────────────────────────────────────────────────────────

    private buildChart() {
        this.chart?.destroy();
        const canvas = this.topChartRef?.nativeElement;
        if (!canvas || this.isLoading()) return;

        const top10 = this.filteredRows().slice(0, 10);
        if (!top10.length) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const maxRev = Math.max(...top10.map(r => r.total_revenue), 1);

        // Build gradient per bar based on revenue share
        const bgColors = top10.map((r, i) => {
            const g = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
            g.addColorStop(0, 'rgba(251,146,60,0.9)');
            g.addColorStop(1, 'rgba(99,102,241,0.6)');
            return g;
        });

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels:   top10.map(r => (r.sku || r.product_name || '').slice(0, 28)),
                datasets: [{
                    label:            'Ingresos MXN',
                    data:             top10.map(r => r.total_revenue),
                    backgroundColor:  bgColors,
                    borderRadius:     6,
                    borderSkipped:    false,
                }],
            },
            options: {
                indexAxis:           'y',
                responsive:          true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1c1c1f',
                        borderColor:     'rgba(255,255,255,.12)',
                        borderWidth:     1,
                        titleColor:      '#f4f4f5',
                        bodyColor:       '#a1a1aa',
                        callbacks: {
                            label: (item: TooltipItem<'bar'>) =>
                                `  $${(item.parsed.x as number).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#71717a', font: { size: 10 },
                            callback: (v: number | string) => {
                                const n = Number(v);
                                if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
                                if (n >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K';
                                return '$' + n;
                            },
                        },
                        grid: { color: 'rgba(255,255,255,.05)' },
                    },
                    y: {
                        ticks: { color: '#a1a1aa', font: { size: 11 } },
                        grid:  { display: false },
                    },
                },
            },
        } as any);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fmtMoney(n: number): string {
        if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
        if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
        return '$' + Math.round(n).toLocaleString('es-MX');
    }

    revenueShare(rev: number): number {
        const total = this.totalRevenue();
        return total > 0 ? (rev / total) * 100 : 0;
    }

    channelColor(ch: string): string {
        return CHANNEL_COLORS[ch] ?? '#71717a';
    }

    channelLabel(ch: string): string {
        return CHANNEL_LABELS[ch] ?? ch;
    }

    channelRevenue(pivot: SkuChannelPivot, ch: string): number {
        return pivot.channels[ch]?.revenue ?? 0;
    }

    pivotBarWidth(rev: number, total: number): number {
        return total > 0 ? Math.max(2, (rev / total) * 100) : 0;
    }

    get pageNumbers(): number[] {
        const total = this.totalPages();
        const cur   = this.page();
        const pages: number[] = [];
        for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) pages.push(i);
        return pages;
    }
}
