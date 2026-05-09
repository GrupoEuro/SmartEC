/**
 * Competitor Intelligence — MercadoLibre
 *
 * Uses the official public MeLi API (no competitor auth required) to:
 *   1. Search top results for configured keywords (e.g. "llantas moto")
 *   2. Fetch each item's price, sold_quantity, and seller reputation
 *   3. Snapshot results to Firestore daily for velocity tracking
 *   4. Expose aggregated data to the admin frontend via a callable function
 *
 * Key insight: sold_quantity is public — by snapshotting it daily we derive
 * per-period sales velocity for any competitor SKU without violating ToS.
 *
 * Rate limit: 1,500 req/min per token — we stay well under by batching.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CompetitorConfig {
    keywords:       string[];         // e.g. ["llantas moto 110/70-17", "llanta scooter"]
    trackedSellers: string[];         // specific seller IDs to deep-track
    ourSellerId:    string;           // your own MeLi seller ID (excluded from competitor view)
    site:           string;           // "MLM" for Mexico
    maxResultsPerKeyword: number;     // default 50 (MeLi max per page is 50)
    enabled:        boolean;
}

export interface CompetitorItem {
    itemId:          string;
    title:           string;
    price:           number;
    currencyId:      string;
    soldQuantity:    number;          // lifetime total — snapshot delta = period sales
    availableQty:    number;
    condition:       string;         // "new" | "used"
    sellerId:        string;
    sellerNickname:  string;
    sellerLevel:     string;         // "5_green" | "4_light_green" | etc.
    thumbnail:       string;
    permalink:       string;
    shipping:        string;         // "free" | "paid"
    keyword:         string;         // which keyword surfaced this item
    searchPosition:  number;         // position in search results (1-indexed)
    scannedAt:       admin.firestore.Timestamp;
}

export interface CompetitorSnapshot {
    date:        string;             // YYYY-MM-DD
    items:       CompetitorItem[];
    totalScanned: number;
    keywords:    string[];
    durationMs:  number;
    createdAt:   admin.firestore.Timestamp;
}

export interface VelocityEntry {
    itemId:        string;
    title:         string;
    sellerId:      string;
    sellerNickname: string;
    sellerLevel:   string;
    price:         number;
    soldQtyDelta:  number;           // units sold in last period (snapshot delta)
    soldQtyTotal:  number;           // lifetime total
    avgPrice:      number;           // avg price over snapshots
    revenueEstimate: number;         // soldQtyDelta × price
    keyword:       string;
    permalink:     string;
    thumbnail:     string;
    searchPosition: number;
    lastScanned:   string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAppToken(): Promise<string> {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meli = configDoc.data()?.meli ?? {};

    // Prefer app-level (client_credentials) token — better for public data reads
    const cached    = meli.appAccessToken;
    const cachedExp = meli.appTokenExpiresAt ?? 0;
    if (cached && (cachedExp - Date.now()) > 10 * 60 * 1000) return cached as string;

    const appId       = meli.appId;
    const clientSecret = meli.clientSecret;
    if (!appId || !clientSecret) {
        // Fallback: user OAuth token
        if (meli.accessToken) return meli.accessToken as string;
        throw new Error('[CompetitorIntel] No MeLi credentials configured. Connect MeLi in /admin/integrations.');
    }

    const res  = await fetch('https://api.mercadolibre.com/oauth/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body:    new URLSearchParams({ grant_type: 'client_credentials', client_id: appId, client_secret: clientSecret }).toString(),
    });
    const data = await res.json() as any;
    if (!res.ok || !data.access_token) throw new Error('[CompetitorIntel] Token fetch failed: ' + JSON.stringify(data));

    const expiresAt = Date.now() + (data.expires_in * 1000);
    await db.collection('config').doc('integrations').set(
        { meli: { appAccessToken: data.access_token, appTokenExpiresAt: expiresAt } },
        { merge: true }
    );
    return data.access_token as string;
}

async function meliGet(path: string, token: string): Promise<any> {
    const res  = await fetch(`https://api.mercadolibre.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`[MeLiGET] ${path} → ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

/** Chunk an array into batches of size n */
function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

/** Sleep for ms milliseconds */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Core scan logic ────────────────────────────────────────────────────────

async function runCompetitorScan(triggeredBy: 'cron' | 'manual' = 'cron'): Promise<{
    date: string; totalScanned: number; keywords: string[]; durationMs: number;
}> {
    const start = Date.now();
    console.log(`[CompetitorIntel] Starting scan — triggered by: ${triggeredBy}`);

    // Load config
    const configDoc = await db.collection('competitor_config').doc('default').get();
    if (!configDoc.exists) {
        // Create default config on first run
        await db.collection('competitor_config').doc('default').set({
            keywords: [
                'llantas moto',
                'llanta moto 110/70-17',
                'llanta moto 130/70-17',
                'llanta scooter',
                'llantas auto económicas',
            ],
            trackedSellers: [],
            ourSellerId:    '',
            site:           'MLM',
            maxResultsPerKeyword: 50,
            enabled:        true,
        } satisfies CompetitorConfig);
        console.log('[CompetitorIntel] Default config created.');
    }

    const config = (configDoc.exists ? configDoc.data() : (await db.collection('competitor_config').doc('default').get()).data()) as CompetitorConfig;
    if (!config.enabled) {
        console.log('[CompetitorIntel] Scan disabled in config — skipping.');
        return { date: '', totalScanned: 0, keywords: [], durationMs: 0 };
    }

    const token   = await getAppToken();
    const site    = config.site || 'MLM';
    const limit   = Math.min(config.maxResultsPerKeyword || 50, 50);
    const ourId   = config.ourSellerId || '';

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    const scannedAt = admin.firestore.Timestamp.now();

    const allItems: CompetitorItem[] = [];
    const sellerCache = new Map<string, { nickname: string; level: string }>();

    for (const keyword of config.keywords) {
        console.log(`[CompetitorIntel] Scanning keyword: "${keyword}"`);
        try {
            const searchRes = await meliGet(
                `/sites/${site}/search?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=relevance`,
                token
            );
            const results: any[] = searchRes.results ?? [];

            for (let pos = 0; pos < results.length; pos++) {
                const r = results[pos];
                const sellerId = String(r.seller?.id ?? '');

                // Skip our own listings
                if (ourId && sellerId === ourId) continue;

                // Fetch seller details (cached)
                if (!sellerCache.has(sellerId) && sellerId) {
                    try {
                        const sellerRes = await meliGet(`/users/${sellerId}`, token);
                        sellerCache.set(sellerId, {
                            nickname: sellerRes.nickname ?? sellerId,
                            level:    sellerRes.seller_reputation?.level_id ?? 'unknown',
                        });
                        await sleep(50); // gentle pacing — ~1200 req/min max
                    } catch {
                        sellerCache.set(sellerId, { nickname: sellerId, level: 'unknown' });
                    }
                }
                const seller = sellerCache.get(sellerId) ?? { nickname: sellerId, level: 'unknown' };

                // Determine shipping
                const shipping = r.shipping?.free_shipping ? 'free' : 'paid';

                allItems.push({
                    itemId:         r.id,
                    title:          r.title,
                    price:          Number(r.price ?? 0),
                    currencyId:     r.currency_id ?? 'MXN',
                    soldQuantity:   Number(r.sold_quantity ?? 0),
                    availableQty:   Number(r.available_quantity ?? 0),
                    condition:      r.condition ?? 'new',
                    sellerId,
                    sellerNickname: seller.nickname,
                    sellerLevel:    seller.level,
                    thumbnail:      r.thumbnail ?? '',
                    permalink:      r.permalink ?? '',
                    shipping,
                    keyword,
                    searchPosition: pos + 1,
                    scannedAt,
                });
            }

            console.log(`[CompetitorIntel] Keyword "${keyword}": ${results.length} results processed.`);
            await sleep(200); // pause between keyword searches
        } catch (err: any) {
            console.error(`[CompetitorIntel] Error scanning keyword "${keyword}":`, err.message);
        }
    }

    // Also deep-scan tracked sellers
    for (const sellerId of (config.trackedSellers ?? [])) {
        if (ourId && sellerId === ourId) continue;
        try {
            const sellerRes = await meliGet(
                `/sites/${site}/search?seller_id=${sellerId}&limit=50&sort=price_asc`,
                token
            );
            const results: any[] = sellerRes.results ?? [];
            if (!sellerCache.has(sellerId)) {
                const su = await meliGet(`/users/${sellerId}`, token);
                sellerCache.set(sellerId, { nickname: su.nickname ?? sellerId, level: su.seller_reputation?.level_id ?? 'unknown' });
            }
            const seller = sellerCache.get(sellerId)!;
            for (let pos = 0; pos < results.length; pos++) {
                const r = results[pos];
                allItems.push({
                    itemId:         r.id,
                    title:          r.title,
                    price:          Number(r.price ?? 0),
                    currencyId:     r.currency_id ?? 'MXN',
                    soldQuantity:   Number(r.sold_quantity ?? 0),
                    availableQty:   Number(r.available_quantity ?? 0),
                    condition:      r.condition ?? 'new',
                    sellerId,
                    sellerNickname: seller.nickname,
                    sellerLevel:    seller.level,
                    thumbnail:      r.thumbnail ?? '',
                    permalink:      r.permalink ?? '',
                    shipping:       r.shipping?.free_shipping ? 'free' : 'paid',
                    keyword:        `__seller:${sellerId}`,
                    searchPosition: pos + 1,
                    scannedAt,
                });
            }
            await sleep(300);
        } catch (err: any) {
            console.error(`[CompetitorIntel] Error scanning tracked seller ${sellerId}:`, err.message);
        }
    }

    const durationMs = Date.now() - start;
    console.log(`[CompetitorIntel] Scan complete: ${allItems.length} items in ${durationMs}ms`);

    // ── Write snapshot to Firestore ──────────────────────────────────────────
    // Use a flat collection: competitor_snapshots/{date}
    // Each item is a document inside a subcollection items/{itemId}
    const snapshotRef = db.collection('competitor_snapshots').doc(today);
    await snapshotRef.set({
        date: today,
        totalScanned: allItems.length,
        keywords: config.keywords,
        durationMs,
        triggeredBy,
        createdAt: scannedAt,
    } satisfies Omit<CompetitorSnapshot, 'items'> & { triggeredBy: string });

    // Batch-write items in chunks of 400 to stay under Firestore limits
    const itemBatches = chunk(allItems, 400);
    for (const batch of itemBatches) {
        const fb = db.batch();
        for (const item of batch) {
            fb.set(snapshotRef.collection('items').doc(item.itemId), item);
        }
        await fb.commit();
    }

    return { date: today, totalScanned: allItems.length, keywords: config.keywords, durationMs };
}

// ─── Cloud Functions ─────────────────────────────────────────────────────────

/** Daily cron — runs at 2:00 AM Mexico City time */
export const meliCompetitorScanCron = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('0 2 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
        try {
            const result = await runCompetitorScan('cron');
            console.log('[CompetitorIntel:Cron] Done:', result);
        } catch (err: any) {
            console.error('[CompetitorIntel:Cron] Fatal:', err.message);
        }
    });

/** Manual trigger — from Operations UI */
export const meliCompetitorScanManual = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (_data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
        try {
            const result = await runCompetitorScan('manual');
            return { ok: true, ...result };
        } catch (err: any) {
            throw new functions.https.HttpsError('internal', err.message);
        }
    });

/**
 * Callable: returns aggregated competitor intelligence for the dashboard.
 */
export const getCompetitorIntelligence = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');

        const days = Math.min(Number(data?.days ?? 7), 30);

        const snapshotsQuery = await db.collection('competitor_snapshots')
            .orderBy('date', 'desc')
            .limit(1)
            .get();

        if (snapshotsQuery.empty) {
            return {
                ok:              true,
                hasData:         false,
                latestSnapshot:  null,
                velocityRanking: [],
                priceMap:        [],
                trends:          [],
                trackedSellers:  [],
            };
        }

        const latestDoc  = snapshotsQuery.docs[0];
        const latestMeta = latestDoc.data() as Omit<CompetitorSnapshot, 'items'>;
        const latestDate = latestMeta.date;

        const priorDate = (() => {
            const d = new Date(latestDate + 'T12:00:00Z');
            d.setDate(d.getDate() - days);
            return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        })();

        const latestItemsSnap = await latestDoc.ref.collection('items').get();
        const latestItems = latestItemsSnap.docs.map(d => d.data() as CompetitorItem);

        let priorItemMap = new Map<string, number>();
        const priorSnap = await db.collection('competitor_snapshots').doc(priorDate).get();
        if (priorSnap.exists) {
            const priorItemsSnap = await priorSnap.ref.collection('items').get();
            priorItemsSnap.docs.forEach(d => {
                const item = d.data() as CompetitorItem;
                priorItemMap.set(item.itemId, item.soldQuantity);
            });
        }

        // ── Velocity Ranking ──────────────────────────────────────────────
        const velocityMap = new Map<string, VelocityEntry>();
        for (const item of latestItems) {
            const priorSold = priorItemMap.get(item.itemId) ?? item.soldQuantity;
            const delta     = Math.max(0, item.soldQuantity - priorSold);
            const revenue   = delta * item.price;
            const existing  = velocityMap.get(item.itemId);
            if (!existing || revenue > existing.revenueEstimate) {
                velocityMap.set(item.itemId, {
                    itemId:          item.itemId,
                    title:           item.title,
                    sellerId:        item.sellerId,
                    sellerNickname:  item.sellerNickname,
                    sellerLevel:     item.sellerLevel,
                    price:           item.price,
                    soldQtyDelta:    delta,
                    soldQtyTotal:    item.soldQuantity,
                    avgPrice:        item.price,
                    revenueEstimate: revenue,
                    keyword:         item.keyword,
                    permalink:       item.permalink,
                    thumbnail:       item.thumbnail,
                    searchPosition:  item.searchPosition,
                    lastScanned:     latestDate,
                });
            }
        }
        const velocityRanking = [...velocityMap.values()]
            .sort((a, b) => b.revenueEstimate - a.revenueEstimate)
            .slice(0, 30);

        // ── Keyword Trend Summary ────────────────────────────────────────
        const keywordMap = new Map<string, {
            keyword: string; count: number; prices: number[]; sellers: Set<string>;
            totalSold: number; avgPosition: number; freeShipping: number;
        }>();
        for (const item of latestItems) {
            if (item.keyword.startsWith('__seller:')) continue;
            const kw = keywordMap.get(item.keyword) ?? {
                keyword: item.keyword, count: 0, prices: [], sellers: new Set(),
                totalSold: 0, avgPosition: 0, freeShipping: 0,
            };
            kw.count++;
            kw.prices.push(item.price);
            kw.sellers.add(item.sellerId);
            kw.totalSold  += item.soldQuantity;
            kw.avgPosition = ((kw.avgPosition * (kw.count - 1)) + item.searchPosition) / kw.count;
            if (item.shipping === 'free') kw.freeShipping++;
            keywordMap.set(item.keyword, kw);
        }
        const trends = [...keywordMap.values()].map(kw => ({
            keyword:           kw.keyword,
            listingCount:      kw.count,
            uniqueSellers:     kw.sellers.size,
            minPrice:          Math.min(...kw.prices),
            maxPrice:          Math.max(...kw.prices),
            avgPrice:          kw.prices.reduce((a, b) => a + b, 0) / kw.prices.length,
            medianPrice:       (() => {
                const sorted = [...kw.prices].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            })(),
            totalSoldLifetime: kw.totalSold,
            freeShippingPct:   kw.count > 0 ? (kw.freeShipping / kw.count) * 100 : 0,
        }));

        // ── Tracked Seller Summaries ─────────────────────────────────────
        const configDoc  = await db.collection('competitor_config').doc('default').get();
        const config     = (configDoc.data() ?? {}) as Partial<CompetitorConfig>;
        const trackedIds = new Set(config.trackedSellers ?? []);

        const sellerMap = new Map<string, {
            sellerId: string; sellerNickname: string; sellerLevel: string;
            itemCount: number; totalSold: number; avgPrice: number; prices: number[];
        }>();
        for (const item of latestItems) {
            if (!trackedIds.has(item.sellerId)) continue;
            const s = sellerMap.get(item.sellerId) ?? {
                sellerId: item.sellerId, sellerNickname: item.sellerNickname,
                sellerLevel: item.sellerLevel, itemCount: 0, totalSold: 0, avgPrice: 0, prices: [],
            };
            s.itemCount++;
            s.totalSold += item.soldQuantity;
            s.prices.push(item.price);
            sellerMap.set(item.sellerId, s);
        }
        const trackedSellers = [...sellerMap.values()].map(s => ({
            ...s,
            avgPrice: s.prices.length ? s.prices.reduce((a, b) => a + b, 0) / s.prices.length : 0,
        }));

        return {
            ok:             true,
            hasData:        true,
            latestSnapshot: { ...latestMeta, date: latestDate, priorDate },
            velocityRanking,
            trends,
            trackedSellers,
            periodDays:     days,
        };
    });

/** Update competitor scan configuration */
export const updateCompetitorConfig = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { keywords, trackedSellers, ourSellerId, maxResultsPerKeyword, enabled } = data;
    await db.collection('competitor_config').doc('default').set({
        keywords:             keywords ?? [],
        trackedSellers:       trackedSellers ?? [],
        ourSellerId:          ourSellerId ?? '',
        site:                 'MLM',
        maxResultsPerKeyword: Math.min(Number(maxResultsPerKeyword ?? 50), 50),
        enabled:              enabled !== false,
    }, { merge: true });
    return { ok: true };
});
