import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../core/services/toast.service';
import { OrderService } from '../../../../core/services/order.service';
import { Order } from '../../../../core/models/order.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
    selector: 'app-mercadolibre-hub',
    standalone: true,
    imports: [CommonModule, AdminPageHeaderComponent, AppIconComponent, TranslateModule],
    templateUrl: './mercadolibre-hub.component.html'
})
export class MercadolibreHubComponent implements OnInit {
    private functions = inject(Functions);
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
