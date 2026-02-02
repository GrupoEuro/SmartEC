import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
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
import { CartAnimationService } from '../../core/services/cart-animation.service';
import { MatSliderModule } from '@angular/material/slider';

@Component({
    selector: 'app-catalog-v2',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, NgOptimizedImage, SkeletonProductCardComponent, QuickViewModalComponent, MatSliderModule],
    templateUrl: './catalog-v2.component.html',
    styleUrl: './catalog-v2.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogV2Component implements OnInit {
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
    private cartService = inject(CartService);
    private cartAnimation = inject(CartAnimationService);
    public languageService = inject(LanguageService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    // Observables
    products$!: Observable<Product[]>;
    categories$!: Observable<Category[]>;
    filteredProducts$!: Observable<Product[]>;

    // State
    viewMode: 'grid' | 'list' = 'grid';
    currentPage = 1;
    itemsPerPage = 15;
    totalProducts = 0;

    public isLoading = true;
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
        this.setupSearch();
        this.loadFiltersFromURL();
        this.loadProducts();
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

                // Populate brands if empty (first load)
                if (this.brands.length === 0 && products.length > 0) {
                    const uniqueBrands = new Set(products.map(p => p.brand).filter(b => !!b));
                    this.brands = Array.from(uniqueBrands).sort();
                }

                this.totalProducts = filtered.length;
                this.filteredProductsSnapshot = filtered; // Update snapshot for facets

                // Pagination
                const start = (page - 1) * this.itemsPerPage;
                const end = start + this.itemsPerPage;

                this.isLoading = false;

                // Update SEO & Schema
                this.updateSEO();

                return filtered.slice(start, end);
            })
        );
    }

    private seederTriggered = false;
    private dataSeeder = inject(DataSeederService);

    async seedCatalog() {
        this.isLoading = true;
        try {
            await this.dataSeeder.seedProducts((msg) => console.log(msg));
            window.location.reload();
        } catch (err) {
            console.error('Auto-seed failed', err);
            this.isLoading = false;
        }
    }

    setupSearch() {
        this.searchSubject.subscribe(query => {
            this.searchQuery = query;
            this.pageSubject.next(1);
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
            replaceUrl: true
        });
    }

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

    // Computed Filters for Chips
    get activeFiltersList(): { type: string, label: string, value: any, key: string }[] {
        const list: { type: string, label: string, value: any, key: string }[] = [];

        if (this.searchQuery) {
            list.push({ type: 'Search', label: `"${this.searchQuery}"`, value: this.searchQuery, key: 'search' });
        }
        if (this.filters.categoryId) {
            // Find category name
            // Note: In a real app we'd need synchronous access to category names or an async pipe. 
            // For now, we use the ID or look it up if categories$ value is available locally.
            list.push({ type: 'Category', label: this.getCategoryName(this.filters.categoryId), value: this.filters.categoryId, key: 'category' });
        }
        if (this.filters.brands) {
            this.filters.brands.forEach(b => {
                list.push({ type: 'Brand', label: b, value: b, key: 'brand' });
            });
        }
        if (this.filters.minPrice !== undefined && this.filters.minPrice > 0) {
            list.push({ type: 'Min Price', label: `$${this.filters.minPrice}`, value: this.filters.minPrice, key: 'minPrice' });
        }
        if (this.filters.maxPrice !== undefined && this.filters.maxPrice < 50000) { // Assuming 50000 is realistic max
            list.push({ type: 'Max Price', label: `$${this.filters.maxPrice}`, value: this.filters.maxPrice, key: 'maxPrice' });
        }
        // specs
        if (this.filters.width) list.push({ type: 'Width', label: `${this.filters.width}`, value: this.filters.width, key: 'width' });
        if (this.filters.aspectRatio) list.push({ type: 'AspectRatio', label: `${this.filters.aspectRatio}`, value: this.filters.aspectRatio, key: 'aspectRatio' });
        if (this.filters.diameter) list.push({ type: 'Diameter', label: `R${this.filters.diameter}`, value: this.filters.diameter, key: 'diameter' });

        return list;
    }

    removeFilter(item: { key: string, value: any }) {
        if (item.key === 'search') {
            this.searchQuery = '';
            this.onSearchChange('');
        } else if (item.key === 'category') {
            this.filters.categoryId = undefined;
        } else if (item.key === 'brand') {
            this.toggleBrand(item.value);
            return; // toggle triggers reload
        } else if (item.key === 'minPrice') {
            this.selectedPriceRange.min = 0;
            this.onPriceRangeChange();
            return;
        } else if (item.key === 'maxPrice') {
            this.selectedPriceRange.max = 0; // Or reset to safe max
            delete this.filters.maxPrice;
        } else if (['width', 'aspectRatio', 'diameter'].includes(item.key)) {
            (this.filters as any)[item.key] = undefined;
        }

        this.onFilterChange();
    }

    // Facet Counts
    // We calculate these based on the *current full set* of products (before pagination)
    // but typically you want counts based on the *current search* but ignoring the specific filter being counted.
    // For simplicity V1: Count within the current filtered set.
    // For "Smart" V2: We need the full list.

    private allProducts: Product[] = []; // Store full dataset for counts

    getBrandCount(brand: string): number {
        // Count how many products match this brand
        // ( Ideally, this should be: "How many products would show if I clicked this?")
        // So we filter allProducts by CURRENT filters EXCEPT brand.
        // For simplicity: We use the already loaded `allProducts` (which is filtered by search/category in loadProducts?)
        // Let's ensure loadProducts stores the result.
        return this.filteredProductsSnapshot.filter(p => p.brand === brand).length;
    }

    // Store snapshot for counters
    private filteredProductsSnapshot: Product[] = [];

    private getCategoryName(id: string): string {
        // Helper lookup implementation would go here, returning ID for now
        return id;
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

    selectFilter(type: 'width' | 'aspectRatio' | 'diameter', value: number) {
        // Toggle logic: if already selected, deselect
        if ((this.filters as any)[type] === value) {
            (this.filters as any)[type] = undefined;
        } else {
            (this.filters as any)[type] = value;
        }
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
        event.preventDefault();
        event.stopPropagation();

        const btn = event.target as HTMLElement;
        const card = btn.closest('.product-card');
        const img = card?.querySelector('.product-image img') as HTMLElement;

        if (img) {
            this.cartAnimation.animateToCart(img, 'cart-icon-target', () => {
                this.cartService.addToCart(product);
                this.cartService.openCart();
            });
        } else {
            // Fallback if image not found
            this.cartService.addToCart(product);
            this.cartService.openCart();
        }
    }

    private updateSEO() {
        const meta = this.metaService.generateCatalogMeta(this.filters);
        this.metaService.updateTags(meta);

        // Structured Data (ItemList)
        if (this.filteredProductsSnapshot && this.filteredProductsSnapshot.length > 0) {
            // Limit to first 20 items to keep payload reasonable
            const schemaProducts = this.filteredProductsSnapshot.slice(0, 20);
            const schema = this.metaService.generateCatalogStructuredData(
                schemaProducts,
                this.languageService.currentLang() as 'en' | 'es'
            );
            this.metaService.addStructuredData(schema);
        }
    }
    formatLabel(value: number): string {
        if (value >= 1000) {
            return '$' + Math.round(value / 1000) + 'k';
        }
        return '$' + value;
    }
}
