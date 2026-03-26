import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '@lib/core';

@Component({
    selector: 'app-order-confirmation',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './order-confirmation.component.html',
    styleUrls: ['./order-confirmation.component.css']
})
export class OrderConfirmationComponent {
    cartService = inject(CartService);
    orderId: string | null = null;

    constructor(private router: Router) {
        const nav = this.router.getCurrentNavigation();
        this.orderId = nav?.extras?.state?.['orderId'] ?? null;
        this.cartService.clearCart();
    }
}
