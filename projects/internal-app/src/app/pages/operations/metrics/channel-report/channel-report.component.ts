import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import {
    MetricsAnalyticsService, AnalyticsDailyDoc, DATE_RANGES, DateRange, ChannelBreakdown
} from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';
import { MetricsBigqueryService, DailyTrendRow, SummaryKpisRow } from '../services/metrics-bigquery.service';
import { MetricsHeatmapComponent } from '../shared/metrics-heatmap.component';

interface ChannelConfig {
    id:    string;
    label: string;
    emoji: string;
    color: string;        // hex accent
    description: string;
}

const CHANNEL_CONFIGS: Record<string, ChannelConfig> = {
    WEB:          { id: 'WEB',          label: 'Tienda Web',            emoji: '🌐', color: '#6366f1', description: 'Ventas a través de importadoraeuro.com' },
    POS:          { id: 'POS',          label: 'Punto de Venta',        emoji: '💳', color: '#10b981', description: 'Ventas en mostrador / tienda física' },
    ON_BEHALF:    { id: 'ON_BEHALF',    label: 'Por teléfono/whatsapp', emoji: '📞', color: '#a78bfa', description: 'Órdenes capturadas a nombre del cliente' },
    MELI_CLASSIC: { id: 'MELI_CLASSIC', label: 'MercadoLibre Clásica', emoji: '🛍️', color: '#f59e0b', description: 'Ventas ML donde nosotros hacemos el envío' },
    AMAZON_MFN:   { id: 'AMAZON_MFN',   label: 'Amazon MFN',            emoji: '📦', color: '#fbbf24', description: 'Amazon — Merchant Fulfilled Network' },
    AMAZON_FBA:   { id: 'AMAZON_FBA',   label: 'Amazon FBA',            emoji: '🏭', color: '#f97316', description: 'Amazon — Fulfilled by Amazon (bodega Amazon)' },
};

@Component({
    selector: 'app-channel-report',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, RouterModule, MetricsHeatmapComponent],
    templateUrl: './channel-report.component.html',
    styleUrls: ['./channel-report.component.scss'],
})
export class ChannelReportComponent implements OnInit {

    private svc   = inject(MetricsAnalyticsService);  // kept for pctChange helper
    private bqSvc = inject(MetricsBigqueryService);
    private tf    = inject(MetricsTimeframeService);
    private route = inject(ActivatedRoute);

    readonly dateRanges    = DATE_RANGES;
    readonly selectedRange = this.tf.selected;  // shared + persistent

    channelId  = signal<string>('WEB');
    isLoading  = signal(true);
    dailyDocs  = signal<AnalyticsDailyDoc[]>([]);
    priorDocs  = signal<AnalyticsDailyDoc[]>([]);

    readonly config = computed(() =>
        CHANNEL_CONFIGS[this.channelId()] ?? CHANNEL_CONFIGS['WEB']
    );

    // ── KPIs ─────────────────────────────────────────────────────────────────
    readonly kpis = computed(() => {
        const curAll  = this.svc.aggregateDocs(this.dailyDocs());
        const prevAll = this.svc.aggregateDocs(this.priorDocs());
        const ch      = this.channelId();

        const curCh   = this.dailyDocs().reduce((acc, d) => {
            const b = d.byChannel?.[ch];
            if (b) { acc.revenue += b.revenue ?? 0; acc.orders += b.orders ?? 0; acc.units += b.units ?? 0; }
            return acc;
        }, { revenue: 0, orders: 0, units: 0 });

        const prevCh = this.priorDocs().reduce((acc, d) => {
            const b = d.byChannel?.[ch];
            if (b) { acc.revenue += b.revenue ?? 0; acc.orders += b.orders ?? 0; acc.units += b.units ?? 0; }
            return acc;
        }, { revenue: 0, orders: 0, units: 0 });

        const avgTicket     = curCh.orders > 0 ? curCh.revenue / curCh.orders : 0;
        const prevTicket    = prevCh.orders > 0 ? prevCh.revenue / prevCh.orders : 0;

        const totalRevenue  = curAll.totalRevenue || 1;
        const channelShare  = curCh.revenue / totalRevenue;

        return {
            revenue:    { value: curCh.revenue,   delta: this.svc.pctChange(curCh.revenue,  prevCh.revenue)  },
            orders:     { value: curCh.orders,     delta: this.svc.pctChange(curCh.orders,   prevCh.orders)   },
            avgTicket:  { value: avgTicket,        delta: this.svc.pctChange(avgTicket,      prevTicket)      },
            units:      { value: curCh.units,      delta: this.svc.pctChange(curCh.units,    prevCh.units)    },
            channelShare,
        };
    });

    // ── Daily trend per channel ───────────────────────────────────────────────
    readonly trendData = computed(() => {
        const ch   = this.channelId();
        const docs = this.dailyDocs();
        return {
            labels:  docs.map(d => {
                const dt = new Date(d.date + 'T12:00:00');
                return dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
            }),
            revenue: docs.map(d => d.byChannel?.[ch]?.revenue ?? 0),
            orders:  docs.map(d => d.byChannel?.[ch]?.orders  ?? 0),
        };
    });

    // ── DoW heatmap (last 90d) ────────────────────────────────────────────────
    readonly dayOfWeekData = computed(() => {
        const ch    = this.channelId();
        const days  = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
        const totals = Array(7).fill(0);
        const counts = Array(7).fill(0);
        for (const d of this.dailyDocs()) {
            const dow = d.dayOfWeek ?? 0;
            totals[dow] += d.byChannel?.[ch]?.revenue ?? 0;
            counts[dow]++;
        }
        const max = Math.max(...totals, 1);
        return days.map((label, i) => ({
            label,
            avg:       counts[i] > 0 ? totals[i] / counts[i] : 0,
            intensity: totals[i] / max,
        }));
    });

    // ── Bar data for avg revenue per DoW ─────────────────────────────────────
    readonly bestDay = computed(() => {
        const data = this.dayOfWeekData();
        return data.reduce((best, d) => d.avg > best.avg ? d : best, data[0]);
    });

    // ── Rev bar height helper (avoids non-existent max pipe) ─────────────────
    readonly maxRevenue = computed(() => {
        const ch = this.channelId();
        return Math.max(1, ...this.dailyDocs().map(d => d.byChannel?.[ch]?.revenue ?? 0));
    });

    revBarHeight(rev: number | undefined): number {
        return ((rev ?? 0) / this.maxRevenue()) * 100;
    }

    // ─────────────────────────────────────────────────────────────────────────

    async ngOnInit() {
        // Channel comes from route: /operations/metrics/channel/:id
        this.route.params.subscribe(params => {
            const id = (params['channel'] as string ?? 'WEB').toUpperCase();
            this.channelId.set(id);
        });
        await this.load();
    }

    async selectRange(r: DateRange) {
        this.tf.set(r);
        await this.load();
    }

    private async load() {
        this.isLoading.set(true);
        const range = this.tf.selected();
        try {
            const { fromDate: curFrom, toDate: curTo } = this.bqSvc.getDateStrings(range);
            const [prevFrom, prevTo] = this.svc.getPriorRange(range.type);
            const prevFromStr = prevFrom.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
            const prevToStr   = prevTo.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' });

            const [curTrend, curKpis, prevTrend, prevKpis] = await Promise.all([
                this.bqSvc.queryDailyTrendBetween(curFrom, curTo),
                this.bqSvc.querySummaryKpisBetween(curFrom, curTo),
                this.bqSvc.queryDailyTrendBetween(prevFromStr, prevToStr),
                this.bqSvc.querySummaryKpisBetween(prevFromStr, prevToStr),
            ]);
            this.dailyDocs.set(this._bqToDocs(curTrend, curKpis));
            this.priorDocs.set(this._bqToDocs(prevTrend, prevKpis));
        } catch (err) {
            console.error('[ChannelReport] BQ load failed:', err);
            this.dailyDocs.set([]);
            this.priorDocs.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }

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


    formatDelta(delta: number | null): string {
        if (delta === null) return '—';
        const sign = delta >= 0 ? '+' : '';
        return `${sign}${delta.toFixed(1)}%`;
    }
    isDeltaPos(v: number | null): boolean { return v !== null && v > 0; }
    isDeltaNeg(v: number | null): boolean { return v !== null && v < 0; }

    intensityColor(intensity: number, hex: string): string {
        const alpha = Math.max(0.05, Math.min(0.85, intensity));
        return `${hex}${Math.round(alpha * 255).toString(16).padStart(2,'0')}`;
    }
}
