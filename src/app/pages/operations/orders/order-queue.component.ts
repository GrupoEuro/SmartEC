import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus } from '../../../core/models/order.model';
import { OrderAssignmentService } from '../../../core/services/order-assignment.service';
import { OrderAssignment } from '../../../core/models/order-assignment.model';
import { OrderPriorityService } from '../../../core/services/order-priority.service';
import { UserProfile } from '../../../core/models/user.model';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { PaginationComponent, PaginationConfig } from '../../admin/shared/pagination/pagination.component';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { PdfGenerationService } from '../../../core/services/pdf-generation.service';

import { TableDataSource } from '../../../core/utils/table-data-source';
import { HelpContextButtonComponent } from '../../../shared/components/help-context-button/help-context-button.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

type SortField = 'orderNumber' | 'date' | 'customer' | 'total';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-order-queue',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, TranslateModule, PaginationComponent, AdminPageHeaderComponent, HelpContextButtonComponent, AppIconComponent],
    templateUrl: './order-queue.component.html',
    styleUrls: ['./order-queue.component.css']
})
export class OrderQueueComponent implements OnInit {
    private orderService = inject(OrderService);
    private assignmentService = inject(OrderAssignmentService);
    private priorityService = inject(OrderPriorityService);
    private authService = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private fb = inject(FormBuilder);
    private confirmDialog = inject(ConfirmDialogService);
    private toast = inject(ToastService);
    private firestore = inject(Firestore);
    private pdfService = inject(PdfGenerationService);

    orders = signal<Order[]>([]);

    // UI State
    isLoading = signal(true);
    selectedOrders = signal<Set<string>>(new Set());
    selectAll = false;

    // Table Data Source
    dataSource = new TableDataSource<Order>([], 10);

    // Filter state
    currentStatus = signal<OrderStatus | 'all'>('all');
    searchControl = this.fb.control('');
    selectedDateRange = '';
    selectedPaymentStatus = '';
    selectedFulfillmentStatus = '';

    // New Phase 2B filters
    assignmentFilter = signal<'all' | 'assigned' | 'unassigned' | 'my-orders'>('all');
    priorityFilter = signal<'all' | 'standard' | 'express' | 'rush'>('all');
    slaFilter = signal<'all' | 'on-time' | 'approaching' | 'overdue'>('all');
    channelFilter = signal<'all' | 'WEB' | 'POS' | 'ON_BEHALF' | 'AMAZON_MFN' | 'MELI_CLASSIC' | 'AMAZON_FBA' | 'MELI_FULL'>('all');

    // Staff for bulk assignment
    availableStaff = signal<UserProfile[]>([]);
    bulkAssignTo = signal<string>('');

    // Pagination
    // Pagination (Delegated to dataSource)

    // Assignment state
    currentUserId = signal<string | null>(null);
    currentUserName = signal<string>('');
    orderAssignments = signal<Map<string, OrderAssignment>>(new Map());
    showMyOrdersOnly = signal(false);

    // Status tabs with counts
    statusTabs = signal([
        { id: 'all' as const, label: 'OPERATIONS.ORDERS.STATUS.ALL', icon: 'clipboard-list', count: 0 },
        { id: 'my-orders' as const, label: 'OPERATIONS.ORDERS.MY_ORDERS', icon: 'user', count: 0 },
        { id: 'unassigned' as const, label: 'OPERATIONS.ORDERS.UNASSIGNED', icon: 'pin', count: 0 },
        { id: 'pending' as OrderStatus, label: 'OPERATIONS.ORDERS.STATUS.PENDING', icon: 'clock', count: 0 },
        { id: 'processing' as OrderStatus, label: 'OPERATIONS.ORDERS.STATUS.PROCESSING', icon: 'settings', count: 0 },
        { id: 'shipped' as OrderStatus, label: 'OPERATIONS.ORDERS.STATUS.SHIPPED', icon: 'truck', count: 0 },
        { id: 'delivered' as OrderStatus, label: 'OPERATIONS.ORDERS.STATUS.DELIVERED', icon: 'check-circle', count: 0 },
        { id: 'cancelled' as OrderStatus, label: 'OPERATIONS.ORDERS.STATUS.CANCELLED', icon: 'x-circle', count: 0 }
    ]);

    ngOnInit() {
        this.loadCurrentUser();
        this.loadOrders();
        this.setupSearch();
        this.loadAvailableStaff();
        this.handleQueryParams();
    }

    private getJsDate(timestamp: any): Date {
        if (!timestamp) return new Date();
        return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    }

    handleQueryParams() {
        this.route.queryParams.subscribe((params: any) => {
            if (params['status']) {
                const status = params['status'].toLowerCase();
                // precise matching would be better, but let's assume valid status for now
                if (['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'all', 'my-orders', 'unassigned'].includes(status)) {
                    this.setFilter(status);
                }
            }
        });
    }


    loadCurrentUser() {
        this.authService.userProfile$.subscribe(user => {
            if (user) {
                this.currentUserId.set(user.uid);
                this.currentUserName.set(user.displayName || user.email || 'User');
            }
        });
    }

    async loadAvailableStaff() {
        try {
            const usersRef = collection(this.firestore, 'users');
            const q = query(
                usersRef,
                where('role', 'in', ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'])
            );

            const snapshot = await getDocs(q);
            const staff = snapshot.docs
                .map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile))
                .filter(user => user.isActive);

            this.availableStaff.set(staff);
        } catch (error) {
            console.error('Error loading staff:', error);
            this.toast.error('Error loading staff list');
        }
    }

    loadOrders() {
        this.isLoading.set(true);
        this.orderService.getOrders().subscribe({
            next: (orders) => {
                this.orders.set(orders);
                this.calculateCounts();
                this.dataSource.setData(orders);
                this.applyFilters(); // Initial filter apply
                this.isLoading.set(false);
            },
            error: (error) => {
                console.error('Error loading orders:', error);
                this.toast.error('Error loading orders');
                this.isLoading.set(false);
            }
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

    setFilter(status: OrderStatus | 'all' | 'my-orders' | 'unassigned') {
        // Handle special filters
        if (status === 'my-orders') {
            this.showMyOrdersOnly.set(true);
            this.currentStatus.set('all');
            this.assignmentFilter.set('my-orders');
        } else if (status === 'unassigned') {
            this.showMyOrdersOnly.set(false);
            this.currentStatus.set('all');
            this.assignmentFilter.set('unassigned');
        } else {
            this.showMyOrdersOnly.set(false);
            this.currentStatus.set(status);
            this.assignmentFilter.set('all');
        }
        this.applyFilters();
    }

    onFilterChange() {
        this.applyFilters();
    }

    onSortChange(field: string) {
        // Map string field to keyof Order manually if needed, or cast
        // For simplicity reusing TableDataSource's sorting
        this.dataSource.sort(field as keyof Order);
        // Note: Complex fields like 'customer.name' need custom sort logic in TableDataSource 
        // or we need to flattened the data structure.
        // For now, let's keep the simple refactor. 
        // Actually, TableDataSource default sort might not handle 'customer.name' correctly.
        // Let's customize the sort function if needed or rely on basic props.
    }

    applyFilters() {
        this.dataSource.refresh((order) => {
            // Status filter
            const status = this.currentStatus();
            if (status !== 'all' && order.status !== status) {
                return false;
            }

            // Search filter
            const searchTerm = this.searchControl.value?.toLowerCase() || '';
            if (searchTerm) {
                const matchesSearch =
                    order.orderNumber.toLowerCase().includes(searchTerm) ||
                    order.customer.name.toLowerCase().includes(searchTerm) ||
                    order.customer.email.toLowerCase().includes(searchTerm);
                if (!matchesSearch) return false;
            }

            // Date range filter
            if (this.selectedDateRange) {
                const now = new Date();
                let startDate: Date;

                switch (this.selectedDateRange) {
                    case 'today':
                        startDate = new Date(now.setHours(0, 0, 0, 0));
                        break;
                    case 'this-week':
                        startDate = new Date(now.setDate(now.getDate() - 7));
                        break;
                    case 'this-month':
                        startDate = new Date(now.setMonth(now.getMonth() - 1));
                        break;
                    default:
                        startDate = new Date(0);
                }

                const orderDate = this.getJsDate(order.createdAt);
                if (orderDate < startDate) return false;
            }

            // Assignment filter - handled by tabs via setFilter() method
            // When tab is clicked, it sets assignmentFilter appropriately
            const assignmentFilter = this.assignmentFilter();
            if (assignmentFilter !== 'all') {
                if (assignmentFilter === 'unassigned' && order.assignedTo) return false;
                if (assignmentFilter === 'my-orders' && order.assignedTo !== this.currentUserId()) return false;
            }

            // Priority filter
            const priorityFilter = this.priorityFilter();
            if (priorityFilter !== 'all' && order.priorityLevel !== priorityFilter) {
                return false;
            }

            // SLA filter
            const slaFilter = this.slaFilter();
            if (slaFilter !== 'all') {
                if (slaFilter === 'overdue' && !order.isOverdue) return false;
                if (slaFilter === 'on-time' && order.isOverdue) return false;
                // 'approaching' would need more complex logic with slaDeadline
            }

            // Channel filter
            const channelFilter = this.channelFilter();
            if (channelFilter !== 'all' && order.channel !== channelFilter) {
                return false;
            }

            return true;
        });
    }

    // Deprecated methods replaced by TableDataSource logic
    // applyFilters, applySorting, applyPagination removed

    // Pagination methods
    onPageChange(page: number) {
        this.dataSource.setPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onItemsPerPageChange(itemsPerPage: number) {
        this.dataSource.setItemsPerPage(itemsPerPage);
        // No manual refresh needed, wrapper handles it
    }

    // Bulk selection
    toggleSelectAll(event: Event) {
        const checked = (event.target as HTMLInputElement).checked;
        this.selectAll = checked;
        const selected = new Set<string>();

        if (checked) {
            this.dataSource.displayedData.forEach(order => {
                if (order.id) selected.add(order.id);
            });
        }

        this.selectedOrders.set(selected);
    }

    toggleSelect(orderId: string) {
        const selected = new Set(this.selectedOrders());
        if (selected.has(orderId)) {
            selected.delete(orderId);
        } else {
            selected.add(orderId);
        }
        this.selectedOrders.set(selected);
        this.selectAll = false;
    }

    isSelected(orderId: string): boolean {
        return this.selectedOrders().has(orderId);
    }

    get selectedCount(): number {
        return this.selectedOrders().size;
    }

    // Bulk actions
    async bulkPrint() {
        const selected = Array.from(this.selectedOrders());
        if (selected.length === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Print packing slips for ${selected.length} orders?`,
            message: 'This will open a print dialog with all selected packing slips.',
            confirmText: 'Print',
            type: 'info'
        });

        if (!confirmed) return;

        try {
            // Get full order objects for selected IDs
            const selectedOrders = this.orders().filter(o => o.id && selected.includes(o.id));

            if (selectedOrders.length === 0) {
                this.toast.error('No orders found to print');
                return;
            }

            // Generate bulk PDF
            const pdf = this.pdfService.generateBulkPackingSlips(selectedOrders);
            this.pdfService.printPdf(pdf);

            this.toast.success(`Printing ${selectedOrders.length} packing slips`);
        } catch (error) {
            console.error('Error printing packing slips:', error);
            this.toast.error('Failed to generate packing slips');
        }
    }

    async bulkUpdateStatus(newStatus: OrderStatus) {
        const selected = Array.from(this.selectedOrders());
        if (selected.length === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Update ${selected.length} orders to ${newStatus}?`,
            message: 'This action will update the status of all selected orders.',
            confirmText: 'Update',
            type: 'warning'
        });

        if (!confirmed) return;

        try {
            for (const id of selected) {
                await this.orderService.updateStatus(id, newStatus);
            }
            this.toast.success(`${selected.length} orders updated successfully`);
            this.selectedOrders.set(new Set());
            this.selectAll = false;
            this.loadOrders();
        } catch (error) {
            console.error('Error updating orders:', error);
            this.toast.error('Failed to update orders');
        }
    }

    // Bulk assignment
    async bulkAssign() {
        const selected = Array.from(this.selectedOrders());
        const staffId = this.bulkAssignTo();

        if (selected.length === 0 || !staffId) return;

        const staff = this.availableStaff().find(s => s.uid === staffId);
        if (!staff) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Assign ${selected.length} orders to ${staff.displayName || staff.email}?`,
            message: 'This will assign all selected orders to the chosen staff member.',
            confirmText: 'Assign',
            type: 'info'
        });

        if (!confirmed) return;

        try {
            const currentUser = this.currentUserId();
            const currentUserName = this.currentUserName();

            for (const orderId of selected) {
                await this.assignmentService.assignOrder(
                    orderId,
                    staffId,
                    staff.displayName || staff.email,
                    currentUser!,
                    currentUserName
                );

                // Update order with assignment info
                await this.orderService.updateOrder(orderId, {
                    assignedTo: staffId,
                    assignedToName: staff.displayName || staff.email
                });
            }

            this.toast.success(`${selected.length} orders assigned to ${staff.displayName || staff.email}`);
            this.selectedOrders.set(new Set());
            this.selectAll = false;
            this.bulkAssignTo.set('');
            this.loadOrders();
        } catch (error) {
            console.error('Error assigning orders:', error);
            this.toast.error('Failed to assign orders');
        }
    }

    // Export to CSV
    handleExport() {
        // Use dataSource.filteredData for export to respect current filters
        const filtered = this.dataSource.filteredData;

        // Use dataSource's sortData logic or just export filtered
        // Ideally we want to export sorted too
        // const sorted = this.dataSource.sortData(filtered); // private method access? 
        // We can just export filteredData as it's already sorted if we applied sort

        this.exportToCSV(filtered);
    }

    exportToCSV(orders: Order[]) {
        const escapeCSVField = (field: string): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['Order Number', 'Channel', 'Date', 'Customer', 'Email', 'Total', 'Status'];
        const rows = orders.map(o => {
            const date = this.getJsDate(o.createdAt);
            return [
                escapeCSVField(o.orderNumber),
                escapeCSVField(o.channel || 'WEB'),
                escapeCSVField(date.toLocaleDateString('es-MX')),
                escapeCSVField(o.customer.name),
                escapeCSVField(o.customer.email),
                escapeCSVField(o.total.toString()),
                escapeCSVField(o.status)
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
        a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.toast.success('Orders exported successfully');
    }

    // Quick actions
    createOrder() {
        this.router.navigate(['/operations/orders/new']);
    }

    viewOrder(orderId: string) {
        // Navigation handled by routerLink
    }

    printPackingSlip(orderId: string) {
        const order = this.orders().find(o => o.id === orderId);
        if (!order) {
            this.toast.error('Order not found');
            return;
        }

        try {
            const pdf = this.pdfService.generatePackingSlip(order);
            this.pdfService.printPdf(pdf);
            this.toast.success('Packing slip sent to printer');
        } catch (error) {
            console.error('Error printing packing slip:', error);
            this.toast.error('Failed to generate packing slip');
        }
    }

    calculateCounts() {
        const orders = this.orders();
        const currentUserId = this.currentUserId();

        const updatedTabs = this.statusTabs().map(tab => {
            let count = 0;

            switch (tab.id) {
                case 'all':
                    count = orders.length;
                    break;
                case 'my-orders':
                    count = orders.filter(o => o.assignedTo === currentUserId).length;
                    break;
                case 'unassigned':
                    count = orders.filter(o => !o.assignedTo).length;
                    break;
                case 'pending':
                case 'processing':
                case 'shipped':
                case 'delivered':
                case 'cancelled':
                case 'refunded':
                    count = orders.filter(o => o.status === tab.id).length;
                    break;
            }

            return { ...tab, count };
        });

        this.statusTabs.set(updatedTabs);
    }

    // Utility
    getStatusBadgeClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50',
            processing: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
            shipped: 'bg-purple-900/30 text-purple-400 border-purple-800/50',
            delivered: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
            cancelled: 'bg-red-900/30 text-red-400 border-red-800/50',
            refunded: 'bg-orange-900/30 text-orange-400 border-orange-800/50',
            returned: 'bg-red-900/30 text-red-400 border-red-800/50'
        };
        return classes[status] || '';
    }

    getChannelBadgeConfig(channel: string): { label: string, icon: string, class: string } {
        const configs: Record<string, { label: string, icon: string, class: string }> = {
            'WEB': { label: 'WEB', icon: 'globe', class: 'channel-web' },
            'POS': { label: 'POS', icon: 'credit-card', class: 'channel-pos' },
            'ON_BEHALF': { label: 'PHONE', icon: 'phone', class: 'channel-on-behalf' },
            'AMAZON_MFN': { label: 'AMZ', icon: 'package', class: 'channel-amazon' },
            'MELI_CLASSIC': { label: 'ML', icon: 'shopping-bag', class: 'channel-meli' },
            'AMAZON_FBA': { label: 'FBA', icon: 'box', class: 'channel-amazon' },
            'MELI_FULL': { label: 'FULL', icon: 'box', class: 'channel-meli' }
        };
        return configs[channel] || { label: channel, icon: 'help-circle', class: 'channel-web' };
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = this.getJsDate(date);
        return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    clearFilters() {
        this.currentStatus.set('all');
        this.searchControl.setValue('');
        this.selectedDateRange = '';
        this.assignmentFilter.set('all');
        this.priorityFilter.set('all');
        this.slaFilter.set('all');
        this.channelFilter.set('all');
        this.dataSource.pagination.currentPage = 1;
        this.applyFilters();
    }

    // Template Helpers
    get displayedOrders() {
        return this.dataSource.displayedData;
    }

    get paginationConfig() {
        return this.dataSource.pagination;
    }

    get sortField() {
        return this.dataSource.sortField;
    }

    get sortDirection() {
        return this.dataSource.sortDirection;
    }

    // Check if any filters are active
    hasActiveFilters(): boolean {
        return !!(
            this.searchControl.value ||
            this.selectedDateRange ||
            this.priorityFilter() !== 'all' ||
            this.slaFilter() !== 'all' ||
            this.channelFilter() !== 'all'
        );
    }

}
