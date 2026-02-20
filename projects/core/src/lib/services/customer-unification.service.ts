
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, getDocs, orderBy, limit, Timestamp } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { UnifiedCustomer } from '../models/unified-customer.model';
import { Order } from '../models/order.model';
import { UserProfile } from '../models/user.model';

@Injectable({
    providedIn: 'root'
})
export class CustomerUnificationService {
    private firestore = inject(Firestore);

    /**
     * Performs "Identity Resolution" to merge customers across channels.
     * Logic:
     * 1. Fetch recent orders (e.g., last 1000) for performance.
     * 2. Group by normalized Email (primary key).
     * 3. Aggregate spend across channels.
     */
    getUnifiedCustomers(limitCount: number = 50): Observable<UnifiedCustomer[]> {
        const ordersRef = collection(this.firestore, 'orders');
        // fetching all orders might be heavy, in real app we'd use an aggregation query or cloud function.
        // For this dashboard, we'll fetch last 500 orders to analyze.
        const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(500));

        return from(getDocs(q)).pipe(
            map(snapshot => {
                const orders = snapshot.docs.map(d => d.data() as Order);
                return this.unifyIdentities(orders);
            }),
            map(customers => {
                // Sort by LTV descending
                return customers.sort((a, b) => b.totalLifetimeValue - a.totalLifetimeValue).slice(0, limitCount);
            })
        );
    }

    private unifyIdentities(orders: Order[]): UnifiedCustomer[] {
        const customerMap = new Map<string, UnifiedCustomer>();

        for (const order of orders) {
            // Identity Resolution Key: Email (Lowercased)
            // Fallback: Phone or Name if email is missing (common in some POS scenarios)
            const email = order.customer.email?.toLowerCase().trim();
            if (!email) continue; // Skip anonymous/no-email orders for now

            const key = email;

            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    id: key, // Using email as temp ID
                    displayName: order.customer.name,
                    email: email,
                    phone: order.customer.phone,
                    channels: [],
                    linkedIds: [],
                    totalLifetimeValue: 0,
                    totalOrders: 0,
                    avgOrderValue: 0,
                    firstSeen: order.createdAt,
                    lastSeen: order.createdAt,
                    channelBreakdown: []
                });
            }

            const profile = customerMap.get(key)!;

            // Update Stats
            profile.totalLifetimeValue += (order.total || 0);
            profile.totalOrders += 1;

            // Update Dates
            const orderDate = order.createdAt instanceof Timestamp ? order.createdAt.toDate() : new Date(order.createdAt);
            const lastSeen = profile.lastSeen instanceof Timestamp ? profile.lastSeen.toDate() : new Date(profile.lastSeen);
            const firstSeen = profile.firstSeen instanceof Timestamp ? profile.firstSeen.toDate() : new Date(profile.firstSeen);

            if (orderDate > lastSeen) profile.lastSeen = order.createdAt;
            if (orderDate < firstSeen) profile.firstSeen = order.createdAt;

            // Track Channels
            const channel = order.channel || 'WEB';
            if (!profile.channels.includes(channel)) {
                profile.channels.push(channel);
            }

            // Update Breakdown
            let breakdown = profile.channelBreakdown.find(b => b.channel === channel);
            if (!breakdown) {
                breakdown = { channel, spend: 0, orders: 0 };
                profile.channelBreakdown.push(breakdown);
            }
            breakdown.spend += (order.total || 0);
            breakdown.orders += 1;
        }

        // derived calc
        const profiles = Array.from(customerMap.values());
        profiles.forEach(p => {
            p.avgOrderValue = p.totalLifetimeValue / p.totalOrders;
        });

        return profiles;
    }
}
