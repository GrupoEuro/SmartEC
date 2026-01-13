import { Timestamp } from '@angular/fire/firestore';

export type PricingRuleTargetType = 'BRAND' | 'CATEGORY' | 'GLOBAL';
export type PricingRuleAction = 'SET_MARGIN' | 'MULTIPLIER';

export interface PricingRule {
    id?: string;
    name: string;

    // Targeting Logic
    targetType: PricingRuleTargetType;
    targetValue?: string; // e.g. "Michelin" or "Tires" (null for GLOBAL)

    // Action Logic
    action: PricingRuleAction;
    value: number; // e.g. 20 (for 20% margin) or 1.25 (for 1.25x multiplier)

    priority: number; // Higher number = Higher priority
    active: boolean;

    createdAt?: Timestamp | Date;
    updatedAt?: Timestamp | Date;
}
