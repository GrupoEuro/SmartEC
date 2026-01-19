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
        <div class="mt-8 mb-8 p-6 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
            <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-4">Frequently Bought Together</h3>
            
            <div class="flex flex-col md:flex-row items-center gap-4">
                <!-- Main Product -->
                <div class="flex items-center gap-3">
                    <img [src]="mainProduct.images.main" class="w-16 h-16 object-cover rounded-md border border-slate-200">
                    <div class="text-sm">
                        <span class="font-bold block">{{ mainProduct.name.es }}</span>
                        <span class="text-slate-500">\${{ mainProduct.price }}</span>
                    </div>
                </div>

                <!-- Plus Icon -->
                <div class="flex-shrink-0 text-slate-400 font-bold text-xl">+</div>

                <!-- Bundle Items -->
                @for (item of bundleItems(); track item.id) {
                    <div class="flex items-center gap-3">
                        <img [src]="item.images.main" class="w-16 h-16 object-cover rounded-md border border-slate-200">
                        <div class="text-sm">
                            <a [routerLink]="['/product', item.slug]" class="font-bold block hover:text-blue-600 line-clamp-1">{{ item.name.es }}</a>
                            <span class="text-slate-500">\${{ item.price }}</span>
                        </div>
                    </div>
                    @if (!$last) {
                        <div class="flex-shrink-0 text-slate-400 font-bold text-xl">+</div>
                    }
                }

                <!-- Total & Action -->
                <div class="ml-auto flex flex-col items-end gap-2 pl-4 md:border-l border-slate-200">
                    <div class="text-right">
                        <span class="text-xs text-slate-500 uppercase tracking-wider font-bold">Total Price:</span>
                        <div class="text-xl font-black text-slate-900 dark:text-white">\${{ getTotalPrice() }}</div>
                    </div>
                    <button (click)="addAllToCart()" class="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity whitespace-nowrap">
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
