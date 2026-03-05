import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, shareReplay, catchError } from 'rxjs/operators';

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
    }
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
        whatsapp: '+52 1 444 200 4677',
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
        }
    }
};

@Injectable({
    providedIn: 'root'
})
export class SettingsService {
    private firestore = inject(Firestore);
    // Use 'as any' only if strict types block doc() creation, but try to avoid if possible.


    private get configDocRef() { return doc(this.firestore, 'config/website'); }
    private get shippingDocRef() { return doc(this.firestore, 'config/shipping'); }

    // Observable that loads settings once on subscription
    settings$: Observable<WebsiteSettings> = new Observable<WebsiteSettings>(observer => {
        Promise.all([
            getDoc(this.configDocRef),
            getDoc(this.shippingDocRef)
        ]).then(([webSnap, shipSnap]) => {
            const data = webSnap.exists() ? webSnap.data() : {};
            const shipData = shipSnap.exists() ? shipSnap.data() : {};
            
            observer.next({
                general: { ...DEFAULT_SETTINGS.general, ...data['general'] },
                social: { ...DEFAULT_SETTINGS.social, ...data['social'] },
                businessHours: { ...DEFAULT_SETTINGS.businessHours, ...data['businessHours'] },
                features: { ...DEFAULT_SETTINGS.features, ...data['features'] },
                seo: { ...DEFAULT_SETTINGS.seo, ...data['seo'] },
                shipping: { ...DEFAULT_SETTINGS.shipping, ...shipData['shipping'], ...(shipData['origin'] ? { origin: shipData['origin'] } : {}) }
            });
            observer.complete();
        }).catch(err => {
            console.error('SettingsService Error:', err);
            observer.next(DEFAULT_SETTINGS);
            observer.complete();
        });
    }).pipe(shareReplay(1));

    async updateSettings(settings: Partial<WebsiteSettings>): Promise<void> {
        const { shipping, ...websiteConfig } = settings;
        
        const promises = [];
        if (Object.keys(websiteConfig).length > 0) {
            promises.push(setDoc(this.configDocRef, websiteConfig, { merge: true }));
        }
        if (shipping) {
            // Note: Cloud function expects { origin: {...} } at root of config/shipping
            promises.push(setDoc(this.shippingDocRef, { origin: shipping.origin, updatedAt: new Date().toISOString() }, { merge: true }));
        }
        
        await Promise.all(promises);
    }
}
