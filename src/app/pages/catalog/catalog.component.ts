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
        return product.id;
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
    products$!: Observable<Product[]>;
    categories$!: Observable<Category[]>;
    filteredProducts$!: Observable<Product[]>;

    // State
    viewMode: 'grid' | 'list' = 'grid';
    currentPage = 1;
    itemsPerPage = 12;
    totalProducts = 0;

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
    }

    loadCategories() {
        this.categories$ = this.categoryService.getActiveCategories();
    }

    loadProducts() {
        this.isLoading = true;
        this.products$ = this.productService.getProducts(this.filters, this.sortBy);

        this.filteredProducts$ = combineLatest([
            this.products$,
            this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()),
            this.pageSubject
        ]).pipe(
            map(([products, search, page]) => {
                let filtered = search
                    ? products.filter(p =>
                        p.name.en.toLowerCase().includes(search.toLowerCase()) ||
                        p.name.es.toLowerCase().includes(search.toLowerCase()) ||
                        p.brand.toLowerCase().includes(search.toLowerCase()) ||
                        p.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
                    )
                    : products;

                this.totalProducts = filtered.length;

                // Pagination
                const start = (page - 1) * this.itemsPerPage;
                const end = start + this.itemsPerPage;

                this.isLoading = false;

                return filtered.slice(start, end);
            })
        );
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
        this.currentPage = page;
        this.pageSubject.next(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    get totalPages(): number {
        return Math.ceil(this.totalProducts / this.itemsPerPage);
    }

    get pages(): number[] {
        return Array.from({ length: this.totalPages }, (_, i) => i + 1);
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
    }
}
