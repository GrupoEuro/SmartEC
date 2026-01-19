import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Action } from 'rxjs/internal/scheduler/Action';
import { ProductService } from '../../core/services/product.service';
import { MetaService } from '../../core/services/meta.service';
import { CartService } from '../../core/services/cart.service';
import { Product } from '../../core/models/product.model';
import { ImageGalleryComponent } from './components/image-gallery/image-gallery.component';
import { RelatedProductsComponent } from './components/related-products/related-products.component';
import { ProductBundlesComponent } from './components/product-bundles/product-bundles.component';

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
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private productService = inject(ProductService);
    private metaService = inject(MetaService);
    private cartService = inject(CartService); // Inject CartService

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

    addToWishlist(product: Product) {
        // TODO: Implement wishlist functionality
        console.log('Add to wishlist:', product);
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
        // Update meta tags
        const meta = this.metaService.generateProductMeta(product, 'es');
        this.metaService.updateTags(meta);

        // Add structured data
        const structuredData = this.metaService.generateProductStructuredData(product, 'es');
        this.metaService.addStructuredData(structuredData);
    }
}
