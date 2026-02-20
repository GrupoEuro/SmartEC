import { Timestamp } from '@angular/fire/firestore';
import { SalesChannel } from './pricing.model';

export type PriceBlockBasis = 'FIXED' | 'PERCENT_OF_TOTAL' | 'PERCENT_OF_BASE' | 'FORMULA';
export type PriceBlockType = 'COST' | 'FEE' | 'MARGIN' | 'TAX' | 'SHIPPING' | 'DISCOUNT';

export interface PriceBlockTemplate {
    id: string; // Internal ID for the block (e.g. 'fba_fee')
    type: PriceBlockType;
    label: string;

    // Logic
    basis: PriceBlockBasis;
    defaultValue: number; // The value to load (e.g. 15 for 15%)

    // UI Properties
    color: string;
    icon?: string;
    isLocked?: boolean; // If true, user cannot remove/edit easily

    // Advanced Formula (Optional)
    // e.g. "weight > 10 ? 150 : 80"
    formula?: string;
}

export interface PricingTemplate {
    id?: string;
    name: string;
    description?: string;

    channel: SalesChannel | 'GLOBAL';

    // The sequence of blocks that make up this strategy
    blocks: PriceBlockTemplate[];

    // Metadata
    isActive: boolean;
    createdAt?: Timestamp | Date;
    updatedAt?: Timestamp | Date;
    createdBy?: string;
}
