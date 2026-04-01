import { Product } from './product.model';

export interface CartItem {
    product:  Product;
    quantity: number;
    addedAt:  number; // Unix ms — when this item was first added
}

/**
 * Full lifecycle of a cart document:
 *
 *  active            → user has items, still browsing
 *  checkout_started  → entered checkout flow
 *  completed         → order placed (converted)
 *  cleared_by_user   → user manually emptied the cart (intentional signal)
 *  abandoned         → system-flagged after 60min idle with no activity
 *  migrated          → guest session merged into a logged-in user cart
 */
export type CartStatus =
    | 'active'
    | 'checkout_started'
    | 'completed'
    | 'cleared_by_user'
    | 'abandoned'
    | 'migrated';

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
    /** Unix ms — when the user intentionally cleared the cart */
    clearedAt?:          number;
    /** Items snapshot preserved at the moment the cart was cleared */
    clearedItems?:       CartItem[];
}

// ── Cart Snapshot (event ledger) ────────────────────────────────────────────

export type CartEventType =
    | 'item_added'
    | 'item_removed'
    | 'quantity_changed'
    | 'cleared_by_user'
    | 'checkout_started'
    | 'completed'
    | 'migrated'
    | 'abandoned_detected';

export interface CartItemDelta {
    added?:       CartItem[];
    removed?:     CartItem[];
    qtyChanged?:  Array<{ productId: string; from: number; to: number }>;
}

export interface CartSnapshot {
    sessionId:    string;
    userId?:      string;
    email?:       string;
    event:        CartEventType;
    items:        CartItem[];       // full snapshot of cart at this moment
    itemsDelta?:  CartItemDelta;    // what changed vs previous state
    cartValue:    number;
    attribution?: any;
    createdAt:    number;           // Unix ms
}
