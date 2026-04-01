import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CartService } from '../../core/services/cart.service';

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
            // Real purchase — clear cart
            this.cartService.clearCart();
        } else {
            // Direct navigation (bookmarked / shared link) — show fallback state
            this.isDirectNav = true;
        }
    }
}
