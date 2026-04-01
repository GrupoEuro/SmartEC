import { Injectable, signal, computed, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CartItem, CartState } from '../models/cart.model';
import { Product } from '../models/product.model';
import { Firestore, doc, setDoc, getDoc, deleteDoc, Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class CartService {
    private readonly STORAGE_KEY = 'praxis_guest_cart';
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private platformId = inject(PLATFORM_ID);

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
        // Effect to persist to LocalStorage AND Firestore
        effect(() => {
            const state = this.cartState();
            this.saveToStorage(state);
            this.saveToFirestore(state);
        });

        // Listen for Auth Changes to switch carts
        this.authService.user$.subscribe(user => {
            if (user) {
                // User logged in: Load their cloud cart
                this.loadFromFirestore(user.uid);
            }
        });
    }

    // ==========================================
    // Cloud Persistence
    // ==========================================
    private saveTimeout: any;

    private async saveToFirestore(state: CartState) {
        const user = this.authService.currentUser();
        if (!user) return; // Don't save for guests yet (or implement guest session logic later)

        // Debounce: Wait 1s before writing to save writes
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        this.saveTimeout = setTimeout(async () => {
            try {
                const cartRef = doc(this.firestore, `carts/${user.uid}`);
                await setDoc(cartRef, {
                    ...state,
                    userId: user.uid,
                    email: user.email,
                    lastUpdated: Timestamp.now()
                }, { merge: true });
                console.log('Cart synced to Firestore');
            } catch (e) {
                console.error('Error syncing cart to Firestore', e);
            }
        }, 1000);
    }

    private async loadFromFirestore(userId: string) {
        try {
            const cartRef = doc(this.firestore, `carts/${userId}`);
            const snapshot = await getDoc(cartRef);

            if (snapshot.exists()) {
                const cloudCart = snapshot.data() as CartState;
                const localItems = this.cartState().items;
                const cloudItems = cloudCart.items ?? [];

                if (cloudItems.length === 0) {
                    this.saveToFirestore(this.cartState());
                } else if (localItems.length === 0) {
                    this.updateState(cloudItems);
                } else {
                    // Union merge: keep higher quantity
                    const merged = [...cloudItems];
                    for (const localItem of localItems) {
                        const idx = merged.findIndex(ci => ci.product.id === localItem.product.id);
                        if (idx > -1) {
                            merged[idx] = { ...merged[idx], quantity: Math.max(merged[idx].quantity, localItem.quantity) };
                        } else {
                            merged.push(localItem);
                        }
                    }
                    this.updateState(merged);
                }
            } else {
                if (this.cartState().items.length > 0) {
                    this.saveToFirestore(this.cartState());
                }
            }
        } catch (e) {
            console.error('Error loading cart from Firestore', e);
        }
    }

    // ==========================================
    // Core Actions
    // ==========================================

    addToCart(product: Product, quantity: number = 1) {
        const currentItems = this.cartItems();
        const existingItemIndex = currentItems.findIndex(item => item.product.id === product.id);

        let updatedItems = [...currentItems];

        if (existingItemIndex > -1) {
            // ✅ Create new object — do NOT mutate in place (Signal won't fire otherwise)
            updatedItems[existingItemIndex] = {
                ...updatedItems[existingItemIndex],
                quantity: updatedItems[existingItemIndex].quantity + quantity
            };
        } else {
            updatedItems.push({ product, quantity, addedAt: Date.now() });
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

    /** Hard-delete the Firestore cart document — call after successful order placement */
    async clearFirestoreCart(): Promise<void> {
        const user = this.authService.currentUser();
        if (!user) return;
        try {
            await deleteDoc(doc(this.firestore, `carts/${user.uid}`));
        } catch (e) {
            console.warn('[Cart] Could not clear Firestore cart:', e);
        }
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



    // ...

    private saveToStorage(state: CartState) {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save cart to storage', e);
        }
    }

    private loadFromStorage(): CartState {
        if (!isPlatformBrowser(this.platformId)) return { items: [], updatedAt: Date.now() };
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : { items: [], updatedAt: Date.now() };
        } catch (e) {
            console.warn('Failed to load cart from storage', e);
            return { items: [], updatedAt: Date.now() };
        }
    }
}
