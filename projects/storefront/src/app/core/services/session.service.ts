import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const SESSION_KEY = 'cart_session_id';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

interface StoredSession {
    id:        string;
    createdAt: number;
}

/**
 * Single source of truth for the visitor's session ID.
 *
 * Rules:
 *  - One ID per browser (localStorage), survives tabs, page reloads, and up to 30 days.
 *  - Resets after 30 days of inactivity (same TTL as attribution).
 *  - On SSR the id is 'ssr' (safe no-op).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
    private platformId = inject(PLATFORM_ID);

    readonly sessionId: string = this.resolveSessionId();

    /** Was this a brand-new session (no prior localStorage entry)? */
    readonly isNewSession: boolean;

    constructor() {
        // isNewSession is set by resolveSessionId — but we need a two-phase init trick.
        // We initialise the flag inside resolveSessionId (set on 'this' before return).
        // TypeScript requires the field to be set in the constructor, so we re-read:
        this.isNewSession = (this as any)._isNewSession ?? false;
    }

    private resolveSessionId(): string {
        if (!isPlatformBrowser(this.platformId)) return 'ssr';

        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (raw) {
                const stored: StoredSession = JSON.parse(raw);
                // Expire after TTL
                if (Date.now() - stored.createdAt < SESSION_TTL) {
                    (this as any)._isNewSession = false;
                    return stored.id;
                }
            }

            // Create a new session ID
            const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            const payload: StoredSession = { id, createdAt: Date.now() };
            localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
            (this as any)._isNewSession = true;
            return id;
        } catch {
            (this as any)._isNewSession = true;
            return `s_${Date.now()}`;
        }
    }

    /** Refresh the TTL without changing the ID (call on meaningful activity). */
    touchSession(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return;
            const stored: StoredSession = JSON.parse(raw);
            stored.createdAt = Date.now();
            localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
        } catch { /* noop */ }
    }
}
