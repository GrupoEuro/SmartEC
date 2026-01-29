import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Product } from '../../../core/models/product.model';
import { CartService } from '../../../core/services/cart.service';

@Component({
    selector: 'app-quick-view-modal',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, NgOptimizedImage],
    templateUrl: './quick-view-modal.component.html',
    styleUrl: './quick-view-modal.component.css'
})
export class QuickViewModalComponent {
    @Input({ required: true }) product!: Product;
    @Output() close = new EventEmitter<void>();

    private cartService = inject(CartService);

    addToCart() {
        this.cartService.addToCart(this.product);
        this.cartService.openCart();
        this.close.emit();
    }

    onBackdropClick(event: MouseEvent) {
        if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
            this.close.emit();
        }
    }

    getProductImage(product: Product): string {
        return product.images?.main || 'assets/images/euro-logo-new.png';
    }
}
