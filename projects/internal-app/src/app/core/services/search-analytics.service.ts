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

    // Single unified collection (replaces search_logs + search_clicks)
    private readonly EVENTS_COLLECTION = 'search_events';

    /**
     * Logs a search query to search_events (type = 'query').
     * Replaces the old search_logs write.
     */
    async logSearch(term: string, resultCount: number): Promise<void> {
        if (!term || term.trim().length < 2) return;

        const user = this.authService.currentUser();

        const event: SearchEvent = {
            type:          'query',
            term:          term.trim(),
            normalizedTerm: term.trim().toLowerCase(),
            timestamp:     Timestamp.now(),
            resultCount,
            userId:        user?.uid ?? null,
            sessionId:     this.getSessionId()
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search query:', error);
        }
    }

    /**
     * Logs a search result click to search_events (type = 'click').
     * Replaces the old search_clicks write.
     */
    async logClick(term: string, productId: string, productName: string, position: number): Promise<void> {
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
            sessionId:     this.getSessionId()
        };

        try {
            await addDoc(collection(this.firestore, this.EVENTS_COLLECTION), event);
        } catch (error) {
            console.error('[SearchAnalytics] Error logging search click:', error);
        }
    }

    private getSessionId(): string {
        let sessionId = localStorage.getItem('praxis_session_id');
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            localStorage.setItem('praxis_session_id', sessionId);
        }
        return sessionId;
    }
}
