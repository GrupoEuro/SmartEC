import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ProductKit } from '../../../../core/models/product-kit.model';
import { KitService } from '../../../../core/services/kit.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TableDataSource } from '../../../../core/utils/table-data-source';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';

type PublishStatus = 'draft' | 'published' | 'archived';

@Component({
    selector: 'app-kit-list',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        RouterModule,
        TranslateModule,
        AdminPageHeaderComponent,
        PaginationComponent
    ],
    templateUrl: './kit-list.component.html',
    styleUrls: ['./kit-list.component.css']
})
export class KitListComponent implements OnInit {
    private kitService = inject(KitService);
    private router = inject(Router);
    private confirmDialog = inject(ConfirmDialogService);
    private toastService = inject(ToastService);

    kits = signal<ProductKit[]>([]);
    dataSource = new TableDataSource<ProductKit>([], 15);
    searchControl = new FormControl('');
    isLoading = signal(true);

    // Filters
    selectedStatus = signal<PublishStatus | 'all'>('all');
    selectedActiveStatus = signal<'all' | 'active' | 'inactive'>('all');

    // Bulk selection
    selectedKits = signal<Set<string>>(new Set());
    selectAll = false;

    // Status tabs with counts
    statusTabs = signal([
        { id: 'all' as const, label: 'ADMIN.KITS.STATUS.ALL', count: 0 },
        { id: 'published' as PublishStatus, label: 'ADMIN.KITS.FORM.PUBLISHED', count: 0 },
        { id: 'draft' as PublishStatus, label: 'ADMIN.KITS.FORM.DRAFT', count: 0 },
        { id: 'archived' as PublishStatus, label: 'ADMIN.KITS.FORM.ARCHIVED', count: 0 }
    ]);

    // For template usage
    Math = Math;

    ngOnInit() {
        this.loadKits();
        this.setupSearch();
    }

    loadKits() {
        this.isLoading.set(true);
        this.kitService.getAllKits().subscribe({
            next: (kits) => {
                this.kits.set(kits);
                this.dataSource.setData(kits);
                this.calculateCounts();
                this.applyFilters();
                this.isLoading.set(false);
            },
            error: (error) => {
                console.error('Error loading kits:', error);
                this.toastService.error('ADMIN.KITS.ERROR_LOAD');
                this.isLoading.set(false);
            }
        });
    }

    setupSearch() {
        this.searchControl.valueChanges
            .pipe(debounceTime(300), distinctUntilChanged())
            .subscribe(() => this.applyFilters());
    }

    applyFilters() {
        const searchTerm = (this.searchControl.value || '').toLowerCase();
        const status = this.selectedStatus();
        const activeStatus = this.selectedActiveStatus();

        this.dataSource.refresh((kit) => {
            // Search filter
            if (searchTerm) {
                const matchesName = kit.name.es.toLowerCase().includes(searchTerm) ||
                    kit.name.en.toLowerCase().includes(searchTerm);
                const matchesSku = kit.sku.toLowerCase().includes(searchTerm);
                if (!matchesName && !matchesSku) return false;
            }

            // Status filter
            if (status !== 'all' && kit.publishStatus !== status) {
                return false;
            }

            // Active status filter
            if (activeStatus !== 'all') {
                const isActive = activeStatus === 'active';
                if (kit.active !== isActive) return false;
            }

            return true;
        });
    }

    setStatusFilter(status: PublishStatus | 'all') {
        this.selectedStatus.set(status);
        this.applyFilters();
    }

    setActiveFilter(status: 'all' | 'active' | 'inactive') {
        this.selectedActiveStatus.set(status);
        this.applyFilters();
    }

    onSortChange(field: string) {
        this.dataSource.sort(field as keyof ProductKit);
    }

    calculateCounts() {
        const kits = this.kits();
        const tabs = this.statusTabs();

        tabs[0].count = kits.length; // All
        tabs[1].count = kits.filter(k => k.publishStatus === 'published').length;
        tabs[2].count = kits.filter(k => k.publishStatus === 'draft').length;
        tabs[3].count = kits.filter(k => k.publishStatus === 'archived').length;

        this.statusTabs.set([...tabs]);
    }

    clearFilters() {
        this.searchControl.setValue('');
        this.selectedStatus.set('all');
        this.selectedActiveStatus.set('all');
        this.dataSource.pagination.currentPage = 1;
        this.applyFilters();
    }

    // Bulk selection
    toggleSelectAll(event: Event) {
        const checked = (event.target as HTMLInputElement).checked;
        this.selectAll = checked;
        const selected = new Set<string>();

        if (checked) {
            this.dataSource.displayedData.forEach(kit => {
                if (kit.id) selected.add(kit.id);
            });
        }

        this.selectedKits.set(selected);
    }

    toggleSelect(kitId: string) {
        const selected = new Set(this.selectedKits());
        if (selected.has(kitId)) {
            selected.delete(kitId);
        } else {
            selected.add(kitId);
        }
        this.selectedKits.set(selected);
        this.selectAll = false;
    }

    isSelected(kitId: string): boolean {
        return this.selectedKits().has(kitId);
    }

    get selectedCount(): number {
        return this.selectedKits().size;
    }

    // Bulk actions
    async bulkUpdateStatus(newStatus: PublishStatus) {
        const selected = Array.from(this.selectedKits());
        if (selected.length === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Update ${selected.length} kits to ${newStatus}?`,
            message: 'This action will update the publish status of all selected kits.',
            confirmText: 'Update',
            type: 'warning'
        });

        if (!confirmed) return;

        try {
            for (const id of selected) {
                await this.kitService.updateKitStatus(id, newStatus);
            }
            this.toastService.success(`${selected.length} kits updated successfully`);
            this.selectedKits.set(new Set());
            this.selectAll = false;
            this.loadKits();
        } catch (error) {
            console.error('Error updating kits:', error);
            this.toastService.error('Failed to update kits');
        }
    }

    async bulkDelete() {
        const selected = Array.from(this.selectedKits());
        if (selected.length === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Delete ${selected.length} kits?`,
            message: 'This action cannot be undone.',
            confirmText: 'Delete',
            type: 'danger'
        });

        if (!confirmed) return;

        try {
            for (const id of selected) {
                await this.kitService.deleteKit(id).toPromise();
            }
            this.toastService.success(`${selected.length} kits deleted successfully`);
            this.selectedKits.set(new Set());
            this.selectAll = false;
            this.loadKits();
        } catch (error) {
            console.error('Error deleting kits:', error);
            this.toastService.error('Failed to delete kits');
        }
    }

    // Export to CSV
    handleExport() {
        const filtered = this.dataSource.filteredData;
        this.exportToCSV(filtered);
    }

    exportToCSV(kits: ProductKit[]) {
        const escapeCSVField = (field: string): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['SKU', 'Name (ES)', 'Name (EN)', 'Components', 'Price', 'Compare Price', 'Savings %', 'Status', 'Active'];
        const rows = kits.map(k => [
            escapeCSVField(k.sku),
            escapeCSVField(k.name.es),
            escapeCSVField(k.name.en),
            escapeCSVField(k.components.length.toString()),
            escapeCSVField(k.price.toString()),
            escapeCSVField(k.compareAtPrice?.toString() || ''),
            escapeCSVField(this.getSavingsPercentage(k).toString()),
            escapeCSVField(k.publishStatus || 'draft'),
            escapeCSVField(k.active ? 'Yes' : 'No')
        ]);

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kits_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.toastService.success('Kits exported successfully');
    }

    // Pagination
    onPageChange(page: number) {
        this.dataSource.setPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onItemsPerPageChange(itemsPerPage: number) {
        this.dataSource.setItemsPerPage(itemsPerPage);
    }

    // Template helpers
    get displayedKits() {
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

    createKit() {
        this.router.navigate(['/admin/kits/new']);
    }

    editKit(kit: ProductKit) {
        this.router.navigate(['/admin/kits', kit.id, 'edit']);
    }

    async deleteKit(kit: ProductKit) {
        const confirmed = await this.confirmDialog.confirm({
            title: 'ADMIN.KITS.DELETE_CONFIRM',
            message: 'ADMIN.KITS.DELETE_WARNING',
            type: 'danger'
        });

        if (confirmed && kit.id) {
            this.kitService.deleteKit(kit.id).subscribe({
                next: () => {
                    this.toastService.success('ADMIN.KITS.SUCCESS_DELETE');
                    this.loadKits();
                },
                error: (error) => {
                    console.error('Error deleting kit:', error);
                    this.toastService.error('Error deleting kit');
                }
            });
        }
    }

    getComponentCount(kit: ProductKit): number {
        return kit.components.reduce((sum, comp) => sum + comp.quantity, 0);
    }

    getTotalComponentPrice(kit: ProductKit): number {
        return kit.components.reduce((sum, comp) => sum + (comp.unitPrice * comp.quantity), 0);
    }

    getSavingsPercentage(kit: ProductKit): number {
        const total = this.getTotalComponentPrice(kit);
        if (total === 0) return 0;
        return Math.round(((total - kit.price) / total) * 100);
    }
}
