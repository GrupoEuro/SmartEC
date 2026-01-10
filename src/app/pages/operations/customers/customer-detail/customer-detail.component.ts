import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { UserProfile } from '../../../../core/models/user.model';
import { Order } from '../../../../core/models/order.model';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { OrderService } from '../../../../core/services/order.service';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../../admin/shared/pagination/pagination.component';
import { TableDataSource } from '../../../../core/utils/table-data-source';
import { ToastService } from '../../../../core/services/toast.service';

type TabType = 'overview' | 'orders' | 'activity' | 'insights';

import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent, AppIconComponent],
    templateUrl: './customer-detail.component.html',
    styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private userService = inject(UserManagementService);
    private orderService = inject(OrderService);
    private toast = inject(ToastService);

    customerId = '';
    customer = signal<UserProfile | null>(null);
    isLoading = signal(true);
    error = signal<string | null>(null);

    // Tabs
    activeTab = signal<TabType>('overview');

    // Orders tab
    ordersDataSource = new TableDataSource<Order>([], 10);

    ngOnInit() {
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

    setTab(tab: TabType) {
        this.activeTab.set(tab);
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
