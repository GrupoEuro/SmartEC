import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Observable, of, BehaviorSubject, combineLatest } from 'rxjs';
import { map, catchError, take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { CategoryService } from '../../../../core/services/category.service';
import { Category } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ExportService } from '../../../../core/services/export.service';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';

type SortField = 'name' | 'order';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-category-list',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './category-list.component.html',
    styleUrl: './category-list.component.css'
})
export class CategoryListComponent implements OnInit {
    private categoryService = inject(CategoryService);
    private confirmDialog = inject(ConfirmDialogService);
    private toast = inject(ToastService);
    private exportService = inject(ExportService);

    // Data observables
    categories$!: Observable<Category[]>;
    displayedCategories$!: Observable<Category[]>;

    // Search and filters
    searchTerm = '';
    selectedStatus = '';

    // Sorting
    sortField: SortField = 'name';
    sortDirection: SortDirection = 'asc';

    // Pagination
    paginationConfig: PaginationConfig = {
        currentPage: 1,
        itemsPerPage: 25,
        totalItems: 0
    };

    // Subjects for reactive filtering
    private filterSubject = new BehaviorSubject<void>(undefined);

    ngOnInit() {
        this.loadData();
        this.setupFiltering();
    }

    loadData() {
        this.categories$ = this.categoryService.getCategories().pipe(
            catchError(error => {
                console.error('Error loading categories:', error);
                return of([]);
            })
        );
    }

    setupFiltering() {
        this.displayedCategories$ = combineLatest([
            this.categories$,
            this.filterSubject
        ]).pipe(
            map(([categories]) => {
                // Apply filters
                let filtered = this.applyFilters(categories);

                // Apply sorting
                filtered = this.applySorting(filtered);

                // Update pagination total
                this.paginationConfig.totalItems = filtered.length;

                // Apply pagination
                return this.applyPagination(filtered);
            })
        );
    }

    applyFilters(categories: Category[]): Category[] {
        let filtered = categories;

        // Search filter
        if (this.searchTerm.trim()) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(c =>
                c.name.en.toLowerCase().includes(searchLower) ||
                c.name.es.toLowerCase().includes(searchLower) ||
                c.description?.en?.toLowerCase().includes(searchLower) ||
                c.description?.es?.toLowerCase().includes(searchLower)
            );
        }

        // Status filter
        if (this.selectedStatus === 'active') {
            filtered = filtered.filter(c => c.active);
        } else if (this.selectedStatus === 'inactive') {
            filtered = filtered.filter(c => !c.active);
        }

        return filtered;
    }

    applySorting(categories: Category[]): Category[] {
        const sorted = [...categories];

        sorted.sort((a, b) => {
            let comparison = 0;

            switch (this.sortField) {
                case 'name':
                    comparison = a.name.en.localeCompare(b.name.en);
                    break;
                case 'order':
                    comparison = (a.order || 0) - (b.order || 0);
                    break;
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }

    applyPagination(categories: Category[]): Category[] {
        const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const end = start + this.paginationConfig.itemsPerPage;
        return categories.slice(start, end);
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

    async deleteCategory(category: Category) {
        if (!category.id) return;

        const confirmed = await this.confirmDialog.confirmDelete(
            category.name.en,
            'Category'
        );

        if (!confirmed) return;

        try {
            await this.categoryService.deleteCategory(category.id);
            this.toast.success('Category deleted successfully');
        } catch (error) {
            console.error('Error deleting category:', error);
            this.toast.error('Failed to delete category. Please try again.');
        }
    }

    exportToCSV() {
        this.categories$.pipe(take(1)).subscribe(categories => {
            const filtered = this.applyFilters(categories);
            const sorted = this.applySorting(filtered);

            this.exportService.exportToCSVWithMapping(
                sorted,
                'categories',
                ['Name (EN)', 'Name (ES)', 'Description (EN)', 'Description (ES)', 'Order', 'Active'],
                (category) => [
                    category.name.en,
                    category.name.es,
                    category.description?.en || 'N/A',
                    category.description?.es || 'N/A',
                    category.order?.toString() || '0',
                    category.active ? 'Active' : 'Inactive'
                ]
            );
            this.toast.success('Categories exported successfully');
        });
    }
}
