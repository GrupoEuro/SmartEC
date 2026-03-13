import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../core/services/toast.service';
import { OrderService } from '../../../../core/services/order.service';
import { Order } from '../../../../core/models/order.model';
import { Firestore, collection, collectionData, Timestamp, query, orderBy, limit } from '@angular/fire/firestore';
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

    totalHistoricalRecords = signal<number | null>(null);
    syncProgress = signal<{ processed: number, total: number }>({ processed: 0, total: 0 });

    // Orders Data
    allOrders = signal<Order[]>([]);
    isLoadingData = signal(true);
    dataError = signal<string | null>(null);

    // FBM Inventory Data
    fbmInventory = signal<any[]>([]);
    isLoadingFbm = signal(true);

    // Webhook Logs
    webhookLogs = signal<any[]>([]);

    // Computed signals for MercadoLibre
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

    // FBM Sort & Pagination State
    fbmSortColumn = signal<'sku' | 'title' | 'qty' | 'sales' | 'days'>('qty');
    fbmSortDirection = signal<'asc' | 'desc'>('asc');
    fbmCurrentPage = signal<number>(1);
    fbmPageSize = signal<number>(10);

    fbmInventoryWithBurnRate = computed(() => {
        const inventory = this.fbmInventory();
        // Use all MercadoLibre orders to get accurate total platform velocity for the SKU
        const orders = this.meliOrders();

        // Calculate 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Map SKUs to quantity sold in last 30 days
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

            return {
                ...item,
                sold30Days,
                dailyBurnRate,
                daysRemaining
            };
        });
    });

    processedFbmInventory = computed(() => {
        let items = [...this.fbmInventoryWithBurnRate()];
        const col = this.fbmSortColumn();
        const dir = this.fbmSortDirection() === 'asc' ? 1 : -1;

        items.sort((a, b) => {
            let valA: any = a[col];
            let valB: any = b[col];

            if (col === 'sku') {
                valA = (a.sku || '').toLowerCase();
                valB = (b.sku || '').toLowerCase();
            } else if (col === 'qty') {
                valA = a.availableQuantity || 0;
                valB = b.availableQuantity || 0;
            } else if (col === 'sales') {
                valA = a.sold30Days || 0;
                valB = b.sold30Days || 0;
            } else if (col === 'days') {
                valA = a.daysRemaining;
                valB = b.daysRemaining;
            } else {
                valA = (a.title || '').toLowerCase();
                valB = (b.title || '').toLowerCase();
            }

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

    setFbmSort(column: 'sku' | 'title' | 'qty' | 'sales' | 'days') {
        if (this.fbmSortColumn() === column) {
            this.fbmSortDirection.set(this.fbmSortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.fbmSortColumn.set(column);
            this.fbmSortDirection.set('asc');
        }
        this.fbmCurrentPage.set(1); // Reset to first page on sort
    }

    setFbmPage(page: number) {
        if (page >= 1 && page <= this.fbmTotalPages()) {
            this.fbmCurrentPage.set(page);
        }
    }

    // Overview Stats
    pendingCount = computed(() => this.pendingClassicOrders().length);
    fullOrdersTodayCount = computed(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return this.fullOrders().filter(o => {
            const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as any).toDate?.();
            return date && date >= today;
        }).length;
    });

    ngOnInit() {
        this.loadOrders();
        this.loadFbmInventory();
        this.loadWebhookLogs();
    }

    private loadOrders() {
        this.isLoadingData.set(true);
        this.dataError.set(null);
        // Since getOrders fetches all, we limit it or just use it if the dataset is small locally
        this.orderService.getOrders().subscribe({
            next: (orders) => {
                this.allOrders.set(orders);
                this.isLoadingData.set(false);
            },
            error: (err) => {
                console.error('Failed to load orders', err);
                this.dataError.set('Could not load orders from database.');
                this.isLoadingData.set(false);
            }
        });
    }

    private loadFbmInventory() {
        this.isLoadingFbm.set(true);
        const ref = collection(this.firestore, 'meli_fbm_inventory');
        collectionData(ref, { idField: 'id' }).subscribe({
            next: (data) => {
                this.fbmInventory.set(data as any[]);
                this.isLoadingFbm.set(false);
            },
            error: (err) => {
                console.error('Failed to load FBM inventory', err);
                this.isLoadingFbm.set(false);
            }
        });
    }

    private loadWebhookLogs() {
        const ref = collection(this.firestore, 'meli_webhook_logs');
        const q = query(ref, orderBy('createdAt', 'desc'), limit(20));
        collectionData(q, { idField: 'id' }).subscribe({
            next: (data) => {
                this.webhookLogs.set(data as any[]);
            },
            error: (err) => console.error('Failed to load webhook logs', err)
        });
    }

    setTab(tab: 'overview' | 'classic' | 'full' | 'listings') {
        this.activeTab.set(tab);
    }

    async analyzeSync() {
        this.isAnalyzing.set(true);
        this.totalHistoricalRecords.set(null);

        try {
            const analyzeFn = httpsCallable(this.functions, 'meliAnalyzeHistoricalSync');
            const result: any = await analyzeFn();

            if (result.data?.success) {
                this.totalHistoricalRecords.set(result.data.totalRecords);
                this.syncProgress.set({ processed: 0, total: result.data.totalRecords });
            } else {
                throw new Error("Failed to parse analysis");
            }
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
        const limit = 50;
        let hasMore = true;

        const syncFn = httpsCallable(this.functions, 'meliSyncHistorical');

        try {
            while (hasMore) {
                const result: any = await syncFn({ offset, limit });
                const data = result.data;

                if (!data?.success) throw new Error("Sync failed at chunk");

                offset += limit;
                hasMore = data.hasMore;

                this.syncProgress.update(p => ({
                    ...p,
                    processed: Math.min(p.processed + data.processed, total)
                }));
            }
            this.toast.success('Historical Sync Completed Successfully!');
        } catch (err: any) {
            console.error('Sync Error:', err);
            this.toast.error('Historical sync interrupted. Check console logs.');
        } finally {
            this.isSyncing.set(false);
            this.totalHistoricalRecords.set(null); // Reset after done
        }
    }

    // Quick sync for recent orders 
    async syncRecentOrders() {
        if (this.isSyncing()) return;

        this.isSyncing.set(true);
        this.toast.info('Starting quick sync of latest orders...');
        try {
            const syncFn = httpsCallable(this.functions, 'meliSyncOrders');
            const result: any = await syncFn();
            if (result.data?.success) {
                this.toast.success(`Synced ${result.data.imported} new orders.`);
            }
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
            const syncFn = httpsCallable(this.functions, 'meliSyncFullInventory');
            const result: any = await syncFn();
            if (result.data?.success) {
                this.toast.success(`Synced ${result.data.syncedCount} FBM items.`);
            } else {
                throw new Error("Unexpected API response");
            }
        } catch (err: any) {
            console.error('FBM Sync Error:', err);
            this.toast.error('Failed to sync FBM inventory.');
        } finally {
            this.isSyncing.set(false);
        }
    }

    isDownloadingLabel = signal<string | null>(null);

    async downloadMeliLabel(order: any) {
        if (!order.shippingId) {
            this.toast.error('No shipping ID available for this order.');
            return;
        }

        this.isDownloadingLabel.set(order.id || '');
        this.toast.info('Requesting Guía de Embarque from MercadoLibre...');

        try {
            const getLabelFn = httpsCallable(this.functions, 'meliGetShippingLabel');
            const result: any = await getLabelFn({ shippingId: order.shippingId });

            if (result.data?.success && result.data.pdfBase64) {
                // Convert Base64 to Blob and Download
                const byteCharacters = atob(result.data.pdfBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Meli_Guia_${order.orderNumber}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.toast.success('Guía downloaded successfully!');
            } else {
                throw new Error('Invalid response from backend.');
            }
        } catch (err: any) {
            console.error('Download Label Error:', err);
            this.toast.error('Failed to download label. It might not be ready yet.');
        } finally {
            this.isDownloadingLabel.set(null);
        }
    }
}
