import { Timestamp } from 'firebase/firestore';

/**
 * Unified search event document written to `search_events`.
 *
 * 5-step search funnel:
 *  type = 'query'       → user typed ≥2 chars and results loaded
 *  type = 'click'       → user clicked a result in the dropdown
 *  type = 'exit'        → dropdown closed with no click (frustration / browse)
 *  type = 'add_to_cart' → a clicked product was added to cart in the same session
 *  type = 'purchase'    → order completed containing a previously clicked product
 */
export interface SearchEvent {
    type:          'query' | 'click' | 'exit' | 'add_to_cart' | 'purchase';
    term:          string;
    normalizedTerm: string;           // lowercase + trimmed, for aggregation
    timestamp:     Timestamp;
    sessionId?:    string;
    userId?:       string | null;

    // ── Context ─────────────────────────────────────────────────────────────
    /** Where the search bar lives. Default: 'navbar' */
    source?:   'navbar' | 'catalog_page' | 'mobile';
    /** Sales channel the search occurred in. */
    channel?:  'WEB' | 'POS';

    // ── type = 'query' ───────────────────────────────────────────────────────
    resultCount?:  number;
    /** true when resultCount > 0. Pre-computed to simplify BQ filter logic. */
    hasResults?:   boolean;

    // ── type = 'click' ───────────────────────────────────────────────────────
    productId?:    string;
    productName?:  string;
    /** 1-based rank position in the result list at time of click. */
    position?:     number;

    // ── type = 'exit' ────────────────────────────────────────────────────────
    /** Why the search was abandoned without a click. */
    exitReason?:   'blur' | 'clear' | 'navigate_away';
    /** Milliseconds between query firing and exit. Measures engagement/frustration. */
    dwellMs?:      number;

    // ── type = 'add_to_cart' ─────────────────────────────────────────────────
    cartValue?:    number;   // total cart value at the time of add
    quantity?:     number;

    // ── type = 'purchase' ────────────────────────────────────────────────────
    orderId?:      string;
    revenue?:      number;   // total order revenue
}

// ── Legacy aliases kept for backwards compatibility during transition ──────────

/** @deprecated Use SearchEvent with type='query' */
export type SearchLog = Omit<SearchEvent, 'type' | 'productId' | 'productName' | 'position'> & {
    resultCount: number;
};

/** @deprecated Use SearchEvent with type='click' */
export type SearchClick = Omit<SearchEvent, 'type' | 'resultCount'> & {
    productId:   string;
    productName: string;
    position:    number;
};
