import { Timestamp } from 'firebase/firestore';

/**
 * Unified search event document written to `search_events`.
 * type = 'query'  → replaces search_logs
 * type = 'click'  → replaces search_clicks
 */
export interface SearchEvent {
    type:           'query' | 'click';
    term:           string;
    normalizedTerm: string;
    timestamp:      Timestamp;
    sessionId?:     string;
    userId?:        string | null;

    // type = 'query' only
    resultCount?:   number;

    // type = 'click' only
    productId?:     string;
    productName?:   string;
    position?:      number;
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
