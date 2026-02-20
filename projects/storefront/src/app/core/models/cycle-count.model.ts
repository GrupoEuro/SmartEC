import { Timestamp } from '@angular/fire/firestore';

export interface CycleCount {
    id?: string;
    createdAt: Timestamp;
    scheduledDate: Timestamp;
    status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    type: 'ABC' | 'ZONE' | 'SPOT' | 'FULL';
    assignedTo?: string; // User ID
    items: CycleCountItem[];
    notes?: string;
    metadata: {
        totalItems: number;
        totalVarianceValue: number;
        accuracyRate: number;
    };
}

export interface CycleCountItem {
    productId: string;
    productName: string;
    sku: string;
    expectedQuantity: number;
    countedQuantity?: number;
    variance: number; // counted - expected
    status: 'PENDING' | 'COUNTED' | 'RECOUNT_NEEDED';
    location?: string;
}
