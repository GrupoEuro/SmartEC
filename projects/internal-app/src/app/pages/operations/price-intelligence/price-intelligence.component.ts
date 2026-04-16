import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    Firestore, doc, docData, collectionData, collection, query, orderBy, limit, updateDoc
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, Subscription, of, timer } from 'rxjs';
import { catchError, retry, retryWhen, delayWhen, tap } from 'rxjs/operators';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../core/services/toast.service';
import { TireMarketScan, MarketListing, MarketStats, PriceAlert, PriceHistoryEntry } from '../../../core/models/competitor.model';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'scanning' | 'done' | 'error';
type ActiveTab = 'scanner' | 'motos' | 'costs';

// ─── Mexico Motorcycle Database ───────────────────────────────────────────────

export interface MotoEntry {
    brand: string;
    model: string;
    segment: string;
    frontSize: string;
    rearSize: string;
    rimSize: number;
    popularity: 'muy alta' | 'alta' | 'media' | 'nueva';
    notes?: string;
}

const MEXICO_MOTO_DB: MotoEntry[] = [
    { brand: 'Italika', model: 'AT110',       segment: 'Trabajo',    frontSize: '2.50-17',   rearSize: '2.75-17',   rimSize: 17, popularity: 'muy alta' },
    { brand: 'Italika', model: 'FT125',       segment: 'Trabajo',    frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'muy alta' },
    { brand: 'Italika', model: 'FT150',       segment: 'Trabajo',    frontSize: '2.75-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'muy alta', notes: 'Best-seller México' },
    { brand: 'Italika', model: 'FT200',       segment: 'Trabajo',    frontSize: '3.00-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'alta' },
    { brand: 'Honda',   model: 'CB125F',      segment: 'Commuter',   frontSize: '80/100-17', rearSize: '90/90-17',  rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'CB150 Invicta', segment: 'Commuter', frontSize: '80/100-17', rearSize: '110/80-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'XR150L',      segment: 'Dual Sport', frontSize: '80/100-17', rearSize: '100/80-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'CG150',       segment: 'Trabajo',    frontSize: '2.75-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'alta' },
    { brand: 'Honda',   model: 'CB190R',      segment: 'Sport',      frontSize: '100/80-17', rearSize: '130/70-17', rimSize: 17, popularity: 'nueva', notes: 'Segmento creciente' },
    { brand: 'Yamaha',  model: 'FZ16 S',      segment: 'Sport',      frontSize: '100/80-17', rearSize: '130/70-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Yamaha',  model: 'YBR125',      segment: 'Commuter',   frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'alta' },
    { brand: 'Yamaha',  model: 'SZ-RR',       segment: 'Trabajo',    frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'Suzuki',  model: 'GS150R',      segment: 'Commuter',   frontSize: '80/100-17', rearSize: '100/90-17', rimSize: 17, popularity: 'media' },
    { brand: 'TVS',     model: 'Sport 110',   segment: 'Trabajo',    frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'TVS',     model: 'Apache 160',  segment: 'Sport',      frontSize: '90/90-17',  rearSize: '110/80-17', rimSize: 17, popularity: 'media' },
    { brand: 'Bajaj',   model: 'Boxer CT100', segment: 'Trabajo',    frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'Hero',    model: 'Hunk 150',    segment: 'Sport',      frontSize: '80/100-17', rearSize: '100/90-17', rimSize: 17, popularity: 'media' },
];

// ─── Channel Commission Definitions ──────────────────────────────────────────

const CHANNEL_COMMISSIONS = [
    { id: 'ml_classica',  label: 'ML Clásica',   rate: 0.12, fulfillmentFee: 0,   color: '#f59e0b', icon: '🛒' },
    { id: 'ml_premium',   label: 'ML Premium',   rate: 0.165, fulfillmentFee: 0,  color: '#fbbf24', icon: '⭐' },
    { id: 'ml_flex',      label: 'ML + Flex',    rate: 0.165, fulfillmentFee: 55, color: '#6366f1', icon: '📦' },
    { id: 'web_direct',   label: 'Web Directa',  rate: 0.03,  fulfillmentFee: 0,  color: '#10b981', icon: '🌐' },
    { id: 'whatsapp',     label: 'WhatsApp',     rate: 0.0,   fulfillmentFee: 0,  color: '#22c55e', icon: '💬' },
];

// ─── Quick sizes (both imperial & metric) ────────────────────────────────────

const QUICK_SIZES_MOTO = [
    '2.50-17', '2.75-17', '3.00-17',
    '2.75-18', '3.00-18',
    '80/100-17', '90/90-17', '100/80-17', '110/80-17', '130/70-17',
];

const QUICK_SIZES_STRUCT = [
    { width: 90,  aspectRatio: 90,  diameter: 18 },
    { width: 100, aspectRatio: 80,  diameter: 17 },
    { width: 110, aspectRatio: 70,  diameter: 17 },
    { width: 120, aspectRatio: 70,  diameter: 17 },
    { width: 130, aspectRatio: 70,  diameter: 17 },
    { width: 140, aspectRatio: 70,  diameter: 17 },
    { width: 150, aspectRatio: 70,  diameter: 17 },
    { width: 160, aspectRatio: 60,  diameter: 17 },
    { width: 180, aspectRatio: 55,  diameter: 17 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeTireSize(input: string): string {
    return input.trim()
        .replace(/\s+/g, '')
        .replace(/x/gi, '/')
        .replace(/R(\d+)/i, '-$1')
        .toUpperCase();
}

@Component({
    selector: 'app-price-intelligence',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, DecimalPipe, CurrencyPipe],
    templateUrl: './price-intelligence.component.html',
    styleUrls: ['./price-intelligence.component.css']
})
export class PriceIntelligenceComponent implements OnInit, OnDestroy {

    private firestore  = inject(Firestore);
    private functions  = inject(Functions);
    private toastSvc   = inject(ToastService);

    // ── Tab ───────────────────────────────────────────────────────────────────
    activeTab = signal<ActiveTab>('scanner');

    readonly TABS = [
        { id: 'scanner' as ActiveTab, label: 'Scanner ML',       icon: 'radar' },
        { id: 'motos'   as ActiveTab, label: 'Mapa de Motos',    icon: 'map' },
        { id: 'costs'   as ActiveTab, label: 'Análisis de Costos', icon: 'dollar-sign' },
    ];

    // ── Category ──────────────────────────────────────────────────────────────
    readonly CATEGORIES = [
        { id: 'MLM169975', label: 'Motocicleta',    emoji: '🏍️' },
        { id: 'MLM3530',   label: 'Auto / Camioneta', emoji: '🚗' },
    ];
    categoryId = signal<string>('MLM169975');

    // ── Tire Size (structured) ────────────────────────────────────────────────
    tireWidth       = signal<number>(120);
    tireAspectRatio = signal<number>(70);
    tireDiameter    = signal<number>(17);

    fingerprint = computed(() => `${this.tireWidth()}_${this.tireAspectRatio()}_R${this.tireDiameter()}`);
    displaySize = computed(() => `${this.tireWidth()}/${this.tireAspectRatio()}R${this.tireDiameter()}`);

    readonly structSizes = QUICK_SIZES_STRUCT;
    readonly quickSizesMoto = QUICK_SIZES_MOTO;

    // ── Free-text search (motos tab / keyword scan) ───────────────────────────
    searchQuery = signal<string>('');

    // ── Scan State ────────────────────────────────────────────────────────────
    scanState    = signal<ScanState>('idle');
    scanError    = signal<string | null>(null);
    lastScanMeta = signal<{ cached: boolean; count: number } | null>(null);

    // ── Market Data (live from Firestore, written by meliPriceScan) ───────────
    marketScan   = signal<TireMarketScan | null>(null);
    private scanSub: Subscription | null = null;

    // ── Alerts ────────────────────────────────────────────────────────────────
    recentAlerts   = signal<PriceAlert[]>([]);
    showAllAlerts  = signal<boolean>(false);
    private alertsSub: Subscription | null = null;

    unreadAlerts = computed(() => this.recentAlerts().filter(a => !a.isRead));

    // ── Portfolio Scan ────────────────────────────────────────────────────────
    portfolioState    = signal<'idle' | 'running' | 'done' | 'error'>('idle');
    portfolioProgress = signal<{ current: number; total: number; currentSize: string } | null>(null);
    portfolioResults  = signal<{ fingerprint: string; count: number; status: 'ok' | 'error' }[]>([]);

    // ── Table Sort/Filter ─────────────────────────────────────────────────────
    sortColumn          = signal<'price' | 'sold' | 'listing'>('price');
    sortDir             = signal<'asc' | 'desc'>('asc');
    showOnlyCompetitors = signal<boolean>(false);

    filteredListings = computed(() => {
        const scan = this.marketScan();
        if (!scan) return [];
        let items = [...scan.listings];
        if (this.showOnlyCompetitors()) items = items.filter((l: MarketListing) => !l.isOurListing);
        const col = this.sortColumn();
        const dir = this.sortDir() === 'asc' ? 1 : -1;
        items.sort((a: MarketListing, b: MarketListing) => {
            if (col === 'price')   return (a.price - b.price) * dir;
            if (col === 'sold')    return (a.soldQuantity - b.soldQuantity) * dir;
            return a.listingType.localeCompare(b.listingType) * dir;
        });
        return items;
    });

    // ── Price History ─────────────────────────────────────────────────────────
    priceHistory   = signal<PriceHistoryEntry[]>([]);
    private historySub: Subscription | null = null;

    /** Trend vs previous available day: positive = market getting cheaper, negative = prices rising */
    priceTrend = computed(() => {
        const h = this.priceHistory();
        if (h.length < 2) return null;
        const latest = h[0];   // sorted desc
        const prev   = h[1];
        if (!latest.stats.medianPrice || !prev.stats.medianPrice) return null;
        const medianDelta = latest.stats.medianPrice - prev.stats.medianPrice;
        const ourDelta    = (latest.stats.ourPrice ?? 0) - (prev.stats.ourPrice ?? 0);
        return {
            medianDelta,
            medianDeltaPct: (medianDelta / prev.stats.medianPrice) * 100,
            ourDelta,
            days: h.length,
            baseline: h[h.length - 1], // oldest entry = baseline
        };
    });

    sparklinePoints = computed(() => {
        const h = [...this.priceHistory()].reverse(); // oldest first for chart
        if (h.length === 0) return null;
        const allPrices = h.flatMap(e => [e.stats.medianPrice, e.stats.lowestPrice, e.stats.ourPrice ?? 0]).filter(p => p > 0);
        const minP = Math.min(...allPrices) * 0.97;
        const maxP = Math.max(...allPrices) * 1.03;
        const range = maxP - minP || 1;
        const W = 300, H = 64;
        const toX = (i: number) => Math.round((i / (h.length - 1 || 1)) * W);
        const toY = (p: number) => Math.round(H - ((p - minP) / range) * H);
        const path = (vals: number[]) => vals.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p)}`).join(' ');
        return {
            median:  path(h.map(e => e.stats.medianPrice)),
            lowest:  path(h.map(e => e.stats.lowestPrice)),
            ours:    path(h.map(e => e.stats.ourPrice ?? 0).filter(p => p > 0)),
            oursPoints: h.map((e, i) => ({ x: toX(i), y: toY(e.stats.ourPrice ?? 0), entry: e })).filter(p => p.y < H),
            labels:  h.filter((_, i) => i === 0 || i === h.length - 1).map((e, i2) => ({ x: i2 === 0 ? 0 : W, label: e.date.slice(5), anchor: i2 === 0 ? 'start' : 'end' })),
            minP, maxP, W, H,
        };
    });

    // ── Market Stats ──────────────────────────────────────────────────────────
    stats = computed(() => this.marketScan()?.stats ?? null);

    competitiveStatus = computed((): string => {
        const s = this.stats();
        if (!s || s.ourPrice === null) return 'not_listed';
        const gap = ((s.ourPrice - s.priceToWin) / s.priceToWin) * 100;
        if (gap <= 0)  return 'winning';
        if (gap <= 5)  return 'competitive';
        if (gap <= 15) return 'warning';
        return 'critical';
    });

    priceGapPercent = computed((): number | null => {
        const s = this.stats();
        if (!s || s.ourPrice === null || s.priceToWin === 0) return null;
        return ((s.ourPrice - s.priceToWin) / s.priceToWin) * 100;
    });

    // ── Moto Fitment (computed from display size match) ───────────────────────
    readonly allMotos = MEXICO_MOTO_DB;

    motosForCurrentSize = computed((): MotoEntry[] => {
        const norm = normalizeTireSize(this.displaySize());
        return MEXICO_MOTO_DB.filter(m =>
            normalizeTireSize(m.frontSize) === norm ||
            normalizeTireSize(m.rearSize)  === norm
        );
    });

    motoFilterQuery = signal<string>('');

    filteredMotos = computed((): MotoEntry[] => {
        const q = this.motoFilterQuery().toLowerCase().trim();
        if (!q) return this.allMotos;
        return this.allMotos.filter(m =>
            m.brand.toLowerCase().includes(q) ||
            m.model.toLowerCase().includes(q) ||
            m.segment.toLowerCase().includes(q) ||
            m.frontSize.toLowerCase().includes(q) ||
            m.rearSize.toLowerCase().includes(q)
        );
    });

    // ── Cost Analyzer ─────────────────────────────────────────────────────────
    readonly CHANNELS = CHANNEL_COMMISSIONS;

    costInput        = 0;
    priceInput       = 0;
    marketPriceInput = 0;

    channelAnalysis = computed(() => {
        return CHANNEL_COMMISSIONS.map(ch => {
            const commissionAmt  = this.priceInput * ch.rate;
            const fulfillmentFee = ch.fulfillmentFee ?? 0;
            const netRevenue     = this.priceInput - commissionAmt - fulfillmentFee;
            const netProfit      = netRevenue - this.costInput;
            const netMarginPct   = this.priceInput > 0 ? (netProfit / this.priceInput) * 100 : 0;
            return { ...ch, commissionAmt, fulfillmentFee, netRevenue, netProfit, netMarginPct, commissionRate: ch.rate };
        });
    });

    breakEvenPrices = computed(() => {
        const minMargin = 0.15;
        return CHANNEL_COMMISSIONS.map(ch => {
            const ff     = ch.fulfillmentFee ?? 0;
            const denom  = 1 - ch.rate - minMargin;
            const breakEven = denom > 0 ? Math.ceil((this.costInput + ff) / denom) : 0;
            return { id: ch.id, label: ch.label, breakEven, color: ch.color, icon: ch.icon };
        });
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() {
        this.subscribeToScan();
        this.loadAlerts();
    }

    ngOnDestroy() {
        this.scanSub?.unsubscribe();
        this.alertsSub?.unsubscribe();
        this.historySub?.unsubscribe();
    }

    private subscribeToScan() {
        this.scanSub?.unsubscribe();
        const ref = doc(this.firestore, 'price_intelligence', this.fingerprint());
        // Use retryWhen so a transient permission error (e.g. rules not yet propagated)
        // retries up to 3 times with a 2 s delay instead of killing the stream permanently.
        this.scanSub = (docData(ref) as Observable<any>).pipe(
            retryWhen(errors => errors.pipe(
                tap(err => console.warn('[PriceIntel] Firestore subscription error, retrying...', err)),
                delayWhen((_, i) => timer((i + 1) * 2000)),  // 2 s, 4 s, 6 s
                // After 3 retries give up silently so the UI stays stable
            )),
            catchError(err => {
                console.error('[PriceIntel] Firestore subscription permanently failed:', err);
                return of(undefined);
            })
        ).subscribe((d: any) => {
            if (d !== undefined && d !== null) {
                this.marketScan.set({
                    ...d,
                    lastScanned: d.lastScanned?.toDate?.() ?? new Date(),
                    listings: (d.listings || []).map((l: any) => ({
                        ...l, scrapedAt: l.scrapedAt?.toDate?.() ?? new Date()
                    }))
                } as TireMarketScan);
            }
            // If undefined/null — leave existing marketScan value as-is (don't wipe it)
        });
        // Load the last 30 days of history for this size
        this.loadHistory();
    }

    private loadAlerts() {
        const q = query(collection(this.firestore, 'price_alerts'), orderBy('createdAt', 'desc'), limit(10));
        this.alertsSub = (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
            retryWhen(errors => errors.pipe(
                delayWhen((_, i) => timer((i + 1) * 2000))
            )),
            catchError(() => of([]))
        ).subscribe((alerts: any[]) => {
            this.recentAlerts.set(alerts.map((a: any) => ({ ...a, createdAt: a.createdAt?.toDate?.() ?? new Date() })));
        });
    }

    private loadHistory() {
        this.historySub?.unsubscribe();
        const histRef = collection(
            this.firestore,
            'price_intelligence', this.fingerprint(), 'history'
        );
        const q = query(histRef, orderBy('date', 'desc'), limit(30));
        this.historySub = (collectionData(q) as Observable<any[]>).pipe(
            retryWhen(errors => errors.pipe(delayWhen((_, i) => timer((i + 1) * 2000)))),
            catchError(() => of([]))
        ).subscribe((docs: any[]) => {
            this.priceHistory.set(docs.map(d => ({
                date:         d.date,
                scannedAt:    d.scannedAt?.toDate?.() ?? new Date(),
                stats:        d.stats,
                listingCount: d.listingCount ?? 0,
                isBaseline:   d.isBaseline ?? false,
            } as PriceHistoryEntry)));
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    selectStructSize(size: { width: number; aspectRatio: number; diameter: number }) {
        this.tireWidth.set(size.width);
        this.tireAspectRatio.set(size.aspectRatio);
        this.tireDiameter.set(size.diameter);
        this.priceHistory.set([]);  // clear stale history for previous size
        this.subscribeToScan();
    }

    onSizeChange() {
        this.priceHistory.set([]);
        this.subscribeToScan();
    }

    async runScan(force = false) {
        if (this.scanState() === 'scanning') return;
        this.scanState.set('scanning');
        this.scanError.set(null);
        this.lastScanMeta.set(null);
        // Re-subscribe before the call so the listener is alive when data lands.
        // This also recovers from any previously dead subscription.
        this.subscribeToScan();
        try {
            const fn = httpsCallable(this.functions, 'meliPriceScan');
            const res = await fn({
                width: this.tireWidth(), aspectRatio: this.tireAspectRatio(),
                diameter: this.tireDiameter(), categoryId: this.categoryId(), force
            });
            const d = res.data as { cached: boolean; count: number; fingerprint: string };
            this.lastScanMeta.set({ cached: d.cached, count: d.count ?? 0 });
            this.scanState.set('done');
            const resp = d as any;
            // Pre-fill market price for cost analyzer
            const s = this.stats();
            if (s?.medianPrice && this.marketPriceInput === 0) {
                this.marketPriceInput = Math.round(s.medianPrice);
            }
            if (d.cached) {
                this.toastSvc.info(`Datos en caché para ${this.displaySize()}.`);
            } else if (resp.isBaseline) {
                this.toastSvc.success(`📌 Registro base establecido para ${this.displaySize()} — ${d.count} listados`);
            } else {
                this.toastSvc.success(`✅ ${d.count} listados encontrados para ${this.displaySize()}`);
            }
            // Reload history so trend appears immediately
            this.loadHistory();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error desconocido.';
            this.scanState.set('error');
            this.scanError.set(msg);
            this.toastSvc.error('No se pudo escanear el mercado.');
        }
    }

    quickScanMoto(size: string) {
        // Parse a string like "120/70R17" or "3.00-17" into structured inputs
        const metricMatch = size.match(/^(\d+)\/(\d+)[Rr-](\d+)$/);
        const inchMatch   = size.match(/^(\d+\.\d+)-(\d+)$/);
        if (metricMatch) {
            this.tireWidth.set(+metricMatch[1]);
            this.tireAspectRatio.set(+metricMatch[2]);
            this.tireDiameter.set(+metricMatch[3]);
        } else if (inchMatch) {
            // Inch sizes: approximate to nearest metric for search
            // e.g. 2.75-17 → width≈70, AR≈90, diam=17
            const inchW = +inchMatch[1];
            const diam  = +inchMatch[2];
            const approxWidth = Math.round(inchW * 25.4);
            this.tireWidth.set(approxWidth);
            this.tireAspectRatio.set(90);
            this.tireDiameter.set(diam);
        }
        this.subscribeToScan();
        this.activeTab.set('scanner');
        this.runScan();
    }

    quickScanFromMoto(moto: MotoEntry, position: 'front' | 'rear') {
        const size = position === 'front' ? moto.frontSize : moto.rearSize;
        this.quickScanMoto(size);
    }

    setSort(col: 'price' | 'sold' | 'listing') {
        if (this.sortColumn() === col) {
            this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortColumn.set(col);
            this.sortDir.set('asc');
        }
    }

    // ── Display Helpers ───────────────────────────────────────────────────────

    getPositionLabel(): string {
        const s = this.stats();
        if (!s || s.positionInMarket === null) return 'No listado en ML';
        if (s.positionInMarket === 1) return '🥇 Precio más bajo';
        if (s.positionInMarket === 2) return '🥈 2° lugar';
        if (s.positionInMarket === 3) return '🥉 3° lugar';
        return `#${s.positionInMarket} de ${s.totalCompetitors + 1}`;
    }

    getStatusClass(): string {
        switch (this.competitiveStatus()) {
            case 'winning':     return 'status-winning';
            case 'competitive': return 'status-competitive';
            case 'warning':     return 'status-warning';
            case 'critical':    return 'status-critical';
            default:            return 'status-unlisted';
        }
    }

    getStatusLabel(): string {
        switch (this.competitiveStatus()) {
            case 'winning':     return 'Precio ganador';
            case 'competitive': return 'Competitivo';
            case 'warning':     return 'Precio alto';
            case 'critical':    return 'Fuera del mercado';
            default:            return 'No listado en ML';
        }
    }

    getReputationClass(rep: string): string {
        if (!rep)                   return 'rep-bronze';
        if (rep.includes('platinum')) return 'rep-platinum';
        if (rep.includes('gold'))     return 'rep-gold';
        if (rep.includes('silver'))   return 'rep-silver';
        return 'rep-bronze';
    }

    getPopularityClass(pop: string): string {
        switch (pop) {
            case 'muy alta': return 'pop-muy-alta';
            case 'alta':     return 'pop-alta';
            case 'media':    return 'pop-media';
            case 'nueva':    return 'pop-nueva';
            default:         return 'pop-media';
        }
    }

    getCategoryEmoji(): string {
        return this.categoryId() === 'MLM169975' ? '🏍️' : '🚗';
    }

    fmt(val: number | null | undefined): string {
        if (val === null || val === undefined) return '—';
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(val);
    }

    fmtDate(d: Date | null | undefined): string {
        if (!d) return '—';
        return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
    }

    fmtAlertSize(fp: string): string {
        if (!fp) return '';
        return fp.replace(/_/g, '/').replace('/R', 'R');
    }
    async markAlertRead(alertId: string) {
        try {
            await updateDoc(doc(this.firestore, 'price_alerts', alertId), { isRead: true });
        } catch { /* non-fatal */ }
    }

    async markAllAlertsRead() {
        const unread = this.unreadAlerts();
        await Promise.all(unread.map(a => a.id ? this.markAlertRead(a.id) : Promise.resolve()));
        this.toastSvc.success(`✅ ${unread.length} alertas marcadas como leídas.`);
    }

    async runPortfolioScan() {
        if (this.portfolioState() === 'running') return;
        this.portfolioState.set('running');
        this.portfolioProgress.set(null);
        this.portfolioResults.set([]);

        // Build portfolio from QUICK_SIZES_STRUCT (our core metric sizes)
        const sizes = QUICK_SIZES_STRUCT;
        const results: { fingerprint: string; count: number; status: 'ok' | 'error' }[] = [];
        const fn = httpsCallable(this.functions, 'meliPriceScan');

        for (let i = 0; i < sizes.length; i++) {
            const s = sizes[i];
            const displaySz = `${s.width}/${s.aspectRatio}R${s.diameter}`;
            this.portfolioProgress.set({ current: i + 1, total: sizes.length, currentSize: displaySz });
            try {
                const res = await fn({ width: s.width, aspectRatio: s.aspectRatio, diameter: s.diameter, force: false });
                const d = res.data as any;
                results.push({ fingerprint: d.fingerprint, count: d.count ?? 0, status: 'ok' });
            } catch {
                results.push({ fingerprint: `${s.width}_${s.aspectRatio}_R${s.diameter}`, count: 0, status: 'error' });
            }
            // 1.5 s breathing room between calls to respect ML rate limits
            if (i < sizes.length - 1) await new Promise(r => setTimeout(r, 1500));
        }

        this.portfolioResults.set(results);
        this.portfolioState.set('done');
        const ok = results.filter(r => r.status === 'ok').length;
        this.toastSvc.success(`📊 Portafolio escaneado: ${ok}/${sizes.length} tamaños procesados.`);
    }
}
