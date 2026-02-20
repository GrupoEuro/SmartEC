import { Injectable, inject } from '@angular/core';
import { Firestore, collection, setDoc, updateDoc, doc, query, where, getDocs, Timestamp, orderBy, getDoc } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { OrderPriority, PriorityLevel, PriorityConfig, DEFAULT_PRIORITY_CONFIG } from '../models/order-priority.model';

@Injectable({
    providedIn: 'root'
})
export class OrderPriorityService {
    private firestore = inject(Firestore);
    private prioritiesCollection = collection(this.firestore, 'orderPriorities');
    private config: PriorityConfig = DEFAULT_PRIORITY_CONFIG;

    /**
     * Set or update priority for an order
     */
    async setPriority(
        orderId: string,
        level: PriorityLevel,
        orderCreatedAt: Timestamp
    ): Promise<void> {
        const slaHours = this.config[level];
        const slaDate = new Date(orderCreatedAt.toMillis() + (slaHours * 60 * 60 * 1000));
        const sla = Timestamp.fromDate(slaDate);

        const orderAge = this.calculateOrderAge(orderCreatedAt);
        const isOverdue = Timestamp.now().toMillis() > sla.toMillis();

        const priority: OrderPriority = {
            orderId,
            level,
            sla,
            orderAge,
            isOverdue,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        };

        const priorityRef = doc(this.firestore, 'orderPriorities', orderId);
        await setDoc(priorityRef, priority);
    }

    /**
     * Update priority level for an order
     */
    async updatePriorityLevel(
        orderId: string,
        level: PriorityLevel,
        orderCreatedAt: Timestamp
    ): Promise<void> {
        const slaHours = this.config[level];
        const slaDate = new Date(orderCreatedAt.toMillis() + (slaHours * 60 * 60 * 1000));
        const sla = Timestamp.fromDate(slaDate);

        const orderAge = this.calculateOrderAge(orderCreatedAt);
        const isOverdue = Timestamp.now().toMillis() > sla.toMillis();

        const priorityRef = doc(this.firestore, 'orderPriorities', orderId);
        await updateDoc(priorityRef, {
            level,
            sla,
            orderAge,
            isOverdue,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Recalculate order age and overdue status
     */
    async recalculatePriority(orderId: string, orderCreatedAt: Timestamp): Promise<void> {
        const priorityRef = doc(this.firestore, 'orderPriorities', orderId);
        const priorityDoc = await getDoc(priorityRef);

        if (!priorityDoc.exists()) {
            return;
        }

        const priority = priorityDoc.data() as OrderPriority;
        const orderAge = this.calculateOrderAge(orderCreatedAt);
        const isOverdue = Timestamp.now().toMillis() > priority.sla.toMillis();

        await updateDoc(priorityRef, {
            orderAge,
            isOverdue,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Get priority for a specific order
     */
    getOrderPriority(orderId: string): Observable<OrderPriority | null> {
        const priorityRef = doc(this.firestore, 'orderPriorities', orderId);

        return from(getDoc(priorityRef)).pipe(
            map(doc => {
                if (!doc.exists()) return null;
                return doc.data() as OrderPriority;
            })
        );
    }

    /**
     * Get all overdue orders
     */
    getOverdueOrders(): Observable<OrderPriority[]> {
        const q = query(
            this.prioritiesCollection,
            where('isOverdue', '==', true),
            orderBy('sla', 'asc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => doc.data() as OrderPriority))
        );
    }

    /**
     * Get orders by priority level
     */
    getOrdersByPriority(level: PriorityLevel): Observable<OrderPriority[]> {
        const q = query(
            this.prioritiesCollection,
            where('level', '==', level),
            orderBy('sla', 'asc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => doc.data() as OrderPriority))
        );
    }

    /**
     * Get orders approaching SLA deadline (within 6 hours)
     */
    getOrdersApproachingSLA(): Observable<OrderPriority[]> {
        const sixHoursFromNow = Timestamp.fromMillis(Date.now() + (6 * 60 * 60 * 1000));

        const q = query(
            this.prioritiesCollection,
            where('isOverdue', '==', false),
            where('sla', '<=', sixHoursFromNow),
            orderBy('sla', 'asc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => doc.data() as OrderPriority))
        );
    }

    /**
     * Calculate order age in hours
     */
    private calculateOrderAge(orderCreatedAt: Timestamp): number {
        const now = Date.now();
        const created = orderCreatedAt.toMillis();
        const ageInMs = now - created;
        return Math.floor(ageInMs / (1000 * 60 * 60)); // Convert to hours
    }

    /**
     * Update priority configuration
     */
    updateConfig(config: Partial<PriorityConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current priority configuration
     */
    getConfig(): PriorityConfig {
        return { ...this.config };
    }

    /**
     * Get SLA compliance statistics
     */
    async getSLAStats(): Promise<{
        total: number;
        onTime: number;
        overdue: number;
        approaching: number;
        complianceRate: number;
    }> {
        const allSnapshot = await getDocs(this.prioritiesCollection);
        const total = allSnapshot.size;

        const overdueSnapshot = await getDocs(
            query(this.prioritiesCollection, where('isOverdue', '==', true))
        );
        const overdue = overdueSnapshot.size;

        const sixHoursFromNow = Timestamp.fromMillis(Date.now() + (6 * 60 * 60 * 1000));
        const approachingSnapshot = await getDocs(
            query(
                this.prioritiesCollection,
                where('isOverdue', '==', false),
                where('sla', '<=', sixHoursFromNow)
            )
        );
        const approaching = approachingSnapshot.size;

        const onTime = total - overdue - approaching;
        const complianceRate = total > 0 ? ((onTime + approaching) / total) * 100 : 100;

        return {
            total,
            onTime,
            overdue,
            approaching,
            complianceRate: Math.round(complianceRate * 100) / 100
        };
    }
}
