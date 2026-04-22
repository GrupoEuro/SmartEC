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
    /** @deprecated — use slideStats[order].clicks instead */
    clickCount: number;         // Legacy: never reliably populated by storefront
}

/**
 * Per-slide analytics counters — written by the storefront via Firestore atomic increments.
 * Key is the slide's `order` value (stringified, e.g. '0', '1', '2').
 */
export interface CampaignSlideStats {
    impressions: number;  // Times this slide was displayed to a user
    clicks:      number;  // Times the CTA button was tapped/clicked
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

    /**
     * Per-slide analytics — written atomically by the storefront hero.
     * Key = slide.order as string ('0', '1', '2', ...).
     * Use Firestore increment() to avoid losing concurrent writes.
     */
    slideStats?: { [order: string]: CampaignSlideStats };

    // Promo Logic
    promoStripText?: string;
    activeCouponId?: string;

    // ── Paid Media Platform Links ──────────────────────────────────────────
    /** Meta Ads campaign ID (numbers string, e.g. "120200000123456789").
     *  Links this campaign to advertising_snapshots/{date}/meta/{metaCampaignId} */
    metaCampaignId?: string;
    /** Google Ads campaign ID (e.g. "1234567890").
     *  Links this campaign to advertising_snapshots/{date}/google/{googleCampaignId} */
    googleCampaignId?: string;

    // Metadata
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
}

