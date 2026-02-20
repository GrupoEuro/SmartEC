import { Timestamp } from '@angular/fire/firestore';

/**
 * Sales Channel Types
 */
export type SalesChannel =
    | 'AMAZON_FBA'
    | 'AMAZON_FBM'
    | 'MELI_CLASSIC'
    | 'MELI_PREMIUM'
    | 'MELI_FULL'
    | 'POS'
    | 'WEB';

export type FulfillmentType = 'FBA' | 'FBM' | 'FULL' | 'STANDARD' | 'SELF';

/**
 * Product Dimensions for Shipping Calculations
 */
export interface ProductDimensions {
    length: number;  // cm
    width: number;   // cm
    height: number;  // cm
}

/**
 * Cost Breakdown for a Channel
 */
export interface CostBreakdown {
    cog: number;                    // Cost of Goods
    commission: number;             // Marketplace commission
    fulfillmentShipping: number;    // FBA/Full or self-shipping
    storageFees: number;            // Monthly storage allocation
    paymentProcessing: number;      // Payment gateway fees
    packagingLabeling: number;      // Per-unit packaging
    inboundShipping: number;        // Shipping to warehouse
    totalCost: number;              // Sum of all costs
}

/**
 * Channel-Specific Price Information
 */
export interface ChannelPrice {
    sellingPrice: number;
    breakdown: CostBreakdown;
    grossProfit: number;
    grossMargin: number;      // Percentage (0-100)
    netProfit: number;
    netMargin: number;        // Percentage (0-100)
    roi: number;              // Return on Investment %
    competitive: boolean;     // Is price competitive? (from scraper data)
    competitorAvgPrice?: number;
    lastUpdated: Timestamp;
}

/**
 * Margin Targets for Pricing Strategy
 */
export interface MarginTargets {
    targetGrossMargin: number;    // Percentage (0-100)
    targetNetMargin: number;      // Percentage (0-100)
    minAcceptableMargin: number;  // Safety threshold (0-100)
}

/**
 * Main Pricing Strategy Document
 */
export interface PricingStrategy {
    id: string;
    productId: string;
    sku: string;
    productName?: string;

    // Base Costs
    cog: number;                    // Cost of Goods
    inboundShipping: number;        // Shipping to warehouse
    packagingCost: number;          // Per-unit packaging

    // Target Margins
    targetGrossMargin: number;      // Percentage (e.g., 50 = 50%)
    targetNetMargin: number;        // Percentage (e.g., 20 = 20%)
    minAcceptableMargin: number;    // Safety threshold

    // Product Specifications (for shipping calculation)
    weight: number;                 // kg
    dimensions: ProductDimensions;

    // Channel-Specific Prices
    channelPrices: {
        amazonFBA?: ChannelPrice;
        amazonFBM?: ChannelPrice;
        mercadoLibre?: ChannelPrice;
        mercadoLibrePremium?: ChannelPrice;
        mercadoLibreFull?: ChannelPrice;
        pos?: ChannelPrice;
        webStore?: ChannelPrice;
    };

    // Metadata
    active: boolean;
    lastCalculated: Timestamp;
    calculatedBy?: string;          // User ID who calculated
    notes?: string;

    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * Weight Tier for Fulfillment Fees
 */
export interface WeightTier {
    maxWeight: number;              // kg
    baseFee: number;                // Base fee in currency
    perKgOver: number;              // Additional cost per kg over base
}

/**
 * Fulfillment Tier (Size Category)
 */
export interface FulfillmentTier {
    sizeCategory: 'small' | 'standard' | 'large' | 'oversized';
    maxLength?: number;             // cm
    maxWidth?: number;              // cm
    maxHeight?: number;             // cm
    maxWeight?: number;             // kg
    weightTiers: WeightTier[];
}

/**
 * Commission Rules for a Channel/Country/Category
 */
export interface ChannelCommissionRule {
    id: string;
    channel: SalesChannel;
    country: string;                // 'MX', 'US', 'BR', 'CL', etc.
    category?: string;              // Product category (optional)
    categoryCode?: string;          // Amazon/ML category code

    // Fee Structure
    referralFeePercent: number;     // Base commission % (0-100)
    minReferralFee?: number;        // Minimum fee amount
    fulfillmentType: FulfillmentType;

    // Fulfillment Fees (for FBA/Full)
    fulfillmentTiers?: FulfillmentTier[];

    // Storage Fees
    monthlyStoragePerCubicMeter?: number;

    // Payment Processing
    paymentProcessingPercent: number;
    paymentProcessingFixed?: number;

    // Additional Fees
    perUnitFee?: number;            // MercadoLibre low-price items
    closingFee?: number;            // Some marketplaces

    // Metadata
    active: boolean;
    effectiveDate: Timestamp;
    endDate?: Timestamp;
    source: string;                 // 'Amazon Seller Central', 'ML Docs', etc.
    notes?: string;

    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * Pricing History Entry
 */
export interface PricingHistory {
    id: string;
    productId: string;
    sku: string;
    channel: SalesChannel;
    timestamp: Timestamp;

    priceChange: {
        oldPrice: number;
        newPrice: number;
        changePercent: number;
        reason: 'margin_adjustment' | 'competitor_match' | 'manual' | 'cost_change' | 'promotion' | 'other';
        reasonDetails?: string;
    };

    marginSnapshot: {
        grossMargin: number;
        netMargin: number;
    };

    competitorPriceSnapshot?: {
        avgPrice: number;
        minPrice: number;
        maxPrice: number;
        sampleSize: number;
    };

    userId?: string;                // Who made the change
    automated: boolean;             // Manual or automated change
}

/**
 * Pricing Alert/Warning
 */
export interface PricingAlert {
    id: string;
    productId: string;
    sku: string;
    channel: SalesChannel;

    alertType: 'low_margin' | 'negative_margin' | 'below_cog' | 'competitor_undercut' | 'high_inventory_cost';
    severity: 'info' | 'warning' | 'critical';
    message: string;

    currentMargin?: number;
    threshold?: number;

    resolved: boolean;
    resolvedAt?: Timestamp;

    createdAt: Timestamp;
}
