import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-order-confirmation',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './order-confirmation.component.html',
    styleUrls: ['./order-confirmation.component.css']
})
export class OrderConfirmationComponent {
    // Logic to clear cart on init
    cartService = inject(CartService);

    constructor() {
        // Clear cart
        // this.cartService.clearCart(); 
        // Commenting out clearCart for now to avoid losing state during dev testing
    }
}
import { CartService } from '../../core/services/cart.service';
