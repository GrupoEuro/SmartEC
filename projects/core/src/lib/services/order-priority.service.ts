import { Injectable, inject } from '@angular/core';
import { Firestore, collection, setDoc, updateDoc, doc, query, where, getDocs, Timestamp, orderBy, getDoc } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { OrderPriority, PriorityLevel, PriorityConfig, DEFAULT_PRIORITY_CONFIG } from '../models/order-priority.model';

@Injectable({
    providedIn: 'root'
})
export class OrderPriorityService {
    private firestore = inject('FIRESTORE' as any) as Firestore;
    private prioritiesCollection = collection(this.firestore, 'orderPriorities');
    private config: PriorityConfig = DEFAULT_PRIORITY_CONFIG;

    /**
     * Set or update priority for an order
     */
    async setPriority(
        orderId: string,
        level: PriorityLevel,
        orderCreatedAt: Timestamp,
        nativeSla?: Timestamp | Date
    ): Promise<void> {
        let sla: Timestamp;

        if (nativeSla) {
            // Respect MercadoLibre (or other channel) native handling limit
            sla = nativeSla instanceof Timestamp ? nativeSla : Timestamp.fromDate(new Date(nativeSla));
        } else {
            // Fallback to local calculation
            const slaHours = this.config[level];
            const slaDate = new Date(orderCreatedAt.toMillis() + (slaHours * 60 * 60 * 1000));
            sla = Timestamp.fromDate(slaDate);
        }

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
        orderCreatedAt: Timestamp,
        nativeSla?: Timestamp | Date
    ): Promise<void> {
        let sla: Timestamp;

        if (nativeSla) {
            sla = nativeSla instanceof Timestamp ? nativeSla : Timestamp.fromDate(new Date(nativeSla));
        } else {
            const slaHours = this.config[level];
            const slaDate = new Date(orderCreatedAt.toMillis() + (slaHours * 60 * 60 * 1000));
            sla = Timestamp.fromDate(slaDate);
        }

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
        const now = Timestamp.now();
        const sixHoursFromNow = Timestamp.fromMillis(Date.now() + (6 * 60 * 60 * 1000));

        const q = query(
            this.prioritiesCollection,
            where('sla', '>', now),
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
    async getSLAStats(startDate?: Date, endDate?: Date): Promise<{
        total: number;
        onTime: number;
        overdue: number;
        approaching: number;
        complianceRate: number;
    }> {
        let statsQuery: any = this.prioritiesCollection;

        if (startDate && endDate) {
            statsQuery = query(
                this.prioritiesCollection,
                where('createdAt', '>=', Timestamp.fromDate(startDate)),
                where('createdAt', '<=', Timestamp.fromDate(endDate))
            );
        }

        const allSnapshot = await getDocs(statsQuery);
        const total = allSnapshot.size;

        if (total === 0) {
            return { total: 0, onTime: 0, overdue: 0, approaching: 0, complianceRate: 100 };
        }

        let onTime = 0;
        let overdue = 0;
        let approaching = 0;

        const now = Date.now();
        const sixHoursFromNow = now + (6 * 60 * 60 * 1000);

        allSnapshot.forEach(docSnap => {
            const data = docSnap.data() as any;
            const slaDeadline = data['sla'] instanceof Timestamp ? data['sla'].toMillis() : (data['sla']?.seconds ? data['sla'].seconds * 1000 : now);

            if (now > slaDeadline) {
                overdue++;
            } else if (slaDeadline <= sixHoursFromNow) {
                approaching++;
            } else {
                onTime++;
            }
        });

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
