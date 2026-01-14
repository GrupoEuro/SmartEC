
import { Timestamp } from '@angular/fire/firestore';

export type POStatus = 'draft' | 'placed' | 'manufacturing' | 'ready_to_ship' | 'shipped' | 'customs_hold' | 'customs_cleared' | 'last_mile' | 'received' | 'cancelled';

export interface POTimelineEvent {
    status: POStatus;
    timestamp: Date | Timestamp;
    description: string;
    location?: string;
    completed: boolean;
}

export interface PurchaseOrder {
    id: string; // PO Number e.g., "PO-2024-001"
    supplierId: string;
    supplierName: string; // e.g. "Michelin France"
    originCountry: string; // e.g. "FR"
    destinationWarehouseId: string; // e.g. "CDMX-MAIN"

    status: POStatus;
    createdAt: Date | Timestamp;
    updatedAt: Date | Timestamp;

    // Dates
    estimatedManufacturingCompletion?: Date | Timestamp;
    estimatedDepartureDate?: Date | Timestamp; // ETD
    estimatedArrivalDate?: Date | Timestamp; // ETA
    actualArrivalDate?: Date | Timestamp;

    // Logistics
    carrier?: string;
    trackingNumber?: string;
    containerId?: string;
    pedimento?: string; // Customs Document ID

    // Financials
    totalItems: number;
    totalCost: number;
    currency: 'USD' | 'MXN' | 'EUR';

    // The Timeline
    timeline: POTimelineEvent[];

    items?: POItem[]; // Simplified for list view
}

export interface POItem {
    sku: string;
    productName: string;
    quantity: number;
    unitCost: number;
}
