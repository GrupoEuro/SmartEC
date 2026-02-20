export interface MeliItem {
    id: string; // MELI ID (e.g. MLM12345678)
    site_id: string;
    title: string;
    price: number;
    currency_id: string;
    available_quantity: number;
    sold_quantity: number;
    buying_mode: string;
    listing_type_id: string;
    condition: 'new' | 'used' | 'not_specified';
    permalink: string;
    thumbnail: string;
    pictures: { id: string; url: string }[];
    status: 'active' | 'paused' | 'closed';

    // Internal Mapping
    localProductId?: string; // ID of our local product
    lastSync?: Date;
    syncStatus?: 'SYNCED' | 'CONFLICT' | 'ORPHAN';

    // Attributes for Auto-matching
    attributes?: {
        id: string;
        name: string;
        value_name: string;
    }[];
}

export interface MeliSyncResult {
    total: number;
    updated: number;
    errors: number;
    details: string[];
}
