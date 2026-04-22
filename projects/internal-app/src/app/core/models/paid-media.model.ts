// ─── Paid Media Intelligence Models ──────────────────────────────────────────
// Firestore path: advertising_snapshots/{YYYY-MM-DD}/meta/{campaignId}
//                 advertising_snapshots/{YYYY-MM-DD}/google/{campaignId}
// Cache path:     advertising_cache/latest

// ── Meta Ads ─────────────────────────────────────────────────────────────────

export interface MetaPlacementBreakdown {
    placement: 'feed' | 'reels' | 'stories' | 'search' | 'audience_network' | string;
    impressions: number;
    clicks: number;
    spend: number;
}

export interface MetaInsights {
    campaignId:   string;
    campaignName: string;
    status:       string;          // ACTIVE | PAUSED | DELETED | ARCHIVED
    spend:        number;          // MXN
    impressions:  number;
    clicks:       number;
    reach:        number;          // unique people
    frequency:    number;          // avg times the same person saw the ad
    cpm:          number;          // cost per 1000 impressions
    cpc:          number;          // cost per click
    ctr:          number;          // click-through rate %
    purchases:    number;          // actions[purchase] — Meta-attributed
    purchaseValue: number;         // action_values[purchase] — MXN
    purchaseRoas:  number;         // purchase_roas (Meta-claimed, usually inflated)
    addToCart:    number;          // actions[add_to_cart]
    viewContent:  number;          // actions[view_content]
    placements?:  MetaPlacementBreakdown[];
    datePreset:   string;          // 'yesterday' | 'last_7d' | 'last_30d'
    snapshotDate: string;          // 'YYYY-MM-DD'
    pulledAt:     FirestoreTimestamp;
}

export interface GoogleInsights {
    campaignId:          string;
    campaignName:        string;
    status:              string;   // ENABLED | PAUSED | REMOVED
    spend:               number;   // MXN (cost_micros ÷ 1_000_000)
    impressions:         number;
    clicks:              number;
    ctr:                 number;   // %
    avgCpc:              number;   // MXN
    conversions:         number;   // primary conversions
    allConversions:      number;   // includes cross-device
    conversionsValue:    number;   // MXN
    costPerConversion:   number;   // MXN
    impressionShare?:    number;   // search_impression_share %
    snapshotDate:        string;   // 'YYYY-MM-DD'
    pulledAt:            FirestoreTimestamp;
}

// ── Cross-platform summary (advertising_cache/latest) ────────────────────────

export interface PaidMediaDailySummary {
    date:              string;    // 'YYYY-MM-DD'
    totalSpend:        number;    // Meta + Google combined (MXN)
    metaSpend:         number;
    googleSpend:       number;
    metaImpressions:   number;
    googleImpressions: number;
    metaClicks:        number;
    googleClicks:      number;
    metaPurchases:     number;
    googleConversions: number;
    metaRoas:          number;    // Meta-claimed
    googleRoas:        number;    // Google-claimed (conversionsValue / spend)
    updatedAt:         FirestoreTimestamp;
}

// ── Unified campaign insights (returned by getPaidMediaInsights callable) ─────

export interface AdInsightsResponse {
    // Internal (Firestore orders)
    internalOrders:  number;
    internalRevenue: number;

    // Meta
    meta?: MetaInsights;

    // Google
    google?: GoogleInsights;

    // Computed cross-platform
    totalSpend:   number;         // meta.spend + google.spend
    realRoas:     number | null;  // internalRevenue / totalSpend (null if no spend)
    realCpa:      number | null;  // totalSpend / internalOrders

    // Frequency warning (Meta)
    frequencyWarning: boolean;    // true if meta.frequency > 4.5

    // History (last N days from snapshots)
    history: AdInsightsHistoryPoint[];
}

export interface AdInsightsHistoryPoint {
    date:         string;
    metaSpend:    number;
    googleSpend:  number;
    totalSpend:   number;
    revenue:      number;   // from Firestore orders
    roas:         number | null;
}

// ── Firestore Timestamp (minimal interface for client use) ────────────────────
export interface FirestoreTimestamp {
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
}
