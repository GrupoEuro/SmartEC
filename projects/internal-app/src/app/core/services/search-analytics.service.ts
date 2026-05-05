import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { SearchEvent } from '../models/search-analytics.model';

@Injectable({
    providedIn: 'root'
})
export class SearchAnalyticsService {
    private firestore   = inject(Firestore);
    private authService = inject(AuthService);

    private readonly EVENTS_COLLECTION = 'search_events';

    /** Tracks the most-recently searched term in this session (in-memory only). */
    private _lastSearchTerm = '';

    // ── type = 'query' ───────────────────────────────────────────────────────

    async logSearch(
        term:        string,
        resultCount: number,
        source:      'navbar' | 'catalog_page' | 'mobile' = 'navbar'
    ): Promise<void> {
        if (!term || term.trim().length < 2) return;

        this._lastSearchTerm = term.trim();
        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'query',
            term:          term.trim(),
            normalizedTerm: term.trim().toLowerCase(),
            timestamp:     Timestamp.now(),
            resultCount,
            hasResults:    resultCount > 0,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
            source,
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search query:', error);
        }
    }

    // ── type = 'click' ───────────────────────────────────────────────────────

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
            normalizedTerm: term.toLowerCase(),
            timestamp:     Timestamp.now(),
            productId,
            productName,
            position,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search click:', error);
        }
    }

    // ── type = 'exit' ────────────────────────────────────────────────────────

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
            normalizedTerm: term.trim().toLowerCase(),
            timestamp:     Timestamp.now(),
            exitReason,
            dwellMs:       Math.round(dwellMs),
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search exit:', error);
        }
    }

    // ── type = 'add_to_cart' ─────────────────────────────────────────────────

    async logAddToCart(
        productId:   string,
        productName: string,
        cartValue:   number,
        quantity:    number,
        term?:       string
    ): Promise<void> {
        const resolvedTerm = (term ?? this._lastSearchTerm).trim();
        if (!resolvedTerm) return;

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'add_to_cart',
            term:          resolvedTerm,
            normalizedTerm: resolvedTerm.toLowerCase(),
            timestamp:     Timestamp.now(),
            productId,
            productName,
            cartValue,
            quantity,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging add_to_cart:', error);
        }
    }

    // ── type = 'purchase' ────────────────────────────────────────────────────

    async logPurchase(
        orderId:   string,
        revenue:   number,
        productId?: string,
        term?:      string
    ): Promise<void> {
        const resolvedTerm = (term ?? this._lastSearchTerm).trim();
        if (!resolvedTerm) return;

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'purchase',
            term:          resolvedTerm,
            normalizedTerm: resolvedTerm.toLowerCase(),
            timestamp:     Timestamp.now(),
            orderId,
            revenue,
            productId,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId(),
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
