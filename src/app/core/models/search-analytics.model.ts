import { Timestamp } from 'firebase/firestore';

export interface SearchLog {
    term: string;
    normalizedTerm: string; // "michelin" (lowercase, trimmed)
    timestamp: Timestamp;
    resultCount: number;
    userId?: string | null; // Optional, if logged in
    sessionId?: string; // For guest tracking
}

export interface SearchClick {
    term: string;
    productId: string;
    productName: string;
    timestamp: Timestamp;
    position: number; // Rank in search results (1st, 2nd...)
}
