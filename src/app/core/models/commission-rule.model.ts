export interface CommissionRule {
    id?: string;
    channel: string; // e.g., 'AMAZON_FBA', 'MELI_FULL', 'WEB'
    active: boolean;

    // MARGINS & FEES
    referralFeePercent: number;      // e.g. 15 for 15%
    paymentProcessingPercent: number; // e.g. 3.6 for 3.6%
    paymentProcessingFixed: number;   // e.g. 4 for $4.00

    // FULFILLMENT
    fulfillmentType: 'FBA' | 'FULL' | 'MERCHANT' | 'NONE';
    fulfillmentCostFixed?: number;    // If we have a fixed cost override

    // METADATA
    updatedAt?: Date;
    updatedBy?: string;
}
