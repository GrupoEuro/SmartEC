import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import {
    Firestore, collection, query, where, orderBy,
    getDocs, addDoc, serverTimestamp
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { ProductService, LanguageService } from '@lib/core';
import { CartService } from '../../core/services/cart.service';
import { MetaService } from '../../core/services/meta.service';
import { TrackingService } from '../../core/services/tracking.service';
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
    private route             = inject(ActivatedRoute);
    private router            = inject(Router);
    private productService    = inject(ProductService);
    private metaService       = inject(MetaService);
    private cartService       = inject(CartService);
    private trackingService   = inject(TrackingService);
    private firestore         = inject(Firestore);
    private auth              = inject(Auth);
    readonly wishlistService   = inject(WishlistService);
    protected readonly lang   = inject(LanguageService).currentLang;
    protected get activeLang(): 'es' | 'en' {
        return (this.lang() === 'en') ? 'en' : 'es';
    }

    product$!: Observable<Product | null>;
    relatedProducts$!: Observable<Product[]>;
    isLoading = true;
    activeTab = 'overview';
    quantity  = 1;

    // ── Review System ──────────────────────────────────────────────────────────
    reviews         = signal<any[]>([]);
    reviewsLoading  = signal(false);
    avgRating       = computed(() => {
        const r = this.reviews();
        if (!r.length) return 0;
        return r.reduce((s, rv) => s + rv.rating, 0) / r.length;
    });
    reviewDraft = { rating: 5, comment: '' };
    reviewSubmitting  = false;
    reviewSuccess     = false;
    reviewError       = '';
    currentProductId  = '';
    private reviewsLoaded = false;


    ngOnInit() {
        this.loadProduct();
        // Auto-open reviews tab when arrived via ?review=1 deep-link
        this.route.queryParamMap.subscribe(params => {
            if (params.get('review') === '1') {
                this.setActiveTab('reviews');
            }
        });
    }

    loadProduct() {
        this.product$ = this.route.paramMap.pipe(
            switchMap(params => {
                const slug = params.get('slug');
                if (!slug) {
                    this.router.navigate(['/catalogo']);
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

    private updateSEO(product: Product) {
        const currentLang = this.lang() as 'es' | 'en';
        this.currentProductId = product.id || '';
        const meta = this.metaService.generateProductMeta(product, currentLang);
        this.metaService.updateTags(meta);
        const structuredData = this.metaService.generateProductStructuredData(product, currentLang);
        // Inject real aggregateRating if reviews exist
        const rate = this.avgRating();
        if (rate > 0 && this.reviews().length > 0) {
            structuredData.aggregateRating = {
                '@type': 'AggregateRating',
                ratingValue: rate.toFixed(1),
                reviewCount: this.reviews().length,
            };
        }
        this.metaService.addStructuredData(structuredData);
        // BreadcrumbList for this PDP
        this.metaService.addStructuredData(
            this.metaService.generateBreadcrumbSchema([
                { name: 'Inicio',   url: 'https://importadoraeuro.com/' },
                { name: 'Catálogo', url: 'https://importadoraeuro.com/catalogo' },
                { name: product.brand  || '', url: `https://importadoraeuro.com/catalogo?brand=${product.brand}` },
                { name: (product.name as any)?.[currentLang] || (product.name as any)?.es || '' },
            ]),
            'schema-breadcrumb'
        );
        this.trackingService.trackViewItem('MXN', product.price, [
            {
                item_id:    product.sku || product.id || '',
                item_name:  product.name?.[currentLang] || product.name?.es || '',
                item_brand: product.brand,
                price:      product.price,
                quantity:   1,
            }
        ]);
    }

    // ── Review System ──────────────────────────────────────────────────────────

    setActiveTab(tab: string) {
        this.activeTab = tab;
        if (tab === 'reviews' && !this.reviewsLoaded) {
            this.loadReviews();
        }
    }

    private async loadReviews() {
        if (!this.currentProductId || this.reviewsLoaded) return;
        this.reviewsLoading.set(true);
        try {
            const snap = await getDocs(query(
                collection(this.firestore, `product_reviews/${this.currentProductId}/reviews`),
                where('status', '==', 'approved'),
                orderBy('createdAt', 'desc'),
            ));
            this.reviews.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            this.reviewsLoaded = true;
        } catch (e) {
            console.error('[Reviews] Load error:', e);
        } finally {
            this.reviewsLoading.set(false);
        }
    }

    async submitReview() {
        const user = this.auth.currentUser;
        if (!user || !this.currentProductId) {
            this.reviewError = 'Debes iniciar sesión para dejar una reseña.';
            return;
        }
        if (!this.reviewDraft.comment.trim()) {
            this.reviewError = 'Escribe un comentario antes de enviar.';
            return;
        }
        this.reviewSubmitting = true;
        this.reviewError = '';
        try {
            await addDoc(
                collection(this.firestore, `product_reviews/${this.currentProductId}/reviews`),
                {
                    userId:    user.uid,
                    userName:  user.displayName || user.email || 'Usuario',
                    rating:    this.reviewDraft.rating,
                    comment:   this.reviewDraft.comment.trim(),
                    status:    'pending', // Staff must approve
                    createdAt: serverTimestamp(),
                }
            );
            this.reviewSuccess = true;
            this.reviewDraft = { rating: 5, comment: '' };
        } catch (e: any) {
            this.reviewError = 'Error al enviar la reseña. Inténtalo de nuevo.';
        } finally {
            this.reviewSubmitting = false;
        }
    }

    starArray(n: number): number[] {
        return Array.from({ length: 5 }, (_, i) => i + 1);
    }

}
