/**
 * paid-media.ts
 * Meta (Facebook/Instagram) and Google Ads campaign analytics sync.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';

async function getPaidMediaConfig(): Promise<{ meta: any; google: any }> {
    const snap = await db.collection('config').doc('integrations').get();
    const data = snap.data() ?? {};
    return { meta: data['meta'] ?? {}, google: data['google'] ?? {} };
}

/** Returns 'YYYY-MM-DD' for a Date in Mexico City timezone */
function toDateStr(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ── Meta helpers ──────────────────────────────────────────────────────────────
const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function actionVal(arr: { action_type: string; value: string }[] | undefined, type: string): number {
    if (!arr) return 0;
    const found = arr.find((a: any) => a.action_type === type);
    return found ? parseFloat(found.value) : 0;
}

async function fetchMetaCampaigns(adAccountId: string, accessToken: string, datePreset: string): Promise<any[]> {
    const fields = [
        'id', 'name', 'status',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,purchase_roas,actions,action_values}`,
    ].join(',');
    const url = `${META_GRAPH_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${accessToken}&limit=100`;
    const res = await fetch(url);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`Meta API: ${body?.error?.message ?? JSON.stringify(body)}`);
    return body.data ?? [];
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com/v17';

async function getGoogleToken(cfg: any): Promise<string> {
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
    const d = await r.json() as any;
    if (!r.ok || !d.access_token) throw new Error(`Google OAuth: ${d.error_description ?? JSON.stringify(d)}`);
    return d.access_token;
}

async function fetchGoogleCampaigns(customerId: string, developerToken: string, accessToken: string, dateStr: string): Promise<any[]> {
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
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`Google Ads API: ${body?.error?.message ?? JSON.stringify(body)}`);
    return body.results ?? [];
}

// ── Core sync logic ───────────────────────────────────────────────────────────
async function runPaidMediaSync(targetDate: Date) {
    const dateStr = toDateStr(targetDate);
    const errors: string[] = [];
    let metaCount = 0, googleCount = 0;

    const cfg = await getPaidMediaConfig();
    const batch = db.batch();
    const snapsBase = db.collection('advertising_snapshots').doc(dateStr);
    const pulledAt = admin.firestore.FieldValue.serverTimestamp();
    const cacheRef = db.collection('advertising_cache').doc('latest');

    // ── Meta ─────────────────────────────────────────────────────────────────
    const metaCfg = cfg.meta;
    if (metaCfg?.accessToken && metaCfg?.adAccountId) {
        try {
            const camps = await fetchMetaCampaigns(metaCfg.adAccountId, metaCfg.accessToken, 'yesterday');
            let mSpend = 0, mImpr = 0, mClicks = 0, mPurch = 0;

            for (const camp of camps) {
                const ins = (camp.insights?.data ?? [])[0];
                if (!ins) continue;
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
                const purchaseRoas = ins.purchase_roas?.[0] ? parseFloat(ins.purchase_roas[0].value) : 0;

                batch.set(snapsBase.collection('meta').doc(camp.id), {
                    campaignId: camp.id, campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, reach, frequency, cpm, cpc, ctr,
                    purchases, purchaseValue, purchaseRoas, addToCart, viewContent,
                    datePreset: 'yesterday', snapshotDate: dateStr, pulledAt,
                }, { merge: true });

                metaCount++;
                mSpend += spend; mImpr += impressions; mClicks += clicks; mPurch += purchases;
            }

            batch.set(cacheRef, {
                date: dateStr, metaSpend: mSpend, metaImpressions: mImpr,
                metaClicks: mClicks, metaPurchases: mPurch, updatedAt: pulledAt,
            }, { merge: true });

        } catch (err: any) {
            console.error('[PaidMedia] Meta error:', err.message);
            errors.push(`Meta: ${err.message}`);
        }
    }

    // ── Google Ads ────────────────────────────────────────────────────────────
    const gCfg = cfg.google;
    if (gCfg?.clientId && gCfg?.clientSecret && gCfg?.refreshToken && gCfg?.customerId && gCfg?.developerToken) {
        try {
            const gToken = await getGoogleToken(gCfg);
            const yesterday = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateStr(yesterday);

            const results = await fetchGoogleCampaigns(gCfg.customerId, gCfg.developerToken, gToken, yesterdayStr);
            let gSpend = 0, gImpr = 0, gClicks = 0, gConv = 0, gConvVal = 0;

            for (const row of results) {
                const camp = row.campaign, m = row.metrics;
                const spend = (m.costMicros ?? 0) / 1_000_000;
                const impressions = m.impressions ?? 0;
                const clicks = m.clicks ?? 0;
                const ctr = (m.ctr ?? 0) * 100;
                const avgCpc = (m.averageCpc ?? 0) / 1_000_000;
                const conversions = m.conversions ?? 0;
                const allConversions = m.allConversions ?? 0;
                const conversionsValue = m.conversionsValue ?? 0;
                const costPerConversion = conversions > 0 ? spend / conversions : 0;
                const impressionShare = m.searchImpressionShare ?? null;

                batch.set(snapsBase.collection('google').doc(String(camp.id)), {
                    campaignId: String(camp.id), campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, ctr, avgCpc, conversions, allConversions,
                    conversionsValue, costPerConversion, impressionShare,
                    snapshotDate: dateStr, pulledAt,
                }, { merge: true });

                googleCount++;
                gSpend += spend; gImpr += impressions; gClicks += clicks;
                gConv += conversions; gConvVal += conversionsValue;
            }

            batch.set(cacheRef, {
                googleSpend: gSpend, googleImpressions: gImpr, googleClicks: gClicks,
                googleConversions: gConv,
                googleRoas: gSpend > 0 ? gConvVal / gSpend : 0,
                updatedAt: pulledAt,
            }, { merge: true });

        } catch (err: any) {
            console.error('[PaidMedia] Google error:', err.message);
            errors.push(`Google: ${err.message}`);
        }
    }

    await batch.commit();
    console.log(`[PaidMedia] ${dateStr}: Meta=${metaCount}, Google=${googleCount}, Errors=${errors.length}`);
    return { metaCampaigns: metaCount, googleCampaigns: googleCount, errors };
}

// ── Scheduled: daily at 06:00 Mexico City ────────────────────────────────────
export const syncPaidMediaSnapshots = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .pubsub.schedule('0 12 * * *')      // 06:00 Mexico City = 12:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async () => { await runPaidMediaSync(new Date()); return null; });

// ── Manual trigger (callable from Angular) ────────────────────────────────────
export const triggerPaidMediaSync = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const role = context.auth.token?.role as string | undefined;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role ?? ''))
        throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
    try {
        const result = await runPaidMediaSync(data?.date ? new Date(data.date) : new Date());
        return { ok: true, ...result };
    } catch (err: any) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// ── Read insights — joins snapshots + internal orders ─────────────────────────
export const getPaidMediaInsights = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { campaignName, metaCampaignId, googleCampaignId, days = 30 } = data ?? {};
    const today = new Date();
    const history: any[] = [];
    let latestMeta: any = null, latestGoogle: any = null;

    // Fetch per-day snapshots in parallel
    await Promise.all(Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = toDateStr(d);
        const snapsBase = db.collection('advertising_snapshots').doc(dateStr);

        return Promise.all([
            metaCampaignId ? snapsBase.collection('meta').doc(metaCampaignId).get() : Promise.resolve(null),
            googleCampaignId ? snapsBase.collection('google').doc(googleCampaignId).get() : Promise.resolve(null),
        ]).then(([ms, gs]) => {
            const md = ms?.exists ? ms.data() : null;
            const gd = gs?.exists ? gs.data() : null;
            if (i === 0) { latestMeta = md; latestGoogle = gd; }
            history.push({
                date: dateStr, metaSpend: md?.spend ?? 0, googleSpend: gd?.spend ?? 0,
                totalSpend: (md?.spend ?? 0) + (gd?.spend ?? 0), revenue: 0, roas: null,
            });
        });
    }));

    // Join with internal orders for revenue data
    let totalOrders = 0, totalRevenue = 0;
    if (campaignName) {
        const from = new Date(today);
        from.setDate(from.getDate() - days);
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(from))
            .orderBy('createdAt', 'desc').get();

        const slug = campaignName.toLowerCase().trim();
        const revByDate = new Map<string, number>();

        for (const doc of ordersSnap.docs) {
            const d = doc.data() as any;
            const cs = (d.attribution?.utm?.utm_campaign ?? '').toLowerCase().trim();
            if (!cs || (!cs.includes(slug) && !slug.includes(cs))) continue;
            const rev = d.total ?? d.totalAmount ?? 0;
            totalOrders++; totalRevenue += rev;
            const ds = toDateStr((d.createdAt as admin.firestore.Timestamp).toDate());
            revByDate.set(ds, (revByDate.get(ds) ?? 0) + rev);
        }

        for (const pt of history) {
            pt.revenue = revByDate.get(pt.date) ?? 0;
            pt.roas = pt.totalSpend > 0 ? pt.revenue / pt.totalSpend : null;
        }
    }

    history.sort((a, b) => a.date.localeCompare(b.date));
    const totalSpend = (latestMeta?.spend ?? 0) + (latestGoogle?.spend ?? 0);

    return {
        internalOrders: totalOrders, internalRevenue: totalRevenue,
        meta: latestMeta, google: latestGoogle,
        totalSpend,
        realRoas: totalSpend > 0 ? totalRevenue / totalSpend : null,
        realCpa: totalOrders > 0 ? totalSpend / totalOrders : null,
        frequencyWarning: (latestMeta?.frequency ?? 0) > 4.5,
        history,
    };
});

// ─── Dynamic Sitemap ──────────────────────────────────────────────────────────
// Deployed endpoint: /sitemap.xml (via Firebase Hosting rewrite)
// Reads all active products + published blog posts from Firestore.
// Submit this URL to Google Search Console and include in robots.txt.
// AI crawlers: GPTBot, PerplexityBot, ClaudeBot, GoogleBot all respect sitemaps.

