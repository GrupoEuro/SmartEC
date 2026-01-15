/**
 * Financial Constants for Mexico Market (2025)
 */

export const FINANCIAL_CONSTANTS = {
    // TAXES
    IVA_RATE: 0.16, // 16% Value Added Tax

    // PAYMENT GATEWAYS
    POS_COMMISSION_RATE: 0.035, // 3.5% + IVA (Clip/Terminal standard approximation)
    WEB_GATEWAY_RATE: 0.036,    // 3.6% (Stripe/MP standard)
    WEB_GATEWAY_FIXED: 4.00,    // $4.00 MXN Fixed Fee

    // LOGISTICS
    DEFAULT_PACKAGING_COST: 0,  // Defaults to 0 as per user "nothing added to base" unless explicit
};
