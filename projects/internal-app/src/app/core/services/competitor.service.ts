import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { CompetitorPrice, TireMarketScan, PriceAlert } from '../models/competitor.model';

@Injectable({
    providedIn: 'root'
})
export class CompetitorService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);

    /**
     * Get real-time market scan data for a tire size from Firestore.
     * Data is written by meliPriceScan Cloud Function.
     * fingerprint format: "120_70_R17"
     */
    getMarketScan(fingerprint: string): Observable<TireMarketScan | null> {
        const docRef = doc(this.firestore, 'price_intelligence', fingerprint);
        return (docData(docRef) as Observable<any>).pipe(
            map(data => {
                if (!data) return null;
                return {
                    ...data,
                    lastScanned: data.lastScanned?.toDate?.() ?? new Date(),
                    listings: (data.listings || []).map((l: any) => ({
                        ...l,
                        scrapedAt: l.scrapedAt?.toDate?.() ?? new Date()
                    }))
                } as TireMarketScan;
            }),
            catchError(() => of(null))
        );
    }

    /**
     * Trigger a fresh competitor price scan via Firebase Cloud Function.
     * The function uses ML's attribute-based search API filtered by tire size.
     * Results are cached in Firestore for 4h (pass force=true to bypass).
     */
    async triggerScan(
        width: number,
        aspectRatio: number,
        diameter: number,
        categoryId = 'MLM371',
        force = false
    ): Promise<{ cached: boolean; fingerprint: string; count: number }> {
        const scanFn = httpsCallable(this.functions, 'meliPriceScan');
        const result: any = await scanFn({ width, aspectRatio, diameter, categoryId, force });
        return result.data;
    }

    /**
     * Get recent price alerts from Firestore.
     */
    getRecentAlerts(limitCount = 10): Observable<PriceAlert[]> {
        const q = query(
            collection(this.firestore, 'price_alerts'),
            orderBy('createdAt', 'desc'),
            limit(limitCount)
        );
        return (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
            map(alerts => alerts.map((a: any) => ({
                ...a,
                createdAt: a.createdAt?.toDate?.() ?? new Date()
            }))),
            catchError(() => of([]))
        );
    }

    /**
     * @deprecated Use getMarketScan() instead.
     * Kept for backward compatibility with SmartPriceConstructor until refactored.
     */
    getCompetitorPrices(productId: string): Observable<CompetitorPrice[]> {
        console.warn('[CompetitorService] getCompetitorPrices is deprecated. Use getMarketScan() with a tire size fingerprint.');
        return of([]);
    }
}
