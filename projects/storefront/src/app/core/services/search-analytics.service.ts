import { Injectable, inject, Injector } from '@angular/core';
import { Firestore, collection, addDoc, Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { SearchEvent } from '../models/search-analytics.model';

@Injectable({
    providedIn: 'root'
})
export class SearchAnalyticsService {
    private injector    = inject(Injector);
    private authService = inject(AuthService);
    private _firestore?: Firestore;

    private get firestore(): Firestore {
        if (!this._firestore) this._firestore = this.injector.get('FIRESTORE' as any) as Firestore;
        return this._firestore!;
    }

    // Single unified collection
    private readonly EVENTS_COLLECTION = 'search_events';

    /**
     * Canonical query normalisation.
     * - Lowercases
     * - Trims surrounding whitespace
     * - Strips trailing special/junk characters (\, ?, !, ., ,, ;, :, *, +)
     * - Collapses internal multiple spaces to one
     *
     * Examples:
     *   '130/90\'  → '130/90'
     *   '130/90?'  → '130/90'
     *   '130/90 R' → '130/90 r'
     *   '  llantas  ' → 'llantas'
     */
    private normalizeTerm(raw: string): string {
        return raw
            .toLowerCase()
            .trim()
            .replace(/[\\?!.,;:*+'`]+$/, '')   // strip trailing junk (incl. quotes)
            .replace(/\s+/g, ' ')              // collapse internal spaces
            .trim();                           // final trim after replacements
    }

    // ── Internal session memory for attribution ──────────────────────────────
    /** Tracks the most-recently searched term in this session (in-memory only). */
    private _lastSearchTerm = '';

    // ────────────────────────────────────────────────────────────────────────
    // type = 'query'
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Logs a search query to search_events (type = 'query').
     * Also caches the term for downstream add_to_cart / purchase attribution.
     */
    async logSearch(
        term:        string,
        resultCount: number,
        source:      'navbar' | 'catalog_page' | 'mobile' = 'navbar'
    ): Promise<void> {
        // Min 4 chars after normalization to avoid logging partial mid-type queries
        // (user types '130', '130/', '130/9' before reaching '130/90' — all noise)
        const normalized = this.normalizeTerm(term);
        if (!normalized || normalized.length < 4) return;

        this._lastSearchTerm = normalized;
        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'query',
            term:          term.trim(),
            normalizedTerm: normalized,
            timestamp:     Timestamp.now(),
            resultCount,
            hasResults:    resultCount > 0,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            source,
            channel:       'WEB',
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search query:', error);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // type = 'click'
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Logs a search result click to search_events (type = 'click').
     */
    async logClick(
        term:        string,
        productId:   string,
        productName: string,
        position:    number
    ): Promise<void> {
        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'click',
            term,
            normalizedTerm: this.normalizeTerm(term),
            timestamp:     Timestamp.now(),
            productId,
            productName,
            position,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            source:        'navbar',
            channel:       'WEB',
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search click:', error);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // type = 'exit'
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Logs a search exit — fired when the user closes the search dropdown
     * without clicking any result. Captures dwell time as a frustration signal.
     *
     * @param term       The term that was searched
     * @param exitReason Why the dropdown closed
     * @param dwellMs    Milliseconds between the query firing and the exit
     */
    async logExit(
        term:       string,
        exitReason: 'blur' | 'clear' | 'navigate_away',
        dwellMs:    number
    ): Promise<void> {
        if (!term || term.trim().length < 2) return;

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'exit',
            term:          term.trim(),
            normalizedTerm: this.normalizeTerm(term),
            timestamp:     Timestamp.now(),
            exitReason,
            dwellMs:       Math.round(dwellMs),
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            source:        'navbar',
            channel:       'WEB',
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search exit:', error);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // type = 'add_to_cart'
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Logs a search-attributed add-to-cart event.
     * Call from CartService when adding an item if a recent search session exists.
     *
     * @param productId   The product being added
     * @param productName Product display name
     * @param cartValue   Total cart value after this add
     * @param quantity    Quantity being added
     * @param term        Override attribution term (defaults to last searched term)
     */
    async logAddToCart(
        productId:   string,
        productName: string,
        cartValue:   number,
        quantity:    number,
        term?:       string
    ): Promise<void> {
        const resolvedTerm = (term ?? this._lastSearchTerm).trim();
        if (!resolvedTerm) return;  // no search context — skip

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'add_to_cart',
            term:          resolvedTerm,
            normalizedTerm: this.normalizeTerm(resolvedTerm),
            timestamp:     Timestamp.now(),
            productId,
            productName,
            cartValue,
            quantity,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            channel:       'WEB',
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging add_to_cart:', error);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // type = 'purchase'
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Logs a search-attributed purchase event.
     * Call from the order confirmation step when the session has a known search term.
     *
     * @param orderId   Firestore order document ID
     * @param revenue   Total order revenue (MXN)
     * @param productId Optional — the specific product that matches the search
     * @param term      Override attribution term (defaults to last searched term)
     */
    async logPurchase(
        orderId:   string,
        revenue:   number,
        productId?: string,
        term?:      string
    ): Promise<void> {
        const resolvedTerm = (term ?? this._lastSearchTerm).trim();
        if (!resolvedTerm) return;  // no search context — skip

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'purchase',
            term:          resolvedTerm,
            normalizedTerm: this.normalizeTerm(resolvedTerm),
            timestamp:     Timestamp.now(),
            orderId,
            revenue,
            productId,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            channel:       'WEB',
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging purchase:', error);
        }
    }

    // ── Session ID ───────────────────────────────────────────────────────────

    private getSessionId(): string {
        let sessionId = localStorage.getItem('praxis_session_id');
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            localStorage.setItem('praxis_session_id', sessionId);
        }
        return sessionId;
    }
}

