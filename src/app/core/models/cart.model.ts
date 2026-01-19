import { Product } from './product.model';

export interface CartItem {
    product: Product;
    quantity: number;
    addedAt: number; // Timestamp for analytics
}

export interface CartState {
    items: CartItem[];
    updatedAt: number;
}
