import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, orderBy, limit, where } from '@angular/fire/firestore';
import { ToastService } from '../../../../core/services/toast.service';
import { Order } from '../../../../core/models/order.model';

export type AmazonTab = 'overview' | 'orders' | 'sync_log';
export type AmazonOrderFilter = 'all' | 'pending' | 'shipped' | 'cancelled';

interface SyncLogEntry {
    id: string;
    type: 'scheduled' | 'manual' | 'webhook';
    status: 'success' | 'partial' | 'error';
    imported: number;
    updated: number;
    errors: number;
    createdAt: any;
    durationMs?: number;
}

@Component({
    selector: 'app-amazon-hub',
    standalone: true,
    imports: [CommonModule, FormsModule, AdminPageHeaderComponent, AppIconComponent, TranslateModule],
    templateUrl: './amazon-hub.component.html',
})
export class AmazonHubComponent implements OnInit {
    private functions = inject(Functions);
    private firestore = inject(Firestore);
    private toast     = inject(ToastService);

    // ── Tab & Filter State ─────────────────────────────────────────────────────
    activeTab     = signal<AmazonTab>('overview');
    orderFilter   = signal<AmazonOrderFilter>('all');
    searchQuery   = signal('');
    isSyncing     = signal(false);
    isLoadingData = signal(true);
    isLoadingLogs = signal(true);

    // ── Data ───────────────────────────────────────────────────────────────────
    allOrders = signal<Order[]>([]);
    syncLogs  = signal<SyncLogEntry[]>([]);

    /** Last sync timestamp from sync log — displayed in overview card */
    lastSyncAt = signal<Date | null>(null);
    lastSyncStatus = signal<'success' | 'partial' | 'error' | null>(null);

    // ── Computed Orders ────────────────────────────────────────────────────────

    amazonOrders = computed(() =>
        this.allOrders().filter(o => o.sourceChannel === 'amazon')
    );

    filteredOrders = computed(() => {
        let orders = this.amazonOrders();
        const filter = this.orderFilter();
        const q = this.searchQuery().toLowerCase().trim();

        if (filter === 'pending')   orders = orders.filter(o => ['pending', 'processing'].includes(o.status as string));
        if (filter === 'shipped')   orders = orders.filter(o => o.status === 'shipped');
        if (filter === 'cancelled') orders = orders.filter(o => o.status === 'cancelled');

        if (q) {
            orders = orders.filter(o =>
                (o.orderNumber || '').toLowerCase().includes(q) ||
                ((o as any).amazonOrderId || '').toLowerCase().includes(q) ||
                (o.items || []).some(i => (i.sku || '').toLowerCase().includes(q))
            );
        }

        // Sort: pending first, then by createdAt desc
        return [...orders].sort((a, b) => {
            const aPriority = ['pending', 'processing'].includes(a.status as string) ? 0 : 1;
            const bPriority = ['pending', 'processing'].includes(b.status as string) ? 0 : 1;
            if (aPriority !== bPriority) return aPriority - bPriority;
            const aDate = this.toDate(a.createdAt)?.getTime() ?? 0;
            const bDate = this.toDate(b.createdAt)?.getTime() ?? 0;
            return bDate - aDate;
        });
    });

    // ── Overview KPIs ──────────────────────────────────────────────────────────

    kpiMtd = computed(() => {
        const now   = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const orders = this.amazonOrders().filter(o => {
            const d = this.toDate(o.createdAt);
            return d && d >= start;
        });
        const revenueOrders = orders.filter(o =>
            !['cancelled', 'refunded', 'returned', 'payment_failed', 'pending_payment'].includes(o.status as string)
        );
        return {
            totalOrders:       orders.length,
            pendingFulfill:    orders.filter(o => ['pending', 'processing'].includes(o.status as string)).length,
            revenueMtd:        revenueOrders.reduce((s, o) => s + (o.total ?? 0), 0),
            avgOrderValue:     revenueOrders.length > 0
                                   ? revenueOrders.reduce((s, o) => s + (o.total ?? 0), 0) / revenueOrders.length
                                   : 0,
            fbaOrders:         orders.filter(o => o.fulfillmentType === 'platform').length,
            mfnOrders:         orders.filter(o => o.fulfillmentType !== 'platform').length,
        };
    });

    /** Ship-by urgency: orders pending with shipByDate < 24h */
    urgentOrders = computed(() =>
        this.amazonOrders().filter(o => {
            if (!['pending', 'processing'].includes(o.status as string)) return false;
            const shipBy = this.toDate((o as any).shipByDate);
            if (!shipBy) return false;
            return shipBy.getTime() - Date.now() < 24 * 60 * 60 * 1000;
        })
    );

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    ngOnInit() {
        this.loadOrders();
        this.loadSyncLogs();
    }

    private loadOrders() {
        this.isLoadingData.set(true);
        // Query directly for Amazon orders only — no full table scan
        const since = new Date();
        since.setDate(since.getDate() - 90);
        const q = query(
            collection(this.firestore, 'orders'),
            where('sourceChannel', '==', 'amazon'),
            orderBy('createdAt', 'desc'),
            limit(20)
        );
        collectionData(q, { idField: 'id' }).subscribe({
            next: (docs: any[]) => {
                const orders = docs.map(d => ({
                    ...d,
                    createdAt:  d.createdAt?.toDate  ? d.createdAt.toDate()  : (d.createdAt  ? new Date(d.createdAt)  : new Date()),
                    updatedAt:  d.updatedAt?.toDate  ? d.updatedAt.toDate()  : (d.updatedAt  ? new Date(d.updatedAt)  : new Date()),
                    shipByDate: d.shipByDate?.toDate ? d.shipByDate.toDate() : (d.shipByDate ? new Date(d.shipByDate) : null),
                }));
                this.allOrders.set(orders as any);
                this.isLoadingData.set(false);
            },
            error: (err) => {
                console.error('[AmazonHub] orders load error:', err);
                this.isLoadingData.set(false);
            }
        });
    }

    private loadSyncLogs() {
        this.isLoadingLogs.set(true);
        const q = query(
            collection(this.firestore, 'amazon_sync_logs'),
            orderBy('createdAt', 'desc'),
            limit(25)
        );
        collectionData(q, { idField: 'id' }).subscribe({
            next: (docs: any[]) => {
                this.syncLogs.set(docs as SyncLogEntry[]);
                const latest = docs[0];
                if (latest?.createdAt) {
                    this.lastSyncAt.set(this.toDate(latest.createdAt));
                    this.lastSyncStatus.set(latest.status ?? 'success');
                }
                this.isLoadingLogs.set(false);
            },
            error: (err) => {
                console.error('[AmazonHub] sync logs error:', err);
                this.isLoadingLogs.set(false);
            }
        });
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async syncNow() {
        if (this.isSyncing()) return;
        this.isSyncing.set(true);
        this.toast.info('Syncing Amazon orders from SP-API…');
        try {
            const result: any = await httpsCallable(this.functions, 'amazonManualSync')({ daysBack: 7 });
            if (result.data?.success) {
                this.toast.success(`✅ ${result.data.imported} new · ${result.data.updated} updated`);
                this.loadOrders();
            } else {
                this.toast.error(result.data?.error ?? 'Sync failed — check credentials.');
            }
        } catch (err: any) {
            const msg = err?.message ?? '';
            if (msg.includes('credentials') || msg.includes('NOT_CONFIGURED')) {
                this.toast.error('SP-API credentials not configured yet. Add secrets and redeploy.');
            } else {
                this.toast.error('Amazon sync failed. Check Cloud Functions logs.');
            }
            console.error('[AmazonHub] sync error:', err);
        } finally {
            this.isSyncing.set(false);
        }
    }

    // ── Tab & Filter Controls ──────────────────────────────────────────────────

    setTab(tab: AmazonTab)                    { this.activeTab.set(tab); }
    setFilter(f: AmazonOrderFilter)           { this.orderFilter.set(f); }
    onSearch(value: string)                   { this.searchQuery.set(value); }

    // ── Helpers ────────────────────────────────────────────────────────────────

    toDate(ts: any): Date | null {
        if (!ts) return null;
        if (ts instanceof Date) return ts;
        if (ts?.toDate) return ts.toDate();
        if (typeof ts === 'number') return new Date(ts);
        return null;
    }

    /** Returns urgency class based on ship-by date */
    shipByUrgency(order: Order): 'urgent' | 'warning' | 'ok' | 'none' {
        const shipBy = this.toDate((order as any).shipByDate);
        if (!shipBy) return 'none';
        const hoursLeft = (shipBy.getTime() - Date.now()) / (60 * 60 * 1000);
        if (hoursLeft < 24) return 'urgent';
        if (hoursLeft < 48) return 'warning';
        return 'ok';
    }

    statusBadgeClass(status: string | null | undefined): string {
        const map: Record<string, string> = {
            pending:         'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            processing:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
            shipped:         'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            delivered:       'bg-teal-500/20 text-teal-400 border-teal-500/30',
            cancelled:       'bg-red-500/20 text-red-400 border-red-500/30',
            refunded:        'bg-zinc-600/40 text-zinc-400 border-zinc-600/30',
        };
        return map[status ?? ''] ?? 'bg-zinc-700/40 text-zinc-400 border-zinc-700/30';
    }

    syncStatusClass(status: string): string {
        if (status === 'success') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        if (status === 'partial') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
        return 'bg-red-500/20 text-red-400 border-red-500/30';
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }

    fmtTimeAgo(date: Date | null): string {
        if (!date) return 'Never';
        const mins = Math.floor((Date.now() - date.getTime()) / 60000);
        if (mins < 1)  return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    }

    getAmazonOrderId(order: Order): string {
        return (order as any).amazonOrderId || order.orderNumber || '';
    }

    getShipByDate(order: Order): any {
        return (order as any).shipByDate;
    }
}
