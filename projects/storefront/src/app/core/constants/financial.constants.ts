/**
 * Financial Constants for Mexico Market (2025)
 */

export const FINANCIAL_CONSTANTS = {
    // TAXES
    IVA_RATE: 0.16, // 16% Value Added Tax
    TAX_RATE_MX: 0.16, // Tax on Fees

    // PAYMENT GATEWAYS
    POS_COMMISSION_RATE: 0.035, // 3.5% + IVA (Clip/Terminal standard approximation)
    WEB_GATEWAY_RATE: 0.036,    // 3.6% (Stripe/MP standard)
    WEB_GATEWAY_FIXED: 4.00,    // $4.00 MXN Fixed Fee

    // LOGISTICS
    DEFAULT_PACKAGING_COST: 0,  // Defaults to 0 as per user "nothing added to base" unless explicit

    // DEFAULTS & FALLBACKS (When no specific rule is found)
    DEFAULT_MARGINS: {
        WEB: 0.20,      // 20% Net Margin
        AMAZON: 0.20,   // 20% Net Margin
        POS: 0.30,      // 30% Net Margin
        WHOLESALE: 0.15 // 15% Net Margin (Hypothetical)
    },
    FALLBACK_FEES: {
        REFERRAL_PERCENT: 15, // 15% Standard Marketplace Fee
        FBA_FIXED: 85.00,     // $85.00 MXN Estimated FBA Fee
        MELI_SHIPPING: 90.00, // $90.00 MXN Estimated Meli Shipping
    },
    MIN_MARGIN_PERCENT: 15,
};
