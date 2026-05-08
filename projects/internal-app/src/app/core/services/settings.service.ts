import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface DayHours {
    open: string;    // "09:00"
    close: string;   // "19:00"
    closed: boolean; // true if closed all day
}

export interface BusinessHours {
    monday: DayHours;
    tuesday: DayHours;
    wednesday: DayHours;
    thursday: DayHours;
    friday: DayHours;
    saturday: DayHours;
    sunday: DayHours;
}

export interface SocialLinks {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
    tiktok?: string;
    showFacebook: boolean;
    showInstagram: boolean;
    showLinkedin: boolean;
    showTwitter: boolean;
    showYoutube: boolean;
    showTiktok: boolean;
}

export interface ShippingSettings {
    origin: {
        street: string;
        number: string;
        colonia: string;
        city: string;
        province: string;
        zip: string;
        country: string;
    };
    rules?: {
        mode: 'preset' | 'live';
        freeShipping: {
            enabled: boolean;
            threshold: number;
        };
        standardRate: {
            enabled: boolean;
            labelEs: string;
            labelEn: string;
            price: number;
            maxDays: number;
        };
        expressRate: {
            enabled: boolean;
            labelEs: string;
            labelEn: string;
            price: number;
            maxDays: number;
        };
    };
}

export interface WebsiteSettings {
    general: {
        companyName: string;
        phone: string;
        whatsapp: string;
        email: string;
        address: string;
        logo: string;
        favicon: string;
    };
    social: SocialLinks;
    businessHours: BusinessHours;
    features: {
        maintenanceMode: boolean;
        showPromoBanner: boolean;
        promoText: string;
        enableChatWidget: boolean;
    };
    approvals: {
        priceChangeThreshold: number;
    };
    seo: {
        metaTitle: string;
        metaDescription: string;
        ogImage: string;
    };
    shipping: ShippingSettings;
}

const DEFAULT_SETTINGS: WebsiteSettings = {
    general: {
        companyName: 'Importadora Euro',
        phone: '+52 444 824 0757',
        whatsapp: '+52 444 194 6502',
        email: 'ventas@importadoraeuro.com',
        address: 'San Luis Potosí, México',
        logo: '',
        favicon: ''
    },
    social: {
        facebook: 'https://facebook.com',
        instagram: 'https://instagram.com',
        linkedin: 'https://linkedin.com',
        twitter: '',
        youtube: '',
        tiktok: '',
        showFacebook: true,
        showInstagram: true,
        showLinkedin: true,
        showTwitter: false,
        showYoutube: false,
        showTiktok: false
    },
    businessHours: {
        monday: { open: '09:00', close: '19:00', closed: false },
        tuesday: { open: '09:00', close: '19:00', closed: false },
        wednesday: { open: '09:00', close: '19:00', closed: false },
        thursday: { open: '09:00', close: '19:00', closed: false },
        friday: { open: '09:00', close: '19:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true }
    },
    features: {
        maintenanceMode: false,
        showPromoBanner: false,
        promoText: '',
        enableChatWidget: true
    },
    approvals: {
        priceChangeThreshold: 15
    },
    seo: {
        metaTitle: '{{page_title}} | Importadora Eurollantas',
        metaDescription: 'Importadora Euro: Distribuidor líder de llantas de motocicleta (Michelin, Praxis) y refacciones en México. Envíos nacionales y excelente servicio garantizado.',
        ogImage: 'https://tiendapraxis.web.app/assets/social-share.jpg'
    },
    shipping: {
        origin: {
            street: 'Av. Salvador Nava',
            number: '704-1',
            colonia: 'Col. Nuevo Paseo',
            city: 'San Luis Potosí',
            province: 'San Luis Potosí',
            zip: '78140',
            country: 'MX'
        },
        rules: {
            mode: 'preset' as const,
            freeShipping: { enabled: true, threshold: 5000 },
            standardRate: { enabled: true, labelEs: 'Envío Estándar (3-5 días)', labelEn: 'Standard Shipping (3-5 days)', price: 150, maxDays: 5 },
            expressRate: { enabled: false, labelEs: 'Envío Express (1-2 días)', labelEn: 'Express Shipping (1-2 days)', price: 280, maxDays: 2 }
        }
    }
};

@Injectable({
    providedIn: 'root'
})
export class SettingsService {
    private firestore = inject(Firestore);

    private get configDocRef() { return doc(this.firestore, 'config/website'); }
    private get shippingDocRef() { return doc(this.firestore, 'config/shipping'); }

    /** BehaviorSubject — emits null until first load, then the current settings. */
    private _settings$ = new BehaviorSubject<WebsiteSettings | null>(null);

    /** Observable that components subscribe to. Filters out the initial null. */
    get settings$(): Observable<WebsiteSettings> {
        return this._settings$.pipe(filter((s): s is WebsiteSettings => s !== null));
    }

    /** Fetches fresh data from Firestore and pushes it to the subject. */
    async loadSettings(): Promise<void> {
        try {
            const [webSnap, shipSnap] = await Promise.all([
                getDoc(this.configDocRef),
                getDoc(this.shippingDocRef)
            ]);
            const data     = webSnap.exists()  ? webSnap.data()  : {};
            const shipData = shipSnap.exists() ? shipSnap.data() : {};

            this._settings$.next({
                general:       { ...DEFAULT_SETTINGS.general,       ...data['general'] },
                social:        { ...DEFAULT_SETTINGS.social,         ...data['social'] },
                businessHours: { ...DEFAULT_SETTINGS.businessHours,  ...data['businessHours'] },
                features:      { ...DEFAULT_SETTINGS.features,       ...data['features'] },
                approvals:     { ...DEFAULT_SETTINGS.approvals,      ...data['approvals'] },
                seo:           { ...DEFAULT_SETTINGS.seo,            ...data['seo'] },
                shipping: {
                    origin: { ...DEFAULT_SETTINGS.shipping.origin, ...(shipData['origin'] || {}) },
                    rules:  { ...DEFAULT_SETTINGS.shipping.rules,  ...(shipData['rules']  || {}) }
                }
            });
        } catch (err) {
            console.error('SettingsService.loadSettings error:', err);
            // Emit defaults so the UI doesn't hang
            this._settings$.next({ ...DEFAULT_SETTINGS });
        }
    }

    async updateSettings(settings: Partial<WebsiteSettings>): Promise<void> {
        const { shipping, ...websiteConfig } = settings;

        const promises: Promise<void>[] = [];
        if (Object.keys(websiteConfig).length > 0) {
            promises.push(setDoc(this.configDocRef, websiteConfig, { merge: true }));
        }
        if (shipping) {
            const shipPayload: any = { updatedAt: new Date().toISOString() };
            if (shipping.origin) shipPayload.origin = shipping.origin;
            if (shipping.rules)  shipPayload.rules  = shipping.rules;
            promises.push(setDoc(this.shippingDocRef, shipPayload, { merge: true }));
        }

        await Promise.all(promises);
        // Re-fetch so next subscriber gets fresh data
        await this.loadSettings();
    }
}
