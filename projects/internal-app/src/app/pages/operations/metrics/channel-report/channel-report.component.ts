import { Component, OnInit, inject, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { Chart, registerables } from 'chart.js';
import {
    MetricsAnalyticsService, AnalyticsDailyDoc, DATE_RANGES, DateRange, ChannelSnapshotDoc
} from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';
import { MetricsBigqueryService, DailyTrendRow, SummaryKpisRow } from '../services/metrics-bigquery.service';

Chart.register(...registerables);

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
    imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule],
    templateUrl: './channel-report.component.html',
    styleUrls: ['./channel-report.component.scss'],
})
export class ChannelReportComponent implements OnInit {

    private svc   = inject(MetricsAnalyticsService);
    private bqSvc = inject(MetricsBigqueryService);
    private tf    = inject(MetricsTimeframeService);
    private route = inject(ActivatedRoute);
    private fs    = inject(Firestore);

    readonly dateRanges    = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    channelId  = signal<string>('WEB');
    isLoading  = signal(true);
    dailyDocs  = signal<AnalyticsDailyDoc[]>([]);
    priorDocs  = signal<AnalyticsDailyDoc[]>([]);
    
    // New Signals for advanced metrics
    channelSnapshots = signal<ChannelSnapshotDoc[]>([]);
    rawListings      = signal<any[]>([]);

    @ViewChild('trendCanvas') trendCanvasRef?: ElementRef<HTMLCanvasElement>;
    private trendChart?: Chart;

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
            orders:     { value: curCh.orders,    delta: this.svc.pctChange(curCh.orders,   prevCh.orders)   },
            avgTicket:  { value: avgTicket,       delta: this.svc.pctChange(avgTicket,      prevTicket)      },
            units:      { value: curCh.units,     delta: this.svc.pctChange(curCh.units,    prevCh.units)    },
            channelShare,
        };
    });

    readonly advancedKpis = computed(() => {
        const snaps = this.channelSnapshots();
        const listings = this.rawListings();
        const units = this.kpis().units.value;

        // Total Visits
        let totalVisits: number | null = null;
        let avgConversion: number | null = null;

        if (this.channelId() === 'MELI_CLASSIC') {
            totalVisits = snaps.reduce((s, d) => s + (d.visits ?? 0), 0);
            avgConversion = totalVisits > 0 ? (units / totalVisits) * 100 : 0;
        }

        // Avg Health
        let avgHealth: number | null = null;
        if (listings.length > 0) {
            const healths = listings.map(l => l.health).filter(h => h != null);
            avgHealth = healths.length > 0 ? healths.reduce((a,b)=>a+b, 0) / healths.length : null;
        }

        return { totalVisits, avgConversion, avgHealth };
    });

    readonly listings = computed(() => {
        // Return sorted top listings
        const list = [...this.rawListings()];
        return list.sort((a,b) => (b.soldQuantity ?? 0) - (a.soldQuantity ?? 0)).slice(0, 50);
    });

    // ─────────────────────────────────────────────────────────────────────────

    async ngOnInit() {
        this.route.params.subscribe(params => {
            const id = (params['channel'] as string ?? 'WEB').toUpperCase();
            this.channelId.set(id);
            this.load();
        });
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

            const [curTrend, curKpis, prevTrend, prevKpis, snaps] = await Promise.all([
                this.bqSvc.queryDailyTrendBetween(curFrom, curTo),
                this.bqSvc.querySummaryKpisBetween(curFrom, curTo),
                this.bqSvc.queryDailyTrendBetween(prevFromStr, prevToStr),
                this.bqSvc.querySummaryKpisBetween(prevFromStr, prevToStr),
                this.channelId() === 'MELI_CLASSIC' ? this.svc.getChannelSnapshots('MELI_CLASSIC', range) : Promise.resolve([]),
            ]);
            
            this.dailyDocs.set(this._bqToDocs(curTrend, curKpis));
            this.priorDocs.set(this._bqToDocs(prevTrend, prevKpis));
            this.channelSnapshots.set(snaps);

            if (this.channelId() === 'MELI_CLASSIC') {
                const snapDocs = await getDocs(collection(this.fs, 'meli_listings'));
                const all = snapDocs.docs.map(d => ({ id: d.id, ...d.data() }) as any);
                const classic = all.filter(l => l.logistic_type !== 'fulfillment' && l.status === 'active');
                this.rawListings.set(classic);
            } else {
                this.rawListings.set([]);
            }

            setTimeout(() => this.buildTrendChart(), 100);

        } catch (err) {
            console.error('[ChannelReport] Data load failed:', err);
            this.dailyDocs.set([]);
            this.priorDocs.set([]);
            this.channelSnapshots.set([]);
            this.rawListings.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }

    private buildTrendChart() {
        this.trendChart?.destroy();
        if (!this.trendCanvasRef?.nativeElement) return;
        const ctx = this.trendCanvasRef.nativeElement.getContext('2d');
        if (!ctx) return;

        const docs = this.dailyDocs();
        const ch = this.channelId();
        const labels = docs.map(d => {
            const dt = new Date(d.date + 'T12:00:00');
            return dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
        });
        const revenue = docs.map(d => d.byChannel?.[ch]?.revenue ?? 0);
        const orders  = docs.map(d => d.byChannel?.[ch]?.orders ?? 0);

        const gradientOrange = ctx.createLinearGradient(0, 0, 0, 400);
        gradientOrange.addColorStop(0, 'rgba(251, 146, 60, 0.4)');
        gradientOrange.addColorStop(1, 'rgba(251, 146, 60, 0.01)');

        this.trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Ingresos',
                        data: revenue,
                        borderColor: '#fb923c',
                        backgroundColor: gradientOrange,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointBackgroundColor: '#1e293b',
                        pointBorderColor: '#fb923c',
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#fb923c',
                        fill: true,
                        tension: 0.4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Órdenes',
                        data: orders,
                        borderColor: '#6366f1',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 2,
                        pointBackgroundColor: '#1e293b',
                        pointBorderColor: '#6366f1',
                        fill: false,
                        tension: 0.4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#e2e8f0', usePointStyle: true, boxWidth: 6, font: { size: 11, family: "'Inter', sans-serif" } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.datasetIndex === 0) {
                                    label += new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(context.parsed.y || 0);
                                } else {
                                    label += context.parsed.y + ' órdenes';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 10, family: "'Inter', sans-serif" }, maxTicksLimit: 14 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#fb923c',
                            font: { size: 10, family: "'Inter', sans-serif" },
                            callback: (val) => '$' + (Number(val) / 1000) + 'k'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#818cf8',
                            font: { size: 10, family: "'Inter', sans-serif" },
                            stepSize: 1
                        }
                    }
                }
            }
        });
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
}
