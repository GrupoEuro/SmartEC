import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl, FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { UserProfile, CustomerNote } from '../../../../core/models/user.model';
import { Order } from '../../../../core/models/order.model';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { OrderService } from '../../../../core/services/order.service';
import { AuthService } from '../../../../core/services/auth.service';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../../admin/shared/pagination/pagination.component';
import { TableDataSource } from '../../../../core/utils/table-data-source';
import { ToastService } from '../../../../core/services/toast.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

type TabType = 'overview' | 'orders' | 'balance' | 'notes' | 'addresses';

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent, AppIconComponent],
    templateUrl: './customer-detail.component.html',
    styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private userService = inject(UserManagementService);
    private orderService = inject(OrderService);
    private authService = inject(AuthService);
    private toast = inject(ToastService);

    customerId = '';
    customer = signal<UserProfile | null>(null);
    isLoading = signal(true);
    error = signal<string | null>(null);

    // Current Staff (for authoring notes)
    currentStaff: { uid: string; name: string } | null = null;

    // Tabs
    activeTab = signal<TabType>('overview');

    // Orders tab
    ordersDataSource = new TableDataSource<Order>([], 10);

    // Notes tab
    notes = signal<CustomerNote[]>([]);
    isLoadingNotes = signal(false);
    newNoteText = signal('');

    ngOnInit() {
        // Track current staff member for CRM notes
        this.authService.userProfile$.subscribe(p => {
            if (p) this.currentStaff = { uid: p.uid, name: p.displayName || p.email || 'Staff' };
        });

        this.customerId = this.route.snapshot.paramMap.get('id') || '';
        if (this.customerId) {
            this.loadCustomerData();
        } else {
            this.error.set('Customer ID not found');
            this.isLoading.set(false);
        }
    }

    loadCustomerData() {
        this.isLoading.set(true);
        this.error.set(null);

        // Load customer profile
        this.userService.getUserById(this.customerId).subscribe({
            next: (customer: UserProfile | undefined) => {
                if (customer) {
                    this.customer.set(customer);
                    this.loadOrders();
                } else {
                    this.error.set('Customer not found');
                    this.isLoading.set(false);
                }
            },
            error: () => {
                this.error.set('Failed to load customer data');
                this.isLoading.set(false);
            }
        });
    }

    loadOrders() {
        this.orderService.getOrdersByCustomer(this.customerId).subscribe({
            next: (orders: Order[]) => {
                this.ordersDataSource.setData(orders);
                this.isLoading.set(false);
            },
            error: () => {
                this.toast.error('Error loading customer orders');
                this.isLoading.set(false);
            }
        });
    }

    loadNotes() {
        this.isLoadingNotes.set(true);
        this.userService.getCustomerNotes(this.customerId).subscribe({
            next: (notes) => {
                this.notes.set(notes);
                this.isLoadingNotes.set(false);
            },
            error: (err) => {
                console.error("Firestore getCustomerNotes error:", err);
                this.toast.error('Failed to load customer notes');
                this.isLoadingNotes.set(false);
            }
        });
    }

    submitNote() {
        const text = this.newNoteText().trim();
        if (!text) return;
        if (!this.currentStaff) {
            this.toast.error('You must be logged in to add a note.');
            return;
        }

        this.userService.addCustomerNote(this.customerId, text, this.currentStaff.uid, this.currentStaff.name).subscribe({
            next: () => {
                this.toast.success('Note added to customer profile');
                this.newNoteText.set('');
                this.loadNotes(); // Reload timeline
            },
            error: () => this.toast.error('Failed to save note')
        });
    }

    setTab(tab: string) {
        this.activeTab.set(tab as TabType);
        // Lazy load notes when the tab is first opened
        if (tab === 'notes' && this.notes().length === 0) {
            this.loadNotes();
        }
    }

    goBack() {
        this.router.navigate(['/operations/customers']);
    }

    viewOrder(orderId: string) {
        this.router.navigate(['/operations/orders', orderId]);
    }

    createOnBehalfOrder() {
        this.router.navigate(['/operations/orders/new'], {
            queryParams: { customerId: this.customerId }
        });
    }

    getStatusBadgeClass(status: string): string {
        const classes: { [key: string]: string } = {
            'pending': 'badge-warning',
            'processing': 'badge-info',
            'shipped': 'badge-primary',
            'delivered': 'badge-success',
            'cancelled': 'badge-danger',
            'refunded': 'badge-secondary'
        };
        return classes[status] || 'badge-neutral';
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    formatDate(timestamp: any): string {
        if (!timestamp) return '-';
        const date = (timestamp as any).toDate ? (timestamp as any).toDate() : new Date(timestamp);
        return date.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    getAverageOrderValue(): number {
        const customer = this.customer();
        if (!customer?.stats?.totalOrders || !customer?.stats?.totalSpend) return 0;
        return customer.stats.totalSpend / customer.stats.totalOrders;
    }
}
