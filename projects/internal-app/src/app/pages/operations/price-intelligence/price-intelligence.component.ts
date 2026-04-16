import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    Firestore,
    doc,
    docData,
    collectionData,
    collection,
    query,
    orderBy,
    limit
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, Subscription, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../core/services/toast.service';
import { TireMarketScan, MarketListing, MarketStats, PriceAlert } from '../../../core/models/competitor.model';

type ScanState = 'idle' | 'scanning' | 'done' | 'error';

// Common tire sizes for quick selection
const COMMON_MOTORCYCLE_SIZES = [
    { width: 90, aspectRatio: 90, diameter: 18 },
    { width: 100, aspectRatio: 80, diameter: 17 },
    { width: 110, aspectRatio: 70, diameter: 17 },
    { width: 120, aspectRatio: 70, diameter: 17 },
    { width: 130, aspectRatio: 70, diameter: 17 },
    { width: 140, aspectRatio: 70, diameter: 17 },
    { width: 150, aspectRatio: 70, diameter: 17 },
    { width: 160, aspectRatio: 60, diameter: 17 },
    { width: 180, aspectRatio: 55, diameter: 17 },
];

@Component({
    selector: 'app-price-intelligence',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, DecimalPipe],
    templateUrl: './price-intelligence.component.html',
    styleUrls: ['./price-intelligence.component.css']
})
export class PriceIntelligenceComponent implements OnInit, OnDestroy {

    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private toastService = inject(ToastService);

    // ── Tire Size Selector ────────────────────────────────────────────────────
    tireWidth = signal<number>(120);
    tireAspectRatio = signal<number>(70);
    tireDiameter = signal<number>(17);

    // Correct MLM category IDs (verified via domain_discovery API)
    // MLM169975 = Llantas para Motos, MLM3530 = Llantas de Auto/Camioneta
    categoryId = signal<string>('MLM169975');

    readonly CATEGORIES = [
        { id: 'MLM169975', label: 'Motocicleta', emoji: '🏍️' },
        { id: 'MLM3530',   label: 'Auto / Camioneta', emoji: '🚗' },
    ];

    readonly commonSizes = COMMON_MOTORCYCLE_SIZES;

    fingerprint = computed(() =>
        `${this.tireWidth()}_${this.tireAspectRatio()}_R${this.tireDiameter()}`
    );

    displaySize = computed(() =>
        `${this.tireWidth()}/${this.tireAspectRatio()}R${this.tireDiameter()}`
    );

    // ── Scan State ────────────────────────────────────────────────────────────
    scanState = signal<ScanState>('idle');
    scanError = signal<string | null>(null);
    lastScanResult = signal<{ cached: boolean; count: number } | null>(null);

    // ── Market Data (Firestore real-time) ─────────────────────────────────────
    marketScan = signal<TireMarketScan | null>(null);
    private scanSub: Subscription | null = null;

    // ── Recent Alerts ─────────────────────────────────────────────────────────
    recentAlerts = signal<PriceAlert[]>([]);
    private alertsSub: Subscription | null = null;

    // ── Sort / Filter for Results Table ──────────────────────────────────────
    sortColumn = signal<'price' | 'sold' | 'listing'>('price');
    sortDir = signal<'asc' | 'desc'>('asc');
    showOnlyCompetitors = signal<boolean>(false);

    filteredListings = computed(() => {
        const scan = this.marketScan();
        if (!scan) return [];

        let items = [...scan.listings];
        if (this.showOnlyCompetitors()) items = items.filter((l: MarketListing) => !l.isOurListing);

        const col = this.sortColumn();
        const dir = this.sortDir() === 'asc' ? 1 : -1;
        items.sort((a: MarketListing, b: MarketListing) => {
            if (col === 'price') return (a.price - b.price) * dir;
            if (col === 'sold') return (a.soldQuantity - b.soldQuantity) * dir;
            return a.listingType.localeCompare(b.listingType) * dir;
        });
        return items;
    });

    // ── Competitive Stats ─────────────────────────────────────────────────────
    stats = computed(() => this.marketScan()?.stats ?? null);

    competitiveStatus = computed((): string => {
        const s = this.stats();
        if (!s || s.ourPrice === null) return 'not_listed';
        const gap = ((s.ourPrice - s.priceToWin) / s.priceToWin) * 100;
        if (gap <= 0) return 'winning';
        if (gap <= 5) return 'competitive';
        if (gap <= 15) return 'warning';
        return 'critical';
    });

    priceGapPercent = computed((): number | null => {
        const s = this.stats();
        if (!s || s.ourPrice === null || s.priceToWin === 0) return null;
        return ((s.ourPrice - s.priceToWin) / s.priceToWin) * 100;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() {
        this.subscribeToScan();
        this.loadRecentAlerts();
    }

    ngOnDestroy() {
        this.scanSub?.unsubscribe();
        this.alertsSub?.unsubscribe();
    }

    private subscribeToScan() {
        this.scanSub?.unsubscribe();
        const docRef = doc(this.firestore, 'price_intelligence', this.fingerprint());
        this.scanSub = (docData(docRef) as Observable<any>).pipe(
            catchError(() => of(null))
        ).subscribe((data: any) => {
            if (data) {
                this.marketScan.set({
                    ...data,
                    lastScanned: data.lastScanned?.toDate?.() ?? new Date(),
                    listings: (data.listings || []).map((l: any) => ({
                        ...l,
                        scrapedAt: l.scrapedAt?.toDate?.() ?? new Date()
                    }))
                } as TireMarketScan);
            } else {
                this.marketScan.set(null);
            }
        });
    }

    private loadRecentAlerts() {
        const q = query(
            collection(this.firestore, 'price_alerts'),
            orderBy('createdAt', 'desc'),
            limit(10)
        );
        this.alertsSub = (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
            catchError(() => of([]))
        ).subscribe((alerts: any[]) => {
            this.recentAlerts.set(alerts.map((a: any) => ({
                ...a,
                createdAt: a.createdAt?.toDate?.() ?? new Date()
            })));
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    selectSize(size: { width: number; aspectRatio: number; diameter: number }) {
        this.tireWidth.set(size.width);
        this.tireAspectRatio.set(size.aspectRatio);
        this.tireDiameter.set(size.diameter);
        this.subscribeToScan();
    }

    onSizeChange() {
        this.subscribeToScan();
    }

    async runScan(force = false) {
        if (this.scanState() === 'scanning') return;

        this.scanState.set('scanning');
        this.scanError.set(null);
        this.lastScanResult.set(null);

        try {
            const scanFn = httpsCallable(this.functions, 'meliPriceScan');
            const result = await scanFn({
                width: this.tireWidth(),
                aspectRatio: this.tireAspectRatio(),
                diameter: this.tireDiameter(),
                categoryId: this.categoryId(),
                force
            });

            const data = result.data as { cached: boolean; count: number; fingerprint: string };
            this.lastScanResult.set({ cached: data.cached, count: data.count ?? 0 });
            this.scanState.set('done');

            if (data.cached) {
                this.toastService.info(`Usando datos en caché — ${this.displaySize()}. Escaneado hace poco.`);
            } else {
                this.toastService.success(`✅ Escaneo completado: ${data.count} listados encontrados para ${this.displaySize()}`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error desconocido al escanear.';
            console.error('[PriceIntel] Scan error:', err);
            this.scanState.set('error');
            this.scanError.set(message);
            this.toastService.error('No se pudo escanear el mercado. Verifica la conexión con MercadoLibre.');
        }
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

    getStatusColor(): string {
        switch (this.competitiveStatus()) {
            case 'winning': return 'status-winning';
            case 'competitive': return 'status-competitive';
            case 'warning': return 'status-warning';
            case 'critical': return 'status-critical';
            default: return 'status-unlisted';
        }
    }

    getStatusLabel(): string {
        switch (this.competitiveStatus()) {
            case 'winning': return 'Precio ganador';
            case 'competitive': return 'Competitivo';
            case 'warning': return 'Precio alto';
            case 'critical': return 'Fuera del mercado';
            default: return 'No listado en ML';
        }
    }

    getReputationColor(rep: string): string {
        if (!rep) return 'rep-bronze';
        if (rep.includes('platinum')) return 'rep-platinum';
        if (rep.includes('gold')) return 'rep-gold';
        if (rep.includes('silver')) return 'rep-silver';
        return 'rep-bronze';
    }

    formatCurrency(val: number | null | undefined): string {
        if (val === null || val === undefined) return '—';
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(val);
    }

    formatDate(date: Date | null | undefined): string {
        if (!date) return '—';
        return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
    }

    /** Converts fingerprint "120_70_R17" → "120/70R17" for display (avoids regex in template) */
    formatAlertSize(fingerprint: string): string {
        if (!fingerprint) return '';
        return fingerprint.replace(/_/g, '/').replace('/R', 'R');
    }
}
