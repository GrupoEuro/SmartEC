import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { UserManagementService } from '../../../core/services/user-management.service';
import { UserProfile } from '../../../core/models/user.model';
import { TableDataSource } from '../../../core/utils/table-data-source';
import { PaginationComponent } from '../../admin/shared/pagination/pagination.component';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { CustomerDetailPanelComponent } from '../../../shared/components/customer-detail-panel/customer-detail-panel.component';
import { ToastService } from '../../../core/services/toast.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-customer-lookup',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, PaginationComponent, AdminPageHeaderComponent, CustomerDetailPanelComponent, AppIconComponent],
    templateUrl: './customer-lookup.component.html',
    styleUrls: ['./customer-lookup.component.css']
})
export class CustomerLookupComponent implements OnInit {
    private userService = inject(UserManagementService);
    private toast = inject(ToastService);

    dataSource = new TableDataSource<UserProfile>([], 15);
    searchControl = new FormControl('');

    // Filters
    customerTypeFilter = signal<'all' | 'new' | 'returning'>('all');
    spendingTierFilter = signal<'all' | 'high' | 'standard'>('all');

    // Panel state
    isPanelOpen = false;
    selectedCustomerId = '';

    // Status filters (optional future expansion)
    // selectedRole = '';

    ngOnInit() {
        this.loadCustomers();
        this.setupSearch();
    }

    loadCustomers() {
        // Implement loading state if desired
        this.userService.getCustomers().subscribe({
            next: (customers) => {
                this.dataSource.setData(customers);
            },
            error: (err) => this.toast.error('Error loading customers')
        });
    }

    setupSearch() {
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged()
        ).subscribe(() => {
            this.applyFilters();
        });
    }

    applyFilters() {
        const term = (this.searchControl.value || '').toLowerCase();
        const type = this.customerTypeFilter();
        const tier = this.spendingTierFilter();

        this.dataSource.refresh((user) => {
            // 1. Search Term
            if (term) {
                const matchesName = (user.displayName || '').toLowerCase().includes(term);
                const matchesEmail = (user.email || '').toLowerCase().includes(term);
                const matchesPhone = (user.phone || '').includes(term);
                if (!matchesName && !matchesEmail && !matchesPhone) return false;
            }

            // 2. Customer Type
            const orders = user.stats?.totalOrders || 0;
            if (type === 'new' && orders > 1) return false;
            if (type === 'returning' && orders <= 1) return false;

            // 3. Spending Tier (High > 20,000 MXN)
            const spend = user.stats?.totalSpend || 0;
            const HIGH_TIER_THRESHOLD = 20000;
            if (tier === 'high' && spend <= HIGH_TIER_THRESHOLD) return false;
            if (tier === 'standard' && spend > HIGH_TIER_THRESHOLD) return false;

            return true;
        });
    }

    setFilter(filterType: 'type' | 'tier', value: string) {
        if (filterType === 'type') this.customerTypeFilter.set(value as 'all' | 'new' | 'returning');
        if (filterType === 'tier') this.spendingTierFilter.set(value as 'all' | 'high' | 'standard');
        this.applyFilters();
    }

    clearFilters() {
        this.searchControl.setValue('');
        this.customerTypeFilter.set('all');
        this.spendingTierFilter.set('all');
        this.applyFilters();
    }

    // Proxy methods for template
    onSort(field: keyof UserProfile | 'stats.totalOrders' | 'stats.totalSpend') {
        // Simple sort for now. Complex nested sort might need TableDataSource upgrade
        // For now, TableDataSource handles simple keys. 
        // We'll trust the simple implementation for direct props.
        // For nested stats, we might need a workaround or just sort by a calculated property.
        // Let's rely on basic props for now.
        this.dataSource.sort(field as any);
    }

    onPageChange(page: number) {
        this.dataSource.setPage(page);
    }

    onItemsPerPageChange(count: number) {
        this.dataSource.setItemsPerPage(count);
    }

    // Helper for template
    get sortField() { return this.dataSource.sortField; }
    get sortDirection() { return this.dataSource.sortDirection; }

    formatDate(timestamp: any): Date | null {
        if (!timestamp) return null;
        if ((timestamp as any).toDate) return (timestamp as any).toDate();
        return new Date(timestamp);
    }

    getItemsBgColor(seed: string): string {
        // Simple hash to color
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        return colors[Math.abs(hash) % colors.length];
    }

    viewCustomerDetails(customer: UserProfile) {
        this.selectedCustomerId = customer.uid;
        this.isPanelOpen = true;
    }

    closePanel() {
        this.isPanelOpen = false;
        this.selectedCustomerId = '';
    }

    onViewFullDetails(customerId: string) {
        // Navigation will be handled by the panel component
        this.closePanel();
    }

    // Export to CSV
    handleExport() {
        const filtered = this.dataSource.filteredData;
        this.exportToCSV(filtered);
    }

    exportToCSV(customers: UserProfile[]) {
        const escapeCSVField = (field: string): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['Nombre', 'Email', 'Teléfono', 'Total Pedidos', 'Gasto Total', 'Último Pedido'];
        const rows = customers.map(c => {
            const lastOrder = this.formatDate(c.stats?.lastOrderDate);
            return [
                escapeCSVField(c.displayName || 'Guest'),
                escapeCSVField(c.email || ''),
                escapeCSVField(c.phone || '-'),
                escapeCSVField((c.stats?.totalOrders || 0).toString()),
                escapeCSVField((c.stats?.totalSpend || 0).toString()),
                escapeCSVField(lastOrder ? lastOrder.toLocaleDateString('es-MX') : '-')
            ];
        });

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clientes_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.toast.success('Clientes exportados exitosamente');
    }
}
