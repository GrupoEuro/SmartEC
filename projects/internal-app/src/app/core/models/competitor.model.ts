export interface Competitor {
    id: string;
    name: string;
    logo?: string; // URL or icon name
    website?: string;
}

export interface CompetitorPrice {
    competitorId: string;
    competitorName: string; // Denormalized for ease
    price: number;
    lastUpdated: Date;
    url?: string; // Direct link to product
    isPromo?: boolean;
}

// ─── Price Intelligence: ML Market Scan Models ───────────────────────────────

/**
 * Top-level document stored in Firestore at:
 * price_intelligence/{fingerprint}  (e.g. "120_70_R17")
 */
export interface TireMarketScan {
    fingerprint: string;                    // "120_70_R17"
    tireSize: TireSize;
    lastScanned: Date;
    listings: MarketListing[];
    stats: MarketStats;
}

export interface TireSize {
    width: number;        // e.g. 120
    aspectRatio: number;  // e.g. 70
    diameter: number;     // e.g. 17
}

/** A single ML listing returned from the competitive market scan */
export interface MarketListing {
    itemId: string;                         // MLM123456789
    title: string;
    price: number;
    priceHistory?: PricePoint[];
    sellerId: string;
    sellerNickname?: string;
    sellerReputation: string;               // 'platinum' | 'gold_pro' | 'gold_special' | etc.
    soldQuantity: number;
    listingType: string;                    // 'gold_pro' | 'gold_special' | 'free'
    isFreeShipping: boolean;
    isOurListing: boolean;                  // ← flagged if itemId matches our meli_listings
    permalink: string;
    thumbnail: string;
    scrapedAt: Date;
}

export interface PricePoint {
    date: Date;
    price: number;
}

/** Aggregated market statistics for a tire size */
export interface MarketStats {
    lowestPrice: number;                    // Cheapest competitor price
    medianPrice: number;
    highestPrice: number;
    ourPrice: number | null;                // null if we don't list this size on ML
    positionInMarket: number | null;        // 1 = cheapest, null = not listed
    totalCompetitors: number;
    priceToWin: number;                     // Lowest competitor price (what we need to beat)
}

/** Alert created when a competitor undercuts our price significantly */
export interface PriceAlert {
    id?: string;
    tireSize: string;                       // fingerprint e.g. "120_70_R17"
    ourPrice: number;
    competitorPrice: number;
    gap: string;                            // e.g. "-25.3%"
    createdAt: Date;
    isRead: boolean;
    resolvedAt?: Date;
}

/**
 * Daily stats snapshot stored in:
 * price_intelligence/{fingerprint}/history/{YYYY-MM-DD}
 *
 * Written by meliPriceScan on every live (non-cached) scan.
 * One document per day — subsequent scans on the same day merge/overwrite.
 */
export interface PriceHistoryEntry {
    date: string;                           // "2026-04-16" (document ID too)
    scannedAt: Date;
    stats: MarketStats;
    listingCount: number;                   // total listings (competitors + ours)
    isBaseline?: boolean;                   // true for first-ever scan of this size
}
