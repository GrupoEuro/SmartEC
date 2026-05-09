"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCompetitorConfig = exports.getCompetitorIntelligence = exports.meliCompetitorScanManual = exports.meliCompetitorScanCron = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const db = admin.firestore();
// ─── Helpers ────────────────────────────────────────────────────────────────
async function getAppToken() {
    var _a, _b, _c;
    const configDoc = await db.collection('config').doc('integrations').get();
    const meli = (_b = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli) !== null && _b !== void 0 ? _b : {};
    // Prefer app-level (client_credentials) token — better for public data reads
    const cached = meli.appAccessToken;
    const cachedExp = (_c = meli.appTokenExpiresAt) !== null && _c !== void 0 ? _c : 0;
    if (cached && (cachedExp - Date.now()) > 10 * 60 * 1000)
        return cached;
    const appId = meli.appId;
    const clientSecret = meli.clientSecret;
    if (!appId || !clientSecret) {
        // Fallback: user OAuth token
        if (meli.accessToken)
            return meli.accessToken;
        throw new Error('[CompetitorIntel] No MeLi credentials configured. Connect MeLi in /admin/integrations.');
    }
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: appId, client_secret: clientSecret }).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token)
        throw new Error('[CompetitorIntel] Token fetch failed: ' + JSON.stringify(data));
    const expiresAt = Date.now() + (data.expires_in * 1000);
    await db.collection('config').doc('integrations').set({ meli: { appAccessToken: data.access_token, appTokenExpiresAt: expiresAt } }, { merge: true });
    return data.access_token;
}
async function meliGet(path, token) {
    const res = await fetch(`https://api.mercadolibre.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`[MeLiGET] ${path} → ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}
/** Chunk an array into batches of size n */
function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n)
        out.push(arr.slice(i, i + n));
    return out;
}
/** Sleep for ms milliseconds */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ─── Core scan logic ────────────────────────────────────────────────────────
async function runCompetitorScan(triggeredBy = 'cron') {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
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
            ourSellerId: '',
            site: 'MLM',
            maxResultsPerKeyword: 50,
            enabled: true,
        });
        console.log('[CompetitorIntel] Default config created.');
    }
    const config = (configDoc.exists ? configDoc.data() : (await db.collection('competitor_config').doc('default').get()).data());
    if (!config.enabled) {
        console.log('[CompetitorIntel] Scan disabled in config — skipping.');
        return { date: '', totalScanned: 0, keywords: [], durationMs: 0 };
    }
    const token = await getAppToken();
    const site = config.site || 'MLM';
    const limit = Math.min(config.maxResultsPerKeyword || 50, 50);
    const ourId = config.ourSellerId || '';
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    const scannedAt = admin.firestore.Timestamp.now();
    const allItems = [];
    const sellerCache = new Map();
    for (const keyword of config.keywords) {
        console.log(`[CompetitorIntel] Scanning keyword: "${keyword}"`);
        try {
            const searchRes = await meliGet(`/sites/${site}/search?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=relevance`, token);
            const results = (_a = searchRes.results) !== null && _a !== void 0 ? _a : [];
            for (let pos = 0; pos < results.length; pos++) {
                const r = results[pos];
                const sellerId = String((_c = (_b = r.seller) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : '');
                // Skip our own listings
                if (ourId && sellerId === ourId)
                    continue;
                // Fetch seller details (cached)
                if (!sellerCache.has(sellerId) && sellerId) {
                    try {
                        const sellerRes = await meliGet(`/users/${sellerId}`, token);
                        sellerCache.set(sellerId, {
                            nickname: (_d = sellerRes.nickname) !== null && _d !== void 0 ? _d : sellerId,
                            level: (_f = (_e = sellerRes.seller_reputation) === null || _e === void 0 ? void 0 : _e.level_id) !== null && _f !== void 0 ? _f : 'unknown',
                        });
                        await sleep(50); // gentle pacing — ~1200 req/min max
                    }
                    catch (_4) {
                        sellerCache.set(sellerId, { nickname: sellerId, level: 'unknown' });
                    }
                }
                const seller = (_g = sellerCache.get(sellerId)) !== null && _g !== void 0 ? _g : { nickname: sellerId, level: 'unknown' };
                // Determine shipping
                const shipping = ((_h = r.shipping) === null || _h === void 0 ? void 0 : _h.free_shipping) ? 'free' : 'paid';
                allItems.push({
                    itemId: r.id,
                    title: r.title,
                    price: Number((_j = r.price) !== null && _j !== void 0 ? _j : 0),
                    currencyId: (_k = r.currency_id) !== null && _k !== void 0 ? _k : 'MXN',
                    soldQuantity: Number((_l = r.sold_quantity) !== null && _l !== void 0 ? _l : 0),
                    availableQty: Number((_m = r.available_quantity) !== null && _m !== void 0 ? _m : 0),
                    condition: (_o = r.condition) !== null && _o !== void 0 ? _o : 'new',
                    sellerId,
                    sellerNickname: seller.nickname,
                    sellerLevel: seller.level,
                    thumbnail: (_p = r.thumbnail) !== null && _p !== void 0 ? _p : '',
                    permalink: (_q = r.permalink) !== null && _q !== void 0 ? _q : '',
                    shipping,
                    keyword,
                    searchPosition: pos + 1,
                    scannedAt,
                });
            }
            console.log(`[CompetitorIntel] Keyword "${keyword}": ${results.length} results processed.`);
            await sleep(200); // pause between keyword searches
        }
        catch (err) {
            console.error(`[CompetitorIntel] Error scanning keyword "${keyword}":`, err.message);
        }
    }
    // Also deep-scan tracked sellers
    for (const sellerId of ((_r = config.trackedSellers) !== null && _r !== void 0 ? _r : [])) {
        if (ourId && sellerId === ourId)
            continue;
        try {
            const sellerRes = await meliGet(`/sites/${site}/search?seller_id=${sellerId}&limit=50&sort=price_asc`, token);
            const results = (_s = sellerRes.results) !== null && _s !== void 0 ? _s : [];
            if (!sellerCache.has(sellerId)) {
                const su = await meliGet(`/users/${sellerId}`, token);
                sellerCache.set(sellerId, { nickname: (_t = su.nickname) !== null && _t !== void 0 ? _t : sellerId, level: (_v = (_u = su.seller_reputation) === null || _u === void 0 ? void 0 : _u.level_id) !== null && _v !== void 0 ? _v : 'unknown' });
            }
            const seller = sellerCache.get(sellerId);
            for (let pos = 0; pos < results.length; pos++) {
                const r = results[pos];
                allItems.push({
                    itemId: r.id,
                    title: r.title,
                    price: Number((_w = r.price) !== null && _w !== void 0 ? _w : 0),
                    currencyId: (_x = r.currency_id) !== null && _x !== void 0 ? _x : 'MXN',
                    soldQuantity: Number((_y = r.sold_quantity) !== null && _y !== void 0 ? _y : 0),
                    availableQty: Number((_z = r.available_quantity) !== null && _z !== void 0 ? _z : 0),
                    condition: (_0 = r.condition) !== null && _0 !== void 0 ? _0 : 'new',
                    sellerId,
                    sellerNickname: seller.nickname,
                    sellerLevel: seller.level,
                    thumbnail: (_1 = r.thumbnail) !== null && _1 !== void 0 ? _1 : '',
                    permalink: (_2 = r.permalink) !== null && _2 !== void 0 ? _2 : '',
                    shipping: ((_3 = r.shipping) === null || _3 === void 0 ? void 0 : _3.free_shipping) ? 'free' : 'paid',
                    keyword: `__seller:${sellerId}`,
                    searchPosition: pos + 1,
                    scannedAt,
                });
            }
            await sleep(300);
        }
        catch (err) {
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
    });
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
exports.meliCompetitorScanCron = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('0 2 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
    try {
        const result = await runCompetitorScan('cron');
        console.log('[CompetitorIntel:Cron] Done:', result);
    }
    catch (err) {
        console.error('[CompetitorIntel:Cron] Fatal:', err.message);
    }
});
// ─── CORS helper ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'https://app-importadora-euro.web.app',
    'https://app-importadora-euro.firebaseapp.com',
    'http://localhost:4200',
    'http://localhost:4000',
];
function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
    }
    else {
        res.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
}
/** Verify Firebase ID token from Authorization header */
async function verifyToken(req) {
    var _a;
    const authHeader = (_a = req.headers.authorization) !== null && _a !== void 0 ? _a : '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken)
        throw new Error('unauthenticated');
    return admin.auth().verifyIdToken(idToken);
}
// ─── Manual scan trigger ─────────────────────────────────────────────────────
/** Manual trigger from admin UI */
exports.meliCompetitorScanManual = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onRequest(async (req, res) => {
    if (setCors(req, res))
        return;
    try {
        await verifyToken(req);
    }
    catch (_a) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
    }
    try {
        const result = await runCompetitorScan('manual');
        res.status(200).json(Object.assign({ ok: true }, result));
    }
    catch (err) {
        console.error('[CompetitorIntel:Manual] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});
// ─── Get intelligence data ────────────────────────────────────────────────────
exports.getCompetitorIntelligence = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (setCors(req, res))
        return;
    try {
        await verifyToken(req);
    }
    catch (_h) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
    }
    const body = (_a = req.body) !== null && _a !== void 0 ? _a : {};
    const days = Math.min(Number((_b = body.days) !== null && _b !== void 0 ? _b : 7), 30);
    const snapshotsQuery = await db.collection('competitor_snapshots')
        .orderBy('date', 'desc')
        .limit(1)
        .get();
    if (snapshotsQuery.empty) {
        res.status(200).json({
            ok: true,
            hasData: false,
            latestSnapshot: null,
            velocityRanking: [],
            priceMap: [],
            trends: [],
            trackedSellers: [],
        });
        return;
    }
    const latestDoc = snapshotsQuery.docs[0];
    const latestMeta = latestDoc.data();
    const latestDate = latestMeta.date;
    const priorDate = (() => {
        const d = new Date(latestDate + 'T12:00:00Z');
        d.setDate(d.getDate() - days);
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    })();
    const latestItemsSnap = await latestDoc.ref.collection('items').get();
    const latestItems = latestItemsSnap.docs.map(d => d.data());
    let priorItemMap = new Map();
    const priorSnap = await db.collection('competitor_snapshots').doc(priorDate).get();
    if (priorSnap.exists) {
        const priorItemsSnap = await priorSnap.ref.collection('items').get();
        priorItemsSnap.docs.forEach(d => {
            const item = d.data();
            priorItemMap.set(item.itemId, item.soldQuantity);
        });
    }
    // ── Velocity Ranking ─────────────────────────────────────────────
    const velocityMap = new Map();
    for (const item of latestItems) {
        const priorSold = (_c = priorItemMap.get(item.itemId)) !== null && _c !== void 0 ? _c : item.soldQuantity;
        const delta = Math.max(0, item.soldQuantity - priorSold);
        const revenue = delta * item.price;
        const existing = velocityMap.get(item.itemId);
        if (!existing || revenue > existing.revenueEstimate) {
            velocityMap.set(item.itemId, {
                itemId: item.itemId,
                title: item.title,
                sellerId: item.sellerId,
                sellerNickname: item.sellerNickname,
                sellerLevel: item.sellerLevel,
                price: item.price,
                soldQtyDelta: delta,
                soldQtyTotal: item.soldQuantity,
                avgPrice: item.price,
                revenueEstimate: revenue,
                keyword: item.keyword,
                permalink: item.permalink,
                thumbnail: item.thumbnail,
                searchPosition: item.searchPosition,
                lastScanned: latestDate,
            });
        }
    }
    const velocityRanking = [...velocityMap.values()]
        .sort((a, b) => b.revenueEstimate - a.revenueEstimate)
        .slice(0, 30);
    // ── Keyword Trend Summary ────────────────────────────────────────
    const keywordMap = new Map();
    for (const item of latestItems) {
        if (item.keyword.startsWith('__seller:'))
            continue;
        const kw = (_d = keywordMap.get(item.keyword)) !== null && _d !== void 0 ? _d : {
            keyword: item.keyword, count: 0, prices: [], sellers: new Set(),
            totalSold: 0, avgPosition: 0, freeShipping: 0,
        };
        kw.count++;
        kw.prices.push(item.price);
        kw.sellers.add(item.sellerId);
        kw.totalSold += item.soldQuantity;
        kw.avgPosition = ((kw.avgPosition * (kw.count - 1)) + item.searchPosition) / kw.count;
        if (item.shipping === 'free')
            kw.freeShipping++;
        keywordMap.set(item.keyword, kw);
    }
    const trends = [...keywordMap.values()].map(kw => ({
        keyword: kw.keyword,
        listingCount: kw.count,
        uniqueSellers: kw.sellers.size,
        minPrice: Math.min(...kw.prices),
        maxPrice: Math.max(...kw.prices),
        avgPrice: kw.prices.reduce((a, b) => a + b, 0) / kw.prices.length,
        medianPrice: (() => {
            const sorted = [...kw.prices].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        })(),
        totalSoldLifetime: kw.totalSold,
        freeShippingPct: kw.count > 0 ? (kw.freeShipping / kw.count) * 100 : 0,
    }));
    // ── Tracked Seller Summaries ─────────────────────────────────────
    const configDoc = await db.collection('competitor_config').doc('default').get();
    const config = ((_e = configDoc.data()) !== null && _e !== void 0 ? _e : {});
    const trackedIds = new Set((_f = config.trackedSellers) !== null && _f !== void 0 ? _f : []);
    const sellerMap = new Map();
    for (const item of latestItems) {
        if (!trackedIds.has(item.sellerId))
            continue;
        const s = (_g = sellerMap.get(item.sellerId)) !== null && _g !== void 0 ? _g : {
            sellerId: item.sellerId, sellerNickname: item.sellerNickname,
            sellerLevel: item.sellerLevel, itemCount: 0, totalSold: 0, avgPrice: 0, prices: [],
        };
        s.itemCount++;
        s.totalSold += item.soldQuantity;
        s.prices.push(item.price);
        sellerMap.set(item.sellerId, s);
    }
    const trackedSellers = [...sellerMap.values()].map(s => (Object.assign(Object.assign({}, s), { avgPrice: s.prices.length ? s.prices.reduce((a, b) => a + b, 0) / s.prices.length : 0 })));
    res.status(200).json({
        ok: true,
        hasData: true,
        latestSnapshot: Object.assign(Object.assign({}, latestMeta), { date: latestDate, priorDate }),
        velocityRanking,
        trends,
        trackedSellers,
        periodDays: days,
    });
});
// ─── Update config ────────────────────────────────────────────────────────────
exports.updateCompetitorConfig = functions
    .https.onRequest(async (req, res) => {
    var _a;
    if (setCors(req, res))
        return;
    try {
        await verifyToken(req);
    }
    catch (_b) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
    }
    const { keywords, trackedSellers, ourSellerId, maxResultsPerKeyword, enabled } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
    await db.collection('competitor_config').doc('default').set({
        keywords: keywords !== null && keywords !== void 0 ? keywords : [],
        trackedSellers: trackedSellers !== null && trackedSellers !== void 0 ? trackedSellers : [],
        ourSellerId: ourSellerId !== null && ourSellerId !== void 0 ? ourSellerId : '',
        site: 'MLM',
        maxResultsPerKeyword: Math.min(Number(maxResultsPerKeyword !== null && maxResultsPerKeyword !== void 0 ? maxResultsPerKeyword : 50), 50),
        enabled: enabled !== false,
    }, { merge: true });
    res.status(200).json({ ok: true });
});
//# sourceMappingURL=competitor-intelligence.js.map