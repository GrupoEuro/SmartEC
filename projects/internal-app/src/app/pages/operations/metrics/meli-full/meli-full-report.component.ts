import {
    Component, OnInit, inject, signal, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Firestore, collection, getDocs, query, where, getDoc, doc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Chart, registerables } from 'chart.js';
import {
    MetricsAnalyticsService, DATE_RANGES, DateRange, ChannelSnapshotDoc
} from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';

Chart.register(...registerables);

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeliListing {
    id: string;
    title: string;
    sku: string;
    price: number;
    soldQuantity: number;
    health: number | null;
    net_amount: number;
    selling_fee_amount: number;
    net_percent: number;
    available_quantity: number;
    is_full: boolean;
    permalink: string;
    thumbnail: string;
    priceToWin?: number | null;
}

interface InventoryItem {
    id: string;
    sku: string | null;
    title: string;
    mlItemId: string;
    fullStock: number;
    fullStockReserved: number;
    availableQuantity: number;
    salesVelocity30d?: number;
    salesVelocity7d?: number;
    daysOfCoverage?: number;
    reorderAlertLevel?: 'ok' | 'low' | 'critical' | 'stockout';
    recommendedReplenishQty?: number;
    projectedStockoutDate?: string;
    price: number;
    permalink?: string;
}

type TabId = 'performance' | 'inventory' | 'scenarios';

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
    selector: 'app-meli-full-report',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule],
    templateUrl: './meli-full-report.component.html',
    styleUrls:  ['./meli-full-report.component.scss'],
})
export class MeliFullReportComponent implements OnInit, AfterViewInit, OnDestroy {

    @ViewChild('revenueCanvas') revenueCanvas?: ElementRef<HTMLCanvasElement>;
    @ViewChild('burnCanvas')    burnCanvas?:    ElementRef<HTMLCanvasElement>;
    @ViewChild('matrixCanvas')  matrixCanvas?:  ElementRef<HTMLCanvasElement>;

    private fs   = inject(Firestore);
    private fns  = inject(Functions);
    private svc  = inject(MetricsAnalyticsService);
    private tf   = inject(MetricsTimeframeService);

    // ── State ─────────────────────────────────────────────────────────────────
    activeTab     = signal<TabId>('performance');
    readonly selectedRange = this.tf.selected;
    readonly dateRanges    = DATE_RANGES;

    isLoadingPerf  = signal(true);
    isLoadingInv   = signal(true);
    isSyncingInv   = signal(false);

    snapshots      = signal<ChannelSnapshotDoc[]>([]);
    listings       = signal<MeliListing[]>([]);
    inventory      = signal<InventoryItem[]>([]);
    inventoryFilter = signal<'all' | 'ok' | 'low' | 'critical' | 'stockout'>('all');

    // Scenario — price simulator
    scenarioListingId = signal<string>('');
    scenarioPct       = signal(0);

    // Scenario — replenishment batch: itemId → qty to send
    replenishBatch = signal<Record<string, number>>({});

    private revenueChart?: Chart;
    private burnChart?: Chart;
    private matrixChart?: Chart;
    private viewReady = false;

    // ── Selected listing + inventory link ─────────────────────────────────────
    readonly scenarioListing = computed((): MeliListing | null =>
        this.listings().find(l => l.id === this.scenarioListingId()) ?? null
    );

    readonly scenarioInventory = computed((): InventoryItem | null => {
        const l = this.scenarioListing();
        if (!l) return null;
        return this.inventory().find(i => i.mlItemId === l.id) ?? null;
    });

    // ── Velocity tier for elasticity model ───────────────────────────────────
    readonly velocityTier = computed((): 'high' | 'medium' | 'low' => {
        const vel = this.scenarioInventory()?.salesVelocity30d ?? 0;
        if (vel > 2)   return 'high';
        if (vel >= 0.5) return 'medium';
        return 'low';
    });

    // ── KPIs from snapshots ───────────────────────────────────────────────────
    readonly perfKpis = computed(() => {
        const snaps = this.snapshots();
        const revenue        = snaps.reduce((s, d) => s + (d.revenue ?? 0), 0);
        const orders         = snaps.reduce((s, d) => s + (d.orders  ?? 0), 0);
        const units          = snaps.reduce((s, d) => s + (d.units   ?? 0), 0);
        const avgTicket      = orders > 0 ? revenue / orders : 0;
        const totalVisits    = snaps.reduce((s, d) => s + (d.visits  ?? 0), 0);
        const avgConversion  = totalVisits > 0 ? (orders / totalVisits) * 100 : 0;
        const ls             = this.listings();
        const avgHealth      = ls.length > 0
            ? ls.filter(l => l.health != null).reduce((s, l) => s + (l.health ?? 0), 0)
              / ls.filter(l => l.health != null).length
            : null;
        return { revenue, orders, units, avgTicket, totalVisits, avgConversion, avgHealth };
    });

    // ── Inventory alert counts ────────────────────────────────────────────────
    readonly invAlerts = computed(() => {
        const inv = this.inventory();
        return {
            ok:       inv.filter(i => i.reorderAlertLevel === 'ok').length,
            low:      inv.filter(i => i.reorderAlertLevel === 'low').length,
            critical: inv.filter(i => i.reorderAlertLevel === 'critical').length,
            stockout: inv.filter(i => i.reorderAlertLevel === 'stockout').length,
        };
    });

    readonly filteredInventory = computed(() => {
        const f = this.inventoryFilter();
        const inv = this.inventory();
        return f === 'all' ? inv : inv.filter(i => i.reorderAlertLevel === f);
    });

    // ── Replenishment totals ──────────────────────────────────────────────────
    readonly totalReplenishUnits = computed(() =>
        Object.values(this.replenishBatch()).reduce((s, v) => s + (v ?? 0), 0)
    );

    readonly totalReplenishValue = computed(() => {
        const batch = this.replenishBatch();
        return this.inventory().reduce((sum, item) => {
            const qty = batch[item.id] ?? 0;
            return sum + qty * item.price;
        }, 0);
    });

    // ── Advanced Price Simulator ──────────────────────────────────────────────
    readonly priceScenario = computed(() => {
        const l = this.scenarioListing();
        if (!l) return null;

        const pct       = this.scenarioPct();
        const newPrice  = l.price * (1 + pct / 100);
        const vel30d    = this.scenarioInventory()?.salesVelocity30d ?? 1;
        const baseUnits = vel30d * 30;

        // Tiered elasticity model
        const tier = this.velocityTier();
        let convMultiplier: number;
        if (pct < 0) {
            const ratePerPoint = tier === 'high' ? 0.03 : tier === 'medium' ? 0.04 : 0.05;
            convMultiplier = 1 + (Math.abs(pct) * ratePerPoint);
        } else {
            const penaltyPerPoint = tier === 'high' ? 0.015 : tier === 'medium' ? 0.02 : 0.03;
            convMultiplier = Math.max(0.3, 1 - (pct * penaltyPerPoint));
        }

        const projUnits   = Math.round(baseUnits * convMultiplier);
        const commissionRate = l.price > 0 ? l.selling_fee_amount / l.price : 0;
        const shippingEst = 85; // avg MXN estimated shipping for Full
        const commissionAmt = newPrice * commissionRate;
        const netPerUnit  = newPrice - commissionAmt - shippingEst;

        const projRevenue = projUnits * newPrice;
        const projNet     = projUnits * netPerUnit;
        const currentNet  = baseUnits * (l.price - l.selling_fee_amount - shippingEst);

        // Break-even: minimum price to maintain current net margin per unit
        const breakEvenPrice = commissionRate < 1
            ? (l.net_amount + shippingEst) / (1 - commissionRate)
            : 0;

        // Win position vs competitor
        let winPosition: 'winning' | 'close' | 'losing' = 'unknown' as any;
        let winPositionLabel = '';
        if (l.priceToWin != null) {
            if (newPrice <= l.priceToWin) {
                winPosition = 'winning';
                winPositionLabel = 'Ganarías la Buy Box';
            } else if (newPrice <= l.priceToWin * 1.03) {
                winPosition = 'close';
                winPositionLabel = 'Muy cerca del ganador';
            } else {
                winPosition = 'losing';
                const over = (newPrice - l.priceToWin).toFixed(0);
                winPositionLabel = `+$${over} sobre el ganador`;
            }
        }

        const gapToWin        = l.priceToWin != null ? newPrice - l.priceToWin : null;
        const projUnitsChange  = projUnits - Math.round(baseUnits);
        const revenueChange    = projRevenue - (baseUnits * l.price);

        return {
            newPrice, projUnits, projRevenue, projNet, currentNet,
            gapToWin, commissionRate, commissionAmt, shippingEst,
            netPerUnit, breakEvenPrice, winPosition, winPositionLabel,
            projUnitsChange, revenueChange,
        };
    });

    // ── Opportunity Matrix data ───────────────────────────────────────────────
    readonly matrixData = computed(() => {
        return this.listings().map(l => {
            const inv      = this.inventory().find(i => i.mlItemId === l.id);
            const vel      = inv?.salesVelocity30d ?? 0;
            const gap      = l.priceToWin != null ? l.price - l.priceToWin : 0;
            const revenue  = l.price * vel * 30;
            const label    = l.title.slice(0, 35);
            return { id: l.id, label, x: gap, y: vel, revenue };
        });
    });

    // ─────────────────────────────────────────────────────────────────────────

    ngOnInit()        { this.loadAll(); }
    ngAfterViewInit() {
        this.viewReady = true;
        if (!this.isLoadingPerf()) this.renderCharts();
    }
    ngOnDestroy() {
        this.revenueChart?.destroy();
        this.burnChart?.destroy();
        this.matrixChart?.destroy();
    }

    setTab(t: TabId) {
        this.activeTab.set(t);
        if (t === 'scenarios') {
            setTimeout(() => this.renderMatrixChart(), 100);
        }
    }

    async selectRange(r: DateRange) {
        this.tf.set(r);
        this.isLoadingPerf.set(true);
        await this.loadSnapshots();
        this.isLoadingPerf.set(false);
        await new Promise(resolve => setTimeout(resolve, 60));
        this.renderCharts();
        if (this.activeTab() === 'scenarios') this.renderMatrixChart();
    }

    async syncInventory() {
        this.isSyncingInv.set(true);
        try {
            const syncFn   = httpsCallable(this.fns, 'meliSyncFullInventory');
            await syncFn({});
            const enrichFn = httpsCallable(this.fns, 'meliEnrichInventoryVelocityCallable');
            await enrichFn({});
            await this.loadInventory();
        } catch (e) { console.error('[MeliFullReport] Sync failed', e); }
        finally { this.isSyncingInv.set(false); }
    }

    setInventoryFilter(f: 'all' | 'ok' | 'low' | 'critical' | 'stockout') {
        this.inventoryFilter.set(f);
    }

    // ── Replenishment batch methods ───────────────────────────────────────────

    setReplenishQty(id: string, qty: number) {
        this.replenishBatch.update(b => ({ ...b, [id]: Math.max(0, qty) }));
    }

    exportReplenishment() {
        const batch = this.replenishBatch();
        const lines: string[] = ['SKU\tProducto\tUnidades\tPrecio Unit.\tValor Total (MXN)'];
        for (const item of this.inventory()) {
            const qty = batch[item.id] ?? 0;
            if (qty > 0) {
                lines.push(
                    `${item.sku ?? '—'}\t${item.title}\t${qty}\t${item.price.toFixed(2)}\t${(qty * item.price).toFixed(2)}`
                );
            }
        }
        const total = this.totalReplenishUnits();
        const value = this.totalReplenishValue();
        lines.push('');
        lines.push(`TOTAL\t\t${total} u\t\t$${value.toFixed(2)} MXN`);

        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `reposicion-meli-full-${new Date().toISOString().slice(0, 10)}.tsv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Opportunity Matrix interaction ────────────────────────────────────────

    selectFromMatrix(listingId: string) {
        this.scenarioListingId.set(listingId);
        this.scenarioPct.set(0);
        setTimeout(() => {
            document.querySelector('.scenarios-simulator')?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
    }

    // ── Helper methods ────────────────────────────────────────────────────────

    alertClass(level?: string): string {
        switch (level) {
            case 'stockout':  return 'alert-stockout';
            case 'critical':  return 'alert-critical';
            case 'low':       return 'alert-low';
            default:          return 'alert-ok';
        }
    }

    coveragePct(item: InventoryItem): number {
        const d = item.daysOfCoverage ?? 0;
        return Math.min(100, Math.round((d / 45) * 100));
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private async loadAll() {
        await Promise.all([this.loadSnapshots(), this.loadListings(), this.loadInventory()]);
        this.isLoadingPerf.set(false);
        this.isLoadingInv.set(false);
        await new Promise(resolve => setTimeout(resolve, 80));
        if (this.viewReady) this.renderCharts();
    }

    private async loadSnapshots() {
        const snaps = await this.svc.getChannelSnapshots('MELI_FULL', this.tf.selected());
        this.snapshots.set(snaps);
    }

    private async loadListings() {
        const snap = await getDocs(
            query(collection(this.fs, 'meli_listings'), where('is_full', '==', true))
        );
        this.listings.set(
            snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id:                 d.id,
                    title:              data.title ?? '',
                    sku:                data.seller_custom_field ?? '',
                    price:              data.price ?? 0,
                    soldQuantity:       data.sold_quantity ?? 0,
                    health:             data.health ?? null,
                    net_amount:         data.net_amount ?? 0,
                    selling_fee_amount: data.selling_fee_amount ?? 0,
                    net_percent:        data.net_percent ?? 0,
                    available_quantity: data.available_quantity ?? 0,
                    is_full:            data.is_full ?? false,
                    permalink:          data.permalink ?? '',
                    thumbnail:          data.thumbnail ?? '',
                    priceToWin:         data.priceToWin ?? null,
                };
            }).sort((a, b) => b.soldQuantity - a.soldQuantity)
        );
    }

    private async loadInventory() {
        const snap = await getDocs(collection(this.fs, 'meli_fbm_inventory'));
        const sorted = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id:                    d.id,
                    sku:                   data.sku ?? null,
                    title:                 data.title ?? '',
                    mlItemId:              data.mlItemId ?? '',
                    fullStock:             data.fullStock ?? 0,
                    fullStockReserved:     data.fullStockReserved ?? 0,
                    availableQuantity:     data.availableQuantity ?? 0,
                    salesVelocity30d:      data.salesVelocity30d ?? undefined,
                    salesVelocity7d:       data.salesVelocity7d  ?? undefined,
                    daysOfCoverage:        data.daysOfCoverage   ?? undefined,
                    reorderAlertLevel:     data.reorderAlertLevel ?? 'ok',
                    recommendedReplenishQty: data.recommendedReplenishQty ?? undefined,
                    projectedStockoutDate: data.projectedStockoutDate ?? undefined,
                    price:                 data.price ?? 0,
                    permalink:             data.permalink ?? undefined,
                };
            })
            .sort((a, b) => {
                const alertOrder: Record<string, number> = { stockout: 0, critical: 1, low: 2, ok: 3 };
                return (alertOrder[a.reorderAlertLevel ?? 'ok'] ?? 3) - (alertOrder[b.reorderAlertLevel ?? 'ok'] ?? 3);
            });

        this.inventory.set(sorted);

        // Auto-populate replenish batch for critical/stockout items
        const autoBatch: Record<string, number> = {};
        for (const item of sorted) {
            if (
                (item.reorderAlertLevel === 'critical' || item.reorderAlertLevel === 'stockout')
                && item.recommendedReplenishQty
            ) {
                autoBatch[item.id] = item.recommendedReplenishQty;
            }
        }
        this.replenishBatch.set(autoBatch);
    }

    // ── Chart rendering ───────────────────────────────────────────────────────

    private renderCharts() {
        this.renderRevenueChart();
        this.renderBurnChart();
    }

    private renderRevenueChart() {
        this.revenueChart?.destroy();
        const ctx = this.revenueCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;
        const snaps   = this.snapshots().sort((a, b) => a.date.localeCompare(b.date));
        const labels  = snaps.map(s => {
            const dt = new Date(s.date + 'T12:00:00');
            return dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
        });
        const revenue = snaps.map(s => s.revenue ?? 0);
        const orders  = snaps.map(s => s.orders  ?? 0);

        const grad = ctx.createLinearGradient(0, 0, 0, 260);
        grad.addColorStop(0, 'rgba(251,146,60,.3)');
        grad.addColorStop(1, 'rgba(251,146,60,.01)');

        this.revenueChart = new Chart(ctx, {
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Ingresos MXN',
                        data: revenue,
                        borderColor: '#fb923c',
                        backgroundColor: grad,
                        borderWidth: 2,
                        yAxisID: 'yRev',
                        tension: 0.4,
                        fill: true,
                        pointRadius: labels.length > 30 ? 0 : 3,
                    },
                    {
                        type: 'bar',
                        label: 'Órdenes',
                        data: orders,
                        backgroundColor: 'rgba(99,102,241,.45)',
                        yAxisID: 'yOrd',
                        borderRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x:    { ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,.04)' } },
                    yRev: { position: 'left',  ticks: { color: '#fb923c', font: { size: 10 }, callback: (v: any) => `$${(v/1000).toFixed(0)}K` }, grid: { color: 'rgba(255,255,255,.04)' } },
                    yOrd: { position: 'right', ticks: { color: '#818cf8', font: { size: 10 } }, grid: { display: false } },
                },
                plugins: {
                    legend: { display: true, labels: { color: '#a1a1aa', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => ctx.dataset.label === 'Ingresos MXN'
                                ? ` $${ctx.parsed.y.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`
                                : ` ${ctx.parsed.y} órdenes`,
                        },
                    },
                },
            },
        } as any);
    }

    private renderBurnChart() {
        this.burnChart?.destroy();
        const ctx = this.burnCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;
        const item = this.inventory().find(i => (i.reorderAlertLevel === 'critical' || i.reorderAlertLevel === 'low'))
            ?? this.inventory()[0];
        if (!item) return;

        const vel        = item.salesVelocity30d ?? 1;
        const startStock = item.availableQuantity;
        const labels: string[] = [];
        const actualStock: (number | null)[] = [];
        const projStock:   (number | null)[] = [];

        for (let d = -14; d <= 30; d++) {
            const dt = new Date();
            dt.setDate(dt.getDate() + d);
            labels.push(dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));
            if (d <= 0) {
                actualStock.push(Math.max(0, Math.round(startStock + (vel * d))));
                projStock.push(null);
            } else {
                actualStock.push(null);
                projStock.push(Math.max(0, Math.round(startStock - (vel * d))));
            }
        }

        this.burnChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: `Stock ${item.sku ?? item.title.slice(0, 20)} (real)`,
                        data: actualStock,
                        borderColor: '#10b981',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                        spanGaps: false,
                    },
                    {
                        label: 'Proyección',
                        data: projStock,
                        borderColor: '#fb923c',
                        borderWidth: 2,
                        borderDash: [5, 4],
                        pointRadius: 0,
                        tension: 0,
                        spanGaps: false,
                    },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,.04)' } },
                    y: { beginAtZero: true, ticks: { color: '#71717a', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
                },
                plugins: {
                    legend: { labels: { color: '#a1a1aa', font: { size: 11 }, boxWidth: 12 } },
                },
            },
        });
    }

    // ── Opportunity Matrix ────────────────────────────────────────────────────

    renderMatrixChart() {
        this.matrixChart?.destroy();
        const ctx = this.matrixCanvas?.nativeElement?.getContext('2d');
        if (!ctx) return;

        const data = this.matrixData();
        if (!data.length) return;

        const maxRev      = Math.max(...data.map(d => d.revenue), 1);
        const selectedId  = this.scenarioListingId();
        const self        = this;

        this.matrixChart = new Chart(ctx, {
            type: 'bubble',
            data: {
                datasets: data.map(d => {
                    // Quadrant colour: winning+fast=green, losing+fast=blue, winning+slow=yellow, losing+slow=red
                    const isWinning = d.x <= 0;
                    const isFast    = d.y >= 1;
                    let bg: string;
                    if      (isWinning && isFast)  bg = 'rgba(16,185,129,0.55)';
                    else if (!isWinning && isFast)  bg = 'rgba(59,130,246,0.55)';
                    else if (isWinning && !isFast)  bg = 'rgba(250,204,21,0.55)';
                    else                            bg = 'rgba(239,68,68,0.55)';

                    const isSelected = d.id === selectedId;
                    return {
                        label: d.label,
                        data: [{ x: d.x, y: d.y, r: Math.max(7, Math.min(32, (d.revenue / maxRev) * 32)) }],
                        backgroundColor: bg,
                        borderColor:     isSelected ? '#fb923c' : 'rgba(255,255,255,0.2)',
                        borderWidth:     isSelected ? 2.5 : 1,
                    };
                }),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event: unknown, elements: any[]) => {
                    if (elements.length > 0) {
                        const idx = elements[0].datasetIndex;
                        self.selectFromMatrix(data[idx].id);
                        setTimeout(() => self.renderMatrixChart(), 50);
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: '← Ganas buy box  |  Perdiendo precio →', color: '#52525b', font: { size: 11 } },
                        ticks: { color: '#71717a', font: { size: 10 }, callback: (v: any) => v > 0 ? `+$${v}` : `$${v}` },
                        grid:  { color: 'rgba(255,255,255,.05)' },
                    },
                    y: {
                        title: { display: true, text: 'Velocidad (u/día)', color: '#52525b', font: { size: 11 } },
                        ticks: { color: '#71717a', font: { size: 10 } },
                        grid:  { color: 'rgba(255,255,255,.05)' },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items: any) => data[items[0].datasetIndex]?.label ?? '',
                            label: (item: any) => {
                                const d = data[item.datasetIndex];
                                const winStr = d.x <= 0 ? `$${Math.abs(d.x).toFixed(0)} bajo ganador` : `+$${d.x.toFixed(0)} sobre ganador`;
                                return [`Precio gap: ${winStr}`, `Velocidad: ${d.y.toFixed(2)} u/día`, `Revenue ~$${(d.revenue/1000).toFixed(1)}K/mes`];
                            },
                        },
                    },
                    // Draw zero-line annotations manually via afterDraw
                },
                animation: { duration: 300 },
            },
        } as any);
    }
}
