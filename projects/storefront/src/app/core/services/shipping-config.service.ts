import { Injectable, inject, signal } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

export interface ShippingRules {
    mode: 'preset' | 'live';
    freeShipping: { enabled: boolean; threshold: number };
    standardRate: { enabled: boolean; labelEs: string; labelEn: string; price: number; maxDays: number };
    expressRate:  { enabled: boolean; labelEs: string; labelEn: string; price: number; maxDays: number };
}

export interface DisplayRate {
    rateId: string;
    carrier: string;
    serviceName: string;
    serviceNameEs: string;
    price: number;
    currency: string;
    estimatedDays: number | null;
    isFree?: boolean;
}

const DEFAULTS: ShippingRules = {
    mode: 'preset',
    freeShipping: { enabled: true, threshold: 5000 },
    standardRate: { enabled: true,  labelEs: 'Envío Estándar (3-5 días)',  labelEn: 'Standard Shipping (3-5 days)',  price: 150, maxDays: 5 },
    expressRate:  { enabled: false, labelEs: 'Envío Express (1-2 días)',   labelEn: 'Express Shipping (1-2 days)',   price: 280, maxDays: 2 }
};

@Injectable({ providedIn: 'root' })
export class ShippingConfigService {
    private firestore = inject(Firestore);

    /** Resolved shipping rules, defaults applied until Firestore loads */
    readonly rules = signal<ShippingRules>(DEFAULTS);
    readonly loaded = signal(false);

    /** Call once from app initialisation or checkout component init */
    async load(): Promise<void> {
        if (this.loaded()) return;
        try {
            const snap = await getDoc(doc(this.firestore, 'config/shipping'));
            if (snap.exists()) {
                const data = snap.data();
                this.rules.set({ ...DEFAULTS, ...(data['rules'] || {}) });
            }
        } catch (err) {
            console.warn('[ShippingConfig] Could not load config, using defaults.', err);
        } finally {
            this.loaded.set(true);
        }
    }

    get freeThreshold(): number {
        const r = this.rules();
        return r.freeShipping.enabled ? r.freeShipping.threshold : Infinity;
    }

    get mode(): 'preset' | 'live' {
        return this.rules().mode;
    }

    /**
     * Builds the display rate cards for preset mode.
     * If subtotal >= freeThreshold → only returns a free shipping card.
     * Otherwise returns enabled standard + express options.
     */
    buildPresetRates(subtotal: number, lang: string = 'es'): DisplayRate[] {
        const r = this.rules();

        if (r.freeShipping.enabled && subtotal >= r.freeShipping.threshold) {
            return [{
                rateId: 'free',
                carrier: 'Gratis',
                serviceName: lang === 'es' ? 'Envío Gratis 🎉' : 'Free Shipping 🎉',
                serviceNameEs: 'Envío Gratis 🎉',
                price: 0,
                currency: 'MXN',
                estimatedDays: r.standardRate.maxDays,
                isFree: true
            }];
        }

        const rates: DisplayRate[] = [];

        if (r.standardRate.enabled) {
            rates.push({
                rateId: 'standard',
                carrier: 'Standard',
                serviceName: lang === 'es' ? r.standardRate.labelEs : r.standardRate.labelEn,
                serviceNameEs: r.standardRate.labelEs,
                price: r.standardRate.price,
                currency: 'MXN',
                estimatedDays: r.standardRate.maxDays
            });
        }

        if (r.expressRate.enabled) {
            rates.push({
                rateId: 'express',
                carrier: 'Express',
                serviceName: lang === 'es' ? r.expressRate.labelEs : r.expressRate.labelEn,
                serviceNameEs: r.expressRate.labelEs,
                price: r.expressRate.price,
                currency: 'MXN',
                estimatedDays: r.expressRate.maxDays
            });
        }

        return rates;
    }
}
