import { Timestamp } from '@angular/fire/firestore';

export type WebsiteTheme = 'default' | 'halloween' | 'christmas' | 'buen-fin' | 'hot-sale' | 'black-friday';

export interface ThemeConfig {
    id: WebsiteTheme;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    patternOverlay?: string;
    fontFamily?: string;
}

export interface CampaignSlide {
    imageUrl: string;           // Public download URL
    imageStoragePath: string;   // Storage path for deletion
    ctaUrl?: string;            // Internal path e.g. /catalog
    ctaLabel?: string;          // Button label e.g. "Ver más"
    order: number;              // Sort order (0-based)
    active: boolean;            // Whether to show this slide
    clickCount: number;         // Analytics: how many CTA clicks
}

export interface Campaign {
    id?: string;
    name: string;
    description?: string;
    startDate: Timestamp;
    endDate: Timestamp;
    isActive: boolean;
    priority: number; // 1-10, higher overrides lower

    // Visual Overrides
    themeId: WebsiteTheme;
    slides: CampaignSlide[];    // Hero carousel slides (replaces heroBannerId)

    // Promo Logic
    promoStripText?: string;
    activeCouponId?: string;

    // Metadata
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
}
