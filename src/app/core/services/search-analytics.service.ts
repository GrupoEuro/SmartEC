import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { SearchLog, SearchClick } from '../models/search-analytics.model';

@Injectable({
    providedIn: 'root'
})
export class SearchAnalyticsService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);

    // Collections
    private readonly LOGS_COLLECTION = 'search_logs';
    private readonly CLICKS_COLLECTION = 'search_clicks';

    /**
     * Logs a search query to Firestore.
     * @param term The user's search query
     * @param resultCount How many items were found (Crucial for Zero-Result analysis)
     */
    async logSearch(term: string, resultCount: number) {
        if (!term || term.trim().length < 2) return; // Ignore single chars

        const user = this.authService.currentUser();

        const log: SearchLog = {
            term: term.trim(),
            normalizedTerm: term.trim().toLowerCase(),
            timestamp: Timestamp.now(),
            resultCount,
            userId: user?.uid || null,
            sessionId: this.getSessionId()
        };

        try {
            await addDoc(collection(this.firestore, this.LOGS_COLLECTION), log);
        } catch (error) {
            console.error('Error logging search analytics:', error);
            // Non-blocking error, don't alert user
        }
    }

    /**
     * Logs when a user clicks a result from search.
     * Links Intent (Term) -> Action (Product)
     */
    async logClick(term: string, productId: string, productName: string, position: number) {
        const click: SearchClick = {
            term,
            productId,
            productName,
            timestamp: Timestamp.now(),
            position
        };

        try {
            await addDoc(collection(this.firestore, this.CLICKS_COLLECTION), click);
        } catch (error) {
            console.error('Error logging search click:', error);
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
