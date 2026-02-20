import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, updateDoc, increment, query, where, getDocs, Timestamp, addDoc } from '@angular/fire/firestore';
import { SharedLink, LinkSession } from '../models/shared-link.model';
import { Observable, from, map } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class DocumentSharingService {
    private firestore = inject(Firestore);

    // ==========================================
    // Link Management
    // ==========================================

    async createLink(config: Omit<SharedLink, 'id' | 'createdAt' | 'stats'>): Promise<string> {
        const slug = this.generateSlug(8);
        const link: SharedLink = {
            ...config,
            id: slug,
            createdAt: Timestamp.now(),
            stats: {
                totalViews: 0,
                uniqueViewers: 0
            }
        };

        await setDoc(doc(this.firestore, 'shared_links', slug), link);
        return slug;
    }

    getLink(slug: string): Observable<SharedLink | null> {
        return from(getDoc(doc(this.firestore, 'shared_links', slug))).pipe(
            map(snap => snap.exists() ? (snap.data() as SharedLink) : null)
        );
    }

    async toggleLinkStatus(slug: string, isActive: boolean): Promise<void> {
        await updateDoc(doc(this.firestore, 'shared_links', slug), { isActive });
    }

    getLinks(): Observable<SharedLink[]> {
        const q = query(collection(this.firestore, 'shared_links'));
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => d.data() as SharedLink))
        );
    }

    // ==========================================
    // Analytics & Tracking
    // ==========================================

    async startSession(linkId: string, metadata: { viewerEmail?: string, userAgent: string }): Promise<string> {
        // 1. Create Session Record
        const session: Omit<LinkSession, 'id'> = {
            linkId,
            viewerEmail: metadata.viewerEmail || 'anonymous',
            userAgent: metadata.userAgent,
            startTime: Timestamp.now(),
            lastActive: Timestamp.now(),
            durationSeconds: 0,
            pagesViewed: []
        };

        const ref = await addDoc(collection(this.firestore, `shared_links/${linkId}/analytics`), session);

        // 2. Increment Link Stats
        // Note: Simple increment for now. Unique viewers logic would require checking previous sessions by email/IP.
        await updateDoc(doc(this.firestore, 'shared_links', linkId), {
            'stats.totalViews': increment(1)
        });

        return ref.id;
    }

    async updateSessionHeartbeat(linkId: string, sessionId: string, duration: number, pages: number[]): Promise<void> {
        const sessionRef = doc(this.firestore, `shared_links/${linkId}/analytics/${sessionId}`);
        await updateDoc(sessionRef, {
            lastActive: Timestamp.now(),
            durationSeconds: duration,
            pagesViewed: pages // In production, use arrayUnion to avoid overwriting if parallel updates
        });
    }

    async getLinkAnalytics(linkId: string): Promise<LinkSession[]> {
        const q = query(collection(this.firestore, `shared_links/${linkId}/analytics`));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LinkSession));
    }

    // ==========================================
    // Helpers
    // ==========================================

    private generateSlug(length: number): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}
