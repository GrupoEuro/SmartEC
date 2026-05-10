/**
 * meli-orders-sync.ts
 *
 * Computes per-SKU sales statistics from already-synced MercadoLibre orders
 * (the `orders` collection, populated by meliSyncOrders / meliSyncHistorical).
 *
 * Outputs:
 *   meli_sku_stats/{sku}  — velocity, revenue, fees, last-sale date
 *
 * This is intentionally a read-from-Firestore approach (no extra MeLi API calls)
 * to keep it fast, cheap, and reliable regardless of token state.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// ── Firestore shorthand ──────────────────────────────────────────────────────
const db = admin.firestore();

// ── Types ────────────────────────────────────────────────────────────────────

interface SkuStat {
    sku:                 string;
    mlItemId:            string | null;
    mlmuId:              string | null;
    title:               string;

    // 7-day window
    unitsSold7d:         number;
    revenue7d:           number;
    saleFees7d:          number;
    orders7d:            number;

    // 30-day window
    unitsSold30d:        number;
    revenue30d:          number;
    saleFees30d:         number;
    orders30d:           number;

    // 90-day window
    unitsSold90d:        number;
    revenue90d:          number;
    saleFees90d:         number;
    orders90d:           number;

    // Velocity
    avgDailyVelocity7d:  number;  // units/day over 7d
    avgDailyVelocity30d: number;  // units/day over 30d (primary metric)
    avgDailyVelocity90d: number;  // units/day over 90d

    // Trend
    trend: 'rising' | 'falling' | 'stable';  // compare 7d velocity vs 30d

    // Time
    lastOrderDate:       string | null;   // ISO date string
    firstOrderDate:      string | null;
    updatedAt:           admin.firestore.FieldValue;
}

interface ComputeResult {
    success:     boolean;
    skusComputed: number;
    ordersRead:  number;
    windowDays:  number;
    computedAt:  string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function windowCutoff(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
}

// ── Core computation ─────────────────────────────────────────────────────────

async function computeAndSaveSkuStats(windowDays: number = 90): Promise<ComputeResult> {
    const now   = new Date();
    const cut90 = windowCutoff(90);
    const cut30 = windowCutoff(30);
    const cut7  = windowCutoff(7);

    // ── 1. Read MeLi orders from the last 90 days ────────────────────────────
    //    The orders collection uses sourceChannel='mercadolibre' and stores items[]
    //    with { sku, productId (=mlItemId), quantity, price, subtotal }
    //    plus marketplaceFee (total commission for the order).
    //
    //    Note: We read ALL meli orders and filter client-side by date because
    //    Firestore compound inequalities require a composite index we may not have.
    //    90-day window ≈ 200–600 docs — perfectly acceptable.

    const snap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('status', 'in', ['paid', 'processing', 'shipped', 'delivered', 'completed'])
        .get();

    const skuMap = new Map<string, {
        title: string;
        mlItemId: string | null;
        mlmuId: string | null;
        orders90: { date: Date; qty: number; revenue: number; fee: number }[];
    }>();

    let ordersRead = 0;

    snap.forEach(doc => {
        const order = doc.data();
        const createdAt = order.createdAt instanceof admin.firestore.Timestamp
            ? order.createdAt.toDate()
            : typeof order.createdAt === 'string'
                ? new Date(order.createdAt)
                : null;

        if (!createdAt || createdAt < cut90) return;
        ordersRead++;

        const items: any[] = order.items || [];
        // Distribute the order fee proportionally across items (or just use per-item if available)
        const totalQty = items.reduce((s: number, i: any) => s + (i.quantity || 1), 0);
        const orderFeeTotal: number = order.marketplaceFee ?? 0;

        items.forEach((item: any) => {
            const sku: string = item.sku || item.productId || 'UNKNOWN';
            const qty: number = item.quantity || 1;
            const revenue: number = item.subtotal ?? (item.price * qty) ?? 0;
            const feeProportion: number = totalQty > 0 ? qty / totalQty : 1;
            const fee: number = orderFeeTotal * feeProportion;

            if (!skuMap.has(sku)) {
                skuMap.set(sku, {
                    title:    item.productName || item.name || sku,
                    mlItemId: item.productId?.startsWith('MLM') ? item.productId : null,
                    mlmuId:   null,
                    orders90: [],
                });
            }
            skuMap.get(sku)!.orders90.push({ date: createdAt, qty, revenue, fee });
        });
    });

    // ── 2. Enrich with mlmuId from meli_fbm_inventory ──────────────────────
    //    The meli_fbm_inventory collection has mlItemId → userProductId (MLMU...)
    const fbmSnap = await db.collection('meli_fbm_inventory').get();
    const fbmByMlItemId = new Map<string, { mlmuId: string; title: string }>();
    fbmSnap.forEach(doc => {
        const d = doc.data();
        if (d.mlItemId) {
            fbmByMlItemId.set(d.mlItemId, {
                mlmuId: d.userProductId || '',
                title:  d.title || '',
            });
        }
    });

    // ── 3. Build SkuStat objects and write to Firestore ─────────────────────
    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let batchCount = 0;
    let skusComputed = 0;

    for (const [sku, data] of skuMap) {
        const all90 = data.orders90;
        if (all90.length === 0) continue;

        const inWindow = (d: Date, cutoff: Date) => d >= cutoff;

        const sum = (arr: { date: Date; qty: number; revenue: number; fee: number }[], cutoff: Date) =>
            arr.filter(o => inWindow(o.date, cutoff))
               .reduce((acc, o) => ({
                   qty:     acc.qty     + o.qty,
                   revenue: acc.revenue + o.revenue,
                   fee:     acc.fee     + o.fee,
                   orders:  acc.orders  + 1,
               }), { qty: 0, revenue: 0, fee: 0, orders: 0 });

        const s7  = sum(all90, cut7);
        const s30 = sum(all90, cut30);
        const s90 = sum(all90, cut90);

        const vel7  = s7.qty  / 7;
        const vel30 = s30.qty / 30;
        const vel90 = s90.qty / 90;

        // Trend: compare 7d daily rate vs 30d daily rate
        const trend: 'rising' | 'falling' | 'stable' =
            vel30 > 0 && vel7 > vel30 * 1.15 ? 'rising' :
            vel30 > 0 && vel7 < vel30 * 0.85 ? 'falling' :
            'stable';

        const dates = all90.map(o => o.date).sort((a, b) => b.getTime() - a.getTime());
        const lastDate  = dates[0]?.toISOString().split('T')[0] ?? null;
        const firstDate = dates[dates.length - 1]?.toISOString().split('T')[0] ?? null;

        // Enrich with FBM data
        const fbmData = data.mlItemId ? fbmByMlItemId.get(data.mlItemId) : null;
        const mlmuId  = fbmData?.mlmuId || null;
        const title   = fbmData?.title  || data.title;

        const stat: SkuStat = {
            sku,
            mlItemId:            data.mlItemId,
            mlmuId,
            title,

            unitsSold7d:         s7.qty,
            revenue7d:           Math.round(s7.revenue * 100) / 100,
            saleFees7d:          Math.round(s7.fee * 100) / 100,
            orders7d:            s7.orders,

            unitsSold30d:        s30.qty,
            revenue30d:          Math.round(s30.revenue * 100) / 100,
            saleFees30d:         Math.round(s30.fee * 100) / 100,
            orders30d:           s30.orders,

            unitsSold90d:        s90.qty,
            revenue90d:          Math.round(s90.revenue * 100) / 100,
            saleFees90d:         Math.round(s90.fee * 100) / 100,
            orders90d:           s90.orders,

            avgDailyVelocity7d:  Math.round(vel7  * 1000) / 1000,
            avgDailyVelocity30d: Math.round(vel30 * 1000) / 1000,
            avgDailyVelocity90d: Math.round(vel90 * 1000) / 1000,

            trend,
            lastOrderDate:       lastDate,
            firstOrderDate:      firstDate,
            updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
        };

        // Use a Firestore-safe doc ID (replace / with _)
        const docId = sku.replace(/\//g, '_');
        batch.set(db.collection('meli_sku_stats').doc(docId), stat, { merge: true });

        batchCount++;
        skusComputed++;

        if (batchCount >= BATCH_LIMIT) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();

    // ── 4. Write summary metadata ───────────────────────────────────────────
    await db.collection('config').doc('meli_sku_stats_meta').set({
        lastComputedAt:  admin.firestore.FieldValue.serverTimestamp(),
        skusComputed,
        ordersRead,
        windowDays,
    }, { merge: true });

    console.log(`[MeliSkuStats] ✅ Computed ${skusComputed} SKUs from ${ordersRead} orders.`);

    return {
        success:      true,
        skusComputed,
        ordersRead,
        windowDays,
        computedAt:   now.toISOString(),
    };
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * computeMeliSkuStats — onCall
 * Triggered manually from the Replenishment Planner UI.
 */
export const computeMeliSkuStats = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }
        try {
            return await computeAndSaveSkuStats(90);
        } catch (err: any) {
            console.error('[MeliSkuStats] Error:', err);
            throw new functions.https.HttpsError('internal', err.message);
        }
    });

/**
 * scheduledMeliSkuStats — runs daily at 04:00 Mexico City time (UTC-6)
 * Computes fresh SKU stats after meliSyncOrders has run (03:00 AM).
 */
export const scheduledMeliSkuStats = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .pubsub.schedule('0 10 * * *')   // 04:00 AM CST = 10:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
        try {
            const result = await computeAndSaveSkuStats(90);
            console.log('[MeliSkuStats Cron] Done:', result);
        } catch (err: any) {
            console.error('[MeliSkuStats Cron] Error:', err);
        }
    });
