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
    normalizedTerm: string;
    timestamp:     Timestamp;
    sessionId?:    string;
    userId?:       string | null;

    // ── Context ─────────────────────────────────────────────────────────────
    source?:   'navbar' | 'catalog_page' | 'mobile';
    channel?:  'WEB' | 'POS';

    // ── type = 'query' ───────────────────────────────────────────────────────
    resultCount?:  number;
    hasResults?:   boolean;

    // ── type = 'click' ───────────────────────────────────────────────────────
    productId?:    string;
    productName?:  string;
    position?:     number;

    // ── type = 'exit' ────────────────────────────────────────────────────────
    exitReason?:   'blur' | 'clear' | 'navigate_away';
    dwellMs?:      number;

    // ── type = 'add_to_cart' ─────────────────────────────────────────────────
    cartValue?:    number;
    quantity?:     number;

    // ── type = 'purchase' ────────────────────────────────────────────────────
    orderId?:      string;
    revenue?:      number;
}

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
