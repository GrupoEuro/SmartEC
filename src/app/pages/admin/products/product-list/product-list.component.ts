import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Observable, of, BehaviorSubject, combineLatest } from 'rxjs';
import { map, catchError, startWith, take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { ProductService } from '../../../../core/services/product.service';
import { BrandService } from '../../../../core/services/brand.service';
import { CategoryService } from '../../../../core/services/category.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { Product } from '../../../../core/models/product.model';
import { Brand } from '../../../../core/models/catalog.model';
import { Category } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';
import { ProductImportService } from '../../../../core/services/product-import.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ImportResultDialogComponent } from '../import-result-dialog/import-result-dialog.component';

type SortField = 'name' | 'price' | 'stock' | 'date';
type SortDirection = 'asc' | 'desc';

@Component({
    selector: 'app-product-list',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './product-list.component.html',
    styleUrl: './product-list.component.css'
})
export class ProductListComponent implements OnInit {
    private productService = inject(ProductService);
    private brandService = inject(BrandService);
    private categoryService = inject(CategoryService);
    private confirmDialog = inject(ConfirmDialogService);
    private toast = inject(ToastService);

    // Data observables
    products$!: Observable<Product[]>;
    brands$!: Observable<Brand[]>;
    categories$!: Observable<Category[]>;

    // Filtered and paginated products
    displayedProducts$!: Observable<Product[]>;

    // Search and filters
    searchTerm = '';
    selectedCategory = '';
    selectedBrand = '';
    selectedStatus = '';
    selectedStockStatus = '';

    // Sorting
    sortField: SortField = 'date';
    sortDirection: SortDirection = 'desc';

    // Pagination
    paginationConfig: PaginationConfig = {
        currentPage: 1,
        itemsPerPage: 10,
        totalItems: 0
    };

    // Bulk selection
    selectedProducts = new Set<string>();
    selectAll = false;

    // State
    isDeleting = false;

    // Subjects for reactive filtering
    private filterSubject = new BehaviorSubject<void>(undefined);

    ngOnInit() {
        this.loadData();
        this.setupFiltering();
    }

    loadData() {
        // Load all products
        this.products$ = this.productService.getProducts({}, 'featured').pipe(
            catchError(error => {
                console.error('Error loading products:', error);
                return of([]);
            })
        );

        // Load brands for filter dropdown
        this.brands$ = this.brandService.getBrands().pipe(
            catchError(() => of([]))
        );

        // Load categories for filter dropdown
        this.categories$ = this.categoryService.getCategories().pipe(
            catchError(() => of([]))
        );
    }

    setupFiltering() {
        // Combine products with filter changes
        this.displayedProducts$ = combineLatest([
            this.products$,
            this.filterSubject
        ]).pipe(
            map(([products]) => {
                // Apply filters
                let filtered = this.applyFilters(products);

                // Apply sorting
                filtered = this.applySorting(filtered);

                // Update pagination total
                this.paginationConfig.totalItems = filtered.length;

                // Apply pagination
                return this.applyPagination(filtered);
            })
        );
    }

    applyFilters(products: Product[]): Product[] {
        let filtered = products;

        // Search filter
        if (this.searchTerm.trim()) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.en.toLowerCase().includes(searchLower) ||
                p.name.es.toLowerCase().includes(searchLower) ||
                p.brand.toLowerCase().includes(searchLower) ||
                p.sku.toLowerCase().includes(searchLower)
            );
        }

        // Category filter
        if (this.selectedCategory) {
            filtered = filtered.filter(p => p.categoryId === this.selectedCategory);
        }

        // Brand filter
        if (this.selectedBrand) {
            filtered = filtered.filter(p => p.brand === this.selectedBrand);
        }

        // Status filter
        if (this.selectedStatus === 'active') {
            filtered = filtered.filter(p => p.active);
        } else if (this.selectedStatus === 'inactive') {
            filtered = filtered.filter(p => !p.active);
        }

        // Stock status filter
        if (this.selectedStockStatus === 'in-stock') {
            filtered = filtered.filter(p => p.inStock && p.stockQuantity > 5);
        } else if (this.selectedStockStatus === 'low-stock') {
            filtered = filtered.filter(p => p.inStock && p.stockQuantity <= 5 && p.stockQuantity > 0);
        } else if (this.selectedStockStatus === 'out-of-stock') {
            filtered = filtered.filter(p => !p.inStock || p.stockQuantity === 0);
        }

        return filtered;
    }

    applySorting(products: Product[]): Product[] {
        const sorted = [...products];

        sorted.sort((a, b) => {
            let comparison = 0;

            switch (this.sortField) {
                case 'name':
                    comparison = a.name.en.localeCompare(b.name.en);
                    break;
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'stock':
                    comparison = a.stockQuantity - b.stockQuantity;
                    break;
                case 'date':
                    const dateA = a.createdAt instanceof Date ? a.createdAt : new Date();
                    const dateB = b.createdAt instanceof Date ? b.createdAt : new Date();
                    comparison = dateA.getTime() - dateB.getTime();
                    break;
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }

    applyPagination(products: Product[]): Product[] {
        const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const end = start + this.paginationConfig.itemsPerPage;
        return products.slice(start, end);
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

    resetFilters() {
        this.searchTerm = '';
        this.selectedCategory = '';
        this.selectedBrand = '';
        this.selectedStatus = '';
        this.selectedStockStatus = '';
        this.onFilterChange();
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

    // Bulk selection methods
    toggleSelectAll(products: Product[]) {
        if (this.selectAll) {
            products.forEach(p => p.id && this.selectedProducts.add(p.id));
        } else {
            this.selectedProducts.clear();
        }
    }

    toggleProductSelection(productId: string | undefined) {
        if (!productId) return;
        if (this.selectedProducts.has(productId)) {
            this.selectedProducts.delete(productId);
        } else {
            this.selectedProducts.add(productId);
        }
        this.selectAll = false;
    }

    isProductSelected(productId: string | undefined): boolean {
        return productId ? this.selectedProducts.has(productId) : false;
    }

    get selectedCount(): number {
        return this.selectedProducts.size;
    }

    // Bulk actions
    async bulkActivate() {
        if (this.selectedProducts.size === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Activate ${this.selectedProducts.size} products?`,
            message: 'This will make them visible in the catalog.',
            confirmText: 'Activate',
            type: 'info'
        });

        if (!confirmed) return;

        try {
            for (const id of this.selectedProducts) {
                await this.productService.updateProduct(id, { active: true });
            }
            this.toast.success(`${this.selectedProducts.size} products activated`);
            this.selectedProducts.clear();
            this.selectAll = false;
            this.loadData();
        } catch (error) {
            console.error('Error activating products:', error);
            this.toast.error('Failed to activate products');
        }
    }

    async bulkDeactivate() {
        if (this.selectedProducts.size === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Deactivate ${this.selectedProducts.size} products?`,
            message: 'This will hide them from the catalog.',
            confirmText: 'Deactivate',
            type: 'warning'
        });

        if (!confirmed) return;

        try {
            for (const id of this.selectedProducts) {
                await this.productService.updateProduct(id, { active: false });
            }
            this.toast.success(`${this.selectedProducts.size} products deactivated`);
            this.selectedProducts.clear();
            this.selectAll = false;
            this.loadData();
        } catch (error) {
            console.error('Error deactivating products:', error);
            this.toast.error('Failed to deactivate products');
        }
    }

    async bulkDelete() {
        if (this.selectedProducts.size === 0) return;

        const confirmed = await this.confirmDialog.confirm({
            title: `Delete ${this.selectedProducts.size} products?`,
            message: 'This action cannot be undone.',
            confirmText: 'Delete',
            type: 'danger'
        });

        if (!confirmed) return;

        try {
            for (const id of this.selectedProducts) {
                await this.productService.deleteProduct(id);
            }
            this.toast.success(`${this.selectedProducts.size} products deleted`);
            this.selectedProducts.clear();
            this.selectAll = false;
            this.loadData();
        } catch (error) {
            console.error('Error deleting products:', error);
            this.toast.error('Failed to delete products');
        }
    }

    // Export handler (Excel)
    handleExport() {
        this.products$.pipe(take(1)).subscribe(products => {
            // Apply current filters to export only what's viewed/filtered
            const filtered = this.applyFilters(products);
            const sorted = this.applySorting(filtered);

            // Allow exporting only selected if any are checked
            const toExport = this.selectedProducts.size > 0
                ? sorted.filter(p => p.id && this.selectedProducts.has(p.id))
                : sorted;

            this.productImportService.exportProducts(toExport);
            this.toast.success(`Exporting ${toExport.length} products to Excel...`);
        });
    }

    // Delete single product
    async deleteProduct(product: Product) {
        if (!product.id) return;

        const confirmed = await this.confirmDialog.confirmDelete(
            product.name.en,
            'Product'
        );

        if (!confirmed) return;

        this.isDeleting = true;
        try {
            await this.productService.deleteProduct(product.id);
            this.toast.success('Product deleted successfully');
            this.loadData();
        } catch (error) {
            console.error('Error deleting product:', error);
            this.toast.error('Failed to delete product. Please try again.');
        } finally {
            this.isDeleting = false;
        }
    }

    // Services
    private productImportService = inject(ProductImportService);
    private dialog = inject(MatDialog);

    // Import State
    isImporting = false;
    importProgress = 0;

    // ... existing code ...

    /**
     * Trigger Template Download
     */
    downloadTemplate() {
        this.productImportService.downloadTemplate();
    }

    /**
     * Handle File Input Change
     */
    async onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        input.value = ''; // Reset input

        // 1. Validate File
        this.toast.info('Validating file...');
        try {
            const validationRules = await this.productImportService.validateImportFile(file);

            // 2. Show Result Dialog
            const dialogRef = this.dialog.open(ImportResultDialogComponent, {
                width: '600px',
                data: validationRules,
                disableClose: true,
                panelClass: 'custom-dialog-container'
            });

            dialogRef.afterClosed().subscribe(async (confirmed) => {
                if (confirmed) {
                    await this.runImport(validationRules.validRows);
                }
            });

        } catch (error) {
            console.error('Validation error:', error);
            this.toast.error('Failed to validate file. Please check the format.');
        }
    }

    /**
     * Run the actual import process
     */
    async runImport(rows: any[]) {
        this.isImporting = true;
        this.importProgress = 0;
        this.toast.info(`Starting import of ${rows.length} products...`);

        // Use a simple progress tracking for now
        // In a real scenario we might stream this, but here we await completion
        // or subscribe to an observable

        await this.productImportService.processImport(rows, (progress) => {
            this.importProgress = Math.round((progress.processed / progress.total) * 100);
        });

        this.isImporting = false;
        this.toast.success('Import completed successfully!');
        this.loadData();
    }
}
