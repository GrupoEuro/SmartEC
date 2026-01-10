import { Timestamp } from '@angular/fire/firestore';

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
    productId: string;
    sku: string;
    productName: string; // Generic name for display
    quantityOrdered: number;
    quantityReceived: number;
    unitCost: number; // The logic: Is this estimated or final?
    totalCost: number;
    notes?: string;

    // Import Data
    autoLinked?: boolean;
    originalDescription?: string;
}

export interface SupplierInvoice {
    id?: string;
    uuid: string; // CFDI UUID (Folio Fiscal)
    invoiceNumber: string; // Folio Interno
    date: Date | Timestamp;
    totalAmount: number;
    currency: string;
    pdfUrl?: string; // Link to stored PDF
    xmlUrl?: string; // Link to stored XML
    status: 'VALID' | 'PENDING' | 'CANCELLED';
}

export interface SupplierProductMapping {
    id?: string;
    supplierId: string; // The RFC or Internal Supplier ID
    supplierSku: string; // The code in the XML
    internalProductId: string; // Your DB ID
    internalSku: string; // Your SKU (denormalized for display)
    lastVerified: Date | Timestamp;
}

export interface PurchaseOrder {
    id?: string; // Firestore ID
    poNumber: string; // Human readable, e.g., PO-2024-001

    supplierId: string;
    supplierName: string;

    status: PurchaseOrderStatus;

    // Dates
    createdAt: Date | Timestamp;
    updatedAt: Date | Timestamp;
    expectedArrivalDate?: Date | Timestamp;
    actualArrivalDate?: Date | Timestamp;

    // Financials
    currency: 'MXN' | 'USD';
    exchangeRate: number; // If USD, what was the rate? (Defaults to 1 for MXN)
    subtotal: number;
    taxTotal: number;
    shippingCost?: number;
    otherCosts?: number; // Import fees, customs
    grandTotal: number;

    // Items
    items: PurchaseOrderItem[];

    // Documentation
    invoices: SupplierInvoice[]; // Attached CFDI invoices
    relatedUuids?: string[]; // Queryable array of Invoice UUIDs for duplicate checking

    notes?: string;

    // Audit
    createdByUserId: string;
    receivedByUserId?: string;

    // Integrity
    fileHash?: string; // Content hash to prevent duplicate imports
}
