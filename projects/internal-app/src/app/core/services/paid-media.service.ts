import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, doc, docData, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AdInsightsResponse, PaidMediaDailySummary } from '../models/paid-media.model';

@Injectable({ providedIn: 'root' })
export class PaidMediaService {
    private fns       = inject(Functions);
    private firestore = inject(Firestore);

    // ── Firestore reads (from cache — no direct API calls) ────────────────────

    /** Latest daily summary (spend totals for the dashboard widget) */
    getLatestSummary(): Observable<PaidMediaDailySummary | null> {
        return docData(
            doc(this.firestore, 'advertising_cache/latest')
        ).pipe(
            map(d => d as PaidMediaDailySummary ?? null),
            catchError(() => of(null)),
        );
    }

    /** Read per-campaign insights from the Cloud Function (joins Firestore + orders) */
    getCampaignInsights(payload: {
        campaignName?:     string;
        metaCampaignId?:   string;
        googleCampaignId?: string;
        days?:             number;
    }): Observable<AdInsightsResponse | null> {
        const fn = httpsCallable<any, AdInsightsResponse>(this.fns, 'getPaidMediaInsights');
        return from(fn(payload)).pipe(
            map(result => result.data),
            catchError(err => {
                console.error('[PaidMediaService] getPaidMediaInsights error:', err);
                return of(null);
            }),
        );
    }

    // ── Manual sync (ADMIN / MANAGER only) ───────────────────────────────────

    /** Triggers a manual data sync for today (or a specific date) */
    async triggerSync(date?: string): Promise<{ ok: boolean; metaCampaigns: number; googleCampaigns: number; errors: string[] }> {
        const fn = httpsCallable<any, any>(this.fns, 'triggerPaidMediaSync');
        const result = await fn({ date });
        return result.data;
    }

    // ── Formatting helpers ────────────────────────────────────────────────────

    fmtMXN(v: number | null | undefined): string {
        if (v == null) return '—';
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
        }).format(v);
    }

    fmtNum(v: number | null | undefined): string {
        if (v == null) return '—';
        return new Intl.NumberFormat('es-MX').format(Math.round(v));
    }

    fmtRoas(v: number | null | undefined): string {
        if (v == null || v === 0) return '—';
        return `${v.toFixed(2)}x`;
    }

    fmtPct(v: number | null | undefined): string {
        if (v == null) return '—';
        return `${v.toFixed(2)}%`;
    }
}
