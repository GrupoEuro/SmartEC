import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../core/services/order.service';
import { GlobalOrderCacheService } from '../../../core/services/global-order-cache.service';
import { Order, OrderStatus } from '../../../core/models/order.model';
import { OrderAssignmentService } from '../../../core/services/order-assignment.service';
import { OrderAssignment } from '../../../core/models/order-assignment.model';
import { OrderPriorityService } from '../../../core/services/order-priority.service';
import { UserProfile } from '../../../core/models/user.model';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
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
import { DATE_RANGES, DateRange, MetricsAnalyticsService } from '../metrics/services/metrics-analytics.service';
import { MetricsTimeframeService } from '../metrics/services/metrics-timeframe.service';
import { Subscription } from 'rxjs';

type SortField = 'orderNumber' | 'date' | 'customer' | 'total';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-order-queue',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, TranslateModule, PaginationComponent, AdminPageHeaderComponent, HelpContextButtonComponent, AppIconComponent],
    templateUrl: './order-queue.component.html',
    styleUrls: ['./order-queue.component.css']
})
export class OrderQueueComponent implements OnInit, OnDestroy {
    private orderService = inject(OrderService);
    private globalOrderCache = inject(GlobalOrderCacheService);
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
    private analyticsSvc = inject(MetricsAnalyticsService);
    private tf = inject(MetricsTimeframeService);

    readonly dateRanges = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    orders = signal<Order[]>([]);

    // UI State
    isLoading = signal(true);
    selectedOrders = signal<Set<string>>(new Set());
    selectAll = false;

    // Table Data Source
    dataSource = new TableDataSource<Order>([], 10);

    // Filter state
    statusFilter = signal<OrderStatus | 'all' | 'ghost'>('all');
    searchControl = this.fb.control('');
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
        { id: 'all' as const,            label: 'OPERATIONS.ORDERS.STATUS.ALL',              icon: 'clipboard-list', count: 0 },
        { id: 'my-orders' as const,      label: 'OPERATIONS.ORDERS.MY_ORDERS',               icon: 'user',           count: 0 },
        { id: 'unassigned' as const,     label: 'OPERATIONS.ORDERS.UNASSIGNED',              icon: 'pin',            count: 0 }
    ]);

    /** Ghost statuses excluded from queue by default (abandoned checkouts & failed payments) */
    readonly GHOST_STATUSES: OrderStatus[] = ['pending_payment', 'payment_failed'];

    /** Toggle to surface ghost orders for debugging */
    showGhostOrders = signal(false);

    /** For real-time new-order notifications — tracks last-known order set */
    private knownOrderIds = new Set<string>();
    private destroy$ = new Subject<void>();

    ngOnInit() {
        this.loadCurrentUser();
        this.loadOrders();
        this.setupSearch();
        this.loadAvailableStaff();
        this.handleQueryParams();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private getJsDate(timestamp: any): Date {
        if (!timestamp) return new Date();
        return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    }

    handleQueryParams() {
        this.route.queryParams.subscribe((params: any) => {
            if (params['status']) {
                const status = params['status'].toLowerCase();
                if (['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'all'].includes(status)) {
                    this.statusFilter.set(status as any);
                } else if (['my-orders', 'unassigned'].includes(status)) {
                    this.setFilter(status as any);
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

    private ordersSub?: Subscription;

    selectRange(r: DateRange) {
        this.tf.set(r);
        this.loadOrders();
    }

    loadOrders() {
        this.isLoading.set(true);
        const range = this.tf.selected();
        const [startDate, endDate] = this.analyticsSvc.getDateRange(range.type);

        if (this.ordersSub) this.ordersSub.unsubscribe();

        this.ordersSub = this.globalOrderCache.getLive(startDate, endDate)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
            next: (orders) => {
                // ── Real-time new-order notification ─────────────────────────
                if (this.knownOrderIds.size > 0) {
                    const newly = orders.filter(
                        o => (o.status === 'paid' || o.status === 'pending') &&
                             o.id && !this.knownOrderIds.has(o.id)
                    );
                    for (const o of newly) {
                        const ch = (o as any).sourceChannel ?? 'Web';
                        this.toast.success(
                            `🆕 Nueva orden — ${o.orderNumber ?? o.id} (${ch.toUpperCase()})`,
                            8000
                        );
                    }
                }
                this.knownOrderIds = new Set(orders.filter(o => !!o.id).map(o => o.id!));
                // ─────────────────────────────────────────────────────────────

                this.orders.set(orders);
                this.calculateCounts();
                this.dataSource.setData(orders);
                this.applyFilters();
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

    setFilter(view: 'all' | 'my-orders' | 'unassigned') {
        // Handle special filters
        if (view === 'my-orders') {
            this.showMyOrdersOnly.set(true);
            this.assignmentFilter.set('my-orders');
        } else if (view === 'unassigned') {
            this.showMyOrdersOnly.set(false);
            this.assignmentFilter.set('unassigned');
        } else {
            this.showMyOrdersOnly.set(false);
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
            const status = this.statusFilter();
            
            // Handle Ghost Orders via Status Dropdown
            if (status === 'ghost') {
                if (!this.GHOST_STATUSES.includes(order.status)) return false;
            } else {
                if (this.GHOST_STATUSES.includes(order.status)) return false;
                
                // Status filter
                if (status !== 'all' && order.status !== status) {
                    return false;
                }
            }

            // Search filter
            const searchTerm = this.searchControl.value?.toLowerCase() || '';
            if (searchTerm) {
                const matchesSearch =
                    order.orderNumber.toLowerCase().includes(searchTerm) ||
                    (order.customer?.name || '').toLowerCase().includes(searchTerm) ||
                    (order.customer?.email || '').toLowerCase().includes(searchTerm);
                if (!matchesSearch) return false;
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
            if (channelFilter !== 'all') {
                if (this.getLegacyChannel(order) !== channelFilter) {
                    return false;
                }
            }

            return true;
        });
    }

    getLegacyChannel(order: Order): string {
        if (!order.sourceChannel) return 'WEB';
        if (order.sourceChannel === 'storefront') return 'WEB';
        if (order.sourceChannel === 'pos') return 'POS';
        if (order.sourceChannel === 'on_behalf') return 'ON_BEHALF';
        if (order.sourceChannel === 'amazon') return order.fulfillmentType === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (order.sourceChannel === 'mercadolibre') return order.fulfillmentType === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
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
                escapeCSVField(this.getLegacyChannel(o)),
                escapeCSVField(date.toLocaleDateString('es-MX')),
                escapeCSVField(o.customer?.name || ''),
                escapeCSVField(o.customer?.email || ''),
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
            }

            return { ...tab, count };
        });

        this.statusTabs.set(updatedTabs);
    }

    // Utility
    getStatusBadgeClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            pending:         'bg-yellow-900/30 text-yellow-400 border-yellow-800/50',
            processing:      'bg-blue-900/30 text-blue-400 border-blue-800/50',
            shipped:         'bg-purple-900/30 text-purple-400 border-purple-800/50',
            delivered:       'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
            cancelled:       'bg-red-900/30 text-red-400 border-red-800/50',
            refunded:        'bg-orange-900/30 text-orange-400 border-orange-800/50',
            returned:        'bg-red-900/30 text-red-400 border-red-800/50',
            // Web checkout statuses
            pending_payment: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50',
            paid:            'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
            payment_failed:  'bg-red-900/30 text-red-400 border-red-800/50',
            refund_pending:  'bg-amber-900/30 text-amber-400 border-amber-800/50',
        };
        return classes[status] || '';
    }

    getChannelBadgeConfig(channel: string): { label: string, icon: string, class: string } {
        const configs: Record<string, { label: string, icon: string, class: string }> = {
            'WEB': { label: 'OPERATIONS.ORDERS.CHANNELS.WEB', icon: 'globe', class: 'channel-web' },
            'POS': { label: 'OPERATIONS.ORDERS.CHANNELS.POS', icon: 'credit-card', class: 'channel-pos' },
            'ON_BEHALF': { label: 'OPERATIONS.ORDERS.CHANNELS.PHONE', icon: 'phone', class: 'channel-on-behalf' },
            'AMAZON_MFN': { label: 'OPERATIONS.ORDERS.CHANNELS.AMAZON_MFN', icon: 'package', class: 'channel-amazon' },
            'MELI_CLASSIC': { label: 'OPERATIONS.ORDERS.CHANNELS.MELI_CLASSIC', icon: 'shopping-bag', class: 'channel-meli' },
            'AMAZON_FBA': { label: 'OPERATIONS.ORDERS.CHANNELS.AMAZON_FBA', icon: 'box', class: 'channel-amazon' },
            'MELI_FULL': { label: 'OPERATIONS.ORDERS.CHANNELS.MELI_FULL', icon: 'box', class: 'channel-meli' }
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
        this.statusFilter.set('all');
        this.searchControl.setValue('');
        this.assignmentFilter.set('all');
        this.showMyOrdersOnly.set(false);
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
            this.statusFilter() !== 'all' ||
            this.priorityFilter() !== 'all' ||
            this.slaFilter() !== 'all' ||
            this.channelFilter() !== 'all' ||
            this.assignmentFilter() !== 'all'
        );
    }

}
