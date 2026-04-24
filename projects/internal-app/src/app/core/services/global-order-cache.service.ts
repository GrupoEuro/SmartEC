import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    query,
    where,
    orderBy,
    getDocs,
    Timestamp
} from '@angular/fire/firestore';
import { Observable, from as fromPromise, map, shareReplay } from 'rxjs';
import { Order } from '../models/order.model';

/**
 * GlobalOrderCacheService
 *
 * Single source of truth for all date-bounded order queries.
 * Uses shareReplay(1) so every subscriber within the same date range
 * receives data from ONE Firestore request — eliminating the Thundering Herd
 * where multiple components/services independently query the same range.
 *
 * Usage:
 *   this.globalOrderCache.get(from, to).subscribe(orders => { ... });
 *
 * Cache is keyed by [YYYY-MM-DD]_[YYYY-MM-DD] (rounded to day boundary)
 * so components using slightly different Date instances for the same day
 * still share the same cached observable.
 *
 * Call invalidate() if you need to force a fresh fetch (e.g. after order writes).
 */
@Injectable({
    providedIn: 'root'
})
export class GlobalOrderCacheService {
    private fs = inject(Firestore);
    private cache = new Map<string, Observable<Order[]>>();

    /**
     * Returns a cached Observable<Order[]> for the given date range.
     * Multiple subscribers to the same range share a single Firestore read.
     */
    get(startDate: Date, endDate: Date): Observable<Order[]> {
        const key = this.buildKey(startDate, endDate);

        if (!this.cache.has(key)) {
            const ordersRef = collection(this.fs, 'orders');
            const q = query(
                ordersRef,
                where('createdAt', '>=', Timestamp.fromDate(this.startOfDay(startDate))),
                where('createdAt', '<=', Timestamp.fromDate(this.endOfDay(endDate))),
                orderBy('createdAt', 'desc')
            );

            const shared$ = fromPromise(getDocs(q)).pipe(
                map((snap: any) => {
                    console.log(`[GlobalOrderCache] Fetched ${snap.size} orders for key=${key}`);
                    return snap.docs.map((d: any) => {
                        const data = d.data();
                        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt ?? 0);
                        const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : createdAt;
                        return { id: d.id, ...data, createdAt, updatedAt } as Order;
                    });
                }),
                shareReplay(1)
            );

            this.cache.set(key, shared$);
        }

        return this.cache.get(key)!;
    }

    /**
     * Clear all cached observables.
     * Call this after order mutations if real-time accuracy is required.
     */
    invalidate(): void {
        this.cache.clear();
        console.log('[GlobalOrderCache] Cache invalidated.');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private buildKey(startDate: Date, endDate: Date): string {
        return `${this.toDateStr(startDate)}_${this.toDateStr(endDate)}`;
    }

    private toDateStr(d: Date): string {
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    private startOfDay(d: Date): Date {
        const r = new Date(d);
        r.setHours(0, 0, 0, 0);
        return r;
    }

    private endOfDay(d: Date): Date {
        const r = new Date(d);
        r.setHours(23, 59, 59, 999);
        return r;
    }
}
