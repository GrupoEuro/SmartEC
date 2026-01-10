import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../../core/services/order.service';
import { Order, OrderStatus } from '../../../../core/models/order.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { TableDataSource } from '../../../../core/utils/table-data-source';
import { ToastService } from '../../../../core/services/toast.service';
import { debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
    selector: 'app-order-list',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './order-list.component.html',
    styleUrls: ['./order-list.component.css']
})
export class OrderListComponent implements OnInit {
    private orderService = inject(OrderService);
    private fb = inject(FormBuilder);
    private toast = inject(ToastService);

    // Data Source
    dataSource = new TableDataSource<Order>([], 10);
    isLoading = true;

    // Pagination (Managed by dataSource)
    // Filter state
    currentStatus: OrderStatus | 'all' = 'all';
    searchControl = this.fb.control('');

    statusTabs: { id: OrderStatus | 'all', label: string, count: number }[] = [
        { id: 'all', label: 'All', count: 0 },
        { id: 'pending', label: 'Pending', count: 0 },
        { id: 'processing', label: 'Processing', count: 0 },
        { id: 'shipped', label: 'Shipped', count: 0 },
        { id: 'delivered', label: 'Delivered', count: 0 },
        { id: 'cancelled', label: 'Cancelled', count: 0 }
    ];

    ngOnInit() {
        this.loadOrders();
        this.setupSearch();
    }

    loadOrders() {
        this.isLoading = true;
        this.orderService.getOrders().subscribe({
            next: (orders) => {
                this.dataSource.setData(orders);
                this.calculateCounts(orders); // Pass orders explicitly or use dataSource.data
                this.filterOrders();
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading orders:', error);
                this.isLoading = false;
            }
        });
    }

    setupSearch() {
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged()
        ).subscribe(() => {
            this.filterOrders();
        });
    }

    setFilter(status: OrderStatus | 'all') {
        this.currentStatus = status;
        this.filterOrders();
    }

    filterOrders() {
        this.dataSource.refresh((order) => {
            // Filter by Status
            if (this.currentStatus !== 'all' && order.status !== this.currentStatus) {
                return false;
            }

            // Filter by Search
            const searchTerm = this.searchControl.value?.toLowerCase() || '';
            if (searchTerm) {
                const matches =
                    order.orderNumber.toLowerCase().includes(searchTerm) ||
                    order.customer.name.toLowerCase().includes(searchTerm) ||
                    order.customer.email.toLowerCase().includes(searchTerm);
                if (!matches) return false;
            }
            return true;
        });
    }

    // Getters for Template
    get paginatedOrders() {
        return this.dataSource.displayedData;
    }

    get paginationConfig() {
        return this.dataSource.pagination;
    }

    onPageChange(page: number) {
        this.dataSource.setPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Actions
    handleExport() {
        const dataToExport = this.dataSource.filteredData;

        const headers = ['Order #', 'Date', 'Customer', 'Email', 'Total', 'Status'];
        const rows = dataToExport.map(o => {
            const date = (o.createdAt as any).toDate ? (o.createdAt as any).toDate() : new Date(o.createdAt as any);
            return [
                o.orderNumber,
                date.toLocaleDateString(),
                o.customer.name,
                o.customer.email,
                o.total,
                o.status
            ].map(f => `"${f}"`).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orders_export_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();

        this.toast.success('Orders exported to CSV');
    }

    calculateCounts(orders: Order[] = []) {
        // Fallback to this.dataSource.data if passed empty (e.g. initial load logic split)
        // But better to pass explicit
        const allOrders = orders.length ? orders : this.dataSource.data;

        this.statusTabs.forEach(tab => {
            if (tab.id === 'all') {
                tab.count = allOrders.length;
            } else {
                tab.count = allOrders.filter(o => o.status === tab.id).length;
            }
        });
    }

    getStatusClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            'pending': 'status-pending',
            'processing': 'status-processing',
            'shipped': 'status-shipped',
            'delivered': 'status-delivered',
            'cancelled': 'status-cancelled',
            'refunded': 'status-refunded',
            'returned': 'status-returned'
        };
        return classes[status] || 'status-default';
    }
}
