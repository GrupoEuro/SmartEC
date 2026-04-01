import { Product } from './product.model';

export interface CartItem {
    product:  Product;
    quantity: number;
    addedAt:  number; // Unix ms — when this item was first added
}

export type CartStatus = 'active' | 'checkout_started' | 'completed' | 'abandoned';

export interface CartState {
    items:               CartItem[];
    updatedAt:           number;
    /** Unix ms — when the FIRST item ever was added to this cart */
    firstAddedAt?:       number;
    /** Lifecycle status — used to filter abandoned carts in analytics */
    status?:             CartStatus;
    /** Stable browser session ID — links guest activity across page reloads */
    sessionId?:          string;
    /** UTM source or document.referrer — for attribution */
    source?:             string;
    /** ISO string — when the user entered the checkout flow */
    checkoutStartedAt?:  string;
    /** Firestore order ID that converted this cart */
    orderId?:            string;
    /** Unix ms — when the order was placed and cart completed */
    completedAt?:        number;
}
