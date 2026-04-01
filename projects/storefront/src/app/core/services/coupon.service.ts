import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
    Timestamp,
    increment,
    runTransaction,
    CollectionReference,
    Query
} from '@angular/fire/firestore';
import { Observable, map, from } from 'rxjs';
import { Coupon } from '../models/coupon.model';
import { AttributionService, stripUndefined } from './attribution.service';

@Injectable({
    providedIn: 'root'
})
export class CouponService {
    private firestore      = inject(Firestore);
    private attributionSvc = inject(AttributionService);
    private platformId     = inject(PLATFORM_ID);

    private couponsCollection = collection(this.firestore, 'coupons');

    constructor() { }

    // ── Reads ──────────────────────────────────────────────────────────────────

    getCoupons(): Observable<Coupon[]> {
        const q = query(this.couponsCollection, orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map((coupons: any[]) => coupons.map(coupon => this.convertTimestamps(coupon)))
        );
    }

    getActiveCoupons(): Observable<Coupon[]> {
        const q = query(
            this.couponsCollection,
            where('isActive', '==', true),
            orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((coupons: any[]) => coupons.map(coupon => this.convertTimestamps(coupon)))
        );
    }

    getCouponById(id: string): Observable<Coupon | undefined> {
        const q = query(this.couponsCollection, where('__name__', '==', id));
        return collectionData(q, { idField: 'id' }).pipe(
            map((coupons: any[]) => {
                if (coupons.length > 0) {
                    return this.convertTimestamps(coupons[0]);
                }
                return undefined;
            })
        );
    }

    async checkCodeExists(code: string): Promise<boolean> {
        const q = query(this.couponsCollection, where('code', '==', code.toUpperCase()));
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    }

    // ── Validation ─────────────────────────────────────────────────────────────

    async validateCoupon(code: string, cartTotal: number): Promise<Coupon> {
        const q = query(this.couponsCollection, where('code', '==', code.toUpperCase()));
        const snapshot = await getDocs(q);

        if (snapshot.empty) throw new Error('Invalid coupon code');

        const data   = snapshot.docs[0].data() as any;
        const coupon = this.convertTimestamps({ ...data, id: snapshot.docs[0].id });

        if (!coupon.isActive) throw new Error('This coupon is inactive');

        const now   = new Date();
        const start = coupon.startDate instanceof Timestamp ? coupon.startDate.toDate() : coupon.startDate;
        const end   = coupon.endDate instanceof Timestamp   ? coupon.endDate.toDate()   : coupon.endDate;

        if (now < start) throw new Error('This coupon is not valid yet');
        if (end && now > end) throw new Error('This coupon has expired');
        if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
            throw new Error('This coupon usage limit has been reached');
        }
        if (coupon.minPurchaseAmount && cartTotal < coupon.minPurchaseAmount) {
            throw new Error(`Minimum purchase amount of $${coupon.minPurchaseAmount} required`);
        }

        return coupon;
    }

    // ── QR Scan Tracking ───────────────────────────────────────────────────────

    /**
     * Called when a QR code is scanned at /qr/:code.
     * Records the scan with full attribution (device, geo, UTM, session)
     * and returns the coupon's redirectUrl if set.
     */
    async incrementScanCount(code: string): Promise<string | null> {
        try {
            const q        = query(this.couponsCollection, where('code', '==', code.toUpperCase()));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                console.warn(`QR scan attempted for unknown coupon code: ${code}`);
                return null;
            }

            const docRef = snapshot.docs[0].ref;
            const data   = snapshot.docs[0].data() as Coupon;

            // ── Increment root-level counter ──────────────────────────────────
            await updateDoc(docRef, { scanCount: increment(1) });

            // ── Capture full attribution for this scan ─────────────────────────
            const attr      = this.attributionSvc.get();
            const sessionId = isPlatformBrowser(this.platformId)
                ? (sessionStorage.getItem('cart_session_id') || localStorage.getItem('cart_session_id') || null)
                : null;

            // UTM from QR URL (the URL may carry utm_source=qr&utm_campaign=... params)
            const scanUtm = this.captureCurrentUtm();

            const scanDoc = stripUndefined({
                // ── When ──────────────────────────────────────────────────────
                scannedAt:  Timestamp.now(),

                // ── Session link (joins to guestCarts / carts if they add items) ──
                sessionId,

                // ── Device (captured in real time at scan point) ───────────────
                device: isPlatformBrowser(this.platformId) ? {
                    userAgent: navigator.userAgent,
                    mobile:    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
                    language:  navigator.language || '',
                    timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
                } : undefined,

                // ── UTM from the QR URL (may override stored attribution) ──────
                utm: Object.keys(scanUtm).length > 0
                    ? scanUtm
                    : (attr?.utm ?? {}),

                // ── Geo from AttributionService (IP-based, already resolved) ───
                geo: attr?.geo ?? undefined,

                // ── Referrer context ────────────────────────────────────────────
                referrer:       attr?.referrer       ?? undefined,
                referrerDomain: attr?.referrerDomain ?? undefined,
                landingUrl:     isPlatformBrowser(this.platformId) ? window.location.href : undefined,

                // ── Campaign context ────────────────────────────────────────────
                campaignId:   attr?.campaignId   ?? undefined,
                campaignName: attr?.campaignName ?? undefined,

                // ── Conversion funnel — updated at checkout ─────────────────────
                converted:    false,
                orderId:      null,
                convertedAt:  null,
                discountUsed: null,
            });

            const scansCollection = collection(docRef, 'scans');
            await addDoc(scansCollection, scanDoc);

            return data.redirectUrl || null;

        } catch (error) {
            console.error('Error incrementing scan count:', error);
            return null;
        }
    }

    /**
     * Call this when a coupon is successfully used at checkout (payment approved).
     * Finds the most recent scan by sessionId and marks it as converted.
     * Falls back gracefully if no matching scan is found.
     */
    async markScanConverted(couponCode: string, orderId: string, discountAmount: number): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            const sessionId = sessionStorage.getItem('cart_session_id')
                           || localStorage.getItem('cart_session_id');
            if (!sessionId) return;

            // Find the coupon doc
            const q        = query(this.couponsCollection, where('code', '==', couponCode.toUpperCase()));
            const snapshot = await getDocs(q);
            if (snapshot.empty) return;

            const couponRef = snapshot.docs[0].ref;

            // Find matching scan by sessionId in the scans subcollection
            const scansRef = collection(couponRef, 'scans') as CollectionReference;
            const scanQ    = query(
                scansRef,
                where('sessionId', '==', sessionId),
                where('converted', '==', false),
                orderBy('scannedAt', 'desc')
            ) as Query;

            const scanSnap = await getDocs(scanQ);
            if (scanSnap.empty) return; // scan not found, skip silently

            // Mark the most recent matching scan as converted
            const latestScan = scanSnap.docs[0];
            await updateDoc(latestScan.ref, {
                converted:    true,
                orderId,
                discountUsed: discountAmount,
                convertedAt:  Timestamp.now(),
            });
        } catch (e) {
            // Non-critical — don't surface to user
            console.warn('[Coupon] Could not mark scan as converted:', e);
        }
    }

    // ── Mutations ──────────────────────────────────────────────────────────────

    async createCoupon(coupon: Omit<Coupon, 'id'>): Promise<string> {
        const exists = await this.checkCodeExists(coupon.code);
        if (exists) throw new Error('Coupon code already exists');

        const couponData = {
            ...coupon,
            code:       coupon.code.toUpperCase(),
            createdAt:  Timestamp.now(),
            updatedAt:  Timestamp.now(),
            usageCount: 0,
        };

        const docRef = await addDoc(this.couponsCollection, couponData);
        return docRef.id;
    }

    async updateCoupon(id: string, data: Partial<Coupon>): Promise<void> {
        try {
            const docRef = doc(this.firestore, `coupons/${id}`);
            const updateData: any = { ...data, updatedAt: Timestamp.now() };
            if (updateData.code) updateData.code = updateData.code.toUpperCase();
            await updateDoc(docRef, updateData);
        } catch (error) {
            console.error('Error updating coupon:', error);
            throw error;
        }
    }

    async deleteCoupon(id: string): Promise<void> {
        try {
            const docRef = doc(this.firestore, `coupons/${id}`);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting coupon:', error);
            throw error;
        }
    }

    async toggleStatus(id: string, currentStatus: boolean): Promise<void> {
        const docRef = doc(this.firestore, `coupons/${id}`);
        await updateDoc(docRef, { isActive: !currentStatus, updatedAt: Timestamp.now() });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Read UTM params from the current URL at scan time (QR URLs often embed them). */
    private captureCurrentUtm(): Record<string, string> {
        const result: Record<string, string> = {};
        if (!isPlatformBrowser(this.platformId)) return result;
        try {
            const params = new URLSearchParams(window.location.search);
            const keys   = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
            for (const k of keys) {
                const v = params.get(k);
                if (v) result[k] = v;
            }
        } catch { /* noop */ }
        return result;
    }

    private convertTimestamps(coupon: any): Coupon {
        return {
            ...coupon,
            startDate:  coupon.startDate?.toDate  ? coupon.startDate.toDate()  : (coupon.startDate  || new Date()),
            endDate:    coupon.endDate?.toDate     ? coupon.endDate.toDate()    : coupon.endDate,
            createdAt:  coupon.createdAt?.toDate   ? coupon.createdAt.toDate()  : (coupon.createdAt  || new Date()),
            updatedAt:  coupon.updatedAt?.toDate   ? coupon.updatedAt.toDate()  : (coupon.updatedAt  || new Date()),
        };
    }
}
