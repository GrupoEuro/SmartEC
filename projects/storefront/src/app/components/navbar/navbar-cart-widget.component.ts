import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CartService } from '../../core/services/cart.service';

@Component({
    selector: 'app-navbar-cart-widget',
    standalone: true,
    imports: [CommonModule],
    styleUrls: ['./navbar.component.css'],
    template: `
    <button class="cart-btn" (click)="cartService.openCart()" id="cart-icon-target">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
        @if (cartService.cartCount() > 0) {
            <span class="cart-badge">{{ cartService.cartCount() }}</span>
        }
    </button>
  `
})
export class NavbarCartWidgetComponent {
    cartService = inject(CartService);
}
