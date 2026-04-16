import { Timestamp } from '@angular/fire/firestore';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'returned';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partial';
export type SocialSource = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'TIKTOK' | 'PHONE' | 'EMAIL' | 'B2B' | 'WALK_IN' | 'OTHER';
export type ShippingMethod = 'STORE_PICKUP' | 'LOCAL_DELIVERY' | 'NATIONAL_CARRIER' | 'EXPRESS' | 'FEDEX' | 'DHL' | 'ESTAFETA' | 'AMAZON_CARRIER' | 'MELI_CARRIER';

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
    // Shipping dimensions snapshot (from product catalog, used for Skydropx parcel calc)
    weight?: number;        // kg per unit
    dimensions?: {
        length: number;     // cm
        width: number;      // cm
        height: number;     // cm
    };
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
    id?: string; // UserId if registered — absent for guest customers
    name: string;
    email: string;
    phone: string;
    rfc?: string; // Mexican Tax ID
    isGuest?: boolean; // True for social/walk-in customers not in Firebase Auth
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

    // [NEW] Multi-Channel Support & Architecture
    sourceChannel?: 'storefront' | 'mercadolibre' | 'amazon' | 'pos' | 'on_behalf';
    fulfillmentType?: 'merchant' | 'platform'; // 'merchant' (we pack) vs 'platform' (FBA/Meli Full packs)
    /** MeLi listing tier: 'premium' = gold_special/gold_pro, 'classic' = gold_premium/gold_extra, 'free' = free */
    meliListingType?: 'premium' | 'classic' | 'free';
    /** MeLi shipping mode: 'me2' (Flex/Classic merchant ship) | 'fulfillment' (Meli Full) | 'not_specified' */
    meliShipMode?: 'me2' | 'fulfillment' | 'not_specified';
    externalOrderId?: string; // ID from Amazon/ML (e.g., '114-1234567-1234567')
    shippingLabelUrl?: string; // PDF URL for shipping label from external provider
    nativeSla?: any;

    // [NEW] ON_BEHALF metadata
    metadata?: {
        enteredBy?: string;        // Staff UID who created the order
        enteredByName?: string;    // Staff display name
        enteredAt?: Date;
        source?: SocialSource;     // Where the customer came from
        sourceNote?: string;       // Free-text note (e.g. "DM on IG @eurollantas")
    };


    // State
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod?: 'stripe' | 'bank_transfer' | 'cash' | 'oxxo' | 'card_link' | 'partial';
    paymentId?: string;

    // Shipping
    shippingAddress: ShippingAddress;
    shippingMethod?: ShippingMethod;
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
