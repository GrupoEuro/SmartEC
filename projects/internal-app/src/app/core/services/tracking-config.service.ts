import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

export interface PixelConfig {
    enabled: boolean;
    id: string;
}

export interface TrackingConfig {
    ga4:       PixelConfig;  // Google Analytics 4
    meta:      PixelConfig;  // Meta (Facebook) Pixel
    clarity:   PixelConfig;  // Microsoft Clarity
    tiktok:    PixelConfig;  // TikTok Pixel
    gtm:       PixelConfig;  // Google Tag Manager
    pinterest: PixelConfig;  // Pinterest Tag
    snapchat:  PixelConfig;  // Snapchat Pixel
    gads:      PixelConfig;  // Google Ads conversion tag
    updatedAt?: string;
    updatedBy?: string;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
    ga4:       { enabled: false, id: '' },
    meta:      { enabled: false, id: '' },
    clarity:   { enabled: false, id: '' },
    tiktok:    { enabled: false, id: '' },
    gtm:       { enabled: false, id: '' },
    pinterest: { enabled: false, id: '' },
    snapchat:  { enabled: false, id: '' },
    gads:      { enabled: false, id: '' },
};

@Injectable({ providedIn: 'root' })
export class TrackingConfigService {
    private firestore = inject(Firestore);
    private readonly DOC_PATH = 'settings/tracking';

    async load(): Promise<TrackingConfig> {
        try {
            const snap = await getDoc(doc(this.firestore, this.DOC_PATH));
            if (snap.exists()) {
                return { ...DEFAULT_TRACKING_CONFIG, ...snap.data() } as TrackingConfig;
            }
        } catch (e) {
            console.warn('[TrackingConfig] Could not load config:', e);
        }
        return { ...DEFAULT_TRACKING_CONFIG };
    }

    async save(config: TrackingConfig, adminEmail?: string): Promise<void> {
        await setDoc(doc(this.firestore, this.DOC_PATH), {
            ...config,
            updatedAt: new Date().toISOString(),
            updatedBy: adminEmail ?? 'admin',
        });
    }
}
