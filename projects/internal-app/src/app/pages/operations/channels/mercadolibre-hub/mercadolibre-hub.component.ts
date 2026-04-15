import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../core/services/toast.service';
import { OrderService } from '../../../../core/services/order.service';
import { Order } from '../../../../core/models/order.model';
import { MeliListingDoc } from '../../../../core/models/meli-listing.model';
import { Firestore, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-mercadolibre-hub',
    standalone: true,
    imports: [CommonModule, AdminPageHeaderComponent, AppIconComponent, TranslateModule, FormsModule],
    templateUrl: './mercadolibre-hub.component.html'
})
export class MercadolibreHubComponent implements OnInit {
    private functions = inject(Functions);
    private firestore = inject(Firestore);
    private toast = inject(ToastService);
    private orderService = inject(OrderService);

    activeTab = signal<'overview' | 'classic' | 'full' | 'listings'>('overview');

    // Sync states
    isAnalyzing = signal(false);
    isSyncing = signal(false);
    isSyncingListings = signal(false);

    totalHistoricalRecords = signal<number | null>(null);
    syncProgress = signal<{ processed: number, total: number }>({ processed: 0, total: 0 });

    // Orders Data
    allOrders = signal<Order[]>([]);
    isLoadingData = signal(true);
    dataError = signal<string | null>(null);

    // FBM Inventory Data
    fbmInventory = signal<any[]>([]);
    isLoadingFbm = signal(true);

    // Listings / Publications Data
    listings = signal<MeliListingDoc[]>([]);
    isLoadingListings = signal(true);
    listingsFilter = signal<'all' | 'active' | 'paused' | 'full' | 'classic' | 'free_shipping'>('all');
    listingsSearch = signal('');
    listingsSortColumn = signal<'price' | 'fee' | 'net' | 'sold' | 'health'>('net');
    listingsSortDir = signal<'asc' | 'desc'>('desc');
    expandedListingId = signal<string | null>(null);

    // Webhook Logs
    webhookLogs = signal<any[]>([]);

    // ── Orders Computed ───────────────────────────────────────────────────────

    meliOrders = computed(() => {
        return this.allOrders().filter(o =>
            o.sourceChannel === 'mercadolibre' || (o as any).channel?.includes('MELI')
        );
    });

    classicOrders = computed(() => {
        return this.meliOrders().filter(o => o.fulfillmentType === 'merchant' || (o as any).channel === 'MELI_CLASSIC');
    });

    pendingClassicOrders = computed(() => {
        return this.classicOrders().filter(o => o.status === 'pending' || o.status === 'processing');
    });

    fullOrders = computed(() => {
        return this.meliOrders().filter(o => o.fulfillmentType === 'platform' || (o as any).channel === 'MELI_FULL');
    });

    // ── FBM Sort, Filter & Pagination ──────────────────────────────────────────

    fbmSortColumn = signal<'sku' | 'title' | 'qty' | 'reserved' | 'price' | 'sales' | 'days'>('qty');
    fbmSortDirection = signal<'asc' | 'desc'>('desc');
    fbmCurrentPage = signal<number>(1);
    fbmPageSize = signal<number>(25);
    fbmSearch = signal('');
    fbmStockFilter = signal<'all' | 'critical' | 'low' | 'healthy' | 'no_sales'>('all');

    fbmInventoryWithBurnRate = computed(() => {
        const inventory = this.fbmInventory();
        const orders = this.meliOrders();

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const skuSales = new Map<string, number>();

        for (const order of orders) {
            let orderDate: Date | null = null;
            if (order.createdAt instanceof Date) {
                orderDate = order.createdAt;
            } else if ((order.createdAt as any)?.toDate) {
                orderDate = (order.createdAt as any).toDate();
            } else if (typeof order.createdAt === 'string' || typeof order.createdAt === 'number') {
                orderDate = new Date(order.createdAt);
            }

            if (orderDate && orderDate >= thirtyDaysAgo) {
                for (const item of order.items || []) {
                    if (item.sku) {
                        const current = skuSales.get(item.sku) || 0;
                        skuSales.set(item.sku, current + (item.quantity || 1));
                    }
                }
            }
        }

        return inventory.map(item => {
            const sold30Days = skuSales.get(item.sku) || 0;
            const dailyBurnRate = sold30Days / 30;
            let daysRemaining = 999;

            if (dailyBurnRate > 0) {
                daysRemaining = Math.max(0, Math.floor(item.availableQuantity / dailyBurnRate));
            }

            return { ...item, sold30Days, dailyBurnRate, daysRemaining };
        });
    });

    processedFbmInventory = computed(() => {
        let items = [...this.fbmInventoryWithBurnRate()];
        const q = this.fbmSearch().toLowerCase().trim();
        const sf = this.fbmStockFilter();

        // Search filter
        if (q) {
            items = items.filter(item =>
                (item.sku || '').toLowerCase().includes(q) ||
                (item.title || '').toLowerCase().includes(q) ||
                (item.mlItemId || '').toLowerCase().includes(q)
            );
        }

        // Stock health filter
        if (sf === 'critical')  items = items.filter(i => i.daysRemaining <= 15 && i.availableQuantity > 0);
        if (sf === 'low')       items = items.filter(i => i.daysRemaining > 15 && i.daysRemaining <= 30);
        if (sf === 'healthy')   items = items.filter(i => i.daysRemaining > 30 && i.daysRemaining !== 999);
        if (sf === 'no_sales')  items = items.filter(i => i.sold30Days === 0);

        const col = this.fbmSortColumn();
        const dir = this.fbmSortDirection() === 'asc' ? 1 : -1;

        items.sort((a, b) => {
            let valA: any;
            let valB: any;

            if      (col === 'sku')      { valA = (a.sku || '').toLowerCase();   valB = (b.sku || '').toLowerCase(); }
            else if (col === 'qty')      { valA = a.availableQuantity || 0;       valB = b.availableQuantity || 0; }
            else if (col === 'reserved') { valA = a.fullStockReserved || 0;       valB = b.fullStockReserved || 0; }
            else if (col === 'price')    { valA = a.price || 0;                   valB = b.price || 0; }
            else if (col === 'sales')    { valA = a.sold30Days || 0;              valB = b.sold30Days || 0; }
            else if (col === 'days')     { valA = a.daysRemaining;                valB = b.daysRemaining; }
            else                         { valA = (a.title || '').toLowerCase();  valB = (b.title || '').toLowerCase(); }

            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        return items;
    });

    paginatedFbmInventory = computed(() => {
        const items = this.processedFbmInventory();
        const startIndex = (this.fbmCurrentPage() - 1) * this.fbmPageSize();
        return items.slice(startIndex, startIndex + this.fbmPageSize());
    });

    fbmTotalPages = computed(() => {
        return Math.max(1, Math.ceil(this.processedFbmInventory().length / this.fbmPageSize()));
    });

    // ── Listings / Publications Computed ──────────────────────────────────────

    filteredListings = computed(() => {
        let items = [...this.listings()];
        const f = this.listingsFilter();
        const q = this.listingsSearch().toLowerCase().trim();

        if (f === 'active')       items = items.filter(l => l.status === 'active');
        if (f === 'paused')       items = items.filter(l => l.status === 'paused');
        if (f === 'full')         items = items.filter(l => l.is_full);
        if (f === 'classic')      items = items.filter(l => !l.is_full);
        if (f === 'free_shipping') items = (items as any[]).filter((l: any) => l.free_shipping === true);

        if (q) {
            items = items.filter(l =>
                l.title?.toLowerCase().includes(q) ||
                (l.seller_custom_field || '').toLowerCase().includes(q) ||
                (l.id || '').toLowerCase().includes(q)
            );
        }

        const col = this.listingsSortColumn();
        const dir = this.listingsSortDir() === 'asc' ? 1 : -1;

        items.sort((a, b) => {
            let valA: number;
            let valB: number;
            if (col === 'price')      { valA = a.price;                valB = b.price; }
            else if (col === 'fee')   { valA = a.selling_fee_amount;   valB = b.selling_fee_amount; }
            else if (col === 'net')   { valA = a.net_amount;           valB = b.net_amount; }
            else if (col === 'sold')  { valA = a.sold_quantity;        valB = b.sold_quantity; }
            else                      { valA = a.health ?? -1;         valB = b.health ?? -1; }
            return (valA - valB) * dir;
        });

        return items;
    });

    listingsSummary = computed(() => {
        const all = this.listings();
        const withFee = all.filter(l => l.selling_fee_percent > 0);
        const avgFee  = withFee.length ? withFee.reduce((s, l) => s + l.selling_fee_percent, 0) / withFee.length : 0;
        const avgNet  = withFee.length ? withFee.reduce((s, l) => s + l.net_percent, 0) / withFee.length : 0;
        const anyL = all as any[];

        return {
            total:              all.length,
            activeCount:        all.filter(l => l.status === 'active').length,
            pausedCount:        all.filter(l => l.status === 'paused').length,
            fullCount:          all.filter(l => l.is_full).length,
            classicCount:       all.filter(l => !l.is_full).length,
            freeShippingCount:  anyL.filter(l => l.free_shipping === true).length,
            kitCount:           anyL.filter(l => l.item_type && l.item_type !== 'single').length,
            totalSold:          all.reduce((s, l) => s + (l.sold_quantity || 0), 0),
            avgFeePercent:      Math.round(avgFee * 10) / 10,
            avgNetPercent:      Math.round(avgNet * 10) / 10,
            avgFinancingFee:    withFee.length
                ? Math.round(withFee.reduce((s, l: any) => s + (l.financing_fee || 0), 0) / withFee.length * 10) / 10
                : 0,
        };
    });

    // ── Overview Stats ────────────────────────────────────────────────────────

    pendingCount = computed(() => this.pendingClassicOrders().length);

    fullOrdersTodayCount = computed(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return this.fullOrders().filter(o => {
            const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as any).toDate?.();
            return date && date >= today;
        }).length;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    ngOnInit() {
        this.loadOrders();
        this.loadFbmInventory();
        this.loadListings();
        this.loadWebhookLogs();
    }

    private loadOrders() {
        this.isLoadingData.set(true);
        this.dataError.set(null);
        this.orderService.getOrders().subscribe({
            next: (orders) => { this.allOrders.set(orders); this.isLoadingData.set(false); },
            error: (err)   => { console.error('Failed to load orders', err); this.dataError.set('Could not load orders.'); this.isLoadingData.set(false); }
        });
    }

    private loadFbmInventory() {
        this.isLoadingFbm.set(true);
        collectionData(collection(this.firestore, 'meli_fbm_inventory'), { idField: 'id' }).subscribe({
            next: (data) => { this.fbmInventory.set(data as any[]); this.isLoadingFbm.set(false); },
            error: (err) => { console.error('Failed to load FBM inventory', err); this.isLoadingFbm.set(false); }
        });
    }

    private loadListings() {
        this.isLoadingListings.set(true);
        collectionData(collection(this.firestore, 'meli_listings'), { idField: 'id' }).subscribe({
            next: (data) => { this.listings.set(data as MeliListingDoc[]); this.isLoadingListings.set(false); },
            error: (err) => { console.error('Failed to load listings', err); this.isLoadingListings.set(false); }
        });
    }

    private loadWebhookLogs() {
        const q = query(collection(this.firestore, 'meli_webhook_logs'), orderBy('createdAt', 'desc'), limit(20));
        collectionData(q, { idField: 'id' }).subscribe({
            next: (data) => this.webhookLogs.set(data as any[]),
            error: (err) => console.error('Failed to load webhook logs', err)
        });
    }

    // ── Tab & Sort Controls ───────────────────────────────────────────────────

    setTab(tab: 'overview' | 'classic' | 'full' | 'listings') { this.activeTab.set(tab); }

    setFbmSort(column: 'sku' | 'title' | 'qty' | 'reserved' | 'price' | 'sales' | 'days') {
        if (this.fbmSortColumn() === column) {
            this.fbmSortDirection.set(this.fbmSortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.fbmSortColumn.set(column);
            this.fbmSortDirection.set('desc');
        }
        this.fbmCurrentPage.set(1);
    }

    setFbmSearch(value: string) {
        this.fbmSearch.set(value);
        this.fbmCurrentPage.set(1);
    }

    setFbmStockFilter(f: 'all' | 'critical' | 'low' | 'healthy' | 'no_sales') {
        this.fbmStockFilter.set(f);
        this.fbmCurrentPage.set(1);
    }

    setFbmPage(page: number) {
        if (page >= 1 && page <= this.fbmTotalPages()) this.fbmCurrentPage.set(page);
    }

    setListingsSort(col: 'price' | 'fee' | 'net' | 'sold' | 'health') {
        if (this.listingsSortColumn() === col) {
            this.listingsSortDir.set(this.listingsSortDir() === 'asc' ? 'desc' : 'asc');
        } else {
            this.listingsSortColumn.set(col);
            this.listingsSortDir.set('desc');
        }
    }

    setListingsFilter(f: 'all' | 'active' | 'paused' | 'full' | 'classic' | 'free_shipping') { this.listingsFilter.set(f); }

    toggleListingExpand(id: string) {
        this.expandedListingId.set(this.expandedListingId() === id ? null : id);
    }

    onListingsSearch(value: string) { this.listingsSearch.set(value); }

    // ── FBM Helpers & Filter Chips ─────────────────────────────────────────────

    getTotalFbmUnits(): number {
        return this.fbmInventoryWithBurnRate().reduce((sum: number, i: any) => sum + (i.availableQuantity || 0), 0);
    }

    getTotalFbmReserved(): number {
        return this.fbmInventoryWithBurnRate().reduce((sum: number, i: any) => sum + (i.fullStockReserved || 0), 0);
    }

    getCriticalFbmCount(): number {
        return this.fbmInventoryWithBurnRate().filter((i: any) => i.daysRemaining <= 15 && i.availableQuantity > 0).length;
    }

    fbmFilterChips: Array<{ value: any; label: string; activeClass: string; count: (() => number) | null }> = [
        {
            value: 'all',
            label: 'Todos',
            activeClass: 'bg-indigo-600 border-indigo-500 text-white',
            count: null
        },
        {
            value: 'critical',
            label: '🔴 Crítico',
            activeClass: 'bg-red-600/30 border-red-500/50 text-red-300',
            count: () => this.fbmInventoryWithBurnRate().filter((i: any) => i.daysRemaining <= 15 && i.availableQuantity > 0).length
        },
        {
            value: 'low',
            label: '🟡 Bajo',
            activeClass: 'bg-yellow-600/30 border-yellow-500/50 text-yellow-300',
            count: () => this.fbmInventoryWithBurnRate().filter((i: any) => i.daysRemaining > 15 && i.daysRemaining <= 30).length
        },
        {
            value: 'healthy',
            label: '🟢 Saludable',
            activeClass: 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300',
            count: () => this.fbmInventoryWithBurnRate().filter((i: any) => i.daysRemaining > 30 && i.daysRemaining !== 999).length
        },
        {
            value: 'no_sales',
            label: 'Sin ventas',
            activeClass: 'bg-zinc-600/50 border-zinc-500 text-zinc-300',
            count: () => this.fbmInventoryWithBurnRate().filter((i: any) => i.sold30Days === 0).length
        }
    ];

    // ── Sync Actions ──────────────────────────────────────────────────────────

    async analyzeSync() {
        this.isAnalyzing.set(true);
        this.totalHistoricalRecords.set(null);
        try {
            const result: any = await httpsCallable(this.functions, 'meliAnalyzeHistoricalSync')();
            if (result.data?.success) {
                this.totalHistoricalRecords.set(result.data.totalRecords);
                this.syncProgress.set({ processed: 0, total: result.data.totalRecords });
            } else throw new Error('Failed to parse analysis');
        } catch (err: any) {
            console.error('Analyze Error:', err);
            this.toast.error('Could not analyze ML records. Check connection.');
        } finally {
            this.isAnalyzing.set(false);
        }
    }

    async startHistoricalSync() {
        const total = this.totalHistoricalRecords();
        if (!total) return;

        this.isSyncing.set(true);
        this.syncProgress.set({ processed: 0, total });

        let offset = 0;
        const batchLimit = 50;
        let hasMore = true;
        const syncFn = httpsCallable(this.functions, 'meliSyncHistorical');

        try {
            while (hasMore) {
                const result: any = await syncFn({ offset, limit: batchLimit });
                const data = result.data;
                if (!data?.success) throw new Error('Sync failed at chunk');
                offset += batchLimit;
                hasMore = data.hasMore;
                this.syncProgress.update(p => ({ ...p, processed: Math.min(p.processed + data.processed, total) }));
            }
            this.toast.success('Historical Sync Completed Successfully!');
        } catch (err: any) {
            console.error('Sync Error:', err);
            this.toast.error('Historical sync interrupted. Check console logs.');
        } finally {
            this.isSyncing.set(false);
            this.totalHistoricalRecords.set(null);
        }
    }

    async syncRecentOrders() {
        if (this.isSyncing()) return;
        this.isSyncing.set(true);
        this.toast.info('Starting quick sync of latest orders...');
        try {
            const result: any = await httpsCallable(this.functions, 'meliSyncOrders')();
            if (result.data?.success) this.toast.success(`Synced ${result.data.imported} new orders.`);
        } catch (err: any) {
            this.toast.error('Quick sync failed.');
        } finally {
            this.isSyncing.set(false);
        }
    }

    async syncFbmInventory() {
        if (this.isSyncing()) return;
        this.isSyncing.set(true);
        this.toast.info('Requesting FBM inventory sync from MercadoLibre...');
        try {
            const result: any = await httpsCallable(this.functions, 'meliSyncFullInventory')();
            if (result.data?.success) {
                this.toast.success(`Synced ${result.data.syncedCount} FBM items con stock real del almacén.`);
            } else throw new Error('Unexpected API response');
        } catch (err: any) {
            console.error('FBM Sync Error:', err);
            this.toast.error('Failed to sync FBM inventory.');
        } finally {
            this.isSyncing.set(false);
        }
    }

    async syncListings() {
        if (this.isSyncingListings()) return;
        this.isSyncingListings.set(true);
        this.toast.info('Sincronizando publicaciones y calculando comisiones...');
        try {
            const result: any = await httpsCallable(this.functions, 'meliSyncListings')();
            if (result.data?.success) {
                this.toast.success(`${result.data.syncedCount} publicaciones actualizadas con precio y comisión.`);
            } else throw new Error('Unexpected response');
        } catch (err: any) {
            console.error('Listings Sync Error:', err);
            this.toast.error('No se pudo sincronizar las publicaciones.');
        } finally {
            this.isSyncingListings.set(false);
        }
    }

    isBackfillingShipping = signal<boolean>(false);
    backfillShippingResult = signal<any>(null);

    async backfillShippingCosts() {
        if (this.isBackfillingShipping()) return;
        this.isBackfillingShipping.set(true);
        this.backfillShippingResult.set(null);
        this.toast.info('Recuperando costos de envío de pedidos históricos… puede tardar hasta 2 min.');
        try {
            const result: any = await httpsCallable(this.functions, 'meliBackfillShippingCosts')();
            const d = result.data;
            if (d?.success) {
                this.backfillShippingResult.set(d);
                if (d.updated === 0) {
                    this.toast.success('Todos los pedidos ya tenían costo de envío registrado. ✅');
                } else {
                    this.toast.success(`✅ ${d.updated} pedidos actualizados con costo de envío real. Promedio por publicación recalculado.`);
                    await this.loadListings(); // refresh listings after update
                }
            }
        } catch (err: any) {
            console.error('Backfill Shipping Error:', err);
            this.toast.error('Error al recuperar costos de envío.');
        } finally {
            this.isBackfillingShipping.set(false);
        }
    }

    isDownloadingLabel = signal<string | null>(null);

    async downloadMeliLabel(order: any) {
        if (!order.shippingId) { this.toast.error('No shipping ID available for this order.'); return; }

        this.isDownloadingLabel.set(order.id || '');
        this.toast.info('Requesting Guía de Embarque from MercadoLibre...');

        try {
            const result: any = await httpsCallable(this.functions, 'meliGetShippingLabel')({ shippingId: order.shippingId });

            if (result.data?.success && result.data.pdfBase64) {
                const byteCharacters = atob(result.data.pdfBase64);
                const byteNumbers = Array.from({ length: byteCharacters.length }, (_, i) => byteCharacters.charCodeAt(i));
                const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Meli_Guia_${order.orderNumber}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.toast.success('Guía downloaded successfully!');
            } else throw new Error('Invalid response from backend.');
        } catch (err: any) {
            console.error('Download Label Error:', err);
            this.toast.error('Failed to download label. It might not be ready yet.');
        } finally {
            this.isDownloadingLabel.set(null);
        }
    }
}
