import { Timestamp } from '@angular/fire/firestore';

/**
 * Advanced Shipping Notice (ASN)
 * Represents expected incoming shipments
 */
export interface AdvancedShippingNotice {
    id?: string;
    asnNumber: string;
    purchaseOrderRef?: string;
    supplierId?: string;
    supplierName: string;
    warehouseId: string;
    expectedDate: Timestamp;
    status: ASNStatus;
    items: ASNItem[];
    notes?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy?: string;
}

export type ASNStatus = 'pending' | 'partial' | 'received' | 'cancelled';

export interface ASNItem {
    productId: string;
    productSku: string;
    productName: string;
    expectedQuantity: number;
    receivedQuantity: number;
    uom: string; // Unit of measure (ea, box, pallet)
}

/**
 * Goods Receipt Note (GRN)
 * Records actual received items
 */
export interface GoodsReceiptNote {
    id?: string;
    grnNumber: string;
    asnId?: string;
    warehouseId: string;
    receivedDate: Timestamp;
    receivedBy: string; // User ID
    status: GRNStatus;
    items: GRNItem[];
    notes?: string;
    createdAt: Timestamp;
    updatedAt?: Timestamp;
}

export type GRNStatus = 'draft' | 'completed' | 'voided';

export interface GRNItem {
    productId: string;
    productSku: string;
    productName: string;
    quantityReceived: number;
    quantityAccepted: number;
    quantityRejected: number;
    rejectionReason?: string;
    qualityStatus: QualityStatus;
    lotNumber?: string;
    expiryDate?: Timestamp;
    binLocation?: string; // Where placed after putaway
}

export type QualityStatus = 'passed' | 'failed' | 'pending';

/**
 * Putaway Task
 * Directs warehouse staff where to place received items
 */
export interface PutawayTask {
    id?: string;
    grnId: string;
    grnNumber: string;
    warehouseId: string;
    productId: string;
    productSku: string;
    productName: string;
    quantity: number;
    fromLocation: string; // Receiving dock
    suggestedLocation: string; // AI-suggested bin
    actualLocation?: string; // Where actually placed
    status: PutawayStatus;
    assignedTo?: string; // User ID
    priority: PutawayPriority;
    createdAt: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
}

export type PutawayStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';
export type PutawayPriority = 'high' | 'medium' | 'low';

/**
 * Helper type for creating new records
 */
export type CreateASN = Omit<AdvancedShippingNotice, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateGRN = Omit<GoodsReceiptNote, 'id' | 'createdAt'>;
export type CreatePutawayTask = Omit<PutawayTask, 'id' | 'createdAt'>;
