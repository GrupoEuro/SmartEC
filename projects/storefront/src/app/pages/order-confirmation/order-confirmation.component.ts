import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CartService } from '../../core/services/cart.service';

declare let gtag: Function;
function fireGtag(event: string, params: object) {
    try { if (typeof gtag !== 'undefined') gtag('event', event, params); } catch { /* non-critical */ }
}

@Component({
    selector: 'app-order-confirmation',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule],
    templateUrl: './order-confirmation.component.html',
    styleUrls: ['./order-confirmation.component.css']
})
export class OrderConfirmationComponent implements OnInit {
    cartService   = inject(CartService);
    orderId:      string | null = null;
    orderNumber:  string | null = null;
    email:        string | null = null;
    shipping:     { serviceName: string; price: number; estimatedDays: number | null; isFree?: boolean } | null = null;
    isDirectNav = false;

    constructor(private router: Router) {
        const nav = this.router.getCurrentNavigation();
        this.orderId     = nav?.extras?.state?.['orderId']     ?? null;
        this.orderNumber = nav?.extras?.state?.['orderNumber'] ?? null;
        this.email       = nav?.extras?.state?.['email']       ?? null;
        this.shipping    = nav?.extras?.state?.['shipping']    ?? null;
    }

    ngOnInit() {
        if (this.orderId) {
            // GA4: purchase — fire BEFORE clearing the cart so we still have the items
            const items = this.cartService.cartItems();
            const total = this.cartService.cartSubtotal();
            const shippingCost = this.shipping?.isFree ? 0 : (this.shipping?.price ?? 0);

            fireGtag('purchase', {
                transaction_id: this.orderId,
                currency:       'MXN',
                value:          total + shippingCost,
                shipping:       shippingCost,
                items: items.map(i => ({
                    item_id:    i.product.sku || i.product.id,
                    item_name:  i.product.name?.es || i.product.name?.en,
                    item_brand: i.product.brand,
                    price:      i.product.price,
                    quantity:   i.quantity,
                }))
            });

            // Real purchase — clear cart after firing event
            this.cartService.clearCart();
        } else {
            // Direct navigation (bookmarked / shared link) — show fallback state
            this.isDirectNav = true;
        }
    }
}
