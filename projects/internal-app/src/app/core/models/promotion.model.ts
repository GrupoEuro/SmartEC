import { Timestamp } from '@angular/fire/firestore';

export type PromotionTrigger = 'exit_intent' | 'welcome_user' | 'timed_delay' | 'scroll_depth' | 'seasonal';
export type PromotionStatus  = 'active' | 'paused' | 'scheduled';

export interface BilingualText {
    es: string;
    en: string;
}

export interface Promotion {
    id?: string;
    name:       string;           // internal label (monolingual)
    status:     PromotionStatus;

    // Display — bilingual
    emoji:      string;
    headline:   BilingualText;
    body:       BilingualText;
    ctaLabel:   BilingualText;
    bgColor:    string;           // hex or css color
    couponCode: string;           // optional — links to a coupon in /coupons

    // Trigger
    trigger:         PromotionTrigger;
    triggerDelay:    number;
    scrollThreshold: number;

    // Scheduling
    startDate: Timestamp | Date | null;
    endDate:   Timestamp | Date | null;

    // Audience rules
    audienceNewOnly:  boolean;
    audienceCartOnly: boolean;
    maxShowsPerUser:  number;

    // Priority — highest fires if multiple match
    priority: number;

    // Stats
    totalShown:   number;
    totalClicked: number;

    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}
