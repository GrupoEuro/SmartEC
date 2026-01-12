import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, updateDoc, deleteDoc, query, where, orderBy, getDocs, getDoc, writeBatch, Timestamp, onSnapshot } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import {
    AdvancedShippingNotice,
    GoodsReceiptNote,
    PutawayTask,
    ASNStatus,
    GRNItem,
    CreateASN,
    CreateGRN,
    CreatePutawayTask,
    PutawayStatus
} from '../models/receiving.model';

@Injectable({
    providedIn: 'root'
})
export class ReceivingService {
    private firestore = inject(Firestore);

    // ============================================
    // ASN Management
    // ============================================

    /**
     * Get all ASNs for a warehouse, optionally filtered by status
     */
    getASNs(warehouseId: string, status?: ASNStatus): Observable<AdvancedShippingNotice[]> {
        return new Observable(observer => {
            const asnCollection = collection(this.firestore, 'receiving_asns');
            let q = query(
                asnCollection,
                where('warehouseId', '==', warehouseId),
                orderBy('expectedDate', 'desc')
            );

            if (status) {
                q = query(q, where('status', '==', status));
            }

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const asns = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as AdvancedShippingNotice));
                observer.next(asns);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Get single ASN by ID
     */
    getASNById(id: string): Observable<AdvancedShippingNotice | null> {
        return new Observable(observer => {
            const asnDoc = doc(this.firestore, `receiving_asns/${id}`);
            const unsubscribe = onSnapshot(asnDoc, (snapshot) => {
                if (snapshot.exists()) {
                    observer.next({ id: snapshot.id, ...snapshot.data() } as AdvancedShippingNotice);
                } else {
                    observer.next(null);
                }
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Create a new ASN
     */
    async createASN(asnData: CreateASN): Promise<string> {
        const asnId = doc(collection(this.firestore, 'receiving_asns')).id;
        const now = Timestamp.now();

        const asn: AdvancedShippingNotice = {
            ...asnData,
            id: asnId,
            createdAt: now,
            updatedAt: now,
            items: asnData.items.map(item => ({ ...item, receivedQuantity: 0 }))
        };

        await setDoc(doc(this.firestore, `receiving_asns/${asnId}`), asn);
        return asnId;
    }

    /**
     * Update ASN
     */
    async updateASN(id: string, updates: Partial<AdvancedShippingNotice>): Promise<void> {
        const asnRef = doc(this.firestore, `receiving_asns/${id}`);
        await updateDoc(asnRef, {
            ...updates,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Update received quantities in ASN
     */
    async updateASNReceivedQuantities(id: string, receivedItems: { productId: string, quantity: number }[]): Promise<void> {
        const asnRef = doc(this.firestore, `receiving_asns/${id}`);
        const asnSnap = await getDoc(asnRef);

        if (!asnSnap.exists()) throw new Error('ASN not found');

        const asn = asnSnap.data() as AdvancedShippingNotice;
        const updatedItems = asn.items.map(item => {
            const received = receivedItems.find(r => r.productId === item.productId);
            if (received) {
                return { ...item, receivedQuantity: item.receivedQuantity + received.quantity };
            }
            return item;
        });

        // Check if fully received
        const allReceived = updatedItems.every(item => item.receivedQuantity >= item.expectedQuantity);
        const anyReceived = updatedItems.some(item => item.receivedQuantity > 0);

        await updateDoc(asnRef, {
            items: updatedItems,
            status: allReceived ? 'received' : (anyReceived ? 'partial' : 'pending'),
            updatedAt: Timestamp.now()
        });
    }

    // ============================================
    // GRN Operations
    // ============================================

    /**
     * Create Goods Receipt Note
     */
    async createGRN(grnData: CreateGRN): Promise<string> {
        const grnId = doc(collection(this.firestore, 'receiving_grns')).id;
        const now = Timestamp.now();

        const grn: GoodsReceiptNote = {
            ...grnData,
            id: grnId,
            createdAt: now
        };

        await setDoc(doc(this.firestore, `receiving_grns/${grnId}`), grn);

        // Update ASN if linked
        if (grnData.asnId) {
            const receivedItems = grnData.items.map(item => ({
                productId: item.productId,
                quantity: item.quantityAccepted
            }));
            await this.updateASNReceivedQuantities(grnData.asnId, receivedItems);
        }

        return grnId;
    }

    /**
     * Get GRNs for warehouse
     */
    getGRNs(warehouseId: string, limit?: number): Observable<GoodsReceiptNote[]> {
        return new Observable(observer => {
            const grnCollection = collection(this.firestore, 'receiving_grns');
            let q = query(
                grnCollection,
                where('warehouseId', '==', warehouseId),
                orderBy('receivedDate', 'desc')
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                let grns = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as GoodsReceiptNote));

                if (limit) grns = grns.slice(0, limit);

                observer.next(grns);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Complete GRN (mark as completed)
     */
    async completeGRN(grnId: string): Promise<void> {
        const grnRef = doc(this.firestore, `receiving_grns/${grnId}`);
        await updateDoc(grnRef, {
            status: 'completed',
            updatedAt: Timestamp.now()
        });
    }

    // ============================================
    // Putaway Operations
    // ============================================

    /**
     * Generate putaway tasks from GRN
     */
    async generatePutawayTasks(grnId: string): Promise<PutawayTask[]> {
        const grnRef = doc(this.firestore, `receiving_grns/${grnId}`);
        const grnSnap = await getDoc(grnRef);

        if (!grnSnap.exists()) throw new Error('GRN not found');

        const grn = grnSnap.data() as GoodsReceiptNote;
        const tasks: PutawayTask[] = [];
        const batch = writeBatch(this.firestore);

        for (const item of grn.items) {
            if (item.qualityStatus === 'passed' && item.quantityAccepted > 0) {
                const taskId = doc(collection(this.firestore, 'putaway_tasks')).id;
                const suggestedBin = await this.suggestBinLocation(item.productId, item.quantityAccepted, grn.warehouseId);

                const task: PutawayTask = {
                    id: taskId,
                    grnId: grn.id!,
                    grnNumber: grn.grnNumber,
                    warehouseId: grn.warehouseId,
                    productId: item.productId,
                    productSku: item.productSku,
                    productName: item.productName,
                    quantity: item.quantityAccepted,
                    fromLocation: 'RECEIVING_DOCK',
                    suggestedLocation: suggestedBin,
                    status: 'pending',
                    priority: 'medium',
                    createdAt: Timestamp.now()
                };

                tasks.push(task);
                batch.set(doc(this.firestore, `putaway_tasks/${taskId}`), task);
            }
        }

        await batch.commit();
        return tasks;
    }

    /**
     * Get putaway tasks
     */
    getPutawayTasks(warehouseId: string, status?: PutawayStatus): Observable<PutawayTask[]> {
        return new Observable(observer => {
            const taskCollection = collection(this.firestore, 'putaway_tasks');
            let q = query(
                taskCollection,
                where('warehouseId', '==', warehouseId),
                orderBy('priority', 'asc'),
                orderBy('createdAt', 'asc')
            );

            if (status) {
                q = query(q, where('status', '==', status));
            }

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const tasks = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as PutawayTask));
                observer.next(tasks);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Complete putaway task
     */
    async completePutaway(taskId: string, actualLocation: string, userId: string): Promise<void> {
        const taskRef = doc(this.firestore, `putaway_tasks/${taskId}`);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) throw new Error('Putaway task not found');

        const task = taskSnap.data() as PutawayTask;

        // Update inventory in the bin
        await this.updateInventory(task.productId, actualLocation, task.quantity, task.warehouseId);

        // Mark task as completed
        await updateDoc(taskRef, {
            status: 'completed',
            actualLocation,
            completedAt: Timestamp.now()
        });

        // Update GRN item with bin location
        await this.updateGRNItemLocation(task.grnId, task.productId, actualLocation);
    }

    // ============================================
    // Helper Methods
    // ============================================

    /**
     * Suggest optimal bin location for product
     * (Simplified - can be enhanced with AI/ML)
     */
    private async suggestBinLocation(productId: string, quantity: number, warehouseId: string): Promise<string> {
        // TODO: Implement smarter logic (ABC analysis, bin capacity, proximity)
        // For now, find first available bin with capacity

        const locationsCollection = collection(this.firestore, 'warehouse_locations');
        const q = query(
            locationsCollection,
            where('warehouseId', '==', warehouseId),
            where('occupied', '==', false),
            orderBy('code', 'asc')
        );

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data()['code'] || 'A1-L1-B1';
        }

        return 'A1-L1-B1'; // Default fallback
    }

    /**
     * Update inventory in specific bin
     */
    private async updateInventory(productId: string, binCode: string, quantity: number, warehouseId: string): Promise<void> {
        // Find the bin location
        const locationsCollection = collection(this.firestore, 'warehouse_locations');
        const q = query(
            locationsCollection,
            where('warehouseId', '==', warehouseId),
            where('code', '==', binCode)
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) throw new Error(`Bin ${binCode} not found`);

        const binDoc = snapshot.docs[0];
        await updateDoc(binDoc.ref, {
            productId,
            quantity,
            occupied: true,
            lastUpdated: Timestamp.now()
        });
    }

    /**
     * Update GRN item with actual bin location
     */
    private async updateGRNItemLocation(grnId: string, productId: string, binLocation: string): Promise<void> {
        const grnRef = doc(this.firestore, `receiving_grns/${grnId}`);
        const grnSnap = await getDoc(grnRef);

        if (!grnSnap.exists()) return;

        const grn = grnSnap.data() as GoodsReceiptNote;
        const updatedItems = grn.items.map(item =>
            item.productId === productId ? { ...item, binLocation } : item
        );

        await updateDoc(grnRef, { items: updatedItems });
    }

    /**
     * Generate next ASN number
     */
    async generateASNNumber(): Promise<string> {
        const prefix = 'ASN';
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `${prefix}-${date}-${random}`;
    }

    /**
     * Generate next GRN number
     */
    async generateGRNNumber(): Promise<string> {
        const prefix = 'GRN';
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `${prefix}-${date}-${random}`;
    }
}
