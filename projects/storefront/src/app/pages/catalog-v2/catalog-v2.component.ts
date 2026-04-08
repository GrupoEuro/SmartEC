import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, combineLatest, BehaviorSubject, Subject } from 'rxjs';
import { map, debounceTime, distinctUntilChanged, takeUntil, shareReplay } from 'rxjs/operators';
import {
    ProductService, CategoryService, LanguageService, DataSeederService,
    Product, ProductFilters, Category, ProductSortBy, KitService, ProductKit
} from '@lib/core';
import { CartService } from '../../core/services/cart.service';
import { MetaService } from '../../core/services/meta.service';
import { SkeletonProductCardComponent } from '../../shared/components/skeleton-product-card/skeleton-product-card.component';
import { QuickViewModalComponent } from '../../shared/components/quick-view-modal/quick-view-modal.component';
import { CartAnimationService } from '../../core/services/cart-animation.service';
import { WishlistService } from '../../core/services/wishlist.service';
import { MatSliderModule } from '@angular/material/slider';

@Component({
    selector: 'app-catalog-v2',
    standalone: true,
    imports: [
        CommonModule, RouterModule, FormsModule, TranslateModule,
        NgOptimizedImage, SkeletonProductCardComponent, QuickViewModalComponent, MatSliderModule
    ],
    templateUrl: './catalog-v2.component.html',
    styleUrl: './catalog-v2.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogV2Component implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();

    // ── Services ──────────────────────────────────────────────────────────────
    private productService  = inject(ProductService);
    private categoryService = inject(CategoryService);
    private metaService     = inject(MetaService);
    private cartService     = inject(CartService);
    private cartAnimation   = inject(CartAnimationService);
    private kitService      = inject(KitService);
    private dataSeeder      = inject(DataSeederService);
    private cdr             = inject(ChangeDetectorRef);
    public  wishlistService = inject(WishlistService);
    public  languageService = inject(LanguageService);
    private route           = inject(ActivatedRoute);
    private router          = inject(Router);

    // ── Observables ───────────────────────────────────────────────────────────
    categories$!: Observable<Category[]>;
    filteredProducts$!: Observable<Product[]>;
    activeKits$!: Observable<ProductKit[]>;
    showCombos = false;

    // ── Quick View ────────────────────────────────────────────────────────────
    selectedProduct: Product | null = null;
    openQuickView(product: Product) { this.selectedProduct = product; }
    closeQuickView()                { this.selectedProduct = null;    }

    // ── UI State ──────────────────────────────────────────────────────────────
    viewMode: 'grid' | 'list' = 'grid';
    currentPage = 1;
    itemsPerPage = 15;
    totalProducts = 0;
    isLoading = true;
    isSidebarOpen = false;

    // ── Reactive filter state (single source of truth) ────────────────────────
    private filtersSubject = new BehaviorSubject<ProductFilters>({});
    private sortSubject    = new BehaviorSubject<ProductSortBy>('featured');
    private searchSubject  = new BehaviorSubject<string>('');
    private pageSubject    = new BehaviorSubject<number>(1);

    // ── Local references (kept in sync with subjects for template binding) ────
    filters: ProductFilters = {};
    sortBy: ProductSortBy = 'featured';
    searchQuery = '';
    selectedPriceRange = { min: 0, max: 5000 };

    // ── Available filter options ───────────────────────────────────────────────
    readonly PRICE_MAX = 5000;

    brands:       string[] = [];
    widths:       number[] = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    aspectRatios: number[] = [50, 55, 60, 65, 70, 75, 80, 90];
    diameters:    number[] = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

    // ── Snapshots for facet counts ─────────────────────────────────────────────
    // filteredProductsSnapshot: full post-filter set (for SEO / structured data)
    // brandFacetSnapshot: after all filters EXCEPT brand, so brand counts are accurate
    private filteredProductsSnapshot: Product[] = [];
    private brandFacetSnapshot:       Product[] = [];

    // ==========================================================================
    // Lifecycle
    // ==========================================================================

    ngOnInit() {
        this.categories$ = this.categoryService.getActiveCategories();
        this.loadKits();

        // 1. Read URL params FIRST, update state synchronously
        const params = this.route.snapshot.queryParams;
        if (params['category']) this.filters.categoryId = params['category'];
        if (params['brand'])    this.filters.brands     = params['brand'].split(',').filter(Boolean);
        if (params['sort'])     this.sortBy             = params['sort'] as ProductSortBy;
        if (params['search'])   this.searchQuery        = params['search'];
        if (params['inStock'])  this.filters.inStock    = true;
        if (params['page'])     this.currentPage        = +params['page'];

        // Sync initial state into subjects
        this.filtersSubject.next({ ...this.filters });
        this.sortSubject.next(this.sortBy);
        this.searchSubject.next(this.searchQuery);
        this.pageSubject.next(this.currentPage);

        // 2. Build the single reactive pipeline
        this.buildPipeline();

        // 3. React to URL changes from browser back/forward navigation
        this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(p => {
            const newCategory = p['category'] || undefined;
            const newBrands   = p['brand'] ? p['brand'].split(',').filter(Boolean) : undefined;
            const newSort     = (p['sort'] as ProductSortBy) || 'featured';
            const newSearch   = p['search'] || '';
            const newInStock  = p['inStock'] ? true : undefined;
            const newPage     = p['page'] ? +p['page'] : 1;

            const changed =
                newCategory !== this.filters.categoryId ||
                JSON.stringify(newBrands) !== JSON.stringify(this.filters.brands) ||
                newSort     !== this.sortBy ||
                newSearch   !== this.searchQuery ||
                !!newInStock !== !!this.filters.inStock ||
                newPage     !== this.currentPage;

            if (changed) {
                this.filters     = { ...this.filters, categoryId: newCategory, brands: newBrands, inStock: newInStock };
                this.sortBy      = newSort;
                this.searchQuery = newSearch;
                this.currentPage = newPage;
                this.filtersSubject.next({ ...this.filters });
                this.sortSubject.next(this.sortBy);
                this.searchSubject.next(this.searchQuery);
                this.pageSubject.next(this.currentPage);
            }
        });

        this.updateSEO();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ==========================================================================
    // Reactive Pipeline
    // Fetches ALL published+public products ONCE from Firestore.
    // All subsequent filtering is done in-memory via combineLatest —
    // zero extra reads on every filter interaction.
    // ==========================================================================

    private buildPipeline() {
        // One-time fetch; visibility guard keeps draft/private off the storefront.
        const allProducts$ = this.productService.getProducts().pipe(
            map(products => products.filter(p =>
                (!p.publishStatus || p.publishStatus === 'published') &&
                (!p.visibility    || p.visibility   === 'public')
            )),
            shareReplay(1) // multicast so combineLatest doesn't double-subscribe
        );

        this.filteredProducts$ = combineLatest([
            allProducts$,
            this.filtersSubject,
            this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()),
            this.sortSubject.pipe(distinctUntilChanged()),
            this.pageSubject
        ]).pipe(
            map(([products, f, search, sort, page]) => {

                // ── 1. Rebuild brands list from the full visible set each time.
                //       Category change should update the brand list, so never
                //       cache this — always derive from the current data.
                const allForBrands = f.categoryId
                    ? products.filter(p => p.categoryId === f.categoryId)
                    : products;
                const uniqueBrands = new Set(allForBrands.map(p => p.brand).filter(Boolean));
                this.brands = Array.from(uniqueBrands).sort();

                // ── 2. Text search (client-side, debounced) ─────────────────
                let filtered = search
                    ? products.filter(p =>
                          (p.name.en || '').toLowerCase().includes(search.toLowerCase()) ||
                          (p.name.es || '').toLowerCase().includes(search.toLowerCase()) ||
                          (p.brand    || '').toLowerCase().includes(search.toLowerCase()) ||
                          (p.tags  || []).some(t => t.toLowerCase().includes(search.toLowerCase()))
                      )
                    : [...products];

                // ── 3. Category ─────────────────────────────────────────────
                if (f.categoryId) {
                    filtered = filtered.filter(p => p.categoryId === f.categoryId);
                }

                // ── 4. Price range ──────────────────────────────────────────
                if (f.minPrice !== undefined && f.minPrice > 0) {
                    filtered = filtered.filter(p => p.price >= f.minPrice!);
                }
                if (f.maxPrice !== undefined && f.maxPrice < this.PRICE_MAX) {
                    filtered = filtered.filter(p => p.price <= f.maxPrice!);
                }

                // ── 5. Tire spec filters (nested in specifications map) ──────
                if (f.width) {
                    filtered = filtered.filter(p => Number(p.specifications?.['width']) === f.width);
                }
                if (f.aspectRatio) {
                    filtered = filtered.filter(p => Number(p.specifications?.['aspectRatio']) === f.aspectRatio);
                }
                if (f.diameter) {
                    filtered = filtered.filter(p => Number(p.specifications?.['diameter']) === f.diameter);
                }

                // ── 6. In-stock filter ──────────────────────────────────────
                if (f.inStock) {
                    filtered = filtered.filter(p => p.inStock === true);
                }

                // ── Snapshot for brand facet counts — taken BEFORE brand
                //    filter is applied so that inactive brands show their real
                //    count under the current context, not 0.
                this.brandFacetSnapshot = filtered;

                // ── 7. Brand filter ─────────────────────────────────────────
                if (f.brands?.length) {
                    filtered = filtered.filter(p => f.brands!.includes(p.brand));
                }

                // ── 8. Client-side sort ─────────────────────────────────────
                filtered = this.sortProducts(filtered, sort);

                // ── 9. Snapshots, SEO, loading flag ────────────────────────
                this.totalProducts            = filtered.length;
                this.filteredProductsSnapshot = filtered;
                this.isLoading                = false;
                this.updateSEO();
                this.cdr.markForCheck(); // safe for OnPush side-effects

                // ── 10. Paginate ────────────────────────────────────────────
                const start = (page - 1) * this.itemsPerPage;
                return filtered.slice(start, start + this.itemsPerPage);
            }),
            takeUntil(this.destroy$)
        );
    }

    private sortProducts(products: Product[], sort: ProductSortBy): Product[] {
        const arr = [...products];
        switch (sort) {
            case 'price-asc':  arr.sort((a, b) => a.price - b.price); break;
            case 'price-desc': arr.sort((a, b) => b.price - a.price); break;
            case 'name-asc':
                arr.sort((a, b) => (a.name.es || a.name.en).localeCompare(b.name.es || b.name.en)); break;
            case 'name-desc':
                arr.sort((a, b) => (b.name.es || b.name.en).localeCompare(a.name.es || a.name.en)); break;
            case 'newest':
                arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); break;
            default: // 'featured' — featured first, then newest
                arr.sort((a, b) => {
                    const diff = (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
                    return diff !== 0 ? diff : b.createdAt.getTime() - a.createdAt.getTime();
                });
        }
        return arr;
    }

    // ==========================================================================
    // Filter Actions
    // ==========================================================================

    private applyFilters() {
        this.currentPage = 1;
        this.pageSubject.next(1);
        this.filtersSubject.next({ ...this.filters });
        this.updateURL();
    }

    onFilterChange()   { this.applyFilters(); }
    onTireSizeChange() { this.applyFilters(); }

    onPriceRangeChange() {
        this.filters.minPrice = this.selectedPriceRange.min > 0            ? this.selectedPriceRange.min : undefined;
        this.filters.maxPrice = this.selectedPriceRange.max < this.PRICE_MAX ? this.selectedPriceRange.max : undefined;
        this.applyFilters();
    }

    onSortChange(sort: ProductSortBy) {
        this.sortBy = sort;
        this.sortSubject.next(sort);
        this.updateURL();
    }

    onSearchChange(query: string) {
        this.searchQuery = query;
        this.searchSubject.next(query);
        this.currentPage = 1;
        this.pageSubject.next(1);
        this.updateURL();
    }

    onCategorySelect(categoryId: string) {
        this.filters.categoryId = categoryId || undefined;
        this.applyFilters();
    }

    toggleBrand(brand: string) {
        const current = this.filters.brands ?? [];
        const exists  = current.includes(brand);
        // Immutable update — never mutate the existing array (safe for OnPush)
        const next    = exists ? current.filter(b => b !== brand) : [...current, brand];
        this.filters.brands = next.length > 0 ? next : undefined;
        this.applyFilters();
    }

    selectFilter(type: 'width' | 'aspectRatio' | 'diameter', value: number) {
        // Toggle: clicking the active chip deselects it
        (this.filters as any)[type] = (this.filters as any)[type] === value ? undefined : value;
        this.applyFilters();
    }

    toggleInStock() {
        this.filters.inStock = this.filters.inStock ? undefined : true;
        this.applyFilters();
    }

    toggleFeature(feature: keyof ProductFilters) {
        const current = this.filters[feature];
        if (typeof current === 'boolean' && current) {
            delete (this.filters as any)[feature];
        } else {
            (this.filters as any)[feature] = true;
        }
        this.applyFilters();
    }

    clearFilters() {
        this.filters            = {};
        this.sortBy             = 'featured';
        this.searchQuery        = '';
        this.currentPage        = 1;
        this.selectedPriceRange = { min: 0, max: this.PRICE_MAX };

        this.filtersSubject.next({});
        this.sortSubject.next('featured');
        this.searchSubject.next('');
        this.pageSubject.next(1);

        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            queryParamsHandling: '',
            replaceUrl: true
        });
    }

    // ==========================================================================
    // Remove Active Filter Chip
    // ==========================================================================

    removeFilter(item: { key: string; value: any }) {
        switch (item.key) {
            case 'search':
                this.onSearchChange('');
                return;
            case 'category':
                this.filters.categoryId = undefined;
                break;
            case 'brand':
                this.toggleBrand(item.value);
                return; // toggleBrand calls applyFilters
            case 'minPrice':
                this.selectedPriceRange.min = 0;
                this.filters.minPrice = undefined;
                break;
            case 'maxPrice':
                this.selectedPriceRange.max = this.PRICE_MAX;
                this.filters.maxPrice = undefined;
                break;
            case 'width':
            case 'aspectRatio':
            case 'diameter':
                (this.filters as any)[item.key] = undefined;
                break;
            case 'inStock':
                this.filters.inStock = undefined;
                break;
        }
        this.applyFilters();
    }

    // ==========================================================================
    // Active Filters List (for chips bar)
    // ==========================================================================

    get activeFiltersList(): { type: string; label: string; value: any; key: string }[] {
        const list: { type: string; label: string; value: any; key: string }[] = [];

        if (this.searchQuery) {
            list.push({ type: 'Búsqueda', label: `"${this.searchQuery}"`, value: this.searchQuery, key: 'search' });
        }
        if (this.filters.categoryId) {
            list.push({ type: 'Categoría', label: this.filters.categoryId, value: this.filters.categoryId, key: 'category' });
        }
        if (this.filters.brands?.length) {
            this.filters.brands.forEach(b =>
                list.push({ type: 'Marca', label: b, value: b, key: 'brand' })
            );
        }
        if (this.filters.minPrice && this.filters.minPrice > 0) {
            list.push({ type: 'Precio mín.', label: `$${this.filters.minPrice}`, value: this.filters.minPrice, key: 'minPrice' });
        }
        if (this.filters.maxPrice && this.filters.maxPrice < this.PRICE_MAX) {
            list.push({ type: 'Precio máx.', label: `$${this.filters.maxPrice}`, value: this.filters.maxPrice, key: 'maxPrice' });
        }
        if (this.filters.width) {
            list.push({ type: 'Ancho', label: `${this.filters.width}mm`, value: this.filters.width, key: 'width' });
        }
        if (this.filters.aspectRatio) {
            list.push({ type: 'Relación', label: `/${this.filters.aspectRatio}`, value: this.filters.aspectRatio, key: 'aspectRatio' });
        }
        if (this.filters.diameter) {
            list.push({ type: 'Aro', label: `R${this.filters.diameter}`, value: this.filters.diameter, key: 'diameter' });
        }
        if (this.filters.inStock) {
            list.push({ type: 'Disponibilidad', label: 'En stock', value: true, key: 'inStock' });
        }

        return list;
    }

    // ==========================================================================
    // Facet Counts
    // ==========================================================================

    /**
     * Returns number of products in the brand-facet snapshot (all filters applied
     * except the brand filter itself) that match the given brand.
     * This means unselected brands show their real potential count, not 0.
     */
    getBrandCount(brand: string): number {
        return this.brandFacetSnapshot.filter(p => p.brand === brand).length;
    }

    isBrandSelected(brand: string): boolean {
        return this.filters.brands?.includes(brand) ?? false;
    }

    /** Number of in-stock products given current non-stock filters (for toggle badge). */
    get inStockCount(): number {
        return this.brandFacetSnapshot.filter(p => p.inStock).length;
    }

    /** Total active filter chips — used for mobile badge. */
    get activeFiltersCount(): number {
        return this.activeFiltersList.length;
    }

    // ==========================================================================
    // Pagination
    // ==========================================================================

    onPageChange(page: number) {
        this.currentPage = page;
        this.pageSubject.next(page);
        this.updateURL();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    get totalPages(): number { return Math.ceil(this.totalProducts / this.itemsPerPage); }

    // ==========================================================================
    // URL Sync
    // Multi-brand is serialized as a comma-separated value: brand=Michelin,Pirelli
    // ==========================================================================

    private updateURL() {
        const queryParams: Record<string, any> = {};
        if (this.filters.categoryId)     queryParams['category'] = this.filters.categoryId;
        if (this.filters.brands?.length) queryParams['brand']    = this.filters.brands.join(',');
        if (this.searchQuery)            queryParams['search']   = this.searchQuery;
        if (this.sortBy !== 'featured')  queryParams['sort']     = this.sortBy;
        if (this.filters.inStock)        queryParams['inStock']  = 'true';
        if (this.currentPage > 1)        queryParams['page']     = this.currentPage;

        this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            queryParamsHandling: '',
            replaceUrl: true
        });
    }

    // ==========================================================================
    // Kits / Combos
    // ==========================================================================

    loadKits() {
        this.activeKits$ = this.kitService.getActiveKits();
        this.activeKits$.pipe(takeUntil(this.destroy$)).subscribe(kits => {
            this.showCombos = kits.length > 0;
        });
    }

    getKitSavings(kit: ProductKit): number {
        const total = kit.components.reduce((s, c) => s + (c.unitPrice * c.quantity), 0);
        if (total === 0) return 0;
        return Math.round(((total - kit.price) / total) * 100);
    }

    // ==========================================================================
    // Cart / Wishlist
    // ==========================================================================

    addToCart(product: Product, event: Event) {
        event.preventDefault();
        event.stopPropagation();
        const btn  = event.target as HTMLElement;
        const card = btn.closest('.product-card');
        const img  = card?.querySelector('.product-image img') as HTMLElement;
        if (img) {
            this.cartAnimation.animateToCart(img, 'cart-icon-target', () => {
                this.cartService.addToCart(product);
                this.cartService.openCart();
            });
        } else {
            this.cartService.addToCart(product);
            this.cartService.openCart();
        }
    }

    async toggleWishlist(product: Product, event: Event) {
        event.preventDefault();
        event.stopPropagation();
        await this.wishlistService.toggle(product);
    }

    // ==========================================================================
    // Misc
    // ==========================================================================

    toggleViewMode() { this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid'; }
    toggleSidebar()  { this.isSidebarOpen = !this.isSidebarOpen; }

    trackByProduct(_: number, product: Product): string { return product.id ?? ''; }

    formatLabel(value: number): string {
        return value >= 1000 ? '$' + Math.round(value / 1000) + 'k' : '$' + value;
    }

    async seedCatalog() {
        this.isLoading = true;
        try {
            await this.dataSeeder.seedProducts((msg: string) => console.log(msg));
            window.location.reload();
        } catch (err) {
            console.error('Auto-seed failed', err);
            this.isLoading = false;
        }
    }

    private updateSEO() {
        const meta = this.metaService.generateCatalogMeta(this.filters);
        this.metaService.updateTags(meta);
        if (this.filteredProductsSnapshot?.length > 0) {
            const schema = this.metaService.generateCatalogStructuredData(
                this.filteredProductsSnapshot.slice(0, 20),
                this.languageService.currentLang() as 'en' | 'es'
            );
            this.metaService.addStructuredData(schema);
        }
    }
}
