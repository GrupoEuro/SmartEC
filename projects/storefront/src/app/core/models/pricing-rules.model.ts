import { Timestamp } from '@angular/fire/firestore';

export type PricingRuleTargetType = 'BRAND' | 'CATEGORY' | 'GLOBAL';
export type PricingRuleAction = 'SET_MARGIN' | 'MULTIPLIER' | 'SET_MARKUP';

export interface PricingSchedule {
    startDate: Date | Timestamp; // When the rule becomes active
    endDate?: Date | Timestamp;  // When it expires (optional)
    recurrence?: 'ANNUAL' | 'NONE'; // If 'ANNUAL', ignores the year
    isActiveNow?: boolean; // Helper for UI
}

export interface PricingRule {
    id?: string;
    name: string;

    // Targeting Logic
    targetType: PricingRuleTargetType;
    targetValue?: string; // e.g. "Michelin" or "Tires" (null for GLOBAL)

    // Action Logic
    action: PricingRuleAction | 'APPLY_TEMPLATE';
    value?: number; // Optional if using template
    templateId?: string; // Reference to a PricingTemplate

    // Time Dimension (Phase 3)
    schedule?: PricingSchedule;

    priority: number; // Higher number = Higher priority
    active: boolean;

    createdAt?: Timestamp | Date;
    updatedAt?: Timestamp | Date;
}
