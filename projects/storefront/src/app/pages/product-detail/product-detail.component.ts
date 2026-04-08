import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';

declare let gtag: Function;
function fireGtag(event: string, params: object) {
    try { if (typeof gtag !== 'undefined') gtag('event', event, params); } catch { /* non-critical */ }
}

import { ProductService, LanguageService } from '@lib/core';
import { CartService } from '../../core/services/cart.service';
import { MetaService } from '../../core/services/meta.service';
import { Product } from '@lib/core';
import { ImageGalleryComponent } from './components/image-gallery/image-gallery.component';
import { RelatedProductsComponent } from './components/related-products/related-products.component';
import { ProductBundlesComponent } from './components/product-bundles/product-bundles.component';
import { WishlistService } from '../../core/services/wishlist.service';

@Component({
    selector: 'app-product-detail',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        TranslateModule,
        ImageGalleryComponent,
        RelatedProductsComponent,
        ProductBundlesComponent
    ],
    templateUrl: './product-detail.component.html',
    styleUrl: './product-detail.component.css'
})
export class ProductDetailComponent implements OnInit {
    private route          = inject(ActivatedRoute);
    private router         = inject(Router);
    private productService = inject(ProductService);
    private metaService    = inject(MetaService);
    private cartService    = inject(CartService);
    readonly wishlistService = inject(WishlistService);
    /** Active language signal — use as lang() in template */
    protected readonly lang  = inject(LanguageService).currentLang;
    /** Typed getter for strict-mode template indexing — 'es' | 'en' */
    protected get activeLang(): 'es' | 'en' {
        return (this.lang() === 'en') ? 'en' : 'es';
    }

    product$!: Observable<Product | null>;
    relatedProducts$!: Observable<Product[]>;
    isLoading = true;
    activeTab = 'overview';
    quantity = 1;

    ngOnInit() {
        this.loadProduct();
    }

    loadProduct() {
        this.product$ = this.route.paramMap.pipe(
            switchMap(params => {
                const slug = params.get('slug');
                if (!slug) {
                    this.router.navigate(['/catalog']);
                    return of(null);
                }
                return this.productService.getProductBySlug(slug).pipe(
                    map(product => {
                        this.isLoading = false;
                        if (product) {
                            // Cast to bypass model mismatch between Catalog and Core
                            const coreProduct = product as unknown as Product;
                            this.loadRelatedProducts(coreProduct);
                            this.updateSEO(coreProduct);
                            return coreProduct;
                        }
                        return null; // Map undefined to null
                    }),
                    catchError(error => {
                        console.error('Error loading product:', error);
                        this.isLoading = false;
                        return of(null);
                    })
                );
            })
        );
    }

    loadRelatedProducts(product: Product) {
        // Load products from same category or brand
        this.relatedProducts$ = this.productService.getProducts({
            categoryId: product.categoryId
        }, 'featured').pipe(
            map(products => products
                .filter(p => p.id !== product.id)
                .slice(0, 4)
            ),
            catchError(() => of([]))
        );
    }

    setActiveTab(tab: string) {
        this.activeTab = tab;
    }

    incrementQuantity() {
        this.quantity++;
    }

    decrementQuantity() {
        if (this.quantity > 1) {
            this.quantity--;
        }
    }

    addToCart(product: Product) {
        // Add to cart with specific quantity and open drawer
        this.cartService.addToCart(product, this.quantity);
        this.cartService.openCart();
    }

    async addToWishlist(product: Product) {
        await this.wishlistService.toggle(product);
    }

    shareProduct() {
        if (navigator.share) {
            navigator.share({
                title: document.title,
                url: window.location.href
            });
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(window.location.href);
            // Replace alert with toast if available, or just keeping silence as it's a minor act
        }
    }

    getProductImages(product: Product): string[] {
        return [product.images.main, ...product.images.gallery];
    }

    getRelatedProducts(): Product[] {
        return this.relatedProducts$ ? [] : [];
    }

    /**
     * Update SEO meta tags and structured data for product
     */
    private updateSEO(product: Product) {
        const currentLang = this.lang() as 'es' | 'en';
        const meta = this.metaService.generateProductMeta(product, currentLang);
        this.metaService.updateTags(meta);
        const structuredData = this.metaService.generateProductStructuredData(product, currentLang);
        this.metaService.addStructuredData(structuredData);

        // GA4: view_item
        fireGtag('view_item', {
            currency: 'MXN',
            value: product.price,
            items: [{
                item_id:    product.sku || product.id,
                item_name:  product.name?.[currentLang] || product.name?.es,
                item_brand: product.brand,
                price:      product.price,
                quantity:   1,
            }]
        });
    }
}
