
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { PurchaseOrder } from '../models/purchase-order.model';

@Injectable({
    providedIn: 'root'
})
export class ProcurementService {
    private firestore = inject(Firestore);
    private poCollection = collection(this.firestore, 'purchase_orders');

    /**
     * Fetches active international orders that are 'in-flight' (not draft, not fully received/cancelled)
     */
    getActiveInboundOrders(): Observable<PurchaseOrder[]> {
        const q = query(
            this.poCollection,
            where('status', 'in', ['placed', 'manufacturing', 'ready_to_ship', 'shipped', 'customs_hold', 'customs_cleared', 'last_mile']),
            orderBy('estimatedArrivalDate', 'asc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => {
                return snapshot.docs.map(doc => {
                    const data = doc.data();
                    // Convert Firestore Timestamps to Dates for UI consistency
                    return {
                        ...data,
                        id: doc.id,
                        createdAt: data['createdAt']?.toDate(),
                        updatedAt: data['updatedAt']?.toDate(),
                        estimatedArrivalDate: data['estimatedArrivalDate']?.toDate(),
                        timeline: (data['timeline'] || []).map((t: any) => ({
                            ...t,
                            timestamp: t.timestamp?.toDate ? t.timestamp.toDate() : new Date(t.timestamp)
                        }))
                    } as PurchaseOrder;
                });
            })
        );
    }

    async getOrderByPoNumber(poNumber: string): Promise<PurchaseOrder | null> {
        // Implementation placeholder
        return null;
    }
}
