import { Timestamp } from '@angular/fire/firestore';

export type WebsiteTheme = 'default' | 'halloween' | 'christmas' | 'buen-fin' | 'hot-sale' | 'black-friday';

export interface ThemeConfig {
    id: WebsiteTheme;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string; // e.g. dark for halloween
    patternOverlay?: string; // URL to SVG pattern
    fontFamily?: string;
}

/** Per-slide analytics written atomically by Firestore increment(). Key = slide.order as string. */
export interface CampaignSlideStats {
    impressions: number;
    clicks:      number;
}

export interface Campaign {
    id?: string;
    name: string;
    description?: string;
    startDate: Timestamp;
    endDate: Timestamp;
    isActive: boolean;
    priority: number; // 1-10, higher overrides lower (e.g. Black Friday overrides Autumn)

    // Visual Overrides
    themeId: WebsiteTheme;
    heroBannerId?: string; // Link to Banner collection (legacy)
    slides?: { imageUrl: string; imageStoragePath: string; ctaUrl?: string; ctaLabel?: string; order: number; active: boolean; clickCount: number }[];

    /**
     * Per-slide analytics — written atomically by the storefront hero.
     * Key = slide.order as string ('0', '1', '2', ...).
     */
    slideStats?: { [order: string]: CampaignSlideStats };

    // Promo Logic
    promoStripText?: string; // "Use code SCARY20 for 20% off"
    activeCouponId?: string; // ID of the coupon linked to this campaign

    // Metadata
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
}
