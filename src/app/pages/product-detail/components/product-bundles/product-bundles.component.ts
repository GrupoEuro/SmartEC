import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Product } from '../../../../core/models/product.model';
import { ProductService } from '../../../../core/services/product.service';
import { map } from 'rxjs/operators';
import { Observable, of } from 'rxjs';

@Component({
    selector: 'app-product-bundles',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    @if (bundleItems().length > 0) {
        <div class="mt-8 mb-8 p-6 bg-[#141414] rounded-xl border border-white/10">
            <h3 class="text-lg font-bold text-white mb-4">Frequently Bought Together</h3>
            
            <div class="flex flex-col md:flex-row items-center gap-4">
                <!-- Main Product -->
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <img [src]="mainProduct.images.main || 'assets/images/euro-logo-new.png'" (error)="mainProduct.images.main = 'assets/images/euro-logo-new.png'" class="w-16 h-16 object-cover rounded-md border border-white/10">
                    <div class="text-sm">
                        <span class="font-bold block text-white">{{ mainProduct.name.es }}</span>
                        <span class="text-[#a0a0a0]">\${{ mainProduct.price }}</span>
                    </div>
                </div>

                <!-- Plus Icon -->
                <div class="flex-shrink-0 text-[#00ACD8] font-bold text-xl">+</div>

                <!-- Bundle Items -->
                @for (item of bundleItems(); track item.id) {
                    <div class="flex items-center gap-3 w-full md:w-auto">
                        <img [src]="item.images.main || 'assets/images/euro-logo-new.png'" (error)="item.images.main = 'assets/images/euro-logo-new.png'" class="w-16 h-16 object-cover rounded-md border border-white/10">
                        <div class="text-sm">
                            <a [routerLink]="['/product', item.slug]" class="font-bold block text-white hover:text-[#00ACD8] line-clamp-1 transition-colors">{{ item.name.es }}</a>
                            <span class="text-[#a0a0a0]">\${{ item.price }}</span>
                        </div>
                    </div>
                    @if (!$last) {
                        <div class="flex-shrink-0 text-[#00ACD8] font-bold text-xl">+</div>
                    }
                }

                <!-- Total & Action -->
                <div class="ml-auto w-full md:w-auto flex flex-col md:items-end items-center gap-2 pl-0 md:pl-4 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0">
                    <div class="text-right w-full md:w-auto flex justify-between md:block">
                        <span class="text-xs text-[#a0a0a0] uppercase tracking-wider font-bold">Total Price:</span>
                        <div class="text-xl font-black text-white">\${{ getTotalPrice() }}</div>
                    </div>
                    <button (click)="addAllToCart()" class="w-full md:w-auto bg-gradient-to-r from-[#00ACD8] to-[#0088b3] text-white px-6 py-3 rounded-lg font-bold text-sm hover:brightness-110 transition-all shadow-lg shadow-cyan-500/20">
                        Add Bundle to Cart
                    </button>
                </div>
            </div>
        </div>
    }
  `
})
export class ProductBundlesComponent implements OnInit {
    @Input({ required: true }) mainProduct!: Product;

    private productService = inject(ProductService);
    bundleItems = signal<Product[]>([]);

    ngOnInit() {
        this.loadBundleRecommendations();
    }

    loadBundleRecommendations() {
        // Mock Logic: If category is X, fetch Y. 
        // For now, valid "bundle" logic is hard without real data.
        // We will fetch 1 random popular item as a placeholder for the logic.

        this.productService.getProducts({}, 'featured').pipe(
            map(products => {
                // Filter out self
                const others = products.filter(p => p.id !== this.mainProduct.id);
                // Return top 1
                return others.slice(0, 1);
            })
        ).subscribe(items => {
            this.bundleItems.set(items);
        });
    }

    getTotalPrice(): number {
        const bundleSum = this.bundleItems().reduce((acc, curr) => acc + curr.price, 0);
        return this.mainProduct.price + bundleSum;
    }

    addAllToCart() {
        alert(`Added Bundle to Cart! Total: $${this.getTotalPrice()}`);
    }
}
