import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from } from 'rxjs';

// ── Type Definitions ──────────────────────────────────────────────────────────

export interface ShippingParcel {
    weight: number;  // kg
    height: number;  // cm
    width: number;   // cm
    length: number;  // cm
}

export interface ShippingRate {
    rateId: string;
    carrier: string;
    serviceName: string;
    price: number;
    currency: string;
    estimatedDays: number | null;
}

export interface RatesResult {
    quotationId: string;
    rates: ShippingRate[];
}

export interface LabelResult {
    shipmentId: string;
    trackingNumber: string;
    carrier: string;
    labelUrl: string;
}

export interface TrackingEvent {
    status: string;
    description: string;
    location: string;
    occurredAt: string;
}

export interface TrackingResult {
    trackingNumber: string;
    status: string;
    statusDetail: string;
    estimatedDelivery: string | null;
    events: TrackingEvent[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SkydropxService {
    private fns = inject(Functions);

    /**
     * Get real-time shipping rate quotes for an order.
     * Calls skydropxGetRates Cloud Function.
     */
    getRates(params: { orderId?: string; addressTo?: any; parcel: ShippingParcel }): Observable<RatesResult> {
        const fn = httpsCallable<{ orderId?: string; addressTo?: any; parcel: ShippingParcel }, RatesResult>(
            this.fns, 'skydropxGetRates'
        );
        return from(fn(params).then(r => r.data));
    }

    /**
     * Generate a shipping label with the selected rate.
     * Auto-updates the Firestore order to status='shipped'.
     * Calls skydropxCreateLabel Cloud Function.
     */
    createLabel(orderId: string, rateId: string): Observable<LabelResult> {
        const fn = httpsCallable<{ orderId: string; rateId: string }, LabelResult>(
            this.fns, 'skydropxCreateLabel'
        );
        return from(fn({ orderId, rateId }).then(r => r.data));
    }

    /**
     * Get live tracking status and events for a shipment.
     * Calls skydropxGetTracking Cloud Function.
     */
    getTracking(trackingNumber: string): Observable<TrackingResult> {
        const fn = httpsCallable<{ trackingNumber: string }, TrackingResult>(
            this.fns, 'skydropxGetTracking'
        );
        return from(fn({ trackingNumber }).then(r => r.data));
    }

    /** Human-friendly carrier logo class */
    getCarrierColor(carrier: string): string {
        const lower = (carrier || '').toLowerCase();
        if (lower.includes('dhl'))      return 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10';
        if (lower.includes('fedex'))    return 'text-purple-400 border-purple-500/40 bg-purple-500/10';
        if (lower.includes('estafeta')) return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
        if (lower.includes('j&t') || lower.includes('jt')) return 'text-red-400 border-red-500/40 bg-red-500/10';
        if (lower.includes('redpack'))  return 'text-orange-400 border-orange-500/40 bg-orange-500/10';
        return 'text-slate-300 border-slate-500/40 bg-slate-500/10';
    }
}
