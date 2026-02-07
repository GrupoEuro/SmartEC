import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { UserProfile } from '../../../../core/models/user.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
    selector: 'app-customer-list',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './customer-list.component.html',
    styleUrls: ['./customer-list.component.css']
})
export class CustomerListComponent implements OnInit {
    private userService = inject(UserManagementService);
    private toast = inject(ToastService);

    customers: UserProfile[] = [];
    filteredCustomers: UserProfile[] = [];
    isLoading = true;

    searchControl = new FormControl('');

    // Sorting & Pagination
    currentPage = 1;
    pageSize = 10;
    sortColumn: 'displayName' | 'email' | 'createdAt' | 'orders' | 'spend' = 'createdAt';
    sortDirection: 'asc' | 'desc' = 'desc';
    filterType: 'all' | 'active' | 'new' = 'all';

    get paginationConfig() {
        return {
            currentPage: this.currentPage,
            itemsPerPage: this.pageSize,
            totalItems: this.filteredCustomers.length
        };
    }

    ngOnInit() {
        this.loadCustomers();
        this.setupSearch();
    }

    loadCustomers() {
        if (this.customers.length === 0) {
            this.isLoading = true;
        }

        this.userService.getCustomers().subscribe({
            next: (customers) => {
                this.customers = customers;
                this.applyFilters();
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading customers:', error);
                this.isLoading = false;
            }
        });
    }

    setupSearch() {
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged()
        ).subscribe(() => {
            this.currentPage = 1;
            this.applyFilters();
        });
    }

    setFilterType(type: 'all' | 'active' | 'new') {
        this.filterType = type;
        this.currentPage = 1;
        this.applyFilters();
    }

    applyFilters() {
        let result = [...this.customers];
        const term = this.searchControl.value?.toLowerCase() || '';

        // 1. Search Filter
        if (term) {
            result = result.filter(c =>
                c.displayName?.toLowerCase().includes(term) ||
                c.email.toLowerCase().includes(term)
            );
        }

        // 2. Type Filter
        if (this.filterType === 'active') {
            result = result.filter(c => c.stats?.totalOrders && c.stats.totalOrders > 0);
        } else if (this.filterType === 'new') {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            result = result.filter(c => c.createdAt && new Date(c.createdAt) > thirtyDaysAgo);
        }

        // 2. Sort
        result.sort((a, b) => {
            let valA: any = '';
            let valB: any = '';

            switch (this.sortColumn) {
                case 'displayName':
                    valA = a.displayName || '';
                    valB = b.displayName || '';
                    break;
                case 'email':
                    valA = a.email;
                    valB = b.email;
                    break;
                case 'orders':
                    valA = a.stats?.totalOrders || 0;
                    valB = b.stats?.totalOrders || 0;
                    break;
                case 'spend':
                    valA = a.stats?.totalSpend || 0;
                    valB = b.stats?.totalSpend || 0;
                    break;
                case 'createdAt':
                default:
                    valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    break;
            }

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        this.filteredCustomers = result;
    }

    get paginatedCustomers(): UserProfile[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredCustomers.slice(start, start + this.pageSize);
    }

    sort(column: any) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        this.currentPage = 1; // Reset to first page
        this.applyFilters();
    }

    onPageChange(page: number) {
        this.currentPage = page;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    getLTV(customer: UserProfile): number {
        return customer.stats?.totalSpend || 0;
    }

    trackByUid(index: number, item: UserProfile): string {
        return item.uid;
    }

    getItemsBgColor(seed: string): string {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }
    exportToCSV() {
        if (this.filteredCustomers.length === 0) return;

        const headers = ['Name', 'Email', 'Joined', 'Total Orders', 'Total Spend', 'Status', 'Last Active'];
        const rows = this.filteredCustomers.map(c => [
            c.displayName || 'Guest',
            c.email,
            c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-',
            c.stats?.totalOrders || 0,
            c.stats?.totalSpend || 0,
            c.isActive ? 'Active' : 'Inactive',
            c.lastLogin ? new Date(c.lastLogin).toLocaleDateString() : '-'
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        this.toast.success('Exported to CSV');
    }
}
