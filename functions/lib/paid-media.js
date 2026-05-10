"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaidMediaInsights = exports.triggerPaidMediaSync = exports.syncPaidMediaSnapshots = void 0;
/**
 * paid-media.ts
 * Meta (Facebook/Instagram) and Google Ads campaign analytics sync.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
async function getPaidMediaConfig() {
    var _a, _b, _c;
    const snap = await shared_1.db.collection('config').doc('integrations').get();
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    return { meta: (_b = data['meta']) !== null && _b !== void 0 ? _b : {}, google: (_c = data['google']) !== null && _c !== void 0 ? _c : {} };
}
/** Returns 'YYYY-MM-DD' for a Date in Mexico City timezone */
function toDateStr(d) {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
// ── Meta helpers ──────────────────────────────────────────────────────────────
const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';
function actionVal(arr, type) {
    if (!arr)
        return 0;
    const found = arr.find((a) => a.action_type === type);
    return found ? parseFloat(found.value) : 0;
}
async function fetchMetaCampaigns(adAccountId, accessToken, datePreset) {
    var _a, _b, _c;
    const fields = [
        'id', 'name', 'status',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,purchase_roas,actions,action_values}`,
    ].join(',');
    const url = `${META_GRAPH_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${accessToken}&limit=100`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok)
        throw new Error(`Meta API: ${(_b = (_a = body === null || body === void 0 ? void 0 : body.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : JSON.stringify(body)}`);
    return (_c = body.data) !== null && _c !== void 0 ? _c : [];
}
// ── Google Ads helpers ────────────────────────────────────────────────────────
const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com/v17';
async function getGoogleToken(cfg) {
    var _a;
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            refresh_token: cfg.refreshToken,
            grant_type: 'refresh_token',
        }).toString(),
    });
    const d = await r.json();
    if (!r.ok || !d.access_token)
        throw new Error(`Google OAuth: ${(_a = d.error_description) !== null && _a !== void 0 ? _a : JSON.stringify(d)}`);
    return d.access_token;
}
async function fetchGoogleCampaigns(customerId, developerToken, accessToken, dateStr) {
    var _a, _b, _c;
    const query = `
        SELECT campaign.id, campaign.name, campaign.status,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.ctr, metrics.average_cpc, metrics.conversions,
               metrics.all_conversions, metrics.conversions_value,
               metrics.cost_per_conversion, metrics.search_impression_share
        FROM campaign
        WHERE segments.date = '${dateStr}' AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC LIMIT 50
    `.trim();
    const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (!res.ok)
        throw new Error(`Google Ads API: ${(_b = (_a = body === null || body === void 0 ? void 0 : body.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : JSON.stringify(body)}`);
    return (_c = body.results) !== null && _c !== void 0 ? _c : [];
}
// ── Core sync logic ───────────────────────────────────────────────────────────
async function runPaidMediaSync(targetDate) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const dateStr = toDateStr(targetDate);
    const errors = [];
    let metaCount = 0, googleCount = 0;
    const cfg = await getPaidMediaConfig();
    const batch = shared_1.db.batch();
    const snapsBase = shared_1.db.collection('advertising_snapshots').doc(dateStr);
    const pulledAt = admin.firestore.FieldValue.serverTimestamp();
    const cacheRef = shared_1.db.collection('advertising_cache').doc('latest');
    // ── Meta ─────────────────────────────────────────────────────────────────
    const metaCfg = cfg.meta;
    if ((metaCfg === null || metaCfg === void 0 ? void 0 : metaCfg.accessToken) && (metaCfg === null || metaCfg === void 0 ? void 0 : metaCfg.adAccountId)) {
        try {
            const camps = await fetchMetaCampaigns(metaCfg.adAccountId, metaCfg.accessToken, 'yesterday');
            let mSpend = 0, mImpr = 0, mClicks = 0, mPurch = 0;
            for (const camp of camps) {
                const ins = ((_b = (_a = camp.insights) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : [])[0];
                if (!ins)
                    continue;
                const spend = parseFloat(ins.spend) || 0;
                const impressions = parseInt(ins.impressions) || 0;
                const clicks = parseInt(ins.clicks) || 0;
                const reach = parseInt(ins.reach) || 0;
                const frequency = parseFloat(ins.frequency) || 0;
                const cpm = parseFloat(ins.cpm) || 0;
                const cpc = parseFloat(ins.cpc) || 0;
                const ctr = parseFloat(ins.ctr) || 0;
                const purchases = actionVal(ins.actions, 'purchase');
                const purchaseValue = actionVal(ins.action_values, 'purchase');
                const addToCart = actionVal(ins.actions, 'add_to_cart');
                const viewContent = actionVal(ins.actions, 'view_content');
                const purchaseRoas = ((_c = ins.purchase_roas) === null || _c === void 0 ? void 0 : _c[0]) ? parseFloat(ins.purchase_roas[0].value) : 0;
                batch.set(snapsBase.collection('meta').doc(camp.id), {
                    campaignId: camp.id, campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, reach, frequency, cpm, cpc, ctr,
                    purchases, purchaseValue, purchaseRoas, addToCart, viewContent,
                    datePreset: 'yesterday', snapshotDate: dateStr, pulledAt,
                }, { merge: true });
                metaCount++;
                mSpend += spend;
                mImpr += impressions;
                mClicks += clicks;
                mPurch += purchases;
            }
            batch.set(cacheRef, {
                date: dateStr, metaSpend: mSpend, metaImpressions: mImpr,
                metaClicks: mClicks, metaPurchases: mPurch, updatedAt: pulledAt,
            }, { merge: true });
        }
        catch (err) {
            console.error('[PaidMedia] Meta error:', err.message);
            errors.push(`Meta: ${err.message}`);
        }
    }
    // ── Google Ads ────────────────────────────────────────────────────────────
    const gCfg = cfg.google;
    if ((gCfg === null || gCfg === void 0 ? void 0 : gCfg.clientId) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.clientSecret) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.refreshToken) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.customerId) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.developerToken)) {
        try {
            const gToken = await getGoogleToken(gCfg);
            const yesterday = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateStr(yesterday);
            const results = await fetchGoogleCampaigns(gCfg.customerId, gCfg.developerToken, gToken, yesterdayStr);
            let gSpend = 0, gImpr = 0, gClicks = 0, gConv = 0, gConvVal = 0;
            for (const row of results) {
                const camp = row.campaign, m = row.metrics;
                const spend = ((_d = m.costMicros) !== null && _d !== void 0 ? _d : 0) / 1000000;
                const impressions = (_e = m.impressions) !== null && _e !== void 0 ? _e : 0;
                const clicks = (_f = m.clicks) !== null && _f !== void 0 ? _f : 0;
                const ctr = ((_g = m.ctr) !== null && _g !== void 0 ? _g : 0) * 100;
                const avgCpc = ((_h = m.averageCpc) !== null && _h !== void 0 ? _h : 0) / 1000000;
                const conversions = (_j = m.conversions) !== null && _j !== void 0 ? _j : 0;
                const allConversions = (_k = m.allConversions) !== null && _k !== void 0 ? _k : 0;
                const conversionsValue = (_l = m.conversionsValue) !== null && _l !== void 0 ? _l : 0;
                const costPerConversion = conversions > 0 ? spend / conversions : 0;
                const impressionShare = (_m = m.searchImpressionShare) !== null && _m !== void 0 ? _m : null;
                batch.set(snapsBase.collection('google').doc(String(camp.id)), {
                    campaignId: String(camp.id), campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, ctr, avgCpc, conversions, allConversions,
                    conversionsValue, costPerConversion, impressionShare,
                    snapshotDate: dateStr, pulledAt,
                }, { merge: true });
                googleCount++;
                gSpend += spend;
                gImpr += impressions;
                gClicks += clicks;
                gConv += conversions;
                gConvVal += conversionsValue;
            }
            batch.set(cacheRef, {
                googleSpend: gSpend, googleImpressions: gImpr, googleClicks: gClicks,
                googleConversions: gConv,
                googleRoas: gSpend > 0 ? gConvVal / gSpend : 0,
                updatedAt: pulledAt,
            }, { merge: true });
        }
        catch (err) {
            console.error('[PaidMedia] Google error:', err.message);
            errors.push(`Google: ${err.message}`);
        }
    }
    await batch.commit();
    console.log(`[PaidMedia] ${dateStr}: Meta=${metaCount}, Google=${googleCount}, Errors=${errors.length}`);
    return { metaCampaigns: metaCount, googleCampaigns: googleCount, errors };
}
// ── Scheduled: daily at 06:00 Mexico City ────────────────────────────────────
exports.syncPaidMediaSnapshots = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .pubsub.schedule('0 12 * * *') // 06:00 Mexico City = 12:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async () => { await runPaidMediaSync(new Date()); return null; });
// ── Manual trigger (callable from Angular) ────────────────────────────────────
exports.triggerPaidMediaSync = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role !== null && role !== void 0 ? role : ''))
        throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
    try {
        const result = await runPaidMediaSync((data === null || data === void 0 ? void 0 : data.date) ? new Date(data.date) : new Date());
        return Object.assign({ ok: true }, result);
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ── Read insights — joins snapshots + internal orders ─────────────────────────
exports.getPaidMediaInsights = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { campaignName, metaCampaignId, googleCampaignId, days = 30 } = data !== null && data !== void 0 ? data : {};
    const today = new Date();
    const history = [];
    let latestMeta = null, latestGoogle = null;
    // Fetch per-day snapshots in parallel
    await Promise.all(Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = toDateStr(d);
        const snapsBase = shared_1.db.collection('advertising_snapshots').doc(dateStr);
        return Promise.all([
            metaCampaignId ? snapsBase.collection('meta').doc(metaCampaignId).get() : Promise.resolve(null),
            googleCampaignId ? snapsBase.collection('google').doc(googleCampaignId).get() : Promise.resolve(null),
        ]).then(([ms, gs]) => {
            var _a, _b, _c, _d;
            const md = (ms === null || ms === void 0 ? void 0 : ms.exists) ? ms.data() : null;
            const gd = (gs === null || gs === void 0 ? void 0 : gs.exists) ? gs.data() : null;
            if (i === 0) {
                latestMeta = md;
                latestGoogle = gd;
            }
            history.push({
                date: dateStr, metaSpend: (_a = md === null || md === void 0 ? void 0 : md.spend) !== null && _a !== void 0 ? _a : 0, googleSpend: (_b = gd === null || gd === void 0 ? void 0 : gd.spend) !== null && _b !== void 0 ? _b : 0,
                totalSpend: ((_c = md === null || md === void 0 ? void 0 : md.spend) !== null && _c !== void 0 ? _c : 0) + ((_d = gd === null || gd === void 0 ? void 0 : gd.spend) !== null && _d !== void 0 ? _d : 0), revenue: 0, roas: null,
            });
        });
    }));
    // Join with internal orders for revenue data
    let totalOrders = 0, totalRevenue = 0;
    if (campaignName) {
        const from = new Date(today);
        from.setDate(from.getDate() - days);
        const ordersSnap = await shared_1.db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(from))
            .orderBy('createdAt', 'desc').get();
        const slug = campaignName.toLowerCase().trim();
        const revByDate = new Map();
        for (const doc of ordersSnap.docs) {
            const d = doc.data();
            const cs = ((_c = (_b = (_a = d.attribution) === null || _a === void 0 ? void 0 : _a.utm) === null || _b === void 0 ? void 0 : _b.utm_campaign) !== null && _c !== void 0 ? _c : '').toLowerCase().trim();
            if (!cs || (!cs.includes(slug) && !slug.includes(cs)))
                continue;
            const rev = (_e = (_d = d.total) !== null && _d !== void 0 ? _d : d.totalAmount) !== null && _e !== void 0 ? _e : 0;
            totalOrders++;
            totalRevenue += rev;
            const ds = toDateStr(d.createdAt.toDate());
            revByDate.set(ds, ((_f = revByDate.get(ds)) !== null && _f !== void 0 ? _f : 0) + rev);
        }
        for (const pt of history) {
            pt.revenue = (_g = revByDate.get(pt.date)) !== null && _g !== void 0 ? _g : 0;
            pt.roas = pt.totalSpend > 0 ? pt.revenue / pt.totalSpend : null;
        }
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    const totalSpend = ((_h = latestMeta === null || latestMeta === void 0 ? void 0 : latestMeta.spend) !== null && _h !== void 0 ? _h : 0) + ((_j = latestGoogle === null || latestGoogle === void 0 ? void 0 : latestGoogle.spend) !== null && _j !== void 0 ? _j : 0);
    return {
        internalOrders: totalOrders, internalRevenue: totalRevenue,
        meta: latestMeta, google: latestGoogle,
        totalSpend,
        realRoas: totalSpend > 0 ? totalRevenue / totalSpend : null,
        realCpa: totalOrders > 0 ? totalSpend / totalOrders : null,
        frequencyWarning: ((_k = latestMeta === null || latestMeta === void 0 ? void 0 : latestMeta.frequency) !== null && _k !== void 0 ? _k : 0) > 4.5,
        history,
    };
});
// ─── Dynamic Sitemap ──────────────────────────────────────────────────────────
// Deployed endpoint: /sitemap.xml (via Firebase Hosting rewrite)
// Reads all active products + published blog posts from Firestore.
// Submit this URL to Google Search Console and include in robots.txt.
// AI crawlers: GPTBot, PerplexityBot, ClaudeBot, GoogleBot all respect sitemaps.
//# sourceMappingURL=paid-media.js.map