import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CartService } from '@lib/core';

@Component({
    selector: 'app-order-confirmation',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule],
    templateUrl: './order-confirmation.component.html',
    styleUrls: ['./order-confirmation.component.css']
})
export class OrderConfirmationComponent implements OnInit {
    cartService = inject(CartService);
    orderId: string | null = null;
    email: string | null = null;

    constructor(private router: Router) {
        const nav = this.router.getCurrentNavigation();
        this.orderId = nav?.extras?.state?.['orderId'] ?? null;
        this.email   = nav?.extras?.state?.['email']   ?? null;
    }

    ngOnInit() {
        // Only clear the cart when arriving from a real purchase
        if (this.orderId) {
            this.cartService.clearCart();
        }
    }
}

