import { Timestamp } from '@angular/fire/firestore';

export type InventoryTransactionType =
    | 'PURCHASE'        // Buying from supplier (In)
    | 'SALE'            // Selling to customer (Out)
    | 'ADJUSTMENT'      // Manual correction (+/-)
    | 'RETURN_IN'       // Customer return (In)
    | 'RETURN_OUT'      // Return to supplier (Out)
    | 'TRANSFER_IN'     // From another warehouse (In)
    | 'TRANSFER_OUT'    // To another warehouse (Out)
    | 'INITIAL_LOAD'    // Opening balance
    | 'RESERVE_STOCK'   // Hard Allocation (Hold)
    | 'RELEASE_STOCK';  // Release Hold (Cancel)

export interface KardexEntry {
    id?: string;
    productId: string;
    warehouseId: string; // Default: 'MAIN'

    type: InventoryTransactionType;
    date: Timestamp | Date;

    // Quantity Movement
    quantityChange: number; // Positive for IN, Negative for OUT (For RESERVE, this is the amount reserved)
    balanceAfter: number;   // Running balance snapshot

    // Financials (Per Unit)
    unitCost: number;       // Cost of this specific batch/transaction
    averageCostBefore: number;
    averageCostAfter: number; // Updated Weighted Average Cost

    // Context
    referenceId?: string;   // PO ID, Order ID, Adjustment ID
    referenceType?: 'ORDER' | 'PURCHASE_ORDER' | 'ADJUSTMENT' | 'RETURN';
    userId: string;         // Who performed the action
    notes?: string;

    // Audit
    createdAt: Timestamp | Date;
}

export interface InventoryBalance {
    productId: string;
    warehouseId: string;
    quantity: number;        // Physical Count
    reservedQuantity?: number; // Allocated but not shipped
    availableQuantity?: number; // quantity - reservedQuantity
    averageCost: number;
    totalValue: number; // quantity * averageCost
    lastUpdated: Timestamp | Date;
}
