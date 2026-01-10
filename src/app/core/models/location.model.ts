/**
 * Location Model
 * Represents a physical or virtual storage location (Warehouse, FBA, Full)
 */
export interface Location {
    id: string; // 'MAIN', 'AMAZON_FBA', 'MELI_FULL'
    name: string;
    type: 'WAREHOUSE' | 'FBA' | 'FULFILLMENT_CENTER';

    // Virtual locations are controlled by 3rd parties (Amazon/MercadoLibre)
    // We cannot manually adjust stock here without a reconciliation process
    isVirtual: boolean;

    address?: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };

    active: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface InventoryLocationData {
    stock: number;      // Physical count at this location
    reserved: number;   // Reserved for orders at this location
    available: number;  // stock - reserved
}
