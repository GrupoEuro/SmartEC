import { Timestamp } from '@angular/fire/firestore';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'returned';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface OrderItem {
    productId: string;
    productName: string;
    productImage: string;
    sku: string;
    price: number;
    quantity: number;
    subtotal: number;
    // Snapshot of product details at time of purchase
    brand?: string;
    category?: string;
}

export interface ShippingAddress {
    street: string;
    exteriorNumber: string; // Needed particularly in Mexico (Num Ext)
    interiorNumber?: string; // Num Int
    colonia?: string; // Neighborhood (Mexico specific context)
    city: string;
    state: string;
    zipCode: string;
    country: string;
    references?: string;
}

export interface CustomerInfo {
    id?: string; // UserId if registered
    name: string;
    email: string;
    phone: string;
    rfc?: string; // Mexican Tax ID
}

export interface OrderHistory {
    status: OrderStatus;
    note?: string;
    timestamp: Timestamp | Date;
    updatedBy?: string; // 'system' | 'admin' | userId
    trackingNumber?: string;
    carrier?: string;
}

export interface OrderSummary {
    id: string;
    date: Timestamp | Date;
    total: number;
    status: OrderStatus;
    items: OrderItem[];
    orderNumber: string; // e.g. ORD-001
}

export interface Order {
    id?: string;
    orderNumber: string; // Human readable ID (e.g. ORD-001)

    // Customer
    customer: CustomerInfo;

    // Items
    items: OrderItem[];

    // Financials
    subtotal: number;
    discount: number;
    shippingCost: number;
    tax: number; // IVA
    total: number;
    currency?: string;

    // [NEW] Multi-Channel Support
    channel?: 'WEB' | 'POS' | 'ON_BEHALF' | 'AMAZON_MFN' | 'AMAZON_FBA' | 'MELI_CLASSIC' | 'MELI_FULL'; // Default: 'WEB'
    externalOrderId?: string; // ID from Amazon/ML (e.g., '114-1234567-1234567')
    shippingLabelUrl?: string; // PDF URL for shipping label from external provider

    // [NEW] ON_BEHALF metadata
    metadata?: {
        enteredBy?: string; // Staff member who created the order
        enteredAt?: Date;
        source?: 'PHONE' | 'EMAIL' | 'B2B' | 'WALK_IN';
    };


    // State
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod?: 'stripe' | 'paypal' | 'bank_transfer' | 'cash';
    paymentId?: string;

    // Shipping
    shippingAddress: ShippingAddress;
    trackingNumber?: string;
    carrier?: string;

    // Meta
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
    notes?: string;

    // Operations Management
    assignedTo?: string;           // User ID of assigned warehouse staff
    assignedToName?: string;       // Display name of assigned staff
    assignmentId?: string;         // Reference to OrderAssignment document
    priorityLevel?: 'standard' | 'express' | 'rush';
    slaDeadline?: Timestamp | Date;  // Expected ship date based on priority
    isOverdue?: boolean;           // SLA status
    internalNotesCount?: number;   // Count of internal notes
    unresolvedIssuesCount?: number; // Count of unresolved issue notes

    // Audit
    history?: OrderHistory[];

    // v2.4.0 - Enhanced order features
    tags?: string[]; // URGENT, VIP, WHOLESALE, GIFT, INTERNATIONAL
    returnReason?: string; // DEFECTIVE, WRONG_ITEM, NOT_AS_DESCRIBED, CHANGED_MIND
    returnDate?: Timestamp;
    refundAmount?: number;
    refundStatus?: string; // PROCESSED, PENDING
    restockFee?: number;
    shipments?: OrderShipment[];
}

export interface OrderShipment {
    shipmentId: string;
    items: OrderItem[];
    carrier: string;
    trackingNumber: string;
    shippedDate: Timestamp;
    deliveredDate?: Timestamp;
}
