import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { OrderService } from '../../../../core/services/order.service';
import { UserProfile } from '../../../../core/models/user.model';
import { Order } from '../../../../core/models/order.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { CustomerTimelineService, TimelineEvent, TimelineCategory } from './customer-timeline.service';
import { map } from 'rxjs/operators';

type Tab = 'overview' | 'orders' | 'timeline';

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './customer-detail.component.html',
    styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit {
    private route      = inject(ActivatedRoute);
    private router     = inject(Router);
    private userSvc    = inject(UserManagementService);
    private orderSvc   = inject(OrderService);
    private timelineSvc = inject(CustomerTimelineService);

    // ── State ──────────────────────────────────────────────────────────────────
    customer:        UserProfile | undefined;
    customerOrders:  Order[] = [];
    isLoading      = true;

    // Timeline
    activeTab      = signal<Tab>('overview');
    timelineEvents = signal<TimelineEvent[]>([]);
    timelineLoading = signal(false);
    timelineFilter  = signal<TimelineCategory | 'all'>('all');

    filteredEvents = computed(() => {
        const filter = this.timelineFilter();
        const events = this.timelineEvents();
        return filter === 'all' ? events : events.filter(e => e.category === filter);
    });

    // Stats derived from timeline
    orderCount      = computed(() => this.timelineEvents().filter(e => e.category === 'order').length);
    totalSpend      = computed(() => this.timelineEvents()
        .filter(e => e.category === 'order' && e.value)
        .reduce((s, e) => s + (e.value ?? 0), 0));
    cartClears      = computed(() => this.timelineEvents().filter(e => e.meta?.['event'] === 'cleared_by_user').length);
    waClicks        = computed(() => this.timelineEvents().filter(e => e.category === 'whatsapp').length);
    qrScans         = computed(() => this.timelineEvents().filter(e => e.category === 'qr_scan').length);
    conversionScans = computed(() => this.timelineEvents().filter(e => e.category === 'qr_scan' && e.meta?.['converted']).length);

    readonly tabs: { id: Tab; label: string; icon: string }[] = [
        { id: 'overview',  label: 'Perfil',    icon: '👤' },
        { id: 'orders',    label: 'Órdenes',   icon: '📦' },
        { id: 'timeline',  label: 'Timeline',  icon: '🕐' },
    ];

    readonly categoryFilters: { id: TimelineCategory | 'all'; label: string; icon: string }[] = [
        { id: 'all',        label: 'Todo',       icon: '⚡' },
        { id: 'order',      label: 'Órdenes',    icon: '📦' },
        { id: 'cart',       label: 'Carrito',    icon: '🛒' },
        { id: 'qr_scan',    label: 'QR',         icon: '📱' },
        { id: 'whatsapp',   label: 'WhatsApp',   icon: '💬' },
        { id: 'account',    label: 'Cuenta',     icon: '👤' },
        { id: 'newsletter', label: 'Newsletter', icon: '📩' },
    ];

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) this.loadCustomerData(id);
        else this.router.navigate(['/admin/customers']);
    }

    setTab(tab: Tab) {
        this.activeTab.set(tab);
        if (tab === 'timeline' && this.timelineEvents().length === 0 && this.customer) {
            this.loadTimeline();
        }
    }

    setFilter(f: TimelineCategory | 'all') {
        this.timelineFilter.set(f);
    }

    private loadCustomerData(id: string) {
        this.isLoading = true;
        this.userSvc.getCustomers().subscribe({
            next: (customers) => {
                this.customer = customers.find(c => c.uid === id);
                if (this.customer) {
                    this.loadOrders(this.customer.email);
                } else {
                    this.router.navigate(['/admin/customers']);
                }
            },
            error: () => { this.isLoading = false; }
        });
    }

    private loadOrders(email: string) {
        this.orderSvc.getOrders().pipe(
            map(orders => orders.filter(o => o.customer.email === email))
        ).subscribe({
            next: (orders) => {
                this.customerOrders = orders;
                this.isLoading = false;
            },
            error: () => { this.isLoading = false; }
        });
    }

    private async loadTimeline() {
        if (!this.customer) return;
        this.timelineLoading.set(true);
        try {
            const events = await this.timelineSvc.getTimeline(
                this.customer.uid,
                this.customer.email
            );
            this.timelineEvents.set(events);
        } catch (e) {
            console.error('[CustomerTimeline] Failed:', e);
        } finally {
            this.timelineLoading.set(false);
        }
    }

    // ── Template helpers ───────────────────────────────────────────────────────
    formatMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }

    formatRelative(ms: number): string {
        const diff   = Date.now() - ms;
        const mins   = Math.floor(diff / 60000);
        const hours  = Math.floor(diff / 3600000);
        const days   = Math.floor(diff / 86400000);
        if (mins  < 2)   return 'Hace un momento';
        if (mins  < 60)  return `Hace ${mins}m`;
        if (hours < 24)  return `Hace ${hours}h`;
        if (days  < 7)   return `Hace ${days}d`;
        return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    formatDate(ms: number): string {
        return new Date(ms).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    getStatusClass(status: string): string {
        const classes: Record<string, string> = {
            pending: 'status-pending', processing: 'status-processing',
            shipped: 'status-shipped', delivered: 'status-delivered',
            completed: 'status-delivered', paid: 'status-delivered',
            cancelled: 'status-cancelled', refunded: 'status-cancelled',
        };
        return classes[status] || 'status-default';
    }

    openOrder(orderId: string) {
        this.router.navigate(['/admin/orders', orderId]);
    }
}
