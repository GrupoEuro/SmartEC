import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { OrderService } from '../../../../core/services/order.service';
import { UserProfile } from '../../../../core/models/user.model';
import { Order } from '../../../../core/models/order.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { map } from 'rxjs/operators';

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './customer-detail.component.html',
    styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private userService = inject(UserManagementService);
    private orderService = inject(OrderService);

    customer: UserProfile | undefined;
    customerOrders: Order[] = [];
    isLoading = true;

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.loadCustomerData(id);
        } else {
            this.router.navigate(['/admin/customers']);
        }
    }

    loadCustomerData(id: string) {
        this.isLoading = true;

        // 1. Get Customer Profile
        // We can reuse getUsers() and find, or ideally implement getUserById(id)
        // For now, since we don't have a direct single user fetch in service exposed nicely,
        // we'll filter from list or (better) implement a getById in service later.
        // Let's rely on the list fetch for now as it's cached/fast for small sets,
        // or add getById to service if needed.
        // Actually, let's just use the collection fetch and map.
        this.userService.getCustomers().subscribe({
            next: (customers) => {
                this.customer = customers.find(c => c.uid === id);

                if (this.customer) {
                    // 2. Get Customer Orders
                    // We need to implement getOrdersByCustomer() in OrderService or filter client side
                    this.loadOrders(this.customer.email);
                } else {
                    // Fallback: try to fetch by ID directly via a new method if we had one,
                    // or just redirect
                    console.error('Customer not found in list');
                    this.router.navigate(['/admin/customers']);
                }
            },
            error: (err) => {
                console.error(err);
                this.isLoading = false;
            }
        });

    }

    loadOrders(email: string) {
        // In a real app we'd query by customerId, but here we might rely on email matches in orders
        this.orderService.getOrders().pipe(
            map(orders => orders.filter(o => o.customer.email === email))
        ).subscribe({
            next: (orders) => {
                this.customerOrders = orders;
                this.isLoading = false;
            },
            error: (err) => {
                console.error(err);
                this.isLoading = false;
            }
        });
    }

    getStatusClass(status: string): string {
        const classes: any = {
            'pending': 'status-pending',
            'processing': 'status-processing',
            'shipped': 'status-shipped',
            'delivered': 'status-delivered',
            'cancelled': 'status-cancelled',
            'refunded': 'status-refunded'
        };
        return classes[status] || 'status-default';
    }
}
