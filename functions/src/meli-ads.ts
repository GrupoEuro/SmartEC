/**
 * meli-ads.ts
 * Mercado Ads (Publicidad) spend sync.
 *
 * Provides two callable Cloud Functions:
 *   meliSyncAdsSpend  — sync daily ad spend for a date range
 *   meliGetAdsSummary — return MTD spend + breakdown from Firestore cache
 *
 * Data is stored in Firestore:
 *   meli_ads_daily/{YYYY-MM-DD}  → { spend, impressions, clicks, orders, date }
 *   meli_ads_campaigns/{campaignId} → { name, status, daily: [...] }
 *
 * ML Advertising API v2 docs:
 *   https://developers.mercadolibre.com/es_ar/advertising-v2
 */

import * as functions from 'firebase-functions';
import { db } from './shared';
import { getValidMeliToken } from './meli-shared';

const ADS_BASE = 'https://api.mercadolibre.com/advertising/v2';

// ─── Helper: fetch from ML Advertising API ───────────────────────────────────
async function fetchAds(path: string, token: string): Promise<any> {
    const res = await fetch(`${ADS_BASE}${path}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(`ML Ads API ${path} → ${res.status}: ${JSON.stringify(err)}`);
    }
    return res.json();
}

// ─── Format date as YYYY-MM-DD ───────────────────────────────────────────────
function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * meliSyncAdsSpend — Callable
 * Syncs Mercado Ads daily spend for a given date range.
 *
 * Input:
 *   dateFrom?: string  — YYYY-MM-DD (default: first day of current month)
 *   dateTo?:   string  — YYYY-MM-DD (default: today)
 *
 * Output:
 *   { success, daysProcessed, totalSpend, campaigns: [...] }
 */
export const meliSyncAdsSpend = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

        try {
            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = configDoc.data()?.meli;
            if (!meliConfig?.userId) throw new Error('MercadoLibre not connected.');

            const accessToken = await getValidMeliToken();
            const sellerId: string = String(meliConfig.userId);

            // Date range defaults: current MTD
            const now = new Date();
            const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            const dateFrom = data?.dateFrom || fmtDate(defaultFrom);
            const dateTo   = data?.dateTo   || fmtDate(now);

            console.log(`[MeliAds] Syncing spend from ${dateFrom} to ${dateTo} for seller ${sellerId}`);

            // ── Step 1: List all campaigns ─────────────────────────────────
            let campaigns: any[] = [];
            try {
                const campRes = await fetchAds(`/advertiser/${sellerId}/campaigns?limit=100`, accessToken);
                campaigns = campRes?.results || campRes?.campaigns || [];
                console.log(`[MeliAds] Found ${campaigns.length} campaigns`);
            } catch (e: any) {
                console.warn('[MeliAds] Could not list campaigns (may need Ads scope):', e.message);
                // Fall through to try the aggregate report
            }

            // ── Step 2: Get daily aggregate report ────────────────────────
            // ML Ads API: GET /advertiser/{id}/report?type=daily&date_from=&date_to=
            let dailyRows: any[] = [];
            let totalSpend = 0;
            let totalClicks = 0;
            let totalImpressions = 0;

            try {
                const reportRes = await fetchAds(
                    `/advertiser/${sellerId}/report?type=daily&date_from=${dateFrom}&date_to=${dateTo}`,
                    accessToken
                );
                dailyRows = reportRes?.results || reportRes?.data || [];
                console.log(`[MeliAds] Daily report rows: ${dailyRows.length}`);
            } catch (e: any) {
                // Try alternative endpoint shape
                console.warn('[MeliAds] Daily report endpoint failed, trying campaigns stats:', e.message);
            }

            // ── Step 3: If daily report worked, aggregate and write ───────
            const batch = db.batch();
            let daysProcessed = 0;

            if (dailyRows.length > 0) {
                // Group by date
                const byDate = new Map<string, { spend: number; clicks: number; impressions: number; orders: number }>();

                dailyRows.forEach((row: any) => {
                    // ML API can return date as 'date', 'date_from', or 'day'
                    const date: string = row.date || row.date_from || row.day || '';
                    if (!date) return;

                    const dateKey = date.slice(0, 10); // normalize to YYYY-MM-DD
                    const existing = byDate.get(dateKey) || { spend: 0, clicks: 0, impressions: 0, orders: 0 };
                    existing.spend       += Number(row.spend || row.cost || 0);
                    existing.clicks      += Number(row.clicks || 0);
                    existing.impressions += Number(row.impressions || 0);
                    existing.orders      += Number(row.orders || row.conversions || 0);
                    byDate.set(dateKey, existing);
                });

                byDate.forEach((stats, dateKey) => {
                    totalSpend       += stats.spend;
                    totalClicks      += stats.clicks;
                    totalImpressions += stats.impressions;

                    const docRef = db.collection('meli_ads_daily').doc(dateKey);
                    batch.set(docRef, {
                        date:        dateKey,
                        spend:       Math.round(stats.spend * 100) / 100,
                        clicks:      stats.clicks,
                        impressions: stats.impressions,
                        orders:      stats.orders,
                        // cost per click
                        cpc: stats.clicks > 0 ? Math.round((stats.spend / stats.clicks) * 100) / 100 : 0,
                        // click-through rate
                        ctr: stats.impressions > 0 ? Math.round((stats.clicks / stats.impressions) * 10000) / 100 : 0,
                        syncedAt: new Date(),
                    }, { merge: true });
                    daysProcessed++;
                });
            } else {
                // ── Fallback: per-campaign stats if daily report unavailable ──
                console.log('[MeliAds] Trying per-campaign stats as fallback...');
                for (const camp of campaigns.slice(0, 20)) {
                    try {
                        const statsRes = await fetchAds(
                            `/advertiser/${sellerId}/campaigns/${camp.id}/statistics?date_from=${dateFrom}&date_to=${dateTo}`,
                            accessToken
                        );
                        const spend = Number(statsRes?.spend || statsRes?.cost || 0);
                        totalSpend  += spend;
                        totalClicks += Number(statsRes?.clicks || 0);

                        // Write per-campaign summary
                        batch.set(db.collection('meli_ads_campaigns').doc(String(camp.id)), {
                            campaignId:  String(camp.id),
                            name:        camp.name || 'Campaign',
                            status:      camp.status || 'unknown',
                            spend:       Math.round(spend * 100) / 100,
                            clicks:      Number(statsRes?.clicks || 0),
                            impressions: Number(statsRes?.impressions || 0),
                            dateFrom, dateTo,
                            syncedAt: new Date(),
                        }, { merge: true });
                    } catch (e: any) {
                        console.warn(`[MeliAds] Campaign ${camp.id} stats failed:`, e.message);
                    }
                }
            }

            // ── Step 4: Write MTD summary ─────────────────────────────────
            const summaryRef = db.collection('meli_ads_daily').doc('_summary');
            batch.set(summaryRef, {
                dateFrom, dateTo,
                totalSpend:       Math.round(totalSpend * 100) / 100,
                totalClicks,
                totalImpressions,
                cpc: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0,
                daysProcessed,
                campaignCount: campaigns.length,
                syncedAt: new Date(),
            }, { merge: true });

            await batch.commit();

            console.log(`[MeliAds] ✅ Synced. totalSpend=$${Math.round(totalSpend*100)/100} | days=${daysProcessed} | campaigns=${campaigns.length}`);

            return {
                success: true,
                dateFrom, dateTo,
                daysProcessed,
                campaignCount: campaigns.length,
                totalSpend:       Math.round(totalSpend * 100) / 100,
                totalClicks,
                totalImpressions,
            };

        } catch (err: any) {
            console.error('[MeliAds] Sync failed:', err.message);
            throw new functions.https.HttpsError('internal', err.message);
        }
    });

/**
 * meliGetAdsSummary — Callable
 * Returns cached MTD ad spend summary + daily breakdown from Firestore.
 * Fast read — no ML API calls.
 *
 * Input: { month?: 'YYYY-MM' }
 * Output: { summary, daily: [...] }
 */
export const meliGetAdsSummary = functions
    .runWith({ timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

        try {
            const now = new Date();
            const month = data?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            // Summary doc
            const summarySnap = await db.collection('meli_ads_daily').doc('_summary').get();
            const summary = summarySnap.exists ? summarySnap.data() : null;

            // Daily docs for the requested month
            const dailySnap = await db.collection('meli_ads_daily')
                .where('date', '>=', `${month}-01`)
                .where('date', '<=', `${month}-31`)
                .orderBy('date', 'asc')
                .get();

            const daily = dailySnap.docs.map(d => d.data());

            return { success: true, month, summary, daily };

        } catch (err: any) {
            console.error('[MeliAds] GetSummary failed:', err.message);
            throw new functions.https.HttpsError('internal', err.message);
        }
    });
