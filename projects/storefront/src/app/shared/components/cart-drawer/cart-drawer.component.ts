import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
                                            <h4>{{ translate.currentLang === 'es' ? (item.product.name.es || item.product.name.en) : (item.product.name.en || item.product.name.es) }}</h4>
                                            <div class="item-meta">
                                                <span class="unit-price">{{ item.product.price | currency }} × {{ item.quantity }}</span>
                                                <span class="price">{{ (item.product.price * item.quantity) | currency }}</span>
                                            </div>
                                            <div class="quantity-controls">
                                                <button (click)="updateQty(item.product.id, item.quantity - 1)">-</button>
                                                <span>{{ item.quantity }}</span>
                                                <button (click)="updateQty(item.product.id, item.quantity + 1)">+</button>
                                            </div>
                                        </div>
                                        <!-- Remove: inline confirmation instead of browser confirm() -->
                                        @if (confirmingId() === item.product.id) {
                                            <div class="remove-confirm">
                                                <button class="confirm-yes" (click)="confirmRemove(item.product.id!)">🗑️ Eliminar</button>
                                                <button class="confirm-no" (click)="cancelRemove()">No</button>
                                            </div>
                                        } @else {
                                            <button class="remove-btn" (click)="requestRemove(item.product.id!)" title="Eliminar">🗑️</button>
                                        }
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

                        <!-- Auto-applied campaign coupon badge -->
                        @if (appliedCoupon) {
                        <div class="coupon-applied-banner">
                            <div class="coupon-applied-left">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                                <span class="coupon-code">{{ appliedCoupon.code }}</span>
                                <span class="coupon-auto-label">auto-aplicado</span>
                            </div>
                            <span class="coupon-saving">-{{ appliedCoupon.amount | currency }}</span>
                        </div>
                        <div class="summary-row total-row">
                            <span>{{ 'CART.TOTAL' | translate }}</span>
                            <span class="amount total-amount">{{ (cartService.cartSubtotal() - appliedCoupon.amount) | currency }}</span>
                        </div>
                        }
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
        :host {
            --zinc-950: #09090b;
            --zinc-900: #18181b;
            --zinc-800: #27272a;
            --primary-cyan: #00ACD8;
            --lime: #93D500;
            --text-primary: #ffffff;
            --text-secondary: #a1a1aa;
        }

        .cart-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.7);
            z-index: 2000;
            display: flex;
            justify-content: flex-end;
            backdrop-filter: blur(8px);
        }
        .cart-drawer {
            width: 100%;
            max-width: 500px;
            background: var(--zinc-900);
            height: 100%;
            display: flex;
            flex-direction: column;
            box-shadow: -10px 0 50px rgba(0,0,0,0.8);
            color: var(--text-primary);
            border-left: 1px solid rgba(255, 255, 255, 0.08);
        }
        .drawer-header {
            padding: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            background: var(--zinc-950);
        }
        .drawer-header h2 { 
            margin: 0; 
            font-size: 1.25rem; 
            font-weight: 800; 
            letter-spacing: -0.5px;
            color: var(--text-primary);
            text-transform: uppercase;
        }
        .close-btn { 
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer; 
            transition: all 0.2s;
            font-size: 1rem;
        }
        .close-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--primary-cyan);
            border-color: var(--primary-cyan);
            transform: rotate(90deg);
        }
        
        .shipping-progress {
            padding: 20px 24px;
            background: rgba(0, 172, 216, 0.03);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .shipping-progress p { 
            margin: 0 0 12px; 
            font-size: 0.9rem; 
            text-align: center; 
            color: var(--text-secondary); 
            font-weight: 500;
        }
        .shipping-progress strong { color: var(--primary-cyan); }
        .progress-track { 
            height: 6px; 
            background: rgba(255, 255, 255, 0.1); 
            border-radius: 999px; 
            overflow: hidden; 
        }
        .progress-fill { 
            height: 100%; 
            background: linear-gradient(90deg, var(--primary-cyan), #0088b3); 
            border-radius: 999px;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1); 
            box-shadow: 0 0 10px rgba(0, 172, 216, 0.5);
        }
        .success-msg { color: var(--lime) !important; font-weight: 700 !important; text-transform: uppercase; font-size: 0.85rem !important; }

        .drawer-content { 
            flex: 1; 
            overflow-y: auto; 
            padding: 0; 
        }
        /* Scrollbar */
        .drawer-content::-webkit-scrollbar { width: 6px; }
        .drawer-content::-webkit-scrollbar-track { background: var(--zinc-900); }
        .drawer-content::-webkit-scrollbar-thumb { background: var(--zinc-800); border-radius: 3px; }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 24px;
            padding: 40px;
            text-align: center;
        }
        .empty-icon { font-size: 4rem; opacity: 0.5; filter: grayscale(100%); margin-bottom: 1rem; }
        .empty-state p {
            font-size: 1.1rem;
            color: var(--text-secondary);
            font-weight: 500;
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
            width: 80px;
            height: 80px;
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
            margin: 0 0 8px; 
            font-size: 0.95rem; 
            font-weight: 700; 
            color: var(--text-primary);
            line-height: 1.4;
        }
        .item-meta { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; }
        .unit-price {
            font-size: 0.8rem;
            color: var(--text-secondary);
            width: 100%;
        }
        .price { 
            font-weight: 800; 
            color: var(--text-primary); 
            font-size: 1.1rem; 
        }
        
        .quantity-controls {
            display: flex;
            align-items: center;
            gap: 0;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            width: fit-content;
            border-radius: 50px;
            padding: 2px;
        }
        .quantity-controls button {
            width: 28px;
            height: 28px;
            border: none;
            background: transparent;
            color: var(--text-primary);
            border-radius: 50%;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
            font-size: 1.1rem;
        }
        .quantity-controls button:hover { background: rgba(255, 255, 255, 0.1); }
        .quantity-controls span { 
            font-variant-numeric: tabular-nums; 
            min-width: 24px; 
            text-align: center; 
            font-weight: 700;
            font-size: 0.9rem;
        }
        
        .remove-btn { 
            background: none; 
            border: none; 
            cursor: pointer; 
            opacity: 0.4; 
            align-self: flex-start;
            padding: 8px;
            font-size: 1.1rem;
            transition: all 0.2s;
            filter: grayscale(1);\n        }
        .remove-btn:hover { 
            opacity: 1; 
            transform: scale(1.1);
            filter: grayscale(0);
        }

        .remove-confirm {
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-self: flex-start;
        }
        .confirm-yes {
            font-size: 0.72rem;
            font-weight: 700;
            padding: 4px 8px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.4);
            border-radius: 6px;
            color: #fca5a5;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.15s;
        }
        .confirm-yes:hover { background: rgba(239, 68, 68, 0.3); }
        .confirm-no {
            font-size: 0.72rem;
            font-weight: 600;
            padding: 4px 8px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: background 0.15s;
        }
        .confirm-no:hover { background: rgba(255, 255, 255, 0.1); }


        .drawer-footer {
            padding: 32px 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            background: var(--zinc-950);
            box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
        }
        .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 1.1rem;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }
        .summary-row .amount {
            color: var(--text-primary);
            font-weight: 800;
            font-size: 1.25rem;
        }
        .tax-note { 
            font-size: 0.8rem; 
            color: var(--text-secondary); 
            text-align: right; 
            margin-bottom: 24px; 
            opacity: 0.7;
        }

        /* Auto-applied campaign coupon badge */
        .coupon-applied-banner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: .75rem;
            margin: 8px 0;
            padding: .55rem .85rem;
            border-radius: 8px;
            background: rgba(74, 222, 128, .08);
            border: 1px solid rgba(74, 222, 128, .25);
            animation: coupon-pop .4s cubic-bezier(.34,1.56,.64,1) both;
        }
        @keyframes coupon-pop {
            from { opacity: 0; transform: scale(.95) translateY(4px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .coupon-applied-left {
            display: flex;
            align-items: center;
            gap: .4rem;
            color: #4ade80;
        }
        .coupon-code {
            font-family: 'Courier New', monospace;
            font-size: .8rem;
            font-weight: 700;
            color: #4ade80;
            letter-spacing: .5px;
        }
        .coupon-auto-label {
            font-size: .62rem;
            background: rgba(74, 222, 128, .15);
            border: 1px solid rgba(74, 222, 128, .2);
            border-radius: 4px;
            padding: .05rem .3rem;
            color: rgba(74, 222, 128, .8);
            font-weight: 600;
        }
        .coupon-saving {
            font-size: .85rem;
            font-weight: 800;
            color: #4ade80;
        }
        .total-row {
            border-top: 1px solid rgba(255,255,255,.06);
            padding-top: 8px;
            margin-top: 8px;
            margin-bottom: 0;
        }
        .total-amount { color: #4ade80 !important; }
        .btn-checkout {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            width: 100%;
            padding: 18px;
            background: linear-gradient(135deg, var(--primary-cyan), #007799);
            color: white;
            text-align: center;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 800;
            font-size: 1rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 20px rgba(0, 172, 216, 0.4);
            position: relative;
            overflow: hidden;
        }
        .btn-checkout:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 8px 30px rgba(0, 172, 216, 0.6);
            filter: brightness(1.1);
        }
        .btn-primary { 
            padding: 12px 24px; 
            background: var(--primary-cyan); 
            color: white; 
            font-weight: 700;
            border: none; 
            border-radius: 50px; 
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
            font-size: 0.9rem;
            letter-spacing: 0.5px;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 15px rgba(0, 172, 216, 0.3);
        }
    `]
})
export class CartDrawerComponent {
    cartService = inject(CartService);
    translate = inject(TranslateService);

    /** productId that awaits inline delete confirmation, null = none */
    confirmingId = signal<string | null>(null);

    close() {
        this.cartService.closeCart();
    }

    updateQty(productId: string | undefined, qty: number) {
        if (!productId) return;
        if (qty <= 0) {
            this.requestRemove(productId);
        } else {
            this.cartService.updateQuantity(productId, qty);
        }
    }

    requestRemove(productId: string) {
        this.confirmingId.set(productId);
    }

    confirmRemove(productId: string) {
        this.cartService.removeFromCart(productId);
        this.confirmingId.set(null);
    }

    cancelRemove() {
        this.confirmingId.set(null);
    }

    get shippingProgress() {
        const threshold = this.cartService.freeShippingThreshold();
        const current = this.cartService.cartSubtotal();
        return Math.min(100, (current / threshold) * 100);
    }

    /** Proxy to CartService appliedCoupon getter for template access */
    get appliedCoupon() { return this.cartService.appliedCoupon; }
}

