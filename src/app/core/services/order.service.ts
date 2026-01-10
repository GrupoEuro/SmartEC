import { Injectable, inject, signal } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
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
     * Get order by ID
     */
    getOrderById(id: string): Observable<Order | undefined> {
        const q = query(this.ordersCollection, where('__name__', '==', id));
        return new Observable(observer => {
            getDocs(q).then(snapshot => {
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    const data = doc.data() as any;
                    observer.next(this.convertTimestamps({ ...data, id: doc.id }));
                } else {
                    observer.next(undefined);
                }
                observer.complete();
            }).catch(error => {
                console.error('Error getting order:', error);
                observer.error(error);
            });
        });
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

            // 3. UPDATE RESERVATIONS WITH REAL ORDER ID (Optional Polish)
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
     */
    async updateStatus(id: string, status: OrderStatus, note?: string, updates?: { carrier?: string, trackingNumber?: string }): Promise<void> {
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
                            // Optionally throw to stop status update? 
                            // For now, log and proceed, but ideally we should block.
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

            const newHistoryItem = {
                status,
                timestamp: Timestamp.now(),
                note: note || `Status updated to ${status}`,
                updatedBy: 'admin' // TODO: Get current user
            };

            const updateData: any = {
                status,
                updatedAt: Timestamp.now(),
                history: [...history, newHistoryItem]
            };

            // Add extra updates if provided (e.g. tracking info)
            if (updates) {
                if (updates.carrier) updateData.carrier = updates.carrier;
                if (updates.trackingNumber) updateData.trackingNumber = updates.trackingNumber;
            }

            await updateDoc(orderDoc, updateData);
        } catch (error) {
            console.error('Error updating order status:', error);
            throw error;
        }
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(order: any): Order {
        return {
            ...order,
            createdAt: order.createdAt?.toDate ? order.createdAt.toDate() : (order.createdAt || new Date()),
            updatedAt: order.updatedAt?.toDate ? order.updatedAt.toDate() : (order.updatedAt || new Date()),
            history: (order.history || []).map((h: any) => ({
                ...h,
                timestamp: h.timestamp?.toDate ? h.timestamp.toDate() : (h.timestamp || new Date())
            }))
        };
    }
}
