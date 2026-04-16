import { Timestamp } from '@angular/fire/firestore';

export interface MeliListingDoc {
    id: string;                         // MLM1234567890
    title: string;
    status: 'active' | 'paused' | 'closed' | 'under_review';
    price: number;
    currency_id: string;                // 'MXN'
    listing_type_id: string;            // 'gold_pro' | 'gold_special' | 'free'
    listing_type_name: string;          // 'Premium' | 'Clásica' | 'Gratis'
    sold_quantity: number;
    available_quantity: number;
    health: number | null;              // 0–100 listing quality score
    logistic_type: string;              // 'fulfillment' | 'me2' | 'not_specified'
    is_full: boolean;                   // true = MeLi Full (fulfillment center)

    // Shipping info (from item.shipping)
    free_shipping: boolean;             // Seller absorbs shipping cost (envío gratis)
    local_pickup_only: boolean;         // No Mercado Envíos configured

    user_product_id: string | null;
    category_id: string;
    seller_custom_field: string | null; // Your SKU/reference
    permalink: string;
    thumbnail: string;

    // Fee data from /sites/MLM/listing_prices (with auth token for seller-specific rates)
    selling_fee_amount: number;         // Total MeLi commission in MXN
    selling_fee_percent: number;        // e.g. 15.0 (from API, not recalculated)
    fixed_fee: number;                  // Fixed per-unit charge (often 0 in MLM)
    financing_fee: number;              // MSI installment cost MeLi deducts from seller (~2-3%)
    net_amount: number;                 // price - selling_fee - fixed_fee - financing_fee
    net_percent: number;                // (net_amount / price) * 100   ← before shipping cost
    fee_has_data: boolean;              // false when fee API call failed (numbers = 0)

    // Kit / Combo / Bundle
    item_type: 'single' | 'kit' | 'combo';   // 'single' = individual item
    is_combo: boolean;
    pack_qty: number | null;            // Pack size from PACK_CONTENT attribute (e.g. 2, 4)
    bundle_components: Array<{ item_id: string; quantity: number }>;

    lastSync: Timestamp | Date;

    // Tire size attributes — extracted from item.attributes during meliSyncListings
    // Used by meliPriceScan to auto-detect our own listings in the market
    tireWidth?: number | null;              // TIRE_WIDTH attribute
    tireAspectRatio?: number | null;        // ASPECT_RATIO attribute
    tireDiameter?: number | null;           // RIM_DIAMETER attribute
}
