export type BlockType = 'COST' | 'TAX' | 'FEE' | 'MARGIN' | 'DISCOUNT' | 'PRICE' | 'SHIPPING';

export type CalculationBasis =
    | 'FIXED'               // Absolute value (e.g. $10)
    | 'PERCENT_OF_BASE'     // % of the previous subtotal or base cost
    | 'PERCENT_OF_TOTAL';   // % of the FINAL price (Revenue) - Circular dependency typical in marketplaces

export interface PriceBlock {
    id: string;
    type: BlockType;
    label: string;
    value: number;            // The input value (e.g., 16 for 16% or 50 for $50)
    basis: CalculationBasis;  // How to calculate the monetary amount

    // Result fields (calculated)
    calculatedAmount?: number;
    subtotalAfter?: number;

    // UI Properties
    color: string;
    icon?: string;
    isLocked?: boolean;       // Cannot be removed (e.g. COG)
    description?: string;
    active: boolean;          // Toggle on/off without removing
}

export interface ConstructorState {
    mode: 'FORWARD' | 'INVERSE';
    channel: string; // 'AMAZON', 'POS', 'WEB', 'MANUAL'
    blocks: PriceBlock[];
    startValue: number; // COG (Forward) or TargetPrice (Inverse)
}
