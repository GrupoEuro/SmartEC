import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    addDoc,
    doc,
    runTransaction,
    Timestamp,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp
} from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { KardexEntry, InventoryBalance, InventoryTransactionType } from '../models/inventory-ledger.model';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class InventoryLedgerService {
    private firestore = inject(Firestore);
    private auth = inject(AuthService);

    /**
     * THE ENGINE: Logs a transaction and updates balances atomically.
     * This is the single source of truth for inventory changes.
     */
    async logTransaction(
        productId: string,
        type: InventoryTransactionType,
        quantityChange: number,
        unitCost: number, // For PURCHASE, this is the purchase price. For SALE, it's usually current AvgCost.
        referenceId: string,
        referenceType: 'ORDER' | 'PURCHASE_ORDER' | 'ADJUSTMENT' | 'RETURN',
        notes?: string,
        warehouseId: string = 'MAIN'
    ): Promise<string> {

        // 1. Prepare References
        const ledgerRef = collection(this.firestore, 'inventory_ledger');
        const balanceRef = doc(this.firestore, `inventory_balances/${productId}_${warehouseId}`);
        const productRef = doc(this.firestore, `products/${productId}`);

        // Get current user
        const userId = this.auth.currentUser()?.uid || 'SYSTEM';

        return await runTransaction(this.firestore, async (transaction) => {
            // 2. Read Current State (Must be first in transaction)
            const balanceDoc = await transaction.get(balanceRef);
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists()) {
                throw new Error(`Product ${productId} does not exist.`);
            }

            // Initialize balance if new
            let currentQty = 0;
            let currentReserved = 0;
            let currentAvailable = 0;
            let currentAvgCost = 0;
            let currentTotalValue = 0;

            if (balanceDoc.exists()) {
                const data = balanceDoc.data() as InventoryBalance;
                currentQty = data.quantity || 0;
                currentReserved = data.reservedQuantity || 0;
                // If availableQuantity missing, recalc
                currentAvailable = data.availableQuantity !== undefined ? data.availableQuantity : (currentQty - currentReserved);

                currentAvgCost = data.averageCost || 0;
                currentTotalValue = data.totalValue || 0;
            } else {
                // Fallback to Product data if no balance record exists yet (Migration support)
                const pData = productDoc.data();
                currentQty = pData['stockQuantity'] || 0;
                currentReserved = 0; // Default new
                currentAvailable = currentQty;
                currentAvgCost = pData['averageCost'] || pData['costPrice'] || 0;
                currentTotalValue = currentQty * currentAvgCost;
            }

            // 3. Calculate New State
            let newQty = currentQty;
            let newReserved = currentReserved;
            let newAvailable = currentAvailable;
            let quantityChangeForLedger = quantityChange;

            // --- TYPE SPECIFIC LOGIC ---
            switch (type) {
                case 'RESERVE_STOCK':
                    // Just holding stock. Physical unchanged.
                    // QtyChange is the amount to RESERVE (+).
                    if (currentAvailable < quantityChange) {
                        throw new Error(`Insufficient Available Stock for Reservation. Available: ${currentAvailable}, Requested: ${quantityChange}`);
                    }
                    newReserved += quantityChange;
                    newAvailable -= quantityChange;
                    // Ledger "Quantity Change" for Reserve is purely informational or treated as 0 for balance calculation?
                    // Actually, Ledger Entry usually tracks Physical Movement.
                    // For Reserve, we want to track the Reserved Amount.
                    // But balanceAfter should be Physical Balance?
                    // Let's keep balanceAfter as Physical Balance.
                    break;

                case 'RELEASE_STOCK':
                    // Release hold. QtyChange is amount to Release (+).
                    // Logic: Reserved - Qty. Available + Qty.
                    if (currentReserved < quantityChange) {
                        console.warn(`Releasing more than reserved. Current Reserved: ${currentReserved}`);
                        newReserved = 0;
                    } else {
                        newReserved -= quantityChange;
                    }
                    newAvailable += quantityChange; // Technically capped by physical
                    if (newAvailable > newQty) newAvailable = newQty;
                    break;

                case 'SALE':
                    // Standard Sale (Deduction).
                    // If this sale comes from an Order, it might have been Reserved.
                    // Strategy: We ALWAYS consume reservation first if it exists?
                    // Simple Logic:
                    // Physical -= Qty.
                    // If Reserved > 0, Reserved -= Qty. (Assuming we shipped a reserved item)
                    // Available: (Physical - Reserved).
                    // Note: 'quantityChange' for SALE is usually NEGATIVE (-1).
                    // But typically passed as -1.
                    const deduction = Math.abs(quantityChange);
                    newQty -= deduction;

                    // Consume Reservation logic
                    if (newReserved >= deduction) {
                        newReserved -= deduction;
                        // Available stays same (Net 0 change to available? Reserved down, Physical down)
                        // Old Avail = P - R
                        // New Avail = (P-d) - (R-d) = P - R. Correct.
                    } else {
                        // We sold more than reserved (or didn't reserve).
                        const remainder = deduction - newReserved;
                        newReserved = 0;
                        newAvailable -= remainder;
                    }
                    break;

                case 'PURCHASE':
                case 'RETURN_IN':
                case 'INITIAL_LOAD':
                case 'ADJUSTMENT':
                case 'TRANSFER_IN':
                case 'TRANSFER_OUT':
                case 'RETURN_OUT':
                default:
                    // Standard Physical Movement
                    newQty += quantityChange;
                    newAvailable = newQty - newReserved;
                    break;
            }

            if (newQty < 0) {
                throw new Error(`Insufficient stock for Product ${productId}. Current: ${currentQty}, Requested Change: ${quantityChange}`);
            }

            let newAvgCost = currentAvgCost;

            // WEIGHTED AVERAGE COST LOGIC
            // Only PURCHASE or POSITIVE ADJUSTMENTS usually change the Average Cost (if cost differs)
            // RESERVE/RELEASE do not change cost.
            if (type !== 'RESERVE_STOCK' && type !== 'RELEASE_STOCK') {
                if (quantityChange > 0 && unitCost > 0) {
                    const incomingValue = quantityChange * unitCost;
                    const totalValue = currentTotalValue + incomingValue;
                    newAvgCost = totalValue / newQty;
                }
            }

            // Recalculate Total Value
            const newTotalValue = newQty * newAvgCost;

            // 4. Create Ledger Entry
            const entry: KardexEntry = {
                productId,
                warehouseId,
                type,
                date: Timestamp.now(),
                quantityChange, // For Reserve, this is (+) amount reserved. For Sale, (-) amount sold.
                balanceAfter: newQty, // Physical Balance
                unitCost: unitCost,
                averageCostBefore: currentAvgCost,
                averageCostAfter: newAvgCost,
                referenceId,
                referenceType,
                userId,
                notes,
                createdAt: Timestamp.now()
            };

            // 5. Writes
            const newLedgerDocRef = doc(ledgerRef);
            transaction.set(newLedgerDocRef, { ...entry, id: newLedgerDocRef.id });

            // Update Balance Record
            const balanceUpdate: InventoryBalance = {
                productId,
                warehouseId,
                quantity: newQty,
                reservedQuantity: newReserved,
                availableQuantity: newAvailable,
                averageCost: newAvgCost,
                totalValue: newTotalValue,
                lastUpdated: Timestamp.now()
            };
            transaction.set(balanceRef, balanceUpdate); // Upsert

            // --- MULTI-LOCATION PRODUCT UPDATE ---
            // 1. Update the specific location bucket
            // 2. We ideally want to re-sum total stock. 
            //    Since we can't easily query ALL balances inside a transaction without knowing them,
            //    we will enforce a rule: 'stockQuantity' in Product is an AGGREGATE.
            //    
            //    Optimization: We can read the OLD product data, subtract the OLD location stock, adds the NEW location stock.

            const productData = productDoc.data() as any;
            const currentInventoryMap = productData.inventory || {};
            const oldLocationData = currentInventoryMap[warehouseId] || { stock: 0, reserved: 0, available: 0 };

            // Calculate Aggregates Deltas
            const deltaStock = newQty - (oldLocationData.stock || 0);
            const deltaReserved = newReserved - (oldLocationData.reserved || 0);
            const deltaAvailable = newAvailable - (oldLocationData.available || 0);
            const deltaValue = newTotalValue - (oldLocationData.totalValue || 0); // Warning: oldLocationData might not store Value

            // New Aggregate Values
            const newTotalStock = (productData.stockQuantity || 0) + deltaStock;
            const newTotalAvailable = (productData.availableStock || 0) + deltaAvailable;

            // Build the Update Object with Dot Notation
            // "inventory.MAIN" = { ... }
            const updates: any = {
                stockQuantity: newTotalStock,
                availableStock: newTotalAvailable,
                // averageCost: newAvgCost, // Global Avg Cost? Or Per Warehouse? Keeping Global for now.
                updatedAt: Timestamp.now(),
                [`inventory.${warehouseId}`]: {
                    stock: newQty,
                    reserved: newReserved,
                    available: newAvailable
                }
            };

            // If MAIN warehouse, update primary cost fields (Business Logic Decision)
            if (warehouseId === 'MAIN') {
                updates.averageCost = newAvgCost;
                updates.totalInventoryValue = newTotalStock * newAvgCost; // Approx
            }

            transaction.update(productRef, updates);

            return newLedgerDocRef.id;
        });
    }

    /**
     * Get current balance for a product
     */
    getBalance(productId: string, warehouseId: string = 'MAIN'): Observable<InventoryBalance | null> {
        const ref = doc(this.firestore, `inventory_balances/${productId}_${warehouseId}`);
        return from(getDocs(query(collection(this.firestore, 'inventory_balances'), where('productId', '==', productId), where('warehouseId', '==', warehouseId), limit(1)))).pipe(
            map(snapshot => {
                if (snapshot.empty) return null;
                return snapshot.docs[0].data() as InventoryBalance;
            })
        );
    }

    /**
     * Get Kardex History
     */
    getHistory(productId: string, limitCount: number = 50): Observable<KardexEntry[]> {
        const ledgerRef = collection(this.firestore, 'inventory_ledger');
        const q = query(
            ledgerRef,
            where('productId', '==', productId),
            orderBy('date', 'desc'),
            limit(limitCount)
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(d => d.data() as KardexEntry))
        );
    }

    /**
     * Reserve stock for an Order (Hard Allocation)
     */
    async reserveStock(productId: string, quantity: number, orderId: string, notes?: string): Promise<string> {
        return this.logTransaction(
            productId,
            'RESERVE_STOCK',
            quantity, // Positive amount to reserve
            0, // No cost change
            orderId,
            'ORDER',
            notes
        );
    }

    /**
     * Release reserved stock (Cancel Order / Timeout)
     */
    async releaseStock(productId: string, quantity: number, orderId: string, notes?: string): Promise<string> {
        return this.logTransaction(
            productId,
            'RELEASE_STOCK',
            quantity, // Positive amount to release back to available
            0,
            orderId,
            'ORDER',
            notes
        );
    }
}
