import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { UserProfile } from '../../../core/models/user.model';
import { Order } from '../../../core/models/order.model';
import { UserManagementService } from '../../../core/services/user-management.service';
import { OrderService } from '../../../core/services/order.service';

@Component({
    selector: 'app-customer-detail-panel',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    templateUrl: './customer-detail-panel.component.html',
    styleUrls: ['./customer-detail-panel.component.css']
})
export class CustomerDetailPanelComponent implements OnInit {
    private userService = inject(UserManagementService);
    private orderService = inject(OrderService);
    private router = inject(Router);

    @Input() customerId: string = '';
    @Input() isOpen: boolean = false;
    @Output() closePanel = new EventEmitter<void>();
    @Output() viewFullDetails = new EventEmitter<string>();

    customer: UserProfile | null = null;
    recentOrders: Order[] = [];
    isLoading = true;
    error: string | null = null;

    ngOnInit() {
        if (this.customerId) {
            this.loadCustomerData();
        }
    }

    ngOnChanges() {
        if (this.customerId && this.isOpen) {
            this.loadCustomerData();
        }
    }

    async loadCustomerData() {
        this.isLoading = true;
        this.error = null;

        try {
            // Load customer profile
            this.userService.getUserById(this.customerId).subscribe({
                next: (customer: UserProfile | undefined) => {
                    this.customer = customer || null;
                },
                error: (err: any) => {
                    console.error('Error loading customer:', err);
                    this.error = 'Failed to load customer data';
                    this.isLoading = false;
                }
            });

            // Load recent orders
            this.orderService.getOrdersByCustomer(this.customerId, 5).subscribe({
                next: (orders: Order[]) => {
                    this.recentOrders = orders;
                    this.isLoading = false;
                },
                error: (err: any) => {
                    console.error('Error loading orders:', err);
                    this.isLoading = false;
                }
            });
        } catch (err) {
            console.error('Error:', err);
            this.error = 'An error occurred';
            this.isLoading = false;
        }
    }

    close() {
        this.closePanel.emit();
    }

    viewFull() {
        this.viewFullDetails.emit(this.customerId);
        this.router.navigate(['/operations/customers', this.customerId]);
        this.close();
    }

    viewOrder(orderId: string) {
        this.router.navigate(['/operations/orders', orderId]);
        this.close();
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
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}
