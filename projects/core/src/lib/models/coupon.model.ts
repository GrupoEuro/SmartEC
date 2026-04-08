import { Timestamp } from '@angular/fire/firestore';

export type DiscountType = 'percentage' | 'fixed_amount';
export type CouponStatus = 'live' | 'pending' | 'rejected';

export interface Coupon {
    id?: string;
    code: string; // e.g., "WELCOME10", unique, uppercase
    type: DiscountType;
    value: number; // Percentage (0-100) or Fixed Amount
    description?: string;
    redirectUrl?: string; // Custom URL to redirect to upon scanning
    qrLogoUrl?: string; // Optional logo for the center of the QR code

    // Constraints
    minPurchaseAmount?: number;
    startDate: Timestamp | Date;
    endDate?: Timestamp | Date;
    usageLimit: number; // Max total global uses (0 = unlimited)
    usageCount: number; // Current total uses
    scanCount?: number; // Total number of times the QR was scanned

    isActive: boolean;
    /** Approval workflow: 'live' (approved/direct), 'pending' (requested from Marketing Hub), 'rejected' */
    status?: CouponStatus;
    /** UID of the marketing user who requested this coupon */
    requestedBy?: string;
    /** Display name of the requester */
    requestedByName?: string;
    /** Admin rejection reason */
    rejectionReason?: string;

    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}
