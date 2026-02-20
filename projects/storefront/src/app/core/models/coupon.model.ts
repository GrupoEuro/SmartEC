import { Timestamp } from '@angular/fire/firestore';

export type DiscountType = 'percentage' | 'fixed_amount';

export interface Coupon {
    id?: string;
    code: string; // e.g., "WELCOME10", unique, uppercase
    type: DiscountType;
    value: number; // Percentage (0-100) or Fixed Amount
    description?: string;

    // Constraints
    minPurchaseAmount?: number;
    startDate: Timestamp | Date;
    endDate?: Timestamp | Date;
    usageLimit: number; // Max total global uses (0 = unlimited)
    usageCount: number; // Current total uses

    isActive: boolean;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}
