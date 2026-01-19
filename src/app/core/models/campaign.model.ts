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
    heroBannerId?: string; // Link to Banner collection

    // Promo Logic
    promoStripText?: string; // "Use code SCARY20 for 20% off"
    activeCouponId?: string; // Auto-apply this coupon

    // Metadata
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
}
