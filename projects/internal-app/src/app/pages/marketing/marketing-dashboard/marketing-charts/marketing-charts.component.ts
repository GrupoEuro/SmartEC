import {
    Component, OnInit, OnDestroy, OnChanges, SimpleChanges,
    inject, signal, computed, Input, ElementRef, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

export type DashTimeframe = 'MTD' | 'PAST_MONTH' | 'YTD';

interface DayBucket { label: string; sessions: number; orders: number; }
interface SourceBucket { source: string; count: number; }

@Component({
    selector: 'app-marketing-charts',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
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

    ngOnInit()    { this.loadAndRender(); }
    ngAfterViewInit() { this.viewReady = true; }
    ngOnChanges(c: SimpleChanges) {
        if (c['timeframe'] && !c['timeframe'].firstChange) this.loadAndRender();
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

            // ── Source map (channel mix) ─────────────────────────────────────
            const sourceMap = new Map<string, number>();
            const sessionsByDay = new Map<string, Set<string>>();

            for (const doc of snapsSnap.docs) {
                const d = doc.data() as any;
                const src = d.attribution?.utm?.utm_source
                          ?? d.attribution?.referrerDomain
                          ?? 'direct';
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);

                // bucket sessions by day
                if (d.sessionId && d.createdAt) {
                    const day = d.createdAt.toDate().toISOString().slice(0, 10);
                    if (!sessionsByDay.has(day)) sessionsByDay.set(day, new Set());
                    sessionsByDay.get(day)!.add(d.sessionId);
                }
            }

            // ── Orders by day ────────────────────────────────────────────────
            const ordersByDay = new Map<string, number>();
            for (const doc of ordersSnap.docs) {
                const d = doc.data() as any;
                if (d.createdAt) {
                    const day = d.createdAt.toDate().toISOString().slice(0, 10);
                    ordersByDay.set(day, (ordersByDay.get(day) ?? 0) + 1);
                }
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

            // Wait one tick for view to initialize
            await new Promise(r => setTimeout(r, 100));

            this.renderMixChart(topSources);
            this.renderTrendChart(dayLabels, orderData);
            this.renderSessionChart(dayLabels, sessionData);

        } catch (e) {
            console.error('[MarketingCharts] load error:', e);
        } finally {
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
}
