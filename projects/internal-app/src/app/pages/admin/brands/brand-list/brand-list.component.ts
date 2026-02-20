import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Observable, of, BehaviorSubject, combineLatest } from 'rxjs';
import { tap, catchError, map, take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { BrandService } from '../../../../core/services/brand.service';
import { Brand } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ExportService } from '../../../../core/services/export.service';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';

type SortField = 'name' | 'country';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-brand-list',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './brand-list.component.html',
    styleUrl: './brand-list.component.css'
})
export class BrandListComponent implements OnInit {
    private brandService = inject(BrandService);
    private confirmDialog = inject(ConfirmDialogService);
    private toast = inject(ToastService);
    private exportService = inject(ExportService);

    // Data observables
    brands$!: Observable<Brand[]>;
    displayedBrands$!: Observable<Brand[]>;
    paginatedBrands$!: Observable<Brand[]>;

    // Search and filters
    searchTerm = '';
    selectedStatus = '';
    selectedFeatured = '';

    // Sorting
    sortField: SortField = 'name';
    sortDirection: SortDirection = 'asc';

    // Pagination
    paginationConfig: PaginationConfig = {
        currentPage: 1,
        itemsPerPage: 25,
        totalItems: 0
    };

    // State
    isLoading = true;

    // Subjects for reactive filtering
    private filterSubject = new BehaviorSubject<void>(undefined);

    ngOnInit() {
        this.loadData();
        this.setupFiltering();
    }

    loadData() {
        this.brands$ = this.brandService.getBrands().pipe(
            tap(() => this.isLoading = false),
            catchError(error => {
                console.error('Error loading brands:', error);
                this.isLoading = false;
                return of([]);
            })
        );
    }

    setupFiltering() {
        this.paginatedBrands$ = combineLatest([
            this.brands$,
            this.filterSubject
        ]).pipe(
            map(([brands]) => {
                // Apply filters
                let filtered = this.applyFilters(brands);

                // Apply sorting
                filtered = this.applySorting(filtered);

                // Update pagination total
                this.paginationConfig.totalItems = filtered.length;

                // Apply pagination
                return this.applyPagination(filtered);
            })
        );
    }

    applyFilters(brands: Brand[]): Brand[] {
        let filtered = brands;

        // Search filter
        if (this.searchTerm.trim()) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(b =>
                b.name.toLowerCase().includes(searchLower) ||
                b.countryOfOrigin?.toLowerCase().includes(searchLower) ||
                b.website?.toLowerCase().includes(searchLower)
            );
        }

        // Status filter
        if (this.selectedStatus === 'active') {
            filtered = filtered.filter(b => b.active);
        } else if (this.selectedStatus === 'inactive') {
            filtered = filtered.filter(b => !b.active);
        }

        // Featured filter
        if (this.selectedFeatured === 'featured') {
            filtered = filtered.filter(b => b.featured);
        } else if (this.selectedFeatured === 'not-featured') {
            filtered = filtered.filter(b => !b.featured);
        }

        return filtered;
    }

    applySorting(brands: Brand[]): Brand[] {
        const sorted = [...brands];

        sorted.sort((a, b) => {
            let comparison = 0;

            switch (this.sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'country':
                    comparison = (a.countryOfOrigin || '').localeCompare(b.countryOfOrigin || '');
                    break;
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }

    applyPagination(brands: Brand[]): Brand[] {
        const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const end = start + this.paginationConfig.itemsPerPage;
        return brands.slice(start, end);
    }

    // Filter methods
    onSearchChange() {
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }

    onFilterChange() {
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }

    onSortChange(field: SortField) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        this.filterSubject.next();
    }

    // Pagination methods
    onPageChange(page: number) {
        this.paginationConfig.currentPage = page;
        this.filterSubject.next();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onItemsPerPageChange(itemsPerPage: number) {
        this.paginationConfig.itemsPerPage = itemsPerPage;
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }

    async deleteBrand(brand: Brand) {
        if (!brand.id) return;

        const confirmed = await this.confirmDialog.confirmDelete(
            brand.name,
            'Brand'
        );

        if (!confirmed) return;

        try {
            await this.brandService.deleteBrand(brand.id);
            this.toast.success('Brand deleted successfully');
        } catch (error) {
            console.error('Error deleting brand:', error);
            this.toast.error('Failed to delete brand. Please try again.');
        }
    }

    exportToCSV() {
        this.brands$.pipe(take(1)).subscribe(brands => {
            const filtered = this.applyFilters(brands);
            const sorted = this.applySorting(filtered);

            this.exportService.exportToCSVWithMapping(
                sorted,
                'brands',
                ['Name', 'Country', 'Website', 'Featured', 'Active'],
                (brand) => [
                    brand.name,
                    brand.countryOfOrigin || 'N/A',
                    brand.website || 'N/A',
                    brand.featured ? 'Yes' : 'No',
                    brand.active ? 'Active' : 'Inactive'
                ]
            );
            this.toast.success('Brands exported successfully');
        });
    }

    get paginatedBrands() {
        return this.paginatedBrands$;
    }
}
