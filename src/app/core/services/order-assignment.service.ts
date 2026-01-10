import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, updateDoc, doc, query, where, getDocs, Timestamp, orderBy } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { OrderAssignment } from '../models/order-assignment.model';

@Injectable({
    providedIn: 'root'
})
export class OrderAssignmentService {
    private firestore = inject(Firestore);
    private assignmentsCollection = collection(this.firestore, 'orderAssignments');

    /**
     * Assign an order to a user
     */
    async assignOrder(
        orderId: string,
        assignedTo: string,
        assignedToName: string,
        assignedBy: string,
        assignedByName: string,
        notes?: string
    ): Promise<string> {
        const assignment: Omit<OrderAssignment, 'id'> = {
            orderId,
            assignedTo,
            assignedToName,
            assignedBy,
            assignedByName,
            assignedAt: Timestamp.now(),
            status: 'assigned',
            notes
        };

        const docRef = await addDoc(this.assignmentsCollection, assignment);
        return docRef.id;
    }

    /**
     * Reassign an order to a different user
     */
    async reassignOrder(
        assignmentId: string,
        newAssignedTo: string,
        newAssignedToName: string,
        reassignedBy: string,
        reassignedByName: string
    ): Promise<void> {
        const assignmentRef = doc(this.firestore, 'orderAssignments', assignmentId);
        await updateDoc(assignmentRef, {
            assignedTo: newAssignedTo,
            assignedToName: newAssignedToName,
            assignedBy: reassignedBy,
            assignedByName: reassignedByName,
            assignedAt: Timestamp.now()
        });
    }

    /**
     * Update assignment status
     */
    async updateStatus(assignmentId: string, status: OrderAssignment['status']): Promise<void> {
        const assignmentRef = doc(this.firestore, 'orderAssignments', assignmentId);
        const updateData: any = { status };

        if (status === 'completed') {
            updateData.completedAt = Timestamp.now();
        }

        await updateDoc(assignmentRef, updateData);
    }

    /**
     * Get assignments for a specific user
     */
    getMyOrders(userId: string): Observable<OrderAssignment[]> {
        const q = query(
            this.assignmentsCollection,
            where('assignedTo', '==', userId),
            where('status', 'in', ['assigned', 'in-progress']),
            orderBy('assignedAt', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as OrderAssignment)))
        );
    }

    /**
     * Get assignment for a specific order
     */
    getOrderAssignment(orderId: string): Observable<OrderAssignment | null> {
        const q = query(
            this.assignmentsCollection,
            where('orderId', '==', orderId),
            where('status', 'in', ['assigned', 'in-progress'])
        );

        return from(getDocs(q)).pipe(
            map(snapshot => {
                if (snapshot.empty) return null;
                const doc = snapshot.docs[0];
                return { id: doc.id, ...doc.data() } as OrderAssignment;
            })
        );
    }

    /**
     * Get unassigned orders (orders without active assignments)
     */
    async getUnassignedOrderIds(allOrderIds: string[]): Promise<string[]> {
        const q = query(
            this.assignmentsCollection,
            where('status', 'in', ['assigned', 'in-progress'])
        );

        const snapshot = await getDocs(q);
        const assignedOrderIds = new Set(snapshot.docs.map(doc => doc.data()['orderId']));

        return allOrderIds.filter(id => !assignedOrderIds.has(id));
    }
}
