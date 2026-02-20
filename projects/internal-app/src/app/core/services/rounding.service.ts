import { Injectable } from '@angular/core';

export type RoundingRuleType = 'NONE' | 'ENDS_IN_99' | 'ENDS_IN_95' | 'ENDS_IN_90' | 'NEAREST_5' | 'NEAREST_10' | 'MXN_RETAIL_90' | 'MXN_DISCOUNT_99' | 'MXN_CASH_50' | 'MXN_LUXURY_00';

@Injectable({
    providedIn: 'root'
})
export class RoundingService {

    applyRounding(value: number, rule: RoundingRuleType): number {
        if (rule === 'NONE') return value;

        const integerPart = Math.floor(value);

        switch (rule) {
            case 'ENDS_IN_99':
            case 'MXN_DISCOUNT_99':
                return integerPart + 0.99;
            case 'ENDS_IN_95':
                return integerPart + 0.95;
            case 'ENDS_IN_90':
            case 'MXN_RETAIL_90':
                return integerPart + 0.90;
            case 'MXN_CASH_50':
                return integerPart + 0.50;
            case 'MXN_LUXURY_00':
                // Classic luxury: Clean 00. 
                // However, usually we want to round to the nearest whole number first?
                // Let's just make sure it has .00 decimal. 
                // Actually, often luxury prices are just integers.
                return Math.round(value);
            case 'NEAREST_5':
                return Math.round(value / 5) * 5;
            case 'NEAREST_10':
                return Math.round(value / 10) * 10;
            default:
                return value;
        }
    }

    getRuleDescription(rule: RoundingRuleType): string {
        switch (rule) {
            case 'ENDS_IN_99': return 'Ends in .99 (Generic)';
            case 'MXN_DISCOUNT_99': return 'MX Supermarket (.99)';
            case 'ENDS_IN_95': return 'Ends in .95 (Value)';
            case 'ENDS_IN_90': return 'Ends in .90 (Generic)';
            case 'MXN_RETAIL_90': return 'MX Retail Standard (.90)';
            case 'MXN_CASH_50': return 'MX Cash Friendly (.50)';
            case 'MXN_LUXURY_00': return 'MX Luxury (00)';
            case 'NEAREST_5': return 'Nearest Multiple of 5';
            case 'NEAREST_10': return 'Nearest Multiple of 10';
            default: return 'No Rounding';
        }
    }
}
