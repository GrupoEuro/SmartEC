import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common'; // Import NgOptimizedImage
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, combineLatest, BehaviorSubject } from 'rxjs';
import { map, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ProductService } from '../../core/services/product.service';
import { CategoryService } from '../../core/services/category.service';
import { MetaService } from '../../core/services/meta.service';
import { CartService } from '../../core/services/cart.service';
import { DataSeederService } from '../../core/services/data-seeder.service';
import { LanguageService } from '../../core/services/language.service';
import { Product, ProductFilters } from '../../core/models/product.model';
import { Category, ProductSortBy } from '../../core/models/catalog.model';

import { SkeletonProductCardComponent } from '../../shared/components/skeleton-product-card/skeleton-product-card.component';
import { QuickViewModalComponent } from '../../shared/components/quick-view-modal/quick-view-modal.component';

@Component({
    selector: 'app-catalog',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, NgOptimizedImage, SkeletonProductCardComponent, QuickViewModalComponent],
    templateUrl: './catalog.component.html',
    styleUrl: './catalog.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogComponent implements OnInit {
    trackByProduct(index: number, product: Product): string {
        return product.id || '';
    }

    // Quick View State
    selectedProduct: Product | null = null;

    openQuickView(product: Product) {
        this.selectedProduct = product;
    }

    closeQuickView() {
        this.selectedProduct = null;
    }

    private productService = inject(ProductService);
    private categoryService = inject(CategoryService);
    private metaService = inject(MetaService);
    private cartService = inject(CartService); // Inject CartService
    public languageService = inject(LanguageService); // Inject LanguageService public for template
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    // Observables
    products$ = new BehaviorSubject<Product[]>([]);
    categories$!: Observable<Category[]>;
    filteredProducts$!: Observable<Product[]>;

    // State
    viewMode: 'grid' | 'list' = 'grid';
    currentPage = 1;
    itemsPerPage = 15;
    totalProducts = 0;

    // Pagination State
    lastDoc: any = null;
    paginationStack: any[] = []; // Stack of lastDocs to go back
    isLoadingMore = false;

    public isLoading = true; // Public for template access
    isSidebarOpen = false;

    // Filters
    filters: ProductFilters = {};
    sortBy: ProductSortBy = 'featured';
    searchQuery = '';
    private searchSubject = new BehaviorSubject<string>('');
    private pageSubject = new BehaviorSubject<number>(1);

    // Available filter options
    brands: string[] = [];
    widths: number[] = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    aspectRatios: number[] = [50, 55, 60, 65, 70, 75, 80, 90];
    diameters: number[] = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    priceRange = { min: 0, max: 500 };
    selectedPriceRange = { min: 0, max: 500 };

    ngOnInit() {
        this.loadCategories();
        this.setupSearch(); // Setup search first
        this.loadFiltersFromURL();
        this.loadProducts(); // Then load products
        this.updateSEO();
        // updateSEO is now called within loadProducts
    }

    loadCategories() {
        this.categories$ = this.categoryService.getActiveCategories();
    }

    async loadProducts() {
        this.isLoading = true;

        // HYBRID STRATEGY:
        // If searching text, we must use client-side filtering (Legacy) for accuracy 
        // because Firestore doesn't support full-text search.
        // If navigating (Categories, Brands, etc.), we use Server-Side Pagination for speed.

        if (this.searchQuery) {
            // --- LEGACY SEARCH MODE (Slower but Accurate) ---
            this.productService.getProducts(this.filters, this.sortBy).subscribe({
                next: (products) => {
                    this.products$.next(products);
                    this.filteredProducts$ = this.products$;

                    // Client-side pagination for search results
                    const start = (this.currentPage - 1) * this.itemsPerPage;
                    const end = start + this.itemsPerPage;
                    // Assuming filteredProductsSnapshot is used elsewhere, keep it updated
                    // This line was missing in the provided snippet, adding it for consistency
                    (this as any).filteredProductsSnapshot = products;
                    this.totalProducts = products.length;

                    // We need to slice here because the template expects a full list? 
                    // No, the template iterates `products`. 
                    // The old logic return filtered.slice(start, end).
                    // We must simulate that.
                    this.products$.next(products.slice(start, end));

                    this.isLoading = false;
                    this.updateSEO();
                },
                error: (err) => {
                    console.error('Error in search:', err);
                    this.isLoading = false;
                }
            });
            return;
        }

        // --- OPTIMIZED BROWSING MODE (Fast) ---
        try {
            const result = await this.productService.getProductsPage(
                this.filters,
                this.sortBy,
                this.itemsPerPage,
                this.currentPage > 1 ? this.lastDoc : undefined
            );

            this.products$.next(result.products);
            this.lastDoc = result.lastDoc;

            // In optimized mode, totalProducts is unknown/approximate
            // We set it to help pagination UI if we found a full page
            if (result.products.length === this.itemsPerPage) {
                this.totalProducts = (this.currentPage * this.itemsPerPage) + this.itemsPerPage;
            } else {
                this.totalProducts = (this.currentPage - 1) * this.itemsPerPage + result.products.length;
            }

            this.filteredProducts$ = this.products$;
            // This line was missing in the provided snippet, adding it for consistency
            (this as any).filteredProductsSnapshot = result.products;

            this.isLoading = false;
            this.updateSEO();

        } catch (error) {
            console.error('Error loading products page:', error);
            this.isLoading = false;
        }
    }

    // Flag to prevent infinite seed loops
    private seederTriggered = false;
    private dataSeeder = inject(DataSeederService);

    async seedCatalog() {
        this.isLoading = true;
        try {
            await this.dataSeeder.seedProducts((msg) => console.log(msg));
            // Reload after seed
            window.location.reload();
        } catch (err) {
            console.error('Auto-seed failed', err);
            this.isLoading = false;
        }
    }

    setupSearch() {
        this.searchSubject.subscribe(query => {
            this.searchQuery = query;
            this.pageSubject.next(1); // Reset to page 1 on search
        });
    }

    onSearchChange(query: string) {
        this.searchSubject.next(query);
    }

    onFilterChange() {
        this.currentPage = 1;
        this.lastDoc = undefined;
        this.paginationStack = [];
        this.loadProducts();
        this.updateURL();
    }

    onSortChange(sort: ProductSortBy) {
        this.sortBy = sort;
        this.loadProducts();
        this.updateURL();
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
    }

    toggleSidebar() {
        this.isSidebarOpen = !this.isSidebarOpen;
    }

    clearFilters() {
        this.filters = {};
        this.selectedPriceRange = { ...this.priceRange };
        this.searchQuery = '';
        this.searchSubject.next('');
        this.currentPage = 1;

        // Reset loading state safely
        this.loadProducts();
        this.updateURL();
    }

    onPageChange(page: number) {
        if (page === this.currentPage) return;

        // If going back to page 1, reset
        if (page === 1) {
            this.lastDoc = undefined;
            this.paginationStack = [];
        } else if (page > this.currentPage) {
            // Going forward: We need the lastDoc of the CURRENT page to be the startAfter for NEXT page
            // We pushed it to stack? No, we need to track history for 'Prev'.
            this.paginationStack.push(this.lastDoc); // Save current end for "Back" button????? 
            // Logic for Firestore pagination is linear (Next/Prev). Jumping to page 5 is hard.
            // We will implement simple Next/Prev for now.
        }

        this.currentPage = page;
        this.loadProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    get totalPages(): number {
        // If we don't know total, return current + 1 to show there's a next page
        return this.totalProducts > 0
            ? Math.ceil(this.totalProducts / this.itemsPerPage)
            : (this.lastDoc ? this.currentPage + 1 : this.currentPage);
    }

    get pages(): number[] {
        // Simple pagination: [Prev] [Current] [Next]
        // If we have totalProducts, standard behavior.
        // If not, we just show current.
        if (this.totalProducts > 0) {
            return Array.from({ length: this.totalPages }, (_, i) => i + 1);
        }
        return [this.currentPage];
    }


    private loadFiltersFromURL() {
        this.route.queryParams.subscribe(params => {
            if (params['category']) this.filters.categoryId = params['category'];
            if (params['brand']) this.filters.brands = [params['brand']];
            if (params['search']) {
                this.searchQuery = params['search'];
                this.searchSubject.next(params['search']);
            }
            if (params['sort']) this.sortBy = params['sort'] as ProductSortBy;
            if (params['page']) {
                this.currentPage = +params['page'];
                this.pageSubject.next(this.currentPage);
            }
        });
    }

    private updateURL() {
        const queryParams: any = {};

        if (this.filters.categoryId) queryParams.category = this.filters.categoryId;
        if (this.filters.brands?.length) queryParams.brand = this.filters.brands[0];
        if (this.searchQuery) queryParams.search = this.searchQuery;
        if (this.sortBy !== 'featured') queryParams.sort = this.sortBy;
        if (this.currentPage > 1) queryParams.page = this.currentPage;

        this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            queryParamsHandling: 'merge',
            replaceUrl: true // Don't trigger navigation, just update URL
        });
    }

    // Filter methods
    toggleBrand(brand: string) {
        if (!this.filters.brands) this.filters.brands = [];

        const index = this.filters.brands.indexOf(brand);
        if (index > -1) {
            this.filters.brands.splice(index, 1);
        } else {
            this.filters.brands.push(brand);
        }

        if (this.filters.brands.length === 0) {
            delete this.filters.brands;
        }

        this.onFilterChange();
    }

    isBrandSelected(brand: string): boolean {
        return this.filters.brands?.includes(brand) || false;
    }

    onPriceRangeChange() {
        this.filters.minPrice = this.selectedPriceRange.min;
        this.filters.maxPrice = this.selectedPriceRange.max;
        this.onFilterChange();
    }

    onCategorySelect(categoryId: string) {
        this.filters.categoryId = categoryId;
        this.onFilterChange();
    }

    onTireSizeChange() {
        this.onFilterChange();
    }

    toggleFeature(feature: keyof ProductFilters) {
        const currentValue = this.filters[feature];
        if (typeof currentValue === 'boolean') {
            (this.filters as any)[feature] = !currentValue;
        } else {
            (this.filters as any)[feature] = true;
        }

        if (!(this.filters as any)[feature]) {
            delete (this.filters as any)[feature];
        }
        this.onFilterChange();
    }

    addToCart(product: Product, event: Event) {
        event.preventDefault(); // Prevent navigation to detail
        event.stopPropagation();
        this.cartService.addToCart(product);
        this.cartService.openCart(); // Visual feedback: Open drawer
    }

    /**
     * Update SEO meta tags for catalog
     */
    private updateSEO() {
        const meta = this.metaService.generateCatalogMeta(this.filters);
        this.metaService.updateTags(meta);

        // Structured Data (ItemList)
        this.products$.subscribe(products => {
            if (products && products.length > 0) {
                const schemaProducts = products.slice(0, 20); // Limit Schema payload
                const schema = this.metaService.generateCatalogStructuredData(
                    schemaProducts,
                    this.languageService.currentLang() as 'en' | 'es'
                );
                this.metaService.addStructuredData(schema);
            }
        });
    }
}
