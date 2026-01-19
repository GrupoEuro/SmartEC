import { Injectable, signal, computed, effect } from '@angular/core';
import { CartItem, CartState } from '../models/cart.model';
import { Product } from '../models/product.model';

@Injectable({
    providedIn: 'root'
})
export class CartService {
    private readonly STORAGE_KEY = 'praxis_guest_cart';

    // State Signals
    private cartState = signal<CartState>(this.loadFromStorage());

    // UI State
    readonly isDrawerOpen = signal(false);

    // Computed Selectors
    readonly cartItems = computed(() => this.cartState().items);

    readonly cartCount = computed(() =>
        this.cartItems().reduce((total, item) => total + item.quantity, 0)
    );

    readonly cartSubtotal = computed(() =>
        this.cartItems().reduce((total, item) => {
            // Price Logic: Use sale price if valid, otherwise regular price
            // Assuming Product model has price and salePrice
            const price = item.product.price || 0;
            return total + (price * item.quantity);
        }, 0)
    );

    readonly freeShippingThreshold = 5000; // Example: $5,000 MXN
    readonly amountToFreeShipping = computed(() => {
        const remaining = this.freeShippingThreshold - this.cartSubtotal();
        return remaining > 0 ? remaining : 0;
    });

    constructor() {
        // Effect to persist changes to LocalStorage automatically
        effect(() => {
            this.saveToStorage(this.cartState());
        });
    }

    // ==========================================
    // Core Actions
    // ==========================================

    addToCart(product: Product, quantity: number = 1) {
        const currentItems = this.cartItems();
        const existingItemIndex = currentItems.findIndex(item => item.product.id === product.id);

        let updatedItems = [...currentItems];

        if (existingItemIndex > -1) {
            // Update existing
            updatedItems[existingItemIndex].quantity += quantity;
        } else {
            // Add new
            updatedItems.push({
                product,
                quantity,
                addedAt: Date.now()
            });
        }

        this.updateState(updatedItems);
    }

    removeFromCart(productId: string) {
        const updatedItems = this.cartItems().filter(item => item.product.id !== productId);
        this.updateState(updatedItems);
    }

    updateQuantity(productId: string, quantity: number) {
        let updatedItems = this.cartItems().map(item => {
            if (item.product.id === productId) {
                return { ...item, quantity: Math.max(0, quantity) };
            }
            return item;
        });

        // Remove items with 0 quantity
        updatedItems = updatedItems.filter(item => item.quantity > 0);

        this.updateState(updatedItems);
    }

    clearCart() {
        this.updateState([]);
    }

    // ==========================================
    // UI Actions
    // ==========================================

    toggleCart() {
        this.isDrawerOpen.update(v => !v);
    }

    openCart() {
        this.isDrawerOpen.set(true);
    }

    closeCart() {
        this.isDrawerOpen.set(false);
    }

    // ==========================================
    // Persistence Logic
    // ==========================================

    private updateState(items: CartItem[]) {
        this.cartState.set({
            items,
            updatedAt: Date.now()
        });
    }

    private saveToStorage(state: CartState) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save cart to storage', e);
        }
    }

    private loadFromStorage(): CartState {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : { items: [], updatedAt: Date.now() };
        } catch (e) {
            console.warn('Failed to load cart from storage', e);
            return { items: [], updatedAt: Date.now() };
        }
    }
}
