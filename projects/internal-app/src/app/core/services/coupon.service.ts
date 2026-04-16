import { Injectable, inject } from '@angular/core';
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
    runTransaction
} from '@angular/fire/firestore';
import { Observable, map, from } from 'rxjs';
import { Coupon } from '../models/coupon.model';
import * as QRCode from 'qrcode';

@Injectable({
    providedIn: 'root'
})
export class CouponService {
    private firestore = inject(Firestore);
    private couponsCollection = collection(this.firestore, 'coupons');

    constructor() { }

    /**
     * Get all coupons (ordered by creation date desc)
     */
    getCoupons(): Observable<Coupon[]> {
        const q = query(this.couponsCollection, orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map((coupons: any[]) => coupons.map(coupon => this.convertTimestamps(coupon)))
        );
    }

    /**
     * Get ALL coupons without orderBy so legacy docs missing createdAt are included.
     * Guarantees every returned coupon has a non-empty code (falls back to doc id).
     */
    getAllCoupons(): Observable<Coupon[]> {
        return collectionData(this.couponsCollection, { idField: 'id' }).pipe(
            map((coupons: any[]) =>
                coupons
                    .map(coupon => this.convertTimestamps(coupon))
                    .map(c => ({ ...c, code: c.code?.trim() || c.id || '—' }))
            )
        );
    }

    /**
     * Get active coupons only
     */
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

    /**
     * Get coupon by ID
     */
    getCouponById(id: string): Observable<Coupon | undefined> {
        const docRef = doc(this.firestore, `coupons/${id}`);
        // We use getDocs query for consistent timestamp conversion or simple getDoc
        // Ideally reuse a shared helper or just use the observable approach
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

    /**
     * Check if a coupon code exists
     */
    async checkCodeExists(code: string): Promise<boolean> {
        const q = query(this.couponsCollection, where('code', '==', code.toUpperCase()));
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    }

    /**
     * Validate a coupon code for a cart
     * Returns the coupon if valid, throws error string if invalid
     */
    async validateCoupon(code: string, cartTotal: number): Promise<Coupon> {
        const q = query(this.couponsCollection, where('code', '==', code.toUpperCase()));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            throw new Error('Invalid coupon code');
        }

        const data = snapshot.docs[0].data() as any;
        const coupon = this.convertTimestamps({ ...data, id: snapshot.docs[0].id });

        if (!coupon.isActive) {
            throw new Error('This coupon is inactive');
        }

        const now = new Date();
        const start = coupon.startDate instanceof Timestamp ? coupon.startDate.toDate() : coupon.startDate;
        const end = coupon.endDate instanceof Timestamp ? coupon.endDate.toDate() : coupon.endDate;

        if (now < start) {
            throw new Error('This coupon is not valid yet');
        }

        if (end && now > end) {
            throw new Error('This coupon has expired');
        }

        if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
            throw new Error('This coupon usage limit has been reached');
        }

        if (coupon.minPurchaseAmount && cartTotal < coupon.minPurchaseAmount) {
            throw new Error(`Minimum purchase amount of $${coupon.minPurchaseAmount} required`);
        }

        return coupon;
    }

    /**
     * Create a new coupon
     */
    async createCoupon(coupon: Omit<Coupon, 'id'>): Promise<string> {
        // Ensure unique code
        const exists = await this.checkCodeExists(coupon.code);
        if (exists) {
            throw new Error('Coupon code already exists');
        }

        const couponData = {
            ...coupon,
            code: coupon.code.toUpperCase(),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            usageCount: 0 // Initialize
        };

        const docRef = await addDoc(this.couponsCollection, couponData);
        return docRef.id;
    }

    /**
     * Update a coupon
     */
    async updateCoupon(id: string, data: Partial<Coupon>): Promise<void> {
        try {
            const docRef = doc(this.firestore, `coupons/${id}`);
            const updateData = {
                ...data,
                updatedAt: Timestamp.now()
            };
            if (updateData.code) {
                updateData.code = updateData.code.toUpperCase();
            }
            await updateDoc(docRef, updateData);
        } catch (error) {
            console.error('Error updating coupon:', error);
            throw error;
        }
    }

    /**
     * Delete a coupon
     */
    async deleteCoupon(id: string): Promise<void> {
        try {
            const docRef = doc(this.firestore, `coupons/${id}`);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting coupon:', error);
            throw error;
        }
    }

    /**
     * Toggle coupon active status
     */
    async toggleStatus(id: string, currentStatus: boolean): Promise<void> {
        const docRef = doc(this.firestore, `coupons/${id}`);
        await updateDoc(docRef, {
            isActive: !currentStatus,
            updatedAt: Timestamp.now()
        });
    }

    // ── Approval workflow ─────────────────────────────────────────────────────

    /**
     * Marketing Hub: submit a coupon request for Admin approval.
     * Created with isActive: false, status: 'pending'.
     */
    async requestCoupon(
        data: Pick<Coupon, 'code' | 'type' | 'value' | 'description' | 'redirectUrl' | 'startDate' | 'endDate' | 'usageLimit' | 'minPurchaseAmount'>,
        requestedBy: string,
        requestedByName: string
    ): Promise<string> {
        const exists = await this.checkCodeExists(data.code);
        if (exists) throw new Error('El código de cupón ya existe');

        const couponData = {
            ...data,
            code: data.code.toUpperCase(),
            isActive: false,
            status: 'pending' as const,
            requestedBy,
            requestedByName,
            usageCount: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        };
        const ref = await addDoc(this.couponsCollection, couponData);
        return ref.id;
    }

    /**
     * Admin: approve a pending coupon → sets isActive:true, status:'live'.
     */
    async approveCoupon(id: string): Promise<void> {
        const docRef = doc(this.firestore, `coupons/${id}`);
        await updateDoc(docRef, {
            isActive: true,
            status: 'live',
            rejectionReason: null,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Admin: reject a pending coupon with a reason.
     */
    async rejectCoupon(id: string, reason: string): Promise<void> {
        const docRef = doc(this.firestore, `coupons/${id}`);
        await updateDoc(docRef, {
            isActive: false,
            status: 'rejected',
            rejectionReason: reason,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(coupon: any): Coupon {
        return {
            ...coupon,
            startDate: coupon.startDate?.toDate ? coupon.startDate.toDate() : (coupon.startDate || new Date()),
            endDate: coupon.endDate?.toDate ? coupon.endDate.toDate() : coupon.endDate,
            createdAt: coupon.createdAt?.toDate ? coupon.createdAt.toDate() : (coupon.createdAt || new Date()),
            updatedAt: coupon.updatedAt?.toDate ? coupon.updatedAt.toDate() : (coupon.updatedAt || new Date())
        };
    }

    /**
     * Generates a composite QR code data URL including an optional centered logo.
     */
    async generateCompositeQR(code: string, logoUrl?: string): Promise<string> {
        const trackingUrl = `https://importadoraeuro.com/q/${code}`;
        
        // Ensure qrcode is properly imported for browser environments
        const qrModule: any = QRCode;
        const toDataURL = qrModule.toDataURL || qrModule.default?.toDataURL;
        if (typeof toDataURL !== 'function') {
           throw new Error('QRCode.toDataURL is not a function. Check import scheme.');
        }

        const qrDataUrl = await toDataURL(trackingUrl, {
            errorCorrectionLevel: 'H', // High error correction to allow for logo overlay (~30%)
            margin: 1,
            width: 300,
            color: { dark: '#000000ff', light: '#ffffffff' }
        });

        if (!logoUrl) return qrDataUrl;

        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(qrDataUrl);

            const qrImage = new Image();
            qrImage.crossOrigin = "Anonymous";
            qrImage.onload = () => {
                ctx.drawImage(qrImage, 0, 0);

                const logo = new Image();
                logo.crossOrigin = "Anonymous";
                logo.onload = () => {
                    // Draw logo in center (25% size)
                    const logoSize = 300 * 0.25;
                    const offset = (300 - logoSize) / 2;
                    
                    // Add white background pad for logo
                    ctx.fillStyle = 'white';
                    ctx.fillRect(offset - 4, offset - 4, logoSize + 8, logoSize + 8);
                    
                    ctx.drawImage(logo, offset, offset, logoSize, logoSize);
                    resolve(canvas.toDataURL('image/png'));
                };
                logo.onerror = () => {
                    console.warn('Failed to load QR logo, returning plain QR code.');
                    resolve(qrDataUrl);
                };
                logo.src = logoUrl;
            };
            qrImage.onerror = () => reject(new Error('Failed to load QR image for compositing'));
            qrImage.src = qrDataUrl;
        });
    }
}
