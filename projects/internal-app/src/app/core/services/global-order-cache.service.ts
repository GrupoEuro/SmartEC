import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    query,
    where,
    orderBy,
    getDocs,
    Timestamp,
    collectionData
} from '@angular/fire/firestore';
import { Observable, from as fromPromise, map, shareReplay, BehaviorSubject } from 'rxjs';
import { Subscription } from 'rxjs';
import { Order } from '../models/order.model';

/**
 * GlobalOrderCacheService
 *
 * Single source of truth for all date-bounded order queries.
 *
 * ── Strategies ────────────────────────────────────────────────────────────────
 *
 * get(from, to)
 *   One-shot getDocs — pays reads exactly once per date-range key per session.
 *   Ideal for analytics, income reports, and marketing dashboards.
 *   Results are shared via shareReplay(1) across all subscribers.
 *
 * getHybrid(from, to)  ← PREFERRED for the Operations Dashboard
 *   Two-phase approach to maximize freshness while minimising reads:
 *     Phase 1 — getDocs over the full window (one-shot, pays once).
 *     Phase 2 — onSnapshot on the last TAIL_HOURS hours only (~50 docs max).
 *   New / updated orders land in the tail first and are merged into the full
 *   set in-memory. The combined result is emitted on a BehaviorSubject so the
 *   dashboard stays near-real-time without re-reading 900 docs per webhook.
 *
 * getLive(from, to)
 *   Full-range onSnapshot — kept for backward compat / order-queue polling.
 *   High read cost; prefer getHybrid() wherever possible.
 *
 * Cache is keyed by YYYY-MM-DD_YYYY-MM-DD so components using slightly different
 * Date instances for the same day still share the same cached observable.
 *
 * Call invalidate() / invalidateLive() if you need to force a fresh fetch.
 */

/** Width of the live-tail window in hours. 48h covers overnight orders safely. */
const TAIL_HOURS = 48;

@Injectable({
    providedIn: 'root'
})
export class GlobalOrderCacheService {
    private fs = inject(Firestore);

    // ── One-shot cache ────────────────────────────────────────────────────────
    private cache     = new Map<string, Observable<Order[]>>();
    // ── Hybrid cache ──────────────────────────────────────────────────────────
    private hybridCache = new Map<string, {
        subject: BehaviorSubject<Order[]>;
        tailSub: Subscription;
    }>();
    // ── Legacy live cache ─────────────────────────────────────────────────────
    private liveCache = new Map<string, Observable<Order[]>>();

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * One-shot getDocs — reads once, replays to all subscribers.
     * Use for analytics / income / marketing pages where data changes
     * are acceptable to be slightly stale.
     */
    get(startDate: Date, endDate: Date): Observable<Order[]> {
        const key = this.buildKey(startDate, endDate);

        if (!this.cache.has(key)) {
            const q = query(
                collection(this.fs, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(this.startOfDay(startDate))),
                where('createdAt', '<=', Timestamp.fromDate(this.endOfDay(endDate))),
                orderBy('createdAt', 'desc')
            );

            const shared$ = fromPromise(getDocs(q)).pipe(
                map((snap: any) => {
                    console.log(`[GlobalOrderCache] One-shot: ${snap.size} orders (key=${key})`);
                    return snap.docs.map((d: any) => this.mapDoc(d));
                }),
                shareReplay(1)
            );

            this.cache.set(key, shared$);
        }

        return this.cache.get(key)!;
    }

    /**
     * Hybrid read — one-shot getDocs for the full window + narrow 48h onSnapshot
     * tail merged in-memory. Emits a BehaviorSubject that updates as new orders
     * arrive without re-reading the entire month.
     *
     * Read cost comparison (assuming 900 MTD docs, 50 docs in tail, 50 webhooks/day):
     *   getLive()    → 50 × 900  = 45,000 reads/day
     *   getHybrid()  →    900    +  50 × 50 = ~3,400 reads/day  (-92%)
     */
    getHybrid(startDate: Date, endDate: Date): Observable<Order[]> {
        const key = this.buildKey(startDate, endDate);

        if (!this.hybridCache.has(key)) {
            // ── Phase 1: one-shot full range ──────────────────────────────────
            const subject = new BehaviorSubject<Order[]>([]);
            const fullQ = query(
                collection(this.fs, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(this.startOfDay(startDate))),
                where('createdAt', '<=', Timestamp.fromDate(this.endOfDay(endDate))),
                orderBy('createdAt', 'desc')
            );

            getDocs(fullQ).then((snap: any) => {
                const orders = snap.docs.map((d: any) => this.mapDoc(d));
                console.log(`[GlobalOrderCache] Hybrid one-shot: ${orders.length} orders (key=${key})`);
                subject.next(orders);
            }).catch((err: any) => {
                console.error('[GlobalOrderCache] Hybrid one-shot failed:', err);
            });

            // ── Phase 2: narrow tail onSnapshot ──────────────────────────────
            // Only reads documents created/updated in the last TAIL_HOURS hours,
            // BUT clamped to the requested period window.
            //
            // Critical: without an upper-bound the tail pulls orders from the
            // previous month when the month rolls over (e.g. May 31 orders appear
            // in the June MTD set), inflating MTD sales by the prior day's total.
            const tailRawStart = new Date(Date.now() - TAIL_HOURS * 60 * 60 * 1000);
            // Never start before the period's own start — prevents prior-month bleed
            const tailStart = tailRawStart > this.startOfDay(startDate)
                ? tailRawStart
                : this.startOfDay(startDate);
            const tailQ = query(
                collection(this.fs, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(tailStart)),
                where('createdAt', '<=', Timestamp.fromDate(this.endOfDay(endDate))),
                orderBy('createdAt', 'desc')
            );

            const tailSub = (collectionData(tailQ, { idField: 'id' }) as Observable<any[]>).subscribe({
                next: (tailDocs) => {
                    // ── Defense-in-depth: filter in-memory ───────────────────────────
                    // collectionData emits twice: once instantly from IndexedDB cache
                    // (potentially stale from a prior session), then again from the
                    // server. Without this filter, stale cached docs outside the period
                    // (e.g. May 31 orders on June 1) pass through mergeTail and inflate
                    // the KPI total even though the Firestore query bounds are correct.
                    const periodEnd = this.endOfDay(endDate);
                    const tail = tailDocs
                        .map((d: any) => this.mapRaw(d))
                        .filter((o: Order) => {
                            const t = o.createdAt instanceof Date
                                ? o.createdAt
                                : new Date((o.createdAt as any) ?? 0);
                            return t >= tailStart && t <= periodEnd;
                        });
                    console.log(`[GlobalOrderCache] Hybrid tail update: ${tailDocs.length} raw → ${tail.length} in-period docs`);

                    // Merge: replace existing + add new from tail
                    const current = subject.getValue();
                    const merged  = this.mergeTail(current, tail);
                    subject.next(merged);
                },
                error: (err: any) => {
                    console.warn('[GlobalOrderCache] Hybrid tail failed (non-critical):', err);
                }
            });

            this.hybridCache.set(key, { subject, tailSub });
        }

        return this.hybridCache.get(key)!.subject.asObservable();
    }

    /**
     * Full-range onSnapshot — high read cost. Kept for components that
     * need direct live updates (e.g. order-queue's 5s polling fallback).
     * Prefer getHybrid() for dashboard-style views.
     */
    getLive(startDate: Date, endDate: Date): Observable<Order[]> {
        const key = this.buildKey(startDate, endDate);

        if (!this.liveCache.has(key)) {
            const q = query(
                collection(this.fs, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(this.startOfDay(startDate))),
                where('createdAt', '<=', Timestamp.fromDate(this.endOfDay(endDate))),
                orderBy('createdAt', 'desc')
            );

            const live$ = (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
                map((docs: any[]) => {
                    console.log(`[GlobalOrderCache] Live update: ${docs.length} orders (key=${key})`);
                    return docs.map((d: any) => this.mapRaw(d));
                }),
                shareReplay({ bufferSize: 1, refCount: true })
            );

            this.liveCache.set(key, live$);
        }

        return this.liveCache.get(key)!;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INVALIDATION
    // ─────────────────────────────────────────────────────────────────────────

    /** Clear the one-shot cache. Call after order mutations when stale data is unacceptable. */
    invalidate(): void {
        this.cache.clear();
        console.log('[GlobalOrderCache] One-shot cache invalidated.');
    }

    /** Clear the hybrid cache and close all tail subscriptions. */
    invalidateHybrid(): void {
        this.hybridCache.forEach(({ tailSub }) => tailSub.unsubscribe());
        this.hybridCache.clear();
        console.log('[GlobalOrderCache] Hybrid cache invalidated.');
    }

    /** Clear the legacy live cache. */
    invalidateLive(): void {
        this.liveCache.clear();
        console.log('[GlobalOrderCache] Live cache invalidated.');
    }

    /** Invalidate all caches at once (e.g. on timeframe change). */
    invalidateAll(): void {
        this.invalidate();
        this.invalidateHybrid();
        this.invalidateLive();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Merge tail (live) docs into the full historical set.
     * - Orders in the tail that already exist in fullSet are replaced (updates).
     * - New orders in the tail are prepended.
     */
    private mergeTail(fullSet: Order[], tail: Order[]): Order[] {
        if (tail.length === 0) return fullSet;

        const tailMap = new Map(tail.map(o => [o.id!, o]));
        // Replace updated docs in-place
        const updated = fullSet.map(o => tailMap.has(o.id!) ? tailMap.get(o.id!)! : o);
        // Prepend genuinely new docs (not present in fullSet)
        const existingIds = new Set(fullSet.map(o => o.id));
        const newOnes = tail.filter(o => !existingIds.has(o.id));
        return [...newOnes, ...updated];
    }

    private mapDoc(d: any): Order {
        const data = d.data();
        return this.mapRaw({ id: d.id, ...data });
    }

    private mapRaw(data: any): Order {
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt ?? 0);
        const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : createdAt;
        return { ...data, createdAt, updatedAt } as Order;
    }

    private buildKey(startDate: Date, endDate: Date): string {
        return `${this.toDateStr(startDate)}_${this.toDateStr(endDate)}`;
    }

    private toDateStr(d: Date): string {
        return d.toISOString().slice(0, 10);
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
