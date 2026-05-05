import {
    Component, OnInit, inject, signal, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Firestore, collection, getDocs, getDoc, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Chart, registerables } from 'chart.js';
import {
    MetricsAnalyticsService, DATE_RANGES, DateRange, ChannelSnapshotDoc
} from '../services/metrics-analytics.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';
import { MetricsBigqueryService, SummaryKpisRow } from '../services/metrics-bigquery.service';

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
    unitsSold30d?: number;
    unitsSold7d?: number;
    salesVelocity30d?: number;
    salesVelocity7d?: number;
    daysOfCoverage?: number;
    reorderAlertLevel?: 'ok' | 'low' | 'critical' | 'stockout';
    recommendedReplenishQty?: number;
    projectedStockoutDate?: string;
    price: number;
    permalink?: string;
    velocityOverride?: number | null;  // user-set u/day; overrides computed vel for planning
}

/** A scheduled demand event (Hot Sale, Buen Fin, etc.) stored in config/demand_events */
interface DemandEvent {
    id: string;
    name: string;         // display name, e.g. "Hot Sale 2026"
    startDate: string;    // YYYY-MM-DD
    endDate: string;      // YYYY-MM-DD
    multiplier: number;   // velocity multiplier for planning, e.g. 2.5
    active: boolean;
}

/** Summary of May 2025 MELI_FULL performance extracted from analytics_daily */
interface May2025Analysis {
    loaded: boolean;
    // ── Full channel ───────────────────────────────────────────────
    totalRevenue: number;
    totalOrders: number;
    totalUnits: number;
    avgDailyRevenue: number;
    avgDailyUnits: number;
    peakDate: string;
    peakRevenue: number;
    peakUnits: number;
    hotSaleMultiplier: number;   // Full: peakWeek avg / rest-of-month avg
    hotSaleAvgUnits: number;
    normalAvgUnits: number;
    hasStockoutWarning: boolean;
    dailyLabels: string[];
    dailyRevenue: number[];
    dailyUnits: number[];
    // ── Classic channel (for combined market framing) ──────────────
    classicRevenue: number;
    classicOrders: number;
    classicUnits: number;
    classicHotSaleMultiplier: number;  // Classic: ×2.69 in May 2025
    // ── Combined market ────────────────────────────────────────────
    combinedRevenue: number;   // Full + Classic May 2025 total
    fullSharePct: number;      // Full as % of combined (was 34.5%)
}

type TabId = 'performance' | 'inventory' | 'scenarios';
type InvSortCol = 'title' | 'fullStock' | 'fullStockReserved' | 'unitsSold30d' | 'unitsSold7d' | 'salesVelocity30d' | 'salesVelocity7d' | 'daysOfCoverage' | 'reorderAlertLevel' | 'recommendedReplenishQty';

type PlaybookAction = 'REPONER_URGENTE' | 'BAJAR_PRECIO' | 'MANTENER' | 'REVISAR' | 'MIGRAR_A_FULL';

/** Per-SKU row in the May 2026 scenario model */
interface MayScenarioRow {
    item: InventoryItem;
    listing: MeliListing | null;
    planVel: number;
    normalUnits: number;   // vel × 25 normal days
    hsUnits: number;       // vel × 7 hot-sale days × multiplier
    totalUnits: number;    // normalUnits + hsUnits
    optUnits: number;      // optimistic: buy-box adjusted
    grossRevenue: number;
    netRevenue: number;
    optRevenue: number;
    action: PlaybookAction;
    stockGap: number;      // units short to cover May with safety stock (may be negative = surplus)
    priceGap: number | null;
    impactScore: number;   // higher = higher revenue opportunity
}

/** Aggregated May 2026 scenario totals across all Full SKUs */
interface MayScenario {
    normalDays: number;
    hotSaleDays: number;
    multiplier: number;            // Full ×1.87 baseline
    classicMultiplier: number;     // Classic ×2.69 — Full's champion target
    // The 3 strategic variants
    conservative:  { units: number; revenue: number; net: number; marketSharePct: number };
    champion:      { units: number; revenue: number; net: number; marketSharePct: number };
    optimistic:    { units: number; revenue: number; net: number; marketSharePct: number };
    // Combined market context
    combinedMay2025: number;       // $547,285 actual
    combinedMay2026Target: number; // projected combined market (+10%)
    fullShareMay2025: number;      // 34.5%
    skuRows: MayScenarioRow[];
}

/** A MeLi Classic/Regular listing cross-referenced with Full inventory */
interface ClassicChampion {
    id: string;
    title: string;
    sku: string;
    soldQuantity: number;
    price: number;
    thumbnail: string;
    permalink: string;
    isInFull: boolean;
    fullItem?: InventoryItem;
    fullListing?: MeliListing;
}

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

    private fs    = inject(Firestore);
    private fns   = inject(Functions);
    private svc   = inject(MetricsAnalyticsService);  // kept for getChannelSnapshots (visits/conversion from MeLi API)
    private bqSvc = inject(MetricsBigqueryService);
    private tf    = inject(MetricsTimeframeService);

    // ── State ─────────────────────────────────────────────────────────────────
    activeTab     = signal<TabId>('performance');
    readonly selectedRange = this.tf.selected;
    readonly dateRanges    = DATE_RANGES;

    isLoadingPerf  = signal(true);
    isLoadingInv   = signal(true);
    isSyncingInv   = signal(false);

    snapshots        = signal<ChannelSnapshotDoc[]>([]);
    listings         = signal<MeliListing[]>([]);
    inventory        = signal<InventoryItem[]>([]);
    classicListings  = signal<MeliListing[]>([]);  // MeLi Classic/Regular top sellers
    inventoryFilter  = signal<'all' | 'ok' | 'low' | 'critical' | 'stockout'>('all');

    // ── Inventory table controls ──────────────────────────────────────────
    invSearch    = signal('');
    invSortCol   = signal<InvSortCol>('reorderAlertLevel');
    invSortDir   = signal<'asc' | 'desc'>('asc');
    invPage      = signal(1);
    invPageSize  = signal(25);

    // Scenario — price simulator
    scenarioListingId = signal<string>('');
    scenarioPct       = signal(0);

    // Scenario — replenishment batch: itemId → qty to send
    replenishBatch = signal<Record<string, number>>({});

    // ── Operational config (settings/meli_full) ───────────────────────────────
    leadTimeDays    = signal<number>(12);   // calendar days from our warehouse → MeLi warehouse
    isSavingConfig  = signal(false);

    // ── Demand Events ─────────────────────────────────────────────────────────
    demandEvents      = signal<DemandEvent[]>([]);
    isLoadingEvents   = signal(false);
    isSavingEvent     = signal(false);
    showEventForm     = signal(false);
    /** New-event form draft */
    newEvent = signal<Omit<DemandEvent, 'id'>>({ name: '', startDate: '', endDate: '', multiplier: 2.0, active: true });

    // ── May 2025 Analysis ─────────────────────────────────────────────────────
    may2025           = signal<May2025Analysis | null>(null);
    isLoadingMay2025  = signal(false);
    private may2025Chart?: Chart;

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

    // ── KPIs: revenue/orders/units from BigQuery; visits/conversion from Firestore snapshots ────
    readonly perfKpis = computed(() => {
        const bq     = this.bqChannelKpis();
        const snaps  = this.snapshots();
        // Revenue, orders, units: prefer BQ (accurate, from raw orders)
        const revenue   = bq?.revenue ?? snaps.reduce((s, d) => s + (d.revenue ?? 0), 0);
        const orders    = bq?.orders  ?? snaps.reduce((s, d) => s + (d.orders  ?? 0), 0);
        const units     = bq?.units   ?? snaps.reduce((s, d) => s + (d.units   ?? 0), 0);
        const avgTicket = orders > 0 ? revenue / orders : 0;
        // Visits & conversion: only available from Firestore channel snapshots (MeLi API)
        const totalVisits   = snaps.reduce((s, d) => s + (d.visits ?? 0), 0);
        const avgConversion = totalVisits > 0 ? (orders / totalVisits) * 100 : 0;
        const ls            = this.listings();
        const avgHealth     = ls.length > 0
            ? ls.filter(l => l.health != null).reduce((s, l) => s + (l.health ?? 0), 0)
              / ls.filter(l => l.health != null).length
            : null;
        return { revenue, orders, units, avgTicket, totalVisits, avgConversion, avgHealth };
    });

    // BQ-sourced channel KPIs for the selected period (MELI_FULL only)
    bqChannelKpis = signal<SummaryKpisRow | null>(null);

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

    // Legacy computed (still used by replenishment planner)
    readonly filteredInventory = computed(() => {
        const f = this.inventoryFilter();
        const inv = this.inventory();
        return f === 'all' ? inv : inv.filter(i => i.reorderAlertLevel === f);
    });

    readonly sortedFilteredInventory = computed(() => {
        const alertOrder: Record<string, number> = { stockout: 0, critical: 1, low: 2, ok: 3 };
        const q   = this.invSearch().trim().toLowerCase();
        const f   = this.inventoryFilter();
        const col = this.invSortCol();
        const dir = this.invSortDir();

        let rows = this.inventory();
        // status filter
        if (f !== 'all') rows = rows.filter(i => i.reorderAlertLevel === f);
        // search filter
        if (q) rows = rows.filter(i =>
            (i.title ?? '').toLowerCase().includes(q) ||
            (i.sku ?? '').toLowerCase().includes(q) ||
            (i.mlItemId ?? '').toLowerCase().includes(q)
        );
        // sort
        rows = [...rows].sort((a, b) => {
            let va: any, vb: any;
            switch (col) {
                case 'reorderAlertLevel':
                    va = alertOrder[a.reorderAlertLevel ?? 'ok'] ?? 3;
                    vb = alertOrder[b.reorderAlertLevel ?? 'ok'] ?? 3; break;
                case 'title': va = a.title.toLowerCase(); vb = b.title.toLowerCase(); break;
                default: va = (a as any)[col] ?? 0; vb = (b as any)[col] ?? 0;
            }
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
        return rows;
    });

    readonly invTotalPages = computed(() =>
        Math.max(1, Math.ceil(this.sortedFilteredInventory().length / this.invPageSize()))
    );

    readonly pagedInventory = computed(() => {
        const page = this.invPage();
        const size = this.invPageSize();
        const rows = this.sortedFilteredInventory();
        return rows.slice((page - 1) * size, page * size);
    });

    readonly invPageNumbers = computed(() => {
        const total = this.invTotalPages();
        const cur   = this.invPage();
        const pages: number[] = [];
        const delta = 2;
        for (let i = Math.max(1, cur - delta); i <= Math.min(total, cur + delta); i++) pages.push(i);
        return pages;
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
            // When no priceToWin, put these items off to the left at a sentinel so they are still visible
            const hasPrice = l.priceToWin != null;
            const gap      = hasPrice ? l.price - l.priceToWin! : null;
            const revenue  = l.price * vel * 30;
            const label    = l.title.slice(0, 35);
            return { id: l.id, label, x: gap ?? 0, y: vel, revenue, hasPrice };
        });
    });

    // ── Scenarios Command Table data (joined, sorted by urgency) ──────────────
    readonly scenariosTableData = computed(() => {
        const alertOrder: Record<string, number> = { stockout: 0, critical: 1, low: 2, ok: 3 };
        return this.listings().map(l => {
            const inv    = this.inventory().find(i => i.mlItemId === l.id);
            const gap    = l.priceToWin != null ? l.price - l.priceToWin : null;
            const gapPct = gap != null && l.price > 0 ? (gap / l.price) * 100 : null;
            return { listing: l, inv, gap, gapPct, isSelected: l.id === this.scenarioListingId() };
        }).sort((a, b) => {
            const aAlert = alertOrder[a.inv?.reorderAlertLevel ?? 'ok'] ?? 3;
            const bAlert = alertOrder[b.inv?.reorderAlertLevel ?? 'ok'] ?? 3;
            if (aAlert !== bAlert) return aAlert - bAlert;
            // Secondary: losing price competition first
            const aLosing = (a.gap ?? 0) > 0 ? 1 : 0;
            const bLosing = (b.gap ?? 0) > 0 ? 1 : 0;
            if (aLosing !== bLosing) return bLosing - aLosing;
            // Tertiary: revenue desc
            const aRev = (a.inv?.salesVelocity30d ?? 0) * 30 * a.listing.price;
            const bRev = (b.inv?.salesVelocity30d ?? 0) * 30 * b.listing.price;
            return bRev - aRev;
        });
    });

    // ── Portfolio KPIs (all Full listings combined) ───────────────────────────
    readonly portfolioRevenue = computed(() =>
        this.listings().reduce((sum, l) => {
            const vel = this.inventory().find(i => i.mlItemId === l.id)?.salesVelocity30d ?? 0;
            return sum + vel * 30 * l.price;
        }, 0)
    );

    readonly portfolioNet = computed(() =>
        this.listings().reduce((sum, l) => {
            const vel = this.inventory().find(i => i.mlItemId === l.id)?.salesVelocity30d ?? 0;
            return sum + vel * 30 * l.net_amount;
        }, 0)
    );

    readonly portfolioWinning = computed(() =>
        this.listings().filter(l => l.priceToWin != null && l.price <= l.priceToWin).length
    );

    /** Potential gross sales value: sum of (availableQuantity × price) for all Full inventory items.
     *  Answers: "how much $$ do I have sitting in MeLi warehouse at current list prices?" */
    readonly inventoryPotentialValue = computed(() =>
        this.inventory().reduce((sum, item) =>
            sum + (item.availableQuantity ?? 0) * (item.price ?? 0), 0
        )
    );

    /** Potential net value: same but using net_amount per unit (after MeLi fees + shipping est).
     *  Joined from listings since inventory items carry the listing price; net_amount lives on the listing. */
    readonly inventoryPotentialNet = computed(() =>
        this.inventory().reduce((sum, item) => {
            const listing = this.listings().find(l => l.id === item.mlItemId);
            const net = listing?.net_amount ?? 0;
            return sum + (item.availableQuantity ?? 0) * net;
        }, 0)
    );

    /** Total available units across all Full inventory items. */
    readonly inventoryTotalUnits = computed(() =>
        this.inventory().reduce((sum, item) => sum + (item.availableQuantity ?? 0), 0)
    );

    /** Count of inventory items that have at least 1 unit available. */
    readonly inventoryInStockCount = computed(() =>
        this.inventory().filter(i => (i.availableQuantity ?? 0) > 0).length
    );

    /**
     * Per-item planning velocity map.
     * Priority: velocityOverride > auto-recovery (vel7d when vel7d > vel30d×1.3) > vel30d.
     * This is the velocity used for replenishment qty calculation.
     */
    readonly planningVelocities = computed(() => {
        const map: Record<string, number> = {};
        for (const item of this.inventory()) {
            const v30 = item.salesVelocity30d ?? 0;
            const v7  = item.salesVelocity7d  ?? 0;
            const isRecovering = v7 > 0 && v30 > 0 && v7 > v30 * 1.3;
            map[item.id] = item.velocityOverride != null
                ? item.velocityOverride
                : (isRecovering ? v7 : v30);
        }
        return map;
    });

    /** True per-item flag: is this SKU in post-stockout recovery mode? */
    isRecovering(item: InventoryItem): boolean {
        const v30 = item.salesVelocity30d ?? 0;
        const v7  = item.salesVelocity7d  ?? 0;
        return v7 > 0 && v30 > 0 && v7 > v30 * 1.3;
    }

    /** Active demand events that matter for planning */
    readonly activeEvents = computed(() => this.demandEvents().filter(e => e.active));

    /**
     * Returns the combined multiplier for an inventory item if any active event
     * falls within its coverage window (days of coverage from today).
     */
    getEventMultiplierForItem(item: InventoryItem): { multiplier: number; eventName: string; daysAway: number } | null {
        const today     = new Date();
        const coverDays = item.daysOfCoverage ?? 0;
        const windowEnd = new Date(today.getTime() + coverDays * 86_400_000);

        for (const ev of this.activeEvents()) {
            const evStart  = new Date(ev.startDate + 'T00:00:00');
            const evEnd    = new Date(ev.endDate   + 'T23:59:59');
            // Overlaps if event starts before window ends AND event ends after today
            if (evStart <= windowEnd && evEnd >= today) {
                const daysAway = Math.ceil((evStart.getTime() - today.getTime()) / 86_400_000);
                return { multiplier: ev.multiplier, eventName: ev.name, daysAway: Math.max(0, daysAway) };
            }
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────

    ngOnInit() { this.loadAll(); }
    ngAfterViewInit() {
        this.viewReady = true;
        if (!this.isLoadingPerf()) this.renderCharts();
    }
    ngOnDestroy() {
        this.revenueChart?.destroy();
        this.burnChart?.destroy();
        this.matrixChart?.destroy();
        this.may2025Chart?.destroy();
    }

    setTab(t: TabId) {
        this.activeTab.set(t);
        if (t === 'scenarios') {
            setTimeout(() => { this.renderMatrixChart(); this.renderMay2025Chart(); }, 100);
        }
        if (t === 'inventory') {
            setTimeout(() => this.renderBurnChart(), 80);
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
        this.invPage.set(1);
    }

    setInvSearch(q: string) {
        this.invSearch.set(q);
        this.invPage.set(1);
    }

    sortInv(col: InvSortCol) {
        if (this.invSortCol() === col) {
            this.invSortDir.update(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            this.invSortCol.set(col);
            this.invSortDir.set('asc');
        }
        this.invPage.set(1);
    }

    setInvPage(p: number) {
        this.invPage.set(Math.max(1, Math.min(p, this.invTotalPages())));
    }

    setInvPageSize(size: number) {
        this.invPageSize.set(size);
        this.invPage.set(1);
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

    alertBadgeClass(level?: string): string {
        switch (level) {
            case 'stockout': return 'abadge abadge-stockout';
            case 'critical': return 'abadge abadge-critical';
            case 'low':      return 'abadge abadge-low';
            default:         return 'abadge abadge-ok';
        }
    }

    alertLabel(level?: string): string {
        switch (level) {
            case 'stockout': return 'SIN STOCK';
            case 'critical': return 'CRÍTICO';
            case 'low':      return 'BAJO';
            default:         return 'OK';
        }
    }

    coveragePct(item: InventoryItem): number {
        const d = item.daysOfCoverage ?? 0;
        return Math.min(100, Math.round((d / 45) * 100));
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private async loadAll() {
        await Promise.all([
            this.loadSnapshots(),
            this.loadListings(),   // also populates classicListings in one fetch
            this.loadInventory(),
            this.loadMeliConfig(),
            this.loadDemandEvents(),
        ]);
        this.isLoadingPerf.set(false);
        this.isLoadingInv.set(false);
        // Load May 2025 analysis in the background (non-blocking)
        this.loadMay2025Analysis();
        await new Promise(resolve => setTimeout(resolve, 80));
        if (this.viewReady) this.renderCharts();
    }

    private async loadMeliConfig() {
        try {
            const snap = await getDoc(doc(this.fs, 'config', 'meli_full'));
            if (snap.exists()) {
                const data = snap.data() as any;
                this.leadTimeDays.set(Number(data['leadTimeDays'] ?? 12));
            } else {
                // First run — seed the document with defaults
                await setDoc(doc(this.fs, 'config', 'meli_full'), {
                    leadTimeDays:       12,
                    targetCoverageDays: 45,
                    safetyStockDays:    7,
                    updatedAt:          new Date().toISOString(),
                });
            }
        } catch { /* silent: use signal default */ }
    }

    async saveLeadTime(days: number) {
        const val = Math.max(1, Math.round(days));
        this.isSavingConfig.set(true);
        try {
            await setDoc(doc(this.fs, 'config', 'meli_full'), {
                leadTimeDays: val,
                updatedAt:    new Date().toISOString(),
            }, { merge: true });
            this.leadTimeDays.set(val);
        } finally { this.isSavingConfig.set(false); }
    }

    private async loadSnapshots() {
        // Keep Firestore snapshots for visits/conversion rate data (MeLi API source)
        const snaps = await this.svc.getChannelSnapshots('MELI_FULL', this.tf.selected());
        this.snapshots.set(snaps);
        // Replace revenue/orders/units with BigQuery for accuracy
        try {
            const { fromDate, toDate } = this.bqSvc.getDateStrings(this.tf.selected());
            const rows = await this.bqSvc.querySummaryKpisBetween(fromDate, toDate);
            const meliFullRow = rows.find(r => r.source_channel === 'MELI_FULL') ?? null;
            this.bqChannelKpis.set(meliFullRow);
        } catch (e) {
            console.warn('[MeliFullReport] BQ KPI load failed, falling back to snapshots:', e);
            this.bqChannelKpis.set(null);
        }
    }

    private async loadListings() {
        // Single fetch for ALL meli_listings — then split into Full vs Classic.
        // Two concurrent getDocs calls on the same collection cause the Firestore SDK
        // to deduplicate the request; the second call gets an already-consumed snapshot
        // where doc.data() returns {}, leaving classicChampions with empty titles.
        const snap = await getDocs(collection(this.fs, 'meli_listings'));

        const mapListing = (d: any): MeliListing & { logistic_type: string } => {
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
                is_full:            data.is_full ?? (data.logistic_type === 'fulfillment'),
                permalink:          data.permalink ?? '',
                thumbnail:          data.thumbnail ?? '',
                priceToWin:         data.priceToWin ?? null,
                logistic_type:      data.logistic_type ?? '',
            };
        };

        const all = snap.docs.map(mapListing);

        // Full listings: logistic_type === 'fulfillment' OR is_full explicitly true
        this.listings.set(
            all
                .filter(l => l.logistic_type === 'fulfillment' || l.is_full === true)
                .sort((a, b) => b.soldQuantity - a.soldQuantity)
        );

        // Classic listings: everything else, top 15 by soldQuantity
        this.classicListings.set(
            all
                .filter(l => l.logistic_type !== 'fulfillment' && !l.is_full)
                .sort((a, b) => b.soldQuantity - a.soldQuantity)
                .slice(0, 15)
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
                    unitsSold30d:          data.unitsSold30d ?? undefined,
                    unitsSold7d:           data.unitsSold7d  ?? undefined,
                    salesVelocity30d:      data.salesVelocity30d ?? undefined,
                    salesVelocity7d:       data.salesVelocity7d  ?? undefined,
                    daysOfCoverage:        data.daysOfCoverage   ?? undefined,
                    reorderAlertLevel:     data.reorderAlertLevel ?? 'ok',
                    recommendedReplenishQty: data.recommendedReplenishQty ?? undefined,
                    projectedStockoutDate: data.projectedStockoutDate ?? undefined,
                    price:                 data.price ?? 0,
                    permalink:             data.permalink ?? undefined,
                    velocityOverride:      data.velocityOverride ?? null,
                };
            })
            .sort((a, b) => {
                const alertOrder: Record<string, number> = { stockout: 0, critical: 1, low: 2, ok: 3 };
                return (alertOrder[a.reorderAlertLevel ?? 'ok'] ?? 3) - (alertOrder[b.reorderAlertLevel ?? 'ok'] ?? 3);
            });

        this.inventory.set(sorted);

        // ── May 2026 Scenario (computed, no extra fetch needed) ──────────────

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

    // ── Demand Events CRUD ────────────────────────────────────────────────────

    async loadDemandEvents() {
        this.isLoadingEvents.set(true);
        try {
            const snap   = await getDocs(collection(this.fs, 'config_demand_events'));
            const events: DemandEvent[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

            if (events.length === 0) {
                // First run — seed Hot Sale 2026
                const hotSale: Omit<DemandEvent, 'id'> = {
                    name: 'Hot Sale 2026', startDate: '2026-05-26', endDate: '2026-06-01',
                    multiplier: 2.0, active: true,
                };
                const ref = doc(collection(this.fs, 'config_demand_events'));
                await setDoc(ref, hotSale);
                this.demandEvents.set([{ id: ref.id, ...hotSale }]);
            } else {
                this.demandEvents.set(events.sort((a, b) => a.startDate.localeCompare(b.startDate)));
            }
        } catch (e) { console.warn('[MeliFullReport] Could not load demand events', e); }
        finally { this.isLoadingEvents.set(false); }
    }

    async saveDemandEvent() {
        const draft = this.newEvent();
        if (!draft.name || !draft.startDate || !draft.endDate) return;
        this.isSavingEvent.set(true);
        try {
            const ref  = doc(collection(this.fs, 'config_demand_events'));
            const data = { ...draft, multiplier: Number(draft.multiplier) };
            await setDoc(ref, data);
            this.demandEvents.update(evs => [...evs, { id: ref.id, ...data }]
                .sort((a, b) => a.startDate.localeCompare(b.startDate)));
            this.newEvent.set({ name: '', startDate: '', endDate: '', multiplier: 2.0, active: true });
            this.showEventForm.set(false);
        } finally { this.isSavingEvent.set(false); }
    }

    async toggleEvent(id: string) {
        const ev = this.demandEvents().find(e => e.id === id);
        if (!ev) return;
        const updated = { ...ev, active: !ev.active };
        await setDoc(doc(this.fs, 'config_demand_events', id), { active: updated.active }, { merge: true });
        this.demandEvents.update(evs => evs.map(e => e.id === id ? updated : e));
    }

    async deleteEvent(id: string) {
        await deleteDoc(doc(this.fs, 'config_demand_events', id));
        this.demandEvents.update(evs => evs.filter(e => e.id !== id));
    }

    // ── Classic Listings (for Cross-Channel Champions) ────────────────────────


    // ── May 2026 Scenario computed ────────────────────────────────────────────

    /** True when ALL Full inventory items have zero planning velocity — i.e. Sync hasn’t run yet */
    readonly noVelocityData = computed(() =>
        this.inventory().length > 0 &&
        this.inventory().every(i => (i.salesVelocity30d ?? 0) === 0)
    );

    /** Returns the best multiplier to use for May 2026: active Hot Sale event → May 2025 data → default 2.0 */
    private getMayMultiplier(): number {
        const hsEvent = this.activeEvents().find(e => e.name.toLowerCase().includes('hot sale'));
        if (hsEvent) return hsEvent.multiplier;
        const may = this.may2025();
        if (may?.loaded && !may.hasStockoutWarning && may.hotSaleMultiplier > 1) return may.hotSaleMultiplier;
        return 1.87; // real May 2025 Full baseline
    }

    private getClassicMultiplier(): number {
        const may = this.may2025();
        if (may?.loaded && may.classicHotSaleMultiplier > 1) return may.classicHotSaleMultiplier;
        return 2.69; // real May 2025 Classic baseline — Full's champion target
    }

    readonly mayScenario = computed((): MayScenario | null => {
        const inv      = this.inventory();
        const listings = this.listings();
        if (!inv.length) return null;

        const NORMAL_DAYS   = 25;   // May 1–25
        const HOT_SALE_DAYS = 7;    // May 26–Jun 1
        const multiplier        = this.getMayMultiplier();    // Full baseline ×1.87
        const classicMultiplier = this.getClassicMultiplier(); // Champion target ×2.69
        const velocities        = this.planningVelocities();
        const leadTime          = this.leadTimeDays();

        // Real May 2025 combined market
        const may25 = this.may2025();
        const combinedMay2025      = may25?.combinedRevenue  ?? 547_285;
        const fullShareMay2025     = may25?.fullSharePct     ?? 0.345;
        const combinedMay2026Target = combinedMay2025 * 1.10; // market grows 10%

        const skuRows: MayScenarioRow[] = [];
        const tierRates: Record<string, number> = { high: 0.03, medium: 0.04, low: 0.05 };

        let conservUnits = 0, conservRevenue = 0, conservNet = 0;
        let champUnitsTotal = 0, champRevenueTotal = 0, champNetTotal = 0;
        let optUnitsTotal = 0, optRevenueTotal = 0, optNetTotal = 0;

        for (const item of inv) {
            const listing    = listings.find(l => l.id === item.mlItemId) ?? null;
            const planVel    = velocities[item.id] ?? 0;
            const price      = listing?.price ?? item.price ?? 0;
            const netAmt     = listing?.net_amount ?? 0;

            // ── Conservative: Full holds current ~34.5% share
            // Same velocity, Full's own ×1.87 multiplier
            const normalUnits = planVel * NORMAL_DAYS;
            const hsUnitsCons = planVel * HOT_SALE_DAYS;
            const totalConserv = normalUnits + hsUnitsCons;  // no HS boost = worst case

            // ── Champion (Hot Sale): Full matches Classic's ×2.69 via proper stocking + buy-box
            // Target: Full grows from 34.5% → 45% of combined market
            const hsUnitsChamp  = planVel * HOT_SALE_DAYS * classicMultiplier;
            const champVelBoost = 0.45 / Math.max(fullShareMay2025, 0.01); // scale up by target share gain
            const champTotal    = (normalUnits * Math.min(champVelBoost, 1.35)) + hsUnitsChamp;

            // ── Optimistic: Full takes 55% of a 20% larger market
            // Also wins buy-box on losing SKUs
            let optVelMultiplier = 1.2; // baseline 20% growth on normal days
            if (listing?.priceToWin != null && price > listing.priceToWin) {
                const gapPct = ((price - listing.priceToWin) / price) * 100;
                const vel    = planVel;
                const tier   = vel > 2 ? 'high' : vel >= 0.5 ? 'medium' : 'low';
                const boost  = 1 + gapPct * tierRates[tier];
                const commRate  = price > 0 ? (listing.selling_fee_amount / price) : 0;
                const breakEven = commRate < 1 ? (netAmt + 85) / (1 - commRate) : 0;
                if (listing.priceToWin >= breakEven) optVelMultiplier = Math.max(optVelMultiplier, boost);
            }
            const hsUnitsOpt = planVel * HOT_SALE_DAYS * classicMultiplier * 1.1;  // exceed Classic
            const optNormal  = normalUnits * optVelMultiplier;
            const optTotal   = optNormal + hsUnitsOpt;

            // Action logic (unchanged)
            const daysOfCoverage = item.daysOfCoverage ?? 999;
            const gap = listing?.priceToWin != null ? price - listing.priceToWin : null;
            let action: PlaybookAction;
            if      (planVel === 0)                                        action = 'REVISAR';
            else if (daysOfCoverage < Math.max(20, leadTime + 5))         action = 'REPONER_URGENTE';
            else if (gap != null && gap > 0 && planVel >= 0.5)            action = 'BAJAR_PRECIO';
            else                                                           action = 'MANTENER';

            const stockNeeded = Math.ceil(champTotal);
            const stockGap    = stockNeeded - (item.availableQuantity ?? 0);
            const actionWeight = action === 'REPONER_URGENTE' ? 2.5 : action === 'BAJAR_PRECIO' ? 1.8 : 1;
            const impactScore  = planVel * 32 * price * actionWeight;

            const grossRevenue = totalConserv * price;
            const netRevenue   = totalConserv * netAmt;
            const optRevenue   = optTotal     * price;

            skuRows.push({
                item, listing, planVel,
                normalUnits, hsUnits: hsUnitsChamp, totalUnits: champTotal,
                optUnits: optTotal, grossRevenue, netRevenue, optRevenue,
                action, stockGap, priceGap: gap, impactScore,
            });

            conservUnits   += totalConserv;  conservRevenue += totalConserv * price; conservNet += totalConserv * netAmt;
            champUnitsTotal+= champTotal;    champRevenueTotal += champTotal * price;   champNetTotal += champTotal * netAmt;
            optUnitsTotal  += optTotal;      optRevenueTotal  += optTotal * price;    optNetTotal  += optTotal * netAmt;
        }

        skuRows.sort((a, b) => b.impactScore - a.impactScore);

        // Compute real market share percentages based on projected combined market
        const conservShare = combinedMay2026Target > 0 ? conservRevenue  / combinedMay2026Target : 0;
        const champShare   = combinedMay2026Target > 0 ? champRevenueTotal / combinedMay2026Target : 0;
        const optShare     = combinedMay2026Target > 0 ? optRevenueTotal  / combinedMay2026Target : 0;

        return {
            normalDays: NORMAL_DAYS, hotSaleDays: HOT_SALE_DAYS,
            multiplier, classicMultiplier,
            conservative: { units: conservUnits,    revenue: conservRevenue,    net: conservNet,    marketSharePct: conservShare },
            champion:     { units: champUnitsTotal,  revenue: champRevenueTotal, net: champNetTotal,  marketSharePct: champShare },
            optimistic:   { units: optUnitsTotal,    revenue: optRevenueTotal,   net: optNetTotal,    marketSharePct: optShare },
            combinedMay2025, combinedMay2026Target, fullShareMay2025,
            skuRows,
        };
    });

    // ── Cross-Channel Champions ───────────────────────────────────────────────

    readonly classicChampions = computed((): ClassicChampion[] => {
        const classic  = this.classicListings();
        const fullInv  = this.inventory();
        const fullList = this.listings();
        return classic.map(cl => {
            // Match by SKU (most reliable cross-channel key)
            const fullItem    = fullInv.find(i => i.sku && cl.sku && i.sku === cl.sku);
            const fullListing = fullItem ? fullList.find(l => l.id === fullItem.mlItemId) : undefined;
            return {
                id: cl.id, title: cl.title, sku: cl.sku,
                soldQuantity: cl.soldQuantity, price: cl.price,
                thumbnail: cl.thumbnail, permalink: cl.permalink,
                isInFull: !!fullItem, fullItem, fullListing,
            };
        });
    });

    readonly championsNotInFull = computed(() =>
        this.classicChampions().filter(c => !c.isInFull).length
    );

    // ── Playbook: top-priority action list ───────────────────────────────────

    readonly playbook = computed((): MayScenarioRow[] => {
        const sc = this.mayScenario();
        if (!sc) return [];
        const actionPriority: Record<PlaybookAction, number> = {
            REPONER_URGENTE: 0, BAJAR_PRECIO: 1, MIGRAR_A_FULL: 2, MANTENER: 3, REVISAR: 4,
        };
        return [...sc.skuRows].sort((a, b) => {
            const ap = actionPriority[a.action] ?? 9;
            const bp = actionPriority[b.action] ?? 9;
            if (ap !== bp) return ap - bp;
            return b.impactScore - a.impactScore;
        });
    });

    readonly playbookCounts = computed(() => ({
        reponer: this.playbook().filter(r => r.action === 'REPONER_URGENTE').length,
        precio:  this.playbook().filter(r => r.action === 'BAJAR_PRECIO').length,
        mantener:this.playbook().filter(r => r.action === 'MANTENER').length,
        revisar: this.playbook().filter(r => r.action === 'REVISAR').length,
    }));

    playbookActionLabel(action: PlaybookAction): string {
        const map: Record<PlaybookAction, string> = {
            REPONER_URGENTE: '🚨 Reponer urgente',
            BAJAR_PRECIO:    '💰 Bajar precio',
            MIGRAR_A_FULL:   '🚀 Migrar a Full',
            MANTENER:        '✅ Mantener',
            REVISAR:         '🔍 Revisar',
        };
        return map[action] ?? action;
    }

    playbookActionClass(action: PlaybookAction): string {
        const map: Record<PlaybookAction, string> = {
            REPONER_URGENTE: 'pb-action-reponer',
            BAJAR_PRECIO:    'pb-action-precio',
            MIGRAR_A_FULL:   'pb-action-migrar',
            MANTENER:        'pb-action-mantener',
            REVISAR:         'pb-action-revisar',
        };
        return map[action] ?? '';
    }

    // ── May 2026 Scenario Export ──────────────────────────────────────────────

    exportMayScenario() {
        const sc = this.mayScenario();
        if (!sc) return;
        const lines: string[] = [
            'SKU\tProducto\tAcción\tVel. Plan (u/d)\tUnid. Cons.\tRevenue Cons. (MXN)\tUnid. Hot Sale Peak\tRevenue Peak (MXN)\tGap vs Buy Box ($)\tStock Extra Necesario'
        ];
        for (const row of sc.skuRows) {
            lines.push([
                row.item.sku ?? '—',
                row.listing?.title ?? row.item.title,
                this.playbookActionLabel(row.action).replace(/[^a-zA-Z ]/g, '').trim(),
                row.planVel.toFixed(2),
                Math.round(row.totalUnits).toString(),
                Math.round(row.grossRevenue).toString(),
                Math.round(row.normalUnits + row.hsUnits).toString(),
                Math.round(row.optRevenue).toString(),
                row.priceGap != null ? row.priceGap.toFixed(0) : '—',
                Math.max(0, row.stockGap).toString(),
            ].join('\t'));
        }
        lines.push('');
        lines.push(`TOTALES\t\t\t\t${Math.round(sc.conservative.units)}\t${Math.round(sc.conservative.revenue)}\t${Math.round(sc.champion.units)}\t${Math.round(sc.champion.revenue)}\t\t`);

        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `escenario-mayo-2026-meli-full-${new Date().toISOString().slice(0, 10)}.tsv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    updateNewEventField(field: keyof Omit<DemandEvent, 'id'>, value: any) {
        this.newEvent.update(e => ({ ...e, [field]: value }));
    }

    // ── Velocity Override ─────────────────────────────────────────────────────

    async setVelocityOverride(itemId: string, rawVal: string) {
        const val = rawVal.trim() === '' ? null : Number(rawVal);
        if (val !== null && (isNaN(val) || val < 0)) return;
        try {
            await setDoc(doc(this.fs, 'meli_fbm_inventory', itemId),
                { velocityOverride: val }, { merge: true });
            this.inventory.update(inv =>
                inv.map(i => i.id === itemId ? { ...i, velocityOverride: val } : i)
            );
        } catch (e) { console.error('[MeliFullReport] Failed to save velocity override', e); }
    }

    // ── May 2025 Historical Analysis ──────────────────────────────────────────

    async loadMay2025Analysis() {
        this.isLoadingMay2025.set(true);
        try {
            // Use BigQuery instead of Firestore analytics_daily
            // dailyTrend filtered to MELI_FULL gives per-day revenue/orders/units directly
            const trend = await this.bqSvc.queryDailyTrendBetween('2025-05-01', '2025-05-31', 'MELI_FULL');

            // Also fetch Classic channel for combined market framing
            const kpis       = await this.bqSvc.querySummaryKpisBetween('2025-05-01', '2025-05-31');
            const classicRow = kpis.find(r => r.source_channel === 'MELI_CLASSIC');
            const fullRow    = kpis.find(r => r.source_channel === 'MELI_FULL');

            const dailyLabels:  string[] = [];
            const dailyRevenue: number[] = [];
            const dailyUnits:   number[] = [];

            let totalRevenue = 0, totalOrders = 0, totalUnits = 0;
            let peakRevenue  = 0, peakUnits = 0, peakDate = '';

            // Hot Sale 2025 typically ran May 26–31
            const HOT_SALE_START = '2025-05-26';
            const hotDaysUnits:    number[] = [];
            const normalDaysUnits: number[] = [];

            for (const d of trend) {
                const rev = d.revenue ?? 0;
                const ord = d.orders  ?? 0;
                const u   = d.units   ?? 0;
                const dt  = new Date(d.order_date + 'T12:00:00');
                const lbl = dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

                dailyLabels.push(lbl);
                dailyRevenue.push(rev);
                dailyUnits.push(u);
                totalRevenue += rev;
                totalOrders  += ord;
                totalUnits   += u;

                if (rev > peakRevenue) { peakRevenue = rev; peakDate = d.order_date; }
                if (u  > peakUnits)    { peakUnits = u; }

                if (d.order_date >= HOT_SALE_START) {
                    hotDaysUnits.push(u);
                } else {
                    normalDaysUnits.push(u);
                }
            }

            const avgDailyRevenue = trend.length > 0 ? totalRevenue / trend.length : 0;
            const avgDailyUnits   = trend.length > 0 ? totalUnits   / trend.length : 0;

            const hotSaleAvgUnits  = hotDaysUnits.length   > 0
                ? hotDaysUnits.reduce((a, b) => a + b, 0)   / hotDaysUnits.length   : 0;
            const normalAvgUnits   = normalDaysUnits.length > 0
                ? normalDaysUnits.reduce((a, b) => a + b, 0) / normalDaysUnits.length : 0;

            const rawMultiplier    = normalAvgUnits > 0 ? hotSaleAvgUnits / normalAvgUnits : 1;
            // Warning: if Hot Sale avg is LOWER than normal, likely had stockout during the event
            const hasStockoutWarning = hotSaleAvgUnits < normalAvgUnits * 0.7;

            // Classic channel totals: use BQ summaryKpis (period totals)
            // Per-day hot-sale breakdown not available for Classic via BQ dailyTrend (filtered),
            // so fall back to hardcoded ×2.69 multiplier from May 2025 actual data.
            const classicRevenue = classicRow?.revenue ?? 0;
            const classicOrders  = classicRow?.orders  ?? 0;
            const classicUnits   = classicRow?.units   ?? 0;
            const classicHotSaleMultiplier = 2.69;  // historical May 2025 actual — ×2.69 during Hot Sale

            const combinedRevenue = totalRevenue + classicRevenue;
            const fullSharePct    = combinedRevenue > 0 ? totalRevenue / combinedRevenue : 0.345;

            this.may2025.set({
                loaded: trend.length > 0,
                totalRevenue, totalOrders, totalUnits,
                avgDailyRevenue, avgDailyUnits,
                peakDate, peakRevenue, peakUnits,
                hotSaleMultiplier: Math.max(1, rawMultiplier),
                hotSaleAvgUnits, normalAvgUnits,
                dailyLabels, dailyRevenue, dailyUnits,
                hasStockoutWarning,
                classicRevenue, classicOrders, classicUnits,
                classicHotSaleMultiplier: Math.max(1, classicHotSaleMultiplier),
                combinedRevenue, fullSharePct,
            });

            // Auto-update Hot Sale 2026 multiplier from real data (only if data is clean)
            if (!hasStockoutWarning && rawMultiplier > 1.1) {
                const hsEvent = this.demandEvents().find(e => e.name.toLowerCase().includes('hot sale 2026'));
                if (hsEvent && Math.abs(hsEvent.multiplier - rawMultiplier) > 0.2) {
                    const rounded = Math.round(rawMultiplier * 10) / 10;
                    await setDoc(doc(this.fs, 'config_demand_events', hsEvent.id),
                        { multiplier: rounded }, { merge: true });
                    this.demandEvents.update(evs =>
                        evs.map(e => e.id === hsEvent.id ? { ...e, multiplier: rounded } : e)
                    );
                }
            }

            setTimeout(() => this.renderMay2025Chart(), 150);
        } catch (e) { console.error('[MeliFullReport] May 2025 analysis failed', e); }
        finally { this.isLoadingMay2025.set(false); }
    }

    @ViewChild('may2025Canvas') may2025Canvas?: ElementRef<HTMLCanvasElement>;

    renderMay2025Chart() {
        this.may2025Chart?.destroy();
        const ctx  = this.may2025Canvas?.nativeElement?.getContext('2d');
        const data = this.may2025();
        if (!ctx || !data?.loaded) return;

        const gradRev = ctx.createLinearGradient(0, 0, 0, 200);
        gradRev.addColorStop(0, 'rgba(251,146,60,.25)');
        gradRev.addColorStop(1, 'rgba(251,146,60,.01)');

        // Shade the Hot Sale zone (last 6 data points = May 26-31)
        const hsPluginAnnotation = {
            id: 'hotSaleShade',
            beforeDraw(chart: any) {
                const { ctx: c, chartArea: { left, right, top, bottom }, scales: { x } } = chart;
                if (!x) return;
                const startIdx = Math.max(0, data.dailyLabels.length - 6);
                const xStart = x.getPixelForValue(startIdx);
                c.save();
                c.fillStyle = 'rgba(251,146,60,.06)';
                c.fillRect(xStart, top, right - xStart, bottom - top);
                c.restore();
            }
        };

        this.may2025Chart = new Chart(ctx, {
            plugins: [hsPluginAnnotation],
            data: {
                labels: data.dailyLabels,
                datasets: [
                    {
                        type: 'line' as const,
                        label: 'Ingresos MELI FULL (MXN)',
                        data: data.dailyRevenue,
                        borderColor: '#fb923c',
                        backgroundColor: gradRev,
                        borderWidth: 2,
                        yAxisID: 'yRev',
                        tension: 0.3,
                        fill: true,
                        pointRadius: data.dailyLabels.length > 20 ? 0 : 3,
                    },
                    {
                        type: 'bar' as const,
                        label: 'Unidades vendidas',
                        data: data.dailyUnits,
                        backgroundColor: data.dailyLabels.map((_, i) =>
                            i >= data.dailyLabels.length - 6
                                ? 'rgba(251,146,60,.6)'
                                : 'rgba(99,102,241,.35)'
                        ),
                        yAxisID: 'yUnits',
                        borderRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index' as const, intersect: false },
                scales: {
                    x:      { ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 16 }, grid: { color: 'rgba(255,255,255,.04)' } },
                    yRev:   { position: 'left'  as const, ticks: { color: '#fb923c', font: { size: 10 }, callback: (v: any) => `$${(v/1000).toFixed(0)}K` }, grid: { color: 'rgba(255,255,255,.04)' } },
                    yUnits: { position: 'right' as const, ticks: { color: '#818cf8', font: { size: 10 } }, grid: { display: false } },
                },
                plugins: {
                    legend: { display: true, labels: { color: '#a1a1aa', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => ctx.dataset.label?.includes('Ingresos')
                                ? ` $${ctx.parsed.y.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`
                                : ` ${ctx.parsed.y} u`,
                        }
                    },
                },
            },
        } as any);
    }

    // ── Chart rendering ───────────────────────────────────────────────────────


    private renderCharts() {
        this.renderRevenueChart();
        // Burn chart only renders when its canvas is in the DOM (inventory tab)
        if (this.activeTab() === 'inventory') {
            setTimeout(() => this.renderBurnChart(), 60);
        }
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

        // Find most critical item — prefer one with real velocity, else any item with stock
        const inv = this.inventory();
        const item = inv.find(i => i.reorderAlertLevel === 'critical' || i.reorderAlertLevel === 'low')
            ?? inv.find(i => i.availableQuantity > 0)
            ?? inv[0];
        if (!item) return;

        const hasVelocity = (item.salesVelocity30d ?? 0) > 0;
        const vel         = hasVelocity ? (item.salesVelocity30d!) : 0;
        const startStock  = item.availableQuantity;
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

        const noVelLabel = hasVelocity
            ? `Proyección a ${Math.floor(startStock / vel)} días`
            : 'Ejecuta Sincronizar para calcular velocidad';

        this.burnChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: `Stock actual: ${item.sku ?? item.title.slice(0, 20)}`,
                        data: actualStock,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,.08)',
                        fill: true,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        spanGaps: false,
                    },
                    {
                        label: hasVelocity ? noVelLabel : noVelLabel,
                        data: projStock,
                        borderColor: hasVelocity ? '#fb923c' : '#52525b',
                        borderWidth: 2,
                        borderDash: hasVelocity ? [5, 4] : [3, 6],
                        pointRadius: 0,
                        tension: 0.2,
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
                    tooltip: { mode: 'index', intersect: false },
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
                    // Items without priceToWin are rendered neutral gray
                    let bg: string;
                    if (!d.hasPrice) {
                        bg = 'rgba(113,113,122,0.45)'; // zinc — no data
                    } else {
                        const isWinning = d.x <= 0;
                        const isFast    = d.y >= 1;
                        if      (isWinning && isFast)  bg = 'rgba(16,185,129,0.55)';
                        else if (!isWinning && isFast)  bg = 'rgba(59,130,246,0.55)';
                        else if (isWinning && !isFast)  bg = 'rgba(250,204,21,0.55)';
                        else                            bg = 'rgba(239,68,68,0.55)';
                    }
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
