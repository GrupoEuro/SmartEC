import { Timestamp } from '@angular/fire/firestore';
import { UserRole } from './user.model';

/**
 * Types of approval requests
 */
export type ApprovalRequestType =
    | 'COUPON_CREATION'
    | 'PROMOTION_CREATION'
    | 'PRICE_CHANGE'
    | 'BULK_DISCOUNT'
    | 'FLASH_SALE';

/**
 * Status of an approval request
 */
export type ApprovalStatus =
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'EXPIRED';

/**
 * Priority levels for approval requests
 */
export type ApprovalPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/**
 * User information for approval tracking
 */
export interface ApprovalUser {
    uid: string;
    name: string;
    email: string;
    role?: UserRole;
}

/**
 * Main approval request model
 */
export interface ApprovalRequest {
    id: string;
    type: ApprovalRequestType;
    status: ApprovalStatus;

    // Request details
    requestedBy: ApprovalUser;
    requestedAt: Timestamp;

    // Approval details
    reviewedBy?: ApprovalUser;
    reviewedAt?: Timestamp;
    rejectionReason?: string;
    reviewerNotes?: string;

    // Request-specific data
    data: CouponApprovalData | PromotionApprovalData | PriceChangeData | BulkDiscountData | FlashSaleData;

    // Metadata
    priority: ApprovalPriority;
    expiresAt?: Timestamp;
    notes?: string;

    // Auto-approval flag
    autoApproved?: boolean;
}

/**
 * Coupon creation approval data
 */
export interface CouponApprovalData {
    code: string;
    type: 'percentage' | 'fixed';
    value: number;
    description?: string;
    usageLimit?: number;
    startDate: Timestamp;
    endDate?: Timestamp;
    minPurchaseAmount?: number;
    applicableProducts?: string[];
    applicableCategories?: string[];
}

/**
 * Promotion creation approval data
 */
export interface PromotionApprovalData {
    name: string;
    type: 'CATEGORY_SALE' | 'PRODUCT_DISCOUNT';
    discountPercentage: number;
    targetProducts?: string[];
    targetCategories?: string[];
    startDate: Timestamp;
    endDate: Timestamp;
    maxQuantity?: number;
}

/**
 * Flash sale approval data
 */
export interface FlashSaleData {
    name: string;
    discountPercentage: number;
    targetProducts: string[];
    startDate: Timestamp;
    endDate: Timestamp;
    maxQuantityPerCustomer?: number;
    totalQuantityLimit?: number;
}

/**
 * Price change approval data
 */
export interface PriceChangeData {
    productId: string;
    productName: string;
    productSku: string;
    currentPrice: number;
    newPrice: number;
    changePercentage: number;
    reason: string;
}

/**
 * Bulk discount approval data
 */
export interface BulkDiscountData {
    productIds: string[];
    productCount: number;
    discountPercentage: number;
    duration: number;  // days
    reason: string;
    affectedCategories?: string[];
}

/**
 * Approval threshold configuration
 */
export interface ApprovalThreshold {
    type: ApprovalRequestType;
    autoApproveConditions?: {
        maxDiscountPercentage?: number;
        maxFixedAmount?: number;
        maxPriceChangePercentage?: number;
    };
    requiresApproval: boolean;
    notifyOnAutoApprove?: boolean;
    expirationHours?: number;  // Auto-expire after X hours
}

/**
 * Approval statistics
 */
export interface ApprovalStats {
    totalRequests: number;
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
    expired: number;
    autoApproved: number;
    averageApprovalTime: number;  // in hours
}
