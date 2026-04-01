import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WishlistService, WishlistItem } from '../../../core/services/wishlist.service';
import { CartService } from '../../../core/services/cart.service';

@Component({
    selector: 'app-wishlist',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    template: `
<div class="wishlist-page">
    <div class="wishlist-header">
        <h2 class="wishlist-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" class="heart-icon-heading">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {{ 'ACCOUNT.WISHLIST.TITLE' | translate }}
            <span class="count-badge" *ngIf="items().length > 0">{{ items().length }}</span>
        </h2>
        <p class="wishlist-subtitle">{{ 'ACCOUNT.WISHLIST.SUBTITLE' | translate }}</p>
    </div>

    <!-- Empty State -->
    @if (items().length === 0) {
        <div class="wishlist-empty">
            <div class="empty-heart">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </div>
            <h3>{{ 'ACCOUNT.WISHLIST.EMPTY_TITLE' | translate }}</h3>
            <p>{{ 'ACCOUNT.WISHLIST.EMPTY_MSG' | translate }}</p>
            <a routerLink="/catalog" class="btn-browse">
                {{ 'ACCOUNT.WISHLIST.BROWSE_CATALOG' | translate }}
            </a>
        </div>
    }

    <!-- Wishlist Grid -->
    @if (items().length > 0) {
        <div class="wishlist-grid">
            @for (item of items(); track item.productId) {
                <div class="wishlist-card">
                    <!-- Remove button -->
                    <button class="btn-remove-wish" (click)="removeItem(item)" title="Quitar de lista">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>

                    <!-- Product Image -->
                    <a [routerLink]="['/product', item.product.slug]" class="wish-img-link">
                        <img
                            [src]="item.product.images?.main || 'assets/images/euro-logo-new.png'"
                            [alt]="item.product.name.es || item.product.name.en"
                            class="wish-img"
                            loading="lazy"
                        >
                    </a>

                    <!-- Product Info -->
                    <div class="wish-info">
                        <span class="wish-brand">{{ item.product.brand }}</span>
                        <a [routerLink]="['/product', item.product.slug]" class="wish-name">
                            {{ item.product.name.es || item.product.name.en }}
                        </a>
                        <p class="wish-size" *ngIf="item.product.specifications">
                            {{ item.product.specifications['width'] }}/{{ item.product.specifications['aspectRatio'] }}-{{ item.product.specifications['diameter'] }}
                        </p>

                        <div class="wish-price-row">
                            <span class="wish-price">{{ item.product.price | currency:'MXN':'symbol-narrow':'1.2-2' }}</span>
                            <span class="wish-price-suffix">MXN</span>
                        </div>

                        <div class="wish-actions">
                            <button class="btn-add-to-cart-wish"
                                    [disabled]="!item.product.inStock"
                                    (click)="addToCart(item)">
                                @if (item.product.inStock) {
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                                    </svg>
                                    {{ 'ACCOUNT.WISHLIST.ADD_TO_CART' | translate }}
                                } @else {
                                    {{ 'PRODUCT_DETAIL.OUT_OF_STOCK' | translate }}
                                }
                            </button>
                        </div>
                    </div>
                </div>
            }
        </div>

        <!-- Clear all -->
        <div class="wishlist-footer">
            <button class="btn-clear-all" (click)="clearAll()">
                {{ 'ACCOUNT.WISHLIST.CLEAR_ALL' | translate }}
            </button>
        </div>
    }
</div>
    `,
    styles: [`
.wishlist-page { padding: 0 0 48px; }

.wishlist-header {
    margin-bottom: 28px;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
}
.wishlist-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.4rem;
    font-weight: 700;
    color: #f4f4f5;
    margin: 0 0 6px;
}
.heart-icon-heading { color: #f43f5e; flex-shrink: 0; }
.count-badge {
    font-size: 0.75rem;
    background: #f43f5e;
    color: #fff;
    border-radius: 99px;
    padding: 2px 9px;
    font-weight: 700;
}
.wishlist-subtitle { font-size: 0.85rem; color: #71717a; margin: 0; }

/* Empty */
.wishlist-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
    gap: 12px;
}
.empty-heart svg { color: rgba(244,63,94,0.3); }
.wishlist-empty h3 { font-size: 1.1rem; font-weight: 600; color: #a1a1aa; margin: 0; }
.wishlist-empty p { font-size: 0.85rem; color: #52525b; margin: 0; }
.btn-browse {
    margin-top: 8px;
    background: linear-gradient(135deg, #00acd8, #0077a8);
    color: #fff;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 600;
    text-decoration: none;
    transition: opacity 0.2s;
}
.btn-browse:hover { opacity: 0.85; }

/* Grid */
.wishlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
}

.wishlist-card {
    position: relative;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    overflow: hidden;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.wishlist-card:hover {
    transform: translateY(-3px);
    border-color: rgba(0,172,216,0.25);
    box-shadow: 0 8px 28px rgba(0,0,0,0.3);
}

.btn-remove-wish {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(0,0,0,0.5);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a1a1aa;
    z-index: 2;
    transition: background 0.2s, color 0.2s;
}
.btn-remove-wish:hover { background: #f43f5e; color: #fff; }

.wish-img-link { display: block; }
.wish-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    padding: 16px;
    background: rgba(255,255,255,0.02);
}

.wish-info { padding: 12px 14px 14px; }
.wish-brand { font-size: 0.72rem; color: #00acd8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.wish-name {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
    color: #e4e4e7;
    margin: 4px 0 3px;
    text-decoration: none;
    line-height: 1.3;
}
.wish-name:hover { color: #00acd8; }
.wish-size { font-size: 0.78rem; color: #71717a; margin: 0 0 10px; }

.wish-price-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 12px; }
.wish-price { font-size: 1.05rem; font-weight: 700; color: #f4f4f5; }
.wish-price-suffix { font-size: 0.72rem; color: #71717a; }

.btn-add-to-cart-wish {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 14px;
    background: linear-gradient(135deg, #00acd8, #0077a8);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
}
.btn-add-to-cart-wish:hover:not(:disabled) { opacity: 0.85; }
.btn-add-to-cart-wish:disabled { background: rgba(255,255,255,0.08); color: #71717a; cursor: not-allowed; }

.wishlist-footer {
    margin-top: 28px;
    display: flex;
    justify-content: flex-end;
}
.btn-clear-all {
    font-size: 0.8rem;
    color: #71717a;
    background: none;
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 7px 16px;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
}
.btn-clear-all:hover { color: #f43f5e; border-color: rgba(244,63,94,0.3); }
    `]
})
export class WishlistComponent implements OnInit {
    private wishlistService = inject(WishlistService);
    private cartService = inject(CartService);

    items = signal<WishlistItem[]>([]);

    ngOnInit() {
        this.wishlistService.items$.subscribe(i => this.items.set(i));
    }

    removeItem(item: WishlistItem) {
        this.wishlistService.remove(item.productId);
    }

    addToCart(item: WishlistItem) {
        this.cartService.addToCart(item.product, 1);
        this.cartService.openCart();
    }

    async clearAll() {
        const all = this.items();
        for (const item of all) {
            await this.wishlistService.remove(item.productId);
        }
    }
}
