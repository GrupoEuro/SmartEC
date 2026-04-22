import { Injectable, inject, signal } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
    increment,
    DocumentReference
} from '@angular/fire/firestore';

import { Observable, map, from, tap } from 'rxjs';
import { Order, OrderStatus } from '../models/order.model';
import { StateRegistryService } from './state-registry.service';
import { InventoryLedgerService } from './inventory-ledger.service';

@Injectable({
    providedIn: 'root'
})
export class OrderService {
    private firestore = inject(Firestore);
    private stateRegistry = inject(StateRegistryService);
    private ledgerService = inject(InventoryLedgerService);

    // Inspector State
    private _ordersState = signal<Order[]>([]);

    constructor() {
        this.stateRegistry.register({
            name: 'OrderService',
            get: () => ({
                totalOrders: this._ordersState().length,
                lastUpdated: new Date(),
                orders: this._ordersState()
            })
        });
    }

    private get ordersCollection() {
        return collection(this.firestore, 'orders');
    }

    /**
     * Get all orders (ordered by date desc)
     */
    getOrders(): Observable<Order[]> {
        const q = query(this.ordersCollection, orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map((orders: any[]) => {
                console.log(`[OrderService] Fetched ${orders.length} orders from Firestore`);
                return orders.map(order => this.convertTimestamps(order));
            }),
            tap(orders => this._ordersState.set(orders))
        );
    }

    /**
     * Get orders by date range (optimized for dashboard)
     */
    getOrdersByDateRange(startDate: Date, endDate: Date): Observable<Order[]> {
        const q = query(
            this.ordersCollection,
            where('createdAt', '>=', Timestamp.fromDate(startDate)),
            where('createdAt', '<=', Timestamp.fromDate(endDate)),
            orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((orders: any[]) => {
                console.log(`[OrderService] Fetched ${orders.length} orders for date range ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
                return orders.map(order => this.convertTimestamps(order));
            })
        );
    }

    /**
     * Get orders by status
     */
    getOrdersByStatus(status: OrderStatus): Observable<Order[]> {
        const q = query(
            this.ordersCollection,
            where('status', '==', status),
            orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((orders: any[]) => orders.map(order => this.convertTimestamps(order)))
        );
    }

    /**
     * Get order by ID — real-time reactive observable
     */
    getOrderById(id: string): Observable<Order | undefined> {
        const q = query(this.ordersCollection, where('__name__', '==', id));
        return collectionData(q, { idField: 'id' }).pipe(
            map((orders: any[]) => {
                if (orders.length === 0) return undefined;
                return this.convertTimestamps(orders[0]);
            })
        );
    }

    /**
     * Get orders by customer ID
     */
    getOrdersByCustomer(customerId: string, limitCount?: number): Observable<Order[]> {
        // Query without orderBy to avoid composite index requirement
        const q = query(
            this.ordersCollection,
            where('customer.id', '==', customerId)
        );

        return collectionData(q, { idField: 'id' }).pipe(
            map((orders: any[]) => {
                // Convert timestamps first (this ensures all dates are Date objects)
                const convertedOrders = orders.map(order => this.convertTimestamps(order));

                // Sort by createdAt descending (newest first)
                // After convertTimestamps, createdAt is guaranteed to be a Date
                const sortedOrders = convertedOrders.sort((a, b) => {
                    const timeA = (a.createdAt as Date).getTime();
                    const timeB = (b.createdAt as Date).getTime();
                    return timeB - timeA;
                });

                // Apply limit after sorting if specified
                return limitCount ? sortedOrders.slice(0, limitCount) : sortedOrders;
            })
        );
    }

    /**
     * Create a new order with STOCK RESERVATION logic
     */
    async createOrder(order: Omit<Order, 'id'>): Promise<string> {
        // Track reserved items for rollback
        const reservedLog: { productId: string; quantity: number }[] = [];

        try {
            // 1. RESERVE STOCK FOR EACH ITEM
            for (const item of order.items) {
                // Fetch product to check for Kit
                const productRef = doc(this.firestore, `products/${item.productId}`);
                const productSnap = await getDocs(query(collection(this.firestore, 'products'), where('__name__', '==', item.productId))); // Cleaner way? 
                // Actually getDoc is better but I need to make sure I import it if not available or use getDocs with ID.
                // existing code uses getDocs for ID lookup sometimes. Let's use getDoc if imported, otherwise getDocs.
                // imports: getDocs, query, collection, where...

                if (productSnap.empty) throw new Error(`Product ${item.productId} not found`);
                const productData = productSnap.docs[0].data() as any; // Cast to Product

                if (productData.type === 'kit' && productData.kitComponents) {
                    // KIT LOGIC: Reserve Components
                    for (const component of productData.kitComponents) {
                        const neededQty = item.quantity * component.quantity;
                        await this.ledgerService.reserveStock(component.productId, neededQty, 'PENDING_ORDER', `Reservation for Kit ${productData.sku}`);
                        reservedLog.push({ productId: component.productId, quantity: neededQty });
                    }
                } else {
                    // SIMPLE PRODUCT LOGIC
                    await this.ledgerService.reserveStock(item.productId, item.quantity, 'PENDING_ORDER', `Reservation for Order`);
                    reservedLog.push({ productId: item.productId, quantity: item.quantity });
                }
            }

            // 2. CREATE ORDER
            const orderData = {
                ...order,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                status: 'pending' as OrderStatus,
                history: [
                    {
                        status: 'pending' as OrderStatus,
                        timestamp: Timestamp.now(),
                        note: 'Order created'
                    }
                ]
            };

            const docRef = await addDoc(this.ordersCollection, orderData);

            // 3. Rollup: persist this order into the monthly_stats aggregate (1 write, 0 reads)
            await this.updateMonthlyRollup(order, +1);

            // 4. UPDATE RESERVATIONS WITH REAL ORDER ID (Optional Polish)
            // Currently they are linked to 'PENDING_ORDER'. 
            // Ideally we update the Ledger entries' referenceId. 
            // But that's expensive. 'PENDING_ORDER' checks might be confusing.
            // Better strategy: Generate ID first? 
            // Firestore allow setDoc with custom ID.
            // Let's rely on the fact that the Order exists now.

            return docRef.id;


        } catch (error) {
            console.error('Error creating order (Rolling back reservations):', error);

            // ROLLBACK RESERVATIONS
            for (const reserved of reservedLog) {
                try {
                    await this.ledgerService.releaseStock(reserved.productId, reserved.quantity, 'ROLLBACK', 'Order Creation Failed');
                } catch (rollbackError) {
                    console.error('Critical: Failed to rollback reservation', rollbackError);
                }
            }
            throw error;
        }
    }

    /**
     * Update an order
     */
    async updateOrder(id: string, data: Partial<Order>): Promise<void> {
        try {
            const orderDoc = doc(this.firestore, `orders/${id}`);
            const updateData = {
                ...data,
                updatedAt: Timestamp.now()
            };
            await updateDoc(orderDoc, updateData);
        } catch (error) {
            console.error('Error updating order:', error);
            throw error;
        }
    }

    /**
     * Update order status
     * @param id        Firestore order document ID
     * @param status    New status
     * @param note      Optional human-readable note logged in timeline
     * @param updates   Optional carrier / trackingNumber fields
     * @param actor     Who is making this change — defaults to SYSTEM if omitted
     */
    async updateStatus(
        id: string,
        status: OrderStatus,
        note?: string,
        updates?: { carrier?: string, trackingNumber?: string },
        actor?: { uid: string; displayName: string; role: string }
    ): Promise<void> {
        try {
            const orderDoc = doc(this.firestore, `orders/${id}`);

            // First get the current order to append history
            const currentOrderSnap = await getDocs(query(this.ordersCollection, where('__name__', '==', id)));
            if (currentOrderSnap.empty) throw new Error('Order not found');

            const currentOrder = currentOrderSnap.docs[0].data() as Order;
            const history = currentOrder.history || [];
            const previousStatus = currentOrder.status;

            // INVENTORY LOGIC: Handle Stock Deduction/Restock
            if (previousStatus !== status) {
                // 1. SHIPMENT (Deduct Stock)
                if (status === 'shipped' && previousStatus !== 'shipped') {
                    for (const item of currentOrder.items) {
                        try {
                            await this.ledgerService.logTransaction(
                                item.productId,
                                'SALE',
                                -item.quantity, // Negative for OUT
                                0, // Unit Cost (Ledger uses AvgCost)
                                id,
                                'ORDER',
                                `Order Shipped: ${id}`
                            );
                        } catch (err) {
                            console.error(`Failed to deduct stock for ${item.productId}:`, err);
                        }
                    }
                }
                // 2. RETURN/CANCELLATION (Restock if it was previously shipped)
                else if ((status === 'cancelled' || status === 'refunded') && previousStatus === 'shipped') {
                    for (const item of currentOrder.items) {
                        try {
                            await this.ledgerService.logTransaction(
                                item.productId,
                                'RETURN_IN', // Restock
                                item.quantity, // Positive for IN
                                0, // Use current avg cost
                                id,
                                'RETURN',
                                `Order ${status}: ${id}`
                            );
                        } catch (err) {
                            console.error(`Failed to restock ${item.productId}:`, err);
                        }
                    }
                }
            }

            // Build the resolved actor — defaults to SYSTEM when called without user context
            const resolvedActor = actor ?? { uid: 'system', displayName: 'Sistema', role: 'SYSTEM' };

            const newHistoryItem = {
                status,
                timestamp:       Timestamp.now(),
                note:            note || `Status updated to ${status}`,
                // Legacy field (kept for backward compat)
                updatedBy:       resolvedActor.uid,
                // Structured actor (new — shown in timeline as "by [name]")
                updatedByActor:  resolvedActor,
                action:          'status_change' as const,
                ...(updates?.carrier        && { carrier:        updates.carrier }),
                ...(updates?.trackingNumber && { trackingNumber: updates.trackingNumber }),
            };

            const updateData: any = {
                status,
                updatedAt: Timestamp.now(),
                history: [...history, newHistoryItem]
            };

            // Add extra updates if provided (e.g. tracking info)
            if (updates) {
                if (updates.carrier)        updateData.carrier        = updates.carrier;
                if (updates.trackingNumber) updateData.trackingNumber = updates.trackingNumber;
            }

            await updateDoc(orderDoc, updateData);

            // Monthly rollup: adjust revenue when order enters or leaves a cancelled/refunded state.
            const VOID_STATUSES: OrderStatus[] = ['cancelled', 'refunded', 'returned'];
            const wasVoid  = VOID_STATUSES.includes(previousStatus);
            const isVoid   = VOID_STATUSES.includes(status);
            if (!wasVoid && isVoid) {
                // Order is being cancelled/refunded → subtract its revenue from the rollup
                await this.updateMonthlyRollup(currentOrder, -1);
            } else if (wasVoid && !isVoid) {
                // Order is being restored from cancelled → re-add revenue
                await this.updateMonthlyRollup(currentOrder, +1);
            }

        } catch (error) {

            console.error('Error updating order status:', error);
            throw error;
        }
    }

    /**
     * Atomically update the monthly_stats/YYYY-MM rollup document.
     *
     * delta = +1  → add this order's contribution
     * delta = -1  → subtract (cancellation / refund)
     *
     * Uses setDoc({ merge: true }) + increment() so:
     *   • No reads required
     *   • Concurrent writes are safe (Firestore server-side increment)
     *   • Document is auto-created on first use
     */
    private async updateMonthlyRollup(order: Omit<Order, 'id'> | Order, delta: 1 | -1): Promise<void> {
        try {
            // Determine the month from order.createdAt (may be a Date, Timestamp, or null)
            const createdAt: any = (order as any).createdAt;
            let date: Date;
            if (createdAt instanceof Date)       date = createdAt;
            else if (createdAt?.toDate)          date = createdAt.toDate();
            else                                 date = new Date();

            const yyyyMm = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const channel = (order as any).sourceChannel ?? 'storefront';

            // Revenue only counts for non-void orders (the caller controls delta direction)
            const salesDelta = (order.total ?? 0) * delta;
            const piecesDelta = (order.items ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0) * delta;

            const rollupRef = doc(this.firestore, `monthly_stats/${yyyyMm}`);
            await setDoc(rollupRef, {
                sales:   increment(salesDelta),
                orders:  increment(delta),       // +1 or -1 to total order count
                pieces:  increment(piecesDelta),
                byChannel: {
                    [channel]: increment(salesDelta),
                },
                updatedAt: Timestamp.now(),
            }, { merge: true });
        } catch (err) {
            // Non-critical — log but never throw; the order itself has already been written
            console.warn('[OrderService] monthly_stats rollup write failed (non-critical):', err);
        }
    }

    /**
     * Convert Firestore Timestamps to Date objects.
     * Also synthesizes a minimum history for legacy orders.
     */
    private convertTimestamps(order: any): Order {
        const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : (order.createdAt ? new Date(order.createdAt) : new Date());
        const updatedAt = order.updatedAt?.toDate ? order.updatedAt.toDate() : (order.updatedAt ? new Date(order.updatedAt) : createdAt);

        let history = (order.history || []).map((h: any) => ({
            ...h,
            timestamp: h.timestamp?.toDate ? h.timestamp.toDate() : (h.timestamp ? new Date(h.timestamp) : new Date())
        }));

        // For legacy orders with no history, synthesize one from available data
        if (history.length === 0) {
            history.push({
                status: 'pending',
                timestamp: createdAt,
                note: 'Order created',
                updatedBy: 'system'
            });

            // If the order has already progressed past pending, add a synthetic final entry
            const terminalStatuses = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned'];
            if (terminalStatuses.includes(order.status) && order.status !== 'pending') {
                history.push({
                    status: order.status,
                    timestamp: updatedAt,
                    note: `Status: ${order.status}`,
                    updatedBy: 'system'
                });
            }
        }

        return {
            ...order,
            createdAt,
            updatedAt,
            history
        };
    }
}
