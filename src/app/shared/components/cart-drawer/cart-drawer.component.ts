import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { TranslateModule } from '@ngx-translate/core';
import { CartService } from '../../../core/services/cart.service';

@Component({
    selector: 'app-cart-drawer',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule],
    animations: [
        trigger('slideInOut', [
            state('void', style({ transform: 'translateX(100%)' })),
            state('*', style({ transform: 'translateX(0)' })),
            transition('void <=> *', animate('300ms ease-in-out'))
        ]),
        trigger('fadeIn', [
            state('void', style({ opacity: 0 })),
            state('*', style({ opacity: 1 })),
            transition('void <=> *', animate('300ms ease-in-out'))
        ])
    ],
    template: `
        @if (cartService.isDrawerOpen()) {
            <div class="cart-overlay" [@fadeIn] (click)="close()">
                <div class="cart-drawer" [@slideInOut] (click)="$event.stopPropagation()">
                    
                    <!-- Header -->
                    <div class="drawer-header">
                        <h2>{{ 'CART.TITLE' | translate }} ({{ cartService.cartCount() }})</h2>
                        <button class="close-btn" (click)="close()">✕</button>
                    </div>

                    <!-- Free Shipping Bar -->
                    <div class="shipping-progress">
                        @if (cartService.amountToFreeShipping() > 0) {
                            <p>{{ 'CART.ADD_MORE_SHIPPING' | translate:{ amount: (cartService.amountToFreeShipping() | currency) } }}</p>
                            <div class="progress-track">
                                <div class="progress-fill" [style.width.%]="shippingProgress"></div>
                            </div>
                        } @else {
                            <p class="success-msg">{{ 'CART.FREE_SHIPPING_UNLOCKED' | translate }}</p>
                            <div class="progress-track">
                                <div class="progress-fill" style="width: 100%; background: var(--green, #10b981);"></div>
                            </div>
                        }
                    </div>

                    <!-- Cart Items -->
                    <div class="drawer-content">
                        @if (cartService.cartItems().length === 0) {
                            <div class="empty-state">
                                <span class="empty-icon">🛒</span>
                                <p>{{ 'CART.EMPTY_MSG' | translate }}</p>
                                <button class="btn-primary" (click)="close()">{{ 'CART.START_SHOPPING' | translate }}</button>
                            </div>
                        } @else {
                            <div class="cart-items">
                                @for (item of cartService.cartItems(); track item.product.id) {
                                    <div class="cart-item">
                                        <div class="item-img">
                                            <!-- Assuming first image or placeholder -->
                                            <img [src]="item.product.images.main || 'assets/placeholder_tire.png'" alt="Product">
                                        </div>
                                        <div class="item-details">
                                            <h4>{{ item.product.name.en }}</h4>
                                            <div class="item-meta">
                                                <span class="price">{{ item.product.price | currency }}</span>
                                            </div>
                                            <div class="quantity-controls">
                                                <button (click)="updateQty(item.product.id, item.quantity - 1)">-</button>
                                                <span>{{ item.quantity }}</span>
                                                <button (click)="updateQty(item.product.id, item.quantity + 1)">+</button>
                                            </div>
                                        </div>
                                        <button class="remove-btn" (click)="removeItem(item.product.id)">🗑️</button>
                                    </div>
                                }
                            </div>
                        }
                    </div>

                    <!-- Footer -->
                    <div class="drawer-footer">
                        <div class="summary-row">
                            <span>{{ 'CART.SUBTOTAL' | translate }}</span>
                            <span class="amount">{{ cartService.cartSubtotal() | currency }}</span>
                        </div>
                        <p class="tax-note">{{ 'CART.TAX_NOTE' | translate }}</p>
                        
                        <a routerLink="/checkout" (click)="close()" class="btn-checkout">
                            {{ 'CART.CHECKOUT_SECURELY' | translate }}
                        </a>
                    </div>

                </div>
            </div>
        }
    `,
    styles: [`
        .cart-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 2000;
            display: flex;
            justify-content: flex-end;
            backdrop-filter: blur(8px);
        }
        .cart-drawer {
            width: 100%;
            max-width: 500px;
            background: #18181b; /* Zinc-900 */
            height: 100%;
            display: flex;
            flex-direction: column;
            box-shadow: -10px 0 40px rgba(0,0,0,0.6);
            color: var(--white);
            border-left: 1px solid rgba(255, 255, 255, 0.1);
        }
        .drawer-header {
            padding: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            background: #09090b; /* Zinc-950 */
        }
        .drawer-header h2 { 
            margin: 0; 
            font-size: 1.25rem; 
            font-weight: 700; 
            letter-spacing: -0.5px;
            color: var(--white);
        }
        .close-btn { 
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--white);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer; 
            transition: all 0.2s;
        }
        .close-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: rotate(90deg);
        }
        
        .shipping-progress {
            padding: 16px 24px;
            background: rgba(0, 172, 216, 0.05); /* Cyan tint */
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .shipping-progress p { 
            margin: 0 0 10px; 
            font-size: 0.9rem; 
            text-align: center; 
            color: var(--text-gray); 
        }
        .shipping-progress strong { color: var(--white); }
        .progress-track { 
            height: 6px; 
            background: rgba(255, 255, 255, 0.1); 
            border-radius: 999px; 
            overflow: hidden; 
        }
        .progress-fill { 
            height: 100%; 
            background: linear-gradient(90deg, var(--cyan), var(--lime)); 
            border-radius: 999px;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1); 
        }
        .success-msg { color: var(--lime) !important; font-weight: 500; }

        .drawer-content { 
            flex: 1; 
            overflow-y: auto; 
            padding: 0; 
        }
        /* Scrollbar */
        .drawer-content::-webkit-scrollbar { width: 6px; }
        .drawer-content::-webkit-scrollbar-track { background: #18181b; }
        .drawer-content::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 24px;
            opacity: 1;
        }
        .empty-icon { font-size: 5rem; opacity: 0.2; filter: grayscale(100%); }
        .empty-state p {
            font-size: 1.1rem;
            color: var(--text-gray);
        }

        .cart-items { padding: 0; }
        .cart-item {
            display: flex;
            gap: 20px;
            padding: 24px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            transition: background 0.2s;
        }
        .cart-item:hover {
            background: rgba(255, 255, 255, 0.02);
        }
        
        .item-img {
            flex-shrink: 0;
            width: 90px;
            height: 90px;
            background: #fff;
            border-radius: 8px;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .item-img img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        
        .item-details { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
        .item-details h4 { 
            margin: 0 0 4px; 
            font-size: 1rem; 
            font-weight: 600; 
            color: var(--white);
            line-height: 1.4;
        }
        .item-meta { display: flex; justify-content: space-between; align-items: center; }
        .price { 
            font-weight: 700; 
            color: var(--lime); 
            font-size: 1.1rem; 
        }
        
        .quantity-controls {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            width: fit-content;
            border-radius: 6px;
            padding: 4px;
        }
        .quantity-controls button {
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            color: var(--white);
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .quantity-controls button:hover { background: rgba(255, 255, 255, 0.1); }
        .quantity-controls span { 
            font-variant-numeric: tabular-nums; 
            min-width: 20px; 
            text-align: center; 
            font-weight: 600;
        }
        
        .remove-btn { 
            background: none; 
            border: none; 
            cursor: pointer; 
            opacity: 0.4; 
            align-self: flex-start;
            padding: 4px;
            font-size: 1.2rem;
            transition: all 0.2s;
        }
        .remove-btn:hover { 
            opacity: 1; 
            transform: scale(1.1);
        }

        .drawer-footer {
            padding: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            background: #09090b; /* Zinc-950 */
            box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
        }
        .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 1.25rem;
            font-weight: 400;
            color: var(--text-gray);
            margin-bottom: 8px;
        }
        .summary-row .amount {
            color: var(--white);
            font-weight: 700;
        }
        .tax-note { 
            font-size: 0.85rem; 
            color: var(--text-gray); 
            text-align: center; 
            margin-bottom: 24px; 
            opacity: 0.7;
        }
        .btn-checkout {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 18px;
            background: linear-gradient(135deg, var(--primary-blue) 0%, var(--cyan) 100%);
            color: white;
            text-align: center;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 700;
            font-size: 1.1rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: all 0.3s;
            box-shadow: 0 4px 15px rgba(0, 172, 216, 0.3);
        }
        .btn-checkout:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 8px 25px rgba(0, 172, 216, 0.5);
            filter: brightness(1.1);
        }
        .btn-primary { 
            padding: 12px 24px; 
            background: var(--cyan); 
            color: black; 
            font-weight: bold;
            border: none; 
            border-radius: 999px; 
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary:hover {
            transform: scale(1.05);
            background: var(--white);
        }
    `]
})
export class CartDrawerComponent {
    cartService = inject(CartService);
    translate = inject(TranslateService);

    // Controlled by Service Logic via Signal

    close() {
        this.cartService.closeCart();
    }

    updateQty(productId: string | undefined, qty: number) {
        if (!productId) return;
        if (qty <= 0) {
            this.removeItem(productId);
        } else {
            this.cartService.updateQuantity(productId, qty);
        }
    }

    removeItem(productId: string | undefined) {
        if (!productId) return;
        if (confirm(this.translate.instant('CART.CONFIRM_REMOVE'))) {
            this.cartService.removeFromCart(productId);
        }
    }

    get shippingProgress() {
        const threshold = this.cartService.freeShippingThreshold;
        const current = this.cartService.cartSubtotal();
        return Math.min(100, (current / threshold) * 100);
    }
}
