import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router'; // Import Router
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError, filter } from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductService } from '../../../core/services/product.service';
import { SearchAnalyticsService } from '../../../core/services/search-analytics.service';
import { Product } from '../../../core/models/product.model';

@Component({
    selector: 'app-search-bar',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule, TranslateModule],
    template: `
        <div class="search-container" (clickOutside)="closeResults()">
            <div class="input-wrapper">
                <span class="search-icon">🔍</span>
                <input 
                    type="text" 
                    [formControl]="searchControl" 
                    placeholder="{{ 'NAVBAR.SEARCH_PLACEHOLDER' | translate }}"
                    (focus)="onFocus()"
                >
                @if (isLoading()) {
                    <div class="spinner"></div>
                }
                @if (searchControl.value) {
                    <button class="clear-btn" (click)="clearSearch()">✕</button>
                }
            </div>

            @if (showResults() && (products().length > 0 || searchControl.value)) {
                <div class="search-results">
                    @if (products().length === 0 && searchControl.value) {
                        <div class="no-results">
                            <p>{{ 'NAVBAR.NO_RESULTS' | translate }} "<strong>{{ searchControl.value }}</strong>"</p>
                            <small>{{ 'NAVBAR.TRY_SEARCH' | translate }}</small>
                        </div>
                    } @else {
                        <div class="results-list">
                            @for (product of products(); track product.id; let i = $index) {
                                <div class="result-item" (click)="selectProduct(product, i)">
                                    <img [src]="product.images.main || 'assets/placeholder_tire.png'" alt="thumb">
                                    <div class="result-info">
                                        <div class="result-name" [innerHTML]="highlightMatch(product.name.en)"></div>
                                        <div class="result-brand">{{ product.brand }}</div>
                                    </div>
                                    <div class="result-price">
                                        {{ (product.price) | currency }}
                                        @if (product.compareAtPrice) {
                                            <span style="text-decoration: line-through; color: #999; font-size: 0.8em;">{{ product.compareAtPrice | currency }}</span>
                                        }
                                    </div>
                                </div>
                            }
                        </div>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        .search-container {
            position: relative;
            width: 100%;
            max-width: 600px;
        }
        .input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
            background: rgba(40, 40, 45, 0.8); /* Zinc-800 transparent */
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 9999px; /* Pill shape */
            padding: 8px 16px;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }
        .input-wrapper:focus-within {
            background: rgba(0, 0, 0, 0.9);
            border-color: var(--cyan);
            box-shadow: 0 0 15px rgba(0, 172, 216, 0.2);
        }
        .search-icon { 
            font-size: 1.1rem; 
            margin-right: 12px; 
            color: var(--text-gray); 
        }
        input {
            border: none;
            background: transparent;
            width: 100%;
            outline: none;
            font-size: 0.95rem;
            color: var(--white);
            font-weight: 500;
        }
        input::placeholder {
            color: rgba(255, 255, 255, 0.4);
        }
        .clear-btn {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: var(--text-gray);
            cursor: pointer;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            transition: all 0.2s;
        }
        .clear-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            color: var(--white);
        }
        .spinner {
            width: 18px;
            height: 18px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-top-color: var(--cyan);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 10px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Results Dropdown */
        .search-results {
            position: absolute;
            top: calc(100% + 10px);
            left: 0;
            right: 0;
            background: #18181b; /* Zinc-900 */
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
            z-index: 1000;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .no-results {
            padding: 24px;
            text-align: center;
            color: var(--text-gray);
        }
        .no-results p { margin-bottom: 8px; color: var(--white); }
        .no-results small { color: var(--text-gray); }

        .results-list {
            max-height: 450px;
            overflow-y: auto;
        }
        /* Custom Scrollbar */
        .results-list::-webkit-scrollbar { width: 6px; }
        .results-list::-webkit-scrollbar-track { background: #18181b; }
        .results-list::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }

        .result-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.2s;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .result-item:last-child { border-bottom: none; }
        .result-item:hover { 
            background: rgba(0, 172, 216, 0.1); 
        }
        .result-item img {
            width: 48px;
            height: 48px;
            object-fit: cover;
            border-radius: 6px;
            margin-right: 16px;
            background: #fff; /* White bg for product images usually looks better */
        }
        .result-info { flex: 1; overflow: hidden; }
        .result-name {
            font-size: 0.95rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--white);
            margin-bottom: 2px;
        }
        .result-brand { 
            font-size: 0.75rem; 
            color: var(--text-gray); 
            text-transform: uppercase; 
            letter-spacing: 0.5px;
        }
        .result-price {
            font-weight: 700;
            color: var(--lime);
            font-size: 1rem;
            text-align: right;
            margin-left: 12px;
        }
    `]
})
export class SearchBarComponent {
    searchControl = new FormControl('');
    productService = inject(ProductService);
    analyticsService = inject(SearchAnalyticsService);
    router = inject(Router); // Inject Router

    products = signal<Product[]>([]);
    isLoading = signal(false);
    showResults = signal(false);

    constructor() {
        this.searchControl.valueChanges.pipe(
            debounceTime(500),
            distinctUntilChanged(),
            filter(term => {
                if (!term || term.length < 2) {
                    this.products.set([]);
                    this.showResults.set(false);
                    return false;
                }
                return true;
            }),
            tap(() => {
                this.isLoading.set(true);
                this.showResults.set(true);
            }),
            switchMap(term => this.productService.searchProducts(term || '').pipe(
                catchError(() => of([]))
            ))
        ).subscribe(results => {
            this.isLoading.set(false);
            this.products.set(results);

            // ANALYTICS HOOK
            const term = this.searchControl.value || '';
            this.analyticsService.logSearch(term, results.length);
        });
    }

    onFocus() {
        if (this.searchControl.value && this.searchControl.value.length >= 2) {
            this.showResults.set(true);
        }
    }

    closeResults() {
        // Delayed to allow click event on result item to fire
        setTimeout(() => this.showResults.set(false), 200);
    }

    clearSearch() {
        this.searchControl.setValue('');
        this.products.set([]);
        this.showResults.set(false);
    }

    selectProduct(product: Product, index: number) {
        // ANALYTICS HOOK
        const term = this.searchControl.value || '';
        if (product.id) {
            this.analyticsService.logClick(term, product.id, product.name.en, index + 1);
        }

        this.showResults.set(false);
        this.searchControl.setValue(''); // Optional: clear or keep term

        // Navigate to product detail
        // Assuming route /product/:slug or /product/:id
        this.router.navigate(['/product', product.slug || product.id]);
    }

    highlightMatch(text: string): string {
        const term = this.searchControl.value;
        if (!term) return text;
        const re = new RegExp(term, 'gi');
        return text.replace(re, match => `<strong>${match}</strong>`);
    }
}
