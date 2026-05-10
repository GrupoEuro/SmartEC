/**
 * analytics-cron.ts
 * Scheduled analytics: abandoned cart detection, daily stats aggregation,
 * MeLi inventory velocity enrichment, price scan diagnostics, paid media sync.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db, bigquery } from './shared';
import { getValidMeliToken, getAppLevelToken, getMeliConfig } from './meli-shared';
import { appendOrdersToBQForDate } from './inbox';

const ABANDON_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

async function runAbandonedCartDetection(): Promise<{ carts: number; guests: number; total: number }> {
    const now = Date.now();
    const cutoff = admin.firestore.Timestamp.fromMillis(now - ABANDON_THRESHOLD_MS);
    const batch = db.batch();
    let cartCount = 0;
    let guestCount = 0;

    // Helper: write a cartSnapshot event doc
    async function writeAbandonedSnapshot(data: any, collection_: string) {
        try {
            const items = data.items ?? [];
            const cartValue = Array.isArray(items)
                ? items.reduce((sum: number, i: any) => sum + (i.product?.price || 0) * (i.quantity || 1), 0)
                : 0;
            await db.collection('cartSnapshots').add({
                sessionId: data.sessionId ?? 'unknown',
                userId: data.userId ?? null,
                email: data.email ?? null,
                event: 'abandoned_detected',
                items: items,
                cartValue,
                attribution: data.attribution ?? null,
                createdAt: admin.firestore.Timestamp.now(),
                source: collection_,
            });
        } catch (e) {
            console.warn('[AbandonDetect] Snapshot write failed:', e);
        }
    }

    // ── Scan: carts/{uid} ──────────────────────────────────────────────────────
    const cartSnap = await db.collection('carts')
        .where('status', 'in', ['active', 'checkout_started'])
        .where('lastUpdated', '<=', cutoff)
        .limit(200)
        .get();

    for (const docSnap of cartSnap.docs) {
        const data = docSnap.data();
        // Guard: require at least one item
        if (!Array.isArray(data.items) || data.items.length === 0) continue;
        batch.update(docSnap.ref, {
            status: 'abandoned',
            abandonedAt: admin.firestore.Timestamp.now(),
            lastUpdated: admin.firestore.Timestamp.now(),
        });
        await writeAbandonedSnapshot(data, 'carts');
        cartCount++;
    }

    // ── Scan: guestCarts/{sessionId} ───────────────────────────────────────────
    const guestSnap = await db.collection('guestCarts')
        .where('status', 'in', ['active', 'checkout_started'])
        .where('lastUpdated', '<=', cutoff)
        .limit(200)
        .get();

    for (const docSnap of guestSnap.docs) {
        const data = docSnap.data();
        if (!Array.isArray(data.items) || data.items.length === 0) continue;
        batch.update(docSnap.ref, {
            status: 'abandoned',
            abandonedAt: admin.firestore.Timestamp.now(),
            lastUpdated: admin.firestore.Timestamp.now(),
        });
        await writeAbandonedSnapshot(data, 'guestCarts');
        guestCount++;
    }

    await batch.commit();

    const total = cartCount + guestCount;
    console.log(`[AbandonDetect] Marked ${total} carts as abandoned (${cartCount} auth, ${guestCount} guest).`);
    return { carts: cartCount, guests: guestCount, total };
}

// ── Scheduled: every 30 minutes ───────────────────────────────────────────────


export const detectAbandonedCarts = functions.pubsub
    .schedule('every 30 minutes')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        try {
            const result = await runAbandonedCartDetection();
            console.log('[AbandonDetect] Run complete:', result);
        } catch (err: any) {
            console.error('[AbandonDetect] Fatal error:', err.message);
        }
    });

// ── Manual HTTP trigger for testing (staff only — validate via token or restrict in rules) ──
export const detectAbandonedCartsHttp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = context.auth.token?.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Manager+ required.');
    }
    const result = await runAbandonedCartDetection();
    return { success: true, ...result };
});

// ─── Monthly Stats Aggregation ─────────────────────────────────────────────────
// Firestore structure: monthly_stats/{YYYY-MM}          ← month aggregate
//                      monthly_stats/{YYYY-MM}/days/{DD} ← daily subcollection

/**
 * backfillMonthlyStats — callable (one-time per month range).
 * Reads all orders in [fromMonth, toMonth] and writes monthly_stats aggregates
 * including the daily subcollection. Safe to re-run: uses set() with merge.
 *
 * Input: { fromMonth: '2025-01', toMonth: '2025-02' }
 */
export const backfillMonthlyStats = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }
        const role = context.auth.token?.role;
        if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
            throw new functions.https.HttpsError('permission-denied', 'Admin required.');
        }

        const { fromMonth, toMonth } = data as { fromMonth: string; toMonth: string };
        if (!fromMonth || !toMonth) {
            throw new functions.https.HttpsError('invalid-argument', 'fromMonth and toMonth required (format: YYYY-MM).');
        }

        // Build the list of months to process
        const months: string[] = [];
        let [year, mon] = fromMonth.split('-').map(Number);
        const [toYear, toMon] = toMonth.split('-').map(Number);
        while (year < toYear || (year === toYear && mon <= toMon)) {
            months.push(`${year}-${String(mon).padStart(2, '0')}`);
            mon++;
            if (mon > 12) { mon = 1; year++; }
        }

        const results: Array<{ month: string; orders: number; sales: number; days: number }> = [];

        for (const monthStr of months) {
            const [y, m] = monthStr.split('-').map(Number);
            const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
            const endDate = new Date(y, m, 0, 23, 59, 59, 999); // last ms of month

            const ordersSnap = await db.collection('orders')
                .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
                .get();

            // Aggregate by day
            const dayMap: Record<string, { sales: number; orders: number; pieces: number }> = {};
            let monthSales = 0, monthOrders = 0, monthPieces = 0;

            ordersSnap.docs.forEach(docSnap => {
                const order = docSnap.data();
                // Skip cancelled/refunded/returned — they don't count toward revenue
                if (['cancelled', 'refunded', 'returned'].includes(order['status'])) return;

                const orderDate: Date = order['createdAt']?.toDate?.() ?? new Date();
                const dayKey = String(orderDate.getDate()).padStart(2, '0');

                const total = Number(order['total'] ?? 0);
                const pieces = (order['items'] as any[] ?? [])
                    .reduce((s: number, item: any) => s + (Number(item.quantity) || 1), 0);

                if (!dayMap[dayKey]) dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
                dayMap[dayKey].sales += total;
                dayMap[dayKey].orders += 1;
                dayMap[dayKey].pieces += pieces;

                monthSales += total;
                monthOrders += 1;
                monthPieces += pieces;
            });

            // Write in batches (max 500 ops per batch; we only have ~31 days + 1 parent = fine)
            const monthRef = db.collection('monthly_stats').doc(monthStr);
            const batch = db.batch();

            // Parent month aggregate
            batch.set(monthRef, {
                month: monthStr,
                sales: monthSales,
                orders: monthOrders,
                pieces: monthPieces,
                backfilled: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Daily subcollection docs
            for (const [day, dayData] of Object.entries(dayMap)) {
                const dayRef = monthRef.collection('days').doc(day);
                batch.set(dayRef, {
                    day,
                    month: monthStr,
                    sales: dayData.sales,
                    orders: dayData.orders,
                    pieces: dayData.pieces,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            await batch.commit();

            const entry = { month: monthStr, orders: monthOrders, sales: monthSales, days: Object.keys(dayMap).length };
            results.push(entry);
            console.log(`[Backfill] ${monthStr}: ${monthOrders} orders, $${monthSales.toFixed(0)}, ${Object.keys(dayMap).length} days`);
        }

        return { success: true, processed: months.length, results };
    });

/**
 * aggregateDailyStats — scheduled every hour.
 * Writes today's order totals to monthly_stats/{YYYY-MM}/days/{DD}
 * and updates the parent month aggregate by re-summing all day docs.
 * Also synchronizes today's orders into BigQuery.
 */
export const aggregateDailyStats = functions.pubsub
    .schedule('0 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        // Force evaluation in Mexico City Timezone
        const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
        const today = new Date(nowStr);
        const DAYS_TO_SYNC = 1; // ✅ Only sync TODAY on the hourly schedule.
        // Historical backfill is handled by backfillMonthlyStats (callable).

        // ── Canonical non-revenue statuses (mirrors order.model.ts) ──────────
        const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];

        // ── Canonical channel resolution (mirrors ops queue getLegacyChannel) ─
        const resolveChannel = (order: any): string => {
            const sc = order.sourceChannel;
            const ft = order.fulfillmentType;
            if (!sc || sc === 'storefront') return 'WEB';
            if (sc === 'pos') return 'POS';
            if (sc === 'on_behalf') return 'ON_BEHALF';
            if (sc === 'amazon') return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
            if (sc === 'mercadolibre') return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
            return 'WEB';
        };

        let totalBqOrdersAppended = 0;
        let lastSyncDateStr = '';

        for (let i = DAYS_TO_SYNC - 1; i >= 0; i--) {
            const now = new Date(today);
            now.setDate(now.getDate() - i);

            const year = now.getFullYear();
            const month = now.getMonth();   // 0-based
            const day = now.getDate();    // 1-based

            const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
            const dayStr = String(day).padStart(2, '0');
            const dateStr = `${monthStr}-${dayStr}`;   // YYYY-MM-DD
            lastSyncDateStr = dateStr;

            // Construct boundaries explicitly using UTC-6 (Mexico City Standard Time)
            const startOfDay = new Date(`${dateStr}T00:00:00-06:00`);
            const endOfDay = new Date(`${dateStr}T23:59:59.999-06:00`);

            // ── Read target day's orders ───────────────────────────────────────────────
            const ordersSnap = await db.collection('orders')
                .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
                .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
                .get();

            // ── Aggregate: totals + per-channel breakdowns ────────────────────────
            let totalSales = 0, totalOrders = 0, totalPieces = 0;
            const byChannel: Record<string, { revenue: number; orders: number; units: number }> = {};

            ordersSnap.docs.forEach(docSnap => {
                const order = docSnap.data();
                if (NON_REVENUE.includes(order['status'])) return;   // skip ghost & void orders

                const revenue = Number(order['total'] ?? 0);
                const units = (order['items'] as any[] ?? [])
                    .reduce((s: number, item: any) => s + (Number(item.quantity) || 1), 0);
                const channel = resolveChannel(order);

                totalSales += revenue;
                totalOrders += 1;
                totalPieces += units;

                if (!byChannel[channel]) byChannel[channel] = { revenue: 0, orders: 0, units: 0 };
                byChannel[channel].revenue += revenue;
                byChannel[channel].orders += 1;
                byChannel[channel].units += units;
            });

            const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
            const ts = admin.firestore.FieldValue.serverTimestamp();

            // ── 1. Legacy monthly_stats (backward compat) ─────────────────────────
            const monthRef = db.collection('monthly_stats').doc(monthStr);
            const dayRef = monthRef.collection('days').doc(dayStr);
            await dayRef.set({
                day: dayStr, month: monthStr,
                sales: totalSales, orders: totalOrders, pieces: totalPieces,
                updatedAt: ts,
            });

            // ── 2. analytics_daily/{YYYY-MM-DD} ──────────────────────────────────
            const dt = new Date(`${dateStr}T12:00:00`);
            await db.collection('analytics_daily').doc(dateStr).set({
                date: dateStr,
                month: monthStr,
                dayOfWeek: (dt.getDay() + 6) % 7,   // 0=Mon … 6=Sun (ISO)
                totalRevenue: totalSales,
                totalOrders,
                totalUnits: totalPieces,
                avgTicket,
                byChannel,
                updatedAt: ts,
            }, { merge: true });

            // ── 3. analytics_channel_snapshots/{channel}/{YYYY-MM-DD} ─────────────
            const batch = db.batch();
            for (const [channel, data] of Object.entries(byChannel)) {
                const snapRef = db
                    .collection('analytics_channel_snapshots')
                    .doc(channel)
                    .collection('days')
                    .doc(dateStr);
                batch.set(snapRef, {
                    channel, date: dateStr, month: monthStr,
                    revenue: data.revenue,
                    orders: data.orders,
                    units: data.units,
                    avgPrice: data.orders > 0 ? data.revenue / data.orders : 0,
                    updatedAt: ts,
                }, { merge: true });
            }
            await batch.commit();

            // ── 4. Enrich MELI_FULL snapshot with visit data from MeLi Metrics API ─
            try {
                const meliConfig = await getMeliConfig();
                if (meliConfig?.accessToken && meliConfig?.userId && byChannel['MELI_FULL']) {
                    const token = await getValidMeliToken();
                    const visitsRes = await fetch(
                        `https://api.mercadolibre.com/users/${meliConfig.userId}/items_visits/time_window?last=1&unit=day`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    );
                    if (visitsRes.ok) {
                        const visitsJson = await visitsRes.json() as any;
                        const totalVisits = visitsJson?.total_visits ?? 0;
                        const meliFullOrders = byChannel['MELI_FULL'].orders ?? 0;
                        const conversionRate = totalVisits > 0
                            ? parseFloat(((meliFullOrders / totalVisits) * 100).toFixed(2))
                            : 0;

                        const meliSnapRef = db
                            .collection('analytics_channel_snapshots')
                            .doc('MELI_FULL')
                            .collection('days')
                            .doc(dateStr);

                        await meliSnapRef.set({
                            visits: totalVisits,
                            conversionRate,
                            updatedAt: ts,
                        }, { merge: true });
                    }
                }
            } catch (meliErr) {
                console.warn(`[DailyStats] MeLi visits enrichment failed for ${dateStr}:`, meliErr);
            }

            console.log(`[DailyStats] ${dateStr}: orders=${totalOrders}, revenue=$${totalSales.toFixed(0)}, pieces=${totalPieces}`);

            // ── 5. Append this day's orders into BigQuery (Rolling Buffer) ─────────
            try {
                const bqPayload = ordersSnap.docs
                    .filter(docSnap => !NON_REVENUE.includes(docSnap.data()['status']))
                    .map(docSnap => ({
                        orderId: docSnap.id,
                        order: docSnap.data(),
                        channel: resolveChannel(docSnap.data()),
                    }));
                await appendOrdersToBQForDate(dateStr, bqPayload);
                totalBqOrdersAppended += bqPayload.length;
            } catch (bqErr: any) {
                console.warn(`[DailyStats] BigQuery append failed for ${dateStr} (non-critical):`, bqErr);
            }
        }

        // ── 6. Re-sum current month aggregate ──────────────────────────────────
        // Instead of incrementing, we recalculate the whole month to ensure it perfectly
        // matches the days we just overwrote, maintaining absolute consistency.
        try {
            const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            const ts = admin.firestore.FieldValue.serverTimestamp();

            const monthRef = db.collection('monthly_stats').doc(currentMonthStr);
            const allDaysSnap = await monthRef.collection('days').get();
            let mSales = 0, mOrders = 0, mPieces = 0;
            allDaysSnap.docs.forEach(d => {
                mSales += Number(d.data()['sales'] ?? 0);
                mOrders += Number(d.data()['orders'] ?? 0);
                mPieces += Number(d.data()['pieces'] ?? 0);
            });

            await monthRef.set({ month: currentMonthStr, sales: mSales, orders: mOrders, pieces: mPieces, updatedAt: ts }, { merge: true });

            await db.collection('analytics_monthly').doc(currentMonthStr).set({
                month: currentMonthStr,
                totalRevenue: mSales,
                totalOrders: mOrders,
                totalUnits: mPieces,
                updatedAt: ts,
            }, { merge: true });

            // ── 7. Write BQ sync status ───────────────────────────────────────────────
            await db.collection('system_logs').doc('bq_sync_status').set({
                lastSyncDate: lastSyncDateStr,
                syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                ordersAppended: totalBqOrdersAppended,
                status: 'success',
                errorMessage: null,
            }, { merge: true });

        } catch (err: any) {
            console.warn('[DailyStats] Aggregate monthly/status write failed:', err);
            await db.collection('system_logs').doc('bq_sync_status').set({
                lastSyncDate: lastSyncDateStr,
                syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                ordersAppended: 0,
                status: 'error',
                errorMessage: err?.message ?? 'unknown',
            }, { merge: true });
        }
    });





// ─── cleanupAbandonedCheckouts — scheduled every 30 min ──────────────────────
//
// Auto-cancels orders stuck in `pending_payment` for more than 35 minutes.
// These are customers who started checkout but never completed payment.
// Runs at :05 and :35 of every hour to avoid overlap with any other nightly jobs.
//
// Adds a history entry for audit trail: { status: 'cancelled', note: 'Pago no completado' }
//
// ─────────────────────────────────────────────────────────────────────────────

export const cleanupAbandonedCheckouts = functions.pubsub
    .schedule('5,35 * * * *')      // every 30 min at :05 and :35
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        const now = new Date();
        const cutoff = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago

        const snap = await db.collection('orders')
            .where('status', '==', 'pending_payment')
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(cutoff))
            .limit(100)
            .get();

        if (snap.empty) {
            console.log('[CleanupCheckouts] No abandoned checkouts found.');
            return;
        }

        console.log(`[CleanupCheckouts] Cancelling ${snap.size} abandoned checkout(s).`);

        const batch = db.batch();
        for (const orderDoc of snap.docs) {
            const data = orderDoc.data();
            const history = data['history'] ?? [];
            batch.update(orderDoc.ref, {
                status: 'cancelled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                history: [...history, {
                    status: 'cancelled',
                    timestamp: admin.firestore.Timestamp.now(),
                    note: 'Pago no completado — cancelación automática (35 min)',
                    updatedBy: 'system',
                }],
            });
        }

        await batch.commit();
        console.log(`[CleanupCheckouts] Done. ${snap.size} order(s) cancelled.`);

        // ── Log daily abandon count for the Metrics Hub ────────────────────────
        // Writes to system_logs/abandon_stats as a map: { daily: { "2026_04_28": 5, ... } }
        // Using underscores in the key so Firestore field paths don't require quoting.
        try {
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
                .replace(/-/g, '_');  // → "2026_04_28"
            await db.collection('system_logs').doc('abandon_stats').set({
                [`daily.${today}`]: admin.firestore.FieldValue.increment(snap.size),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        } catch (logErr) {
            console.warn('[CleanupCheckouts] Failed to write abandon stats (non-critical):', logErr);
        }

    });


// ─── meliEnrichInventoryVelocity ─────────────────────────────────────────────
//
// Scheduled weekly (Mon 06:00 MX) + callable on-demand.
// For every SKU in meli_fbm_inventory, computes:
//   - salesVelocity30d  (units/day average over last 30 days)
//   - salesVelocity7d   (units/day average over last 7 days — shows trend)
//   - daysOfCoverage    (availableQty / velocity30d)
//   - reorderAlertLevel ('ok' | 'low' | 'critical' | 'stockout')
//   - recommendedReplenishQty  (target 45 days of stock)
//   - projectedStockoutDate
//
// ─────────────────────────────────────────────────────────────────────────────

// Helper shared by scheduled + callable
async function computeInventoryVelocity(): Promise<{ updated: number; errors: string[] }> {
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const now = new Date();
    const start30 = new Date(now); start30.setDate(now.getDate() - 30);
    const start7 = new Date(now); start7.setDate(now.getDate() - 7);

    // 1. Load all MELI_FULL revenue orders from last 30 days
    const ordersSnap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('fulfillmentType', '==', 'platform')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start30))
        .get();

    // 2. Build SKU velocity maps: { sku → { units30d, units7d } }
    const velocityMap: Record<string, { units30d: number; units7d: number }> = {};
    const itemIdMap: Record<string, { units30d: number; units7d: number }> = {};

    for (const snap of ordersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status'])) continue;

        const orderDate = (order['createdAt'] as admin.firestore.Timestamp).toDate();
        const inLast7 = orderDate >= start7;

        const items = (order['items'] as any[] ?? []);
        for (const item of items) {
            const sku = (item.sku ?? '').trim();
            const mlId = (item.mlItemId ?? item.productId ?? '').trim();
            const qty = Number(item.quantity) || 1;

            if (sku) {
                if (!velocityMap[sku]) velocityMap[sku] = { units30d: 0, units7d: 0 };
                velocityMap[sku].units30d += qty;
                if (inLast7) velocityMap[sku].units7d += qty;
            }
            if (mlId) {
                if (!itemIdMap[mlId]) itemIdMap[mlId] = { units30d: 0, units7d: 0 };
                itemIdMap[mlId].units30d += qty;
                if (inLast7) itemIdMap[mlId].units7d += qty;
            }
        }
    }

    // 3. Load all FBM inventory docs
    const invSnap = await db.collection('meli_fbm_inventory').get();
    const errors: string[] = [];
    const batch = db.batch();
    let updated = 0;

    for (const invDoc of invSnap.docs) {
        try {
            const data = invDoc.data();
            const sku = (data['sku'] ?? '').trim();
            const mlId = (data['mlItemId'] ?? '').trim();

            // Prefer SKU match, fall back to ML Item ID
            const vel = (sku && velocityMap[sku]) ? velocityMap[sku]
                : (mlId && itemIdMap[mlId]) ? itemIdMap[mlId]
                    : null;

            const units30d = vel?.units30d ?? 0;
            const units7d = vel?.units7d ?? 0;
            const vel30 = units30d / 30;
            const vel7 = units7d / 7;
            const available = Number(data['availableQuantity'] ?? data['fullStock'] ?? 0);
            const daysOfCoverage = vel30 > 0 ? Math.floor(available / vel30) : 9999;
            const targetDays = 45;
            const replenish = vel30 > 0
                ? Math.max(0, Math.ceil((targetDays * vel30) - available))
                : 0;

            let alertLevel: 'ok' | 'low' | 'critical' | 'stockout';
            if (available === 0) alertLevel = 'stockout';
            else if (daysOfCoverage < 7) alertLevel = 'critical';
            else if (daysOfCoverage < 21) alertLevel = 'low';
            else alertLevel = 'ok';

            const stockoutDate = vel30 > 0 && available > 0
                ? new Date(now.getTime() + (daysOfCoverage * 86400000))
                    .toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
                : null;

            batch.update(invDoc.ref, {
                salesVelocity30d: parseFloat(vel30.toFixed(2)),
                salesVelocity7d: parseFloat(vel7.toFixed(2)),
                daysOfCoverage,
                reorderAlertLevel: alertLevel,
                recommendedReplenishQty: replenish,
                projectedStockoutDate: stockoutDate,
                lastVelocityCalc: admin.firestore.FieldValue.serverTimestamp(),
            });
            updated++;
        } catch (err: any) {
            errors.push(`${invDoc.id}: ${err?.message ?? err}`);
        }
    }

    await batch.commit();
    return { updated, errors };
}


export const meliEnrichInventoryVelocity = functions.pubsub
    .schedule('0 6 * * 1')       // Every Monday 06:00 MX
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        const result = await computeInventoryVelocity();
        console.log(`[VelocityEnrich] updated=${result.updated}, errors=${result.errors.length}`);
        if (result.errors.length) console.warn('[VelocityEnrich] errors:', result.errors);
    });

export const meliEnrichInventoryVelocityCallable = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }
        const result = await computeInventoryVelocity();
        return result;
    });


// ─── backfillAnalytics — callable ────────────────────────────────────────────
//
// One-time callable to populate analytics_daily and analytics_channel_snapshots
// from all historical orders. Processes in 30-day chunks to avoid timeouts.
// Call after deploying the new analytics collections.
//
// Returns: { daysProcessed, daysSkipped, writeCount }
//
// ─────────────────────────────────────────────────────────────────────────────

export const backfillAnalytics = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data: { fromDate?: string; toDate?: string }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];

        const resolveChannel = (order: any): string => {
            const sc = order.sourceChannel; const ft = order.fulfillmentType;
            if (!sc || sc === 'storefront') return 'WEB';
            if (sc === 'pos') return 'POS';
            if (sc === 'on_behalf') return 'ON_BEHALF';
            if (sc === 'amazon') return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
            if (sc === 'mercadolibre') return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
            return 'WEB';
        };

        const toMxDateStr = (d: Date): string =>
            d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

        // Date range: default = start of 2024 to yesterday
        const now = new Date();
        const fromDate = data?.fromDate
            ? new Date(data.fromDate + 'T06:00:00')
            : new Date('2024-01-01T06:00:00');
        const toDate = data?.toDate
            ? new Date(data.toDate + 'T23:59:59')
            : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Load ALL orders in range in one query (< 100K docs — manageable in 1GB)
        const allOrdersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
            .get();

        console.log(`[BackfillAnalytics] Total orders loaded: ${allOrdersSnap.size}`);

        // Group orders by MX date key
        const dateMap: Record<string, Record<string, {
            revenue: number; orders: number; units: number;
        }>> = {};   // dateStr → channelId → metrics

        for (const snap of allOrdersSnap.docs) {
            const order = snap.data();
            if (NON_REVENUE.includes(order['status'])) continue;

            const orderDate = (order['createdAt'] as admin.firestore.Timestamp).toDate();
            const dateKey = toMxDateStr(orderDate);
            const channel = resolveChannel(order);
            const revenue = Number(order['total'] ?? 0);
            const units = (order['items'] as any[] ?? [])
                .reduce((s: number, i: any) => s + (Number(i.quantity) || 1), 0);

            if (!dateMap[dateKey]) dateMap[dateKey] = {};
            if (!dateMap[dateKey][channel]) dateMap[dateKey][channel] = { revenue: 0, orders: 0, units: 0 };
            dateMap[dateKey][channel].revenue += revenue;
            dateMap[dateKey][channel].orders += 1;
            dateMap[dateKey][channel].units += units;
        }

        // Write analytics_daily and analytics_channel_snapshots in batches of 400
        const ts = admin.firestore.FieldValue.serverTimestamp();
        let writeCount = 0;
        let batch = db.batch();
        let batchSize = 0;

        const flushBatch = async () => {
            if (batchSize > 0) { await batch.commit(); batch = db.batch(); batchSize = 0; }
        };

        const dates = Object.keys(dateMap).sort();

        for (const dateStr of dates) {
            const channelData = dateMap[dateStr];
            const [y, m, d] = dateStr.split('-').map(Number);
            const monthStr = `${y}-${String(m).padStart(2, '0')}`;
            const dt = new Date(dateStr + 'T12:00:00');

            // Aggregate all channels for this day → analytics_daily
            let totalRevenue = 0, totalOrders = 0, totalUnits = 0;
            for (const ch of Object.values(channelData)) {
                totalRevenue += ch.revenue; totalOrders += ch.orders; totalUnits += ch.units;
            }
            const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

            const dailyRef = db.collection('analytics_daily').doc(dateStr);
            batch.set(dailyRef, {
                date: dateStr, month: monthStr,
                dayOfWeek: (dt.getDay() + 6) % 7,
                totalRevenue, totalOrders, totalUnits, avgTicket,
                byChannel: channelData,
                updatedAt: ts,
            }, { merge: true });
            batchSize++;

            // Per-channel snapshots
            for (const [channel, data2] of Object.entries(channelData)) {
                const snapRef = db
                    .collection('analytics_channel_snapshots')
                    .doc(channel)
                    .collection('days')
                    .doc(dateStr);
                batch.set(snapRef, {
                    channel, date: dateStr, month: monthStr,
                    revenue: data2.revenue, orders: data2.orders, units: data2.units,
                    avgPrice: data2.orders > 0 ? data2.revenue / data2.orders : 0,
                    updatedAt: ts,
                }, { merge: true });
                batchSize++;
            }

            writeCount += 1 + Object.keys(channelData).length;

            // Flush every 400 writes
            if (batchSize >= 400) await flushBatch();
        }
        await flushBatch();

        console.log(`[BackfillAnalytics] Done. dates=${dates.length}, writes=${writeCount}`);
        return { daysProcessed: dates.length, writeCount };
    });


// ─── Price Intelligence Diagnostic ───────────────────────────────────────────
//
// Callable from Angular: httpsCallable(functions, 'meliPriceScanDiag')
// Tests every step of the meliPriceScan pipeline independently.
// Returns a detailed report — never throws, always returns all steps attempted.
//

export const meliPriceScanDiag = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const width = data?.width ?? 120;
        const aspectRatio = data?.aspectRatio ?? 70;
        const diameter = data?.diameter ?? 17;
        const categoryId = data?.categoryId ?? 'MLM169975';

        const report: Record<string, any> = {
            version: '2026-04-17-v1',
            testedSize: `${width}/${aspectRatio}R${diameter}`,
            ranAt: new Date().toISOString(),
        };

        // Step 1: Read integrations config
        let meliConfig: any = null;
        try {
            const configDoc = await db.collection('config').doc('integrations').get();
            const raw = configDoc.data()?.meli ?? null;
            meliConfig = raw;
            report.step1_config = {
                ok: !!raw,
                docExists: configDoc.exists,
                hasAccessToken: !!(raw?.accessToken),
                hasRefreshToken: !!(raw?.refreshToken),
                hasAppId: !!(raw?.appId),
                hasClientSecret: !!(raw?.clientSecret),
                hasUserId: !!(raw?.userId),
                connected: raw?.connected ?? false,
                expiresAt: raw?.expiresAt ? new Date(raw.expiresAt).toISOString() : null,
                tokenExpiresIn: raw?.expiresAt
                    ? `${Math.round((raw.expiresAt - Date.now()) / 60000)} min`
                    : 'unknown',
                accessTokenFirst8: raw?.accessToken
                    ? `${String(raw.accessToken).substring(0, 8)}...`
                    : null,
            };
        } catch (err: any) {
            report.step1_config = { ok: false, error: err.message };
        }

        // Step 0: Test app-level token (client_credentials) — the key fix for GCP IP blocking
        let appToken: string | null = null;
        try {
            appToken = await getAppLevelToken();
            report.step0_app_token = {
                ok: true,
                tokenFirst8: appToken.substring(0, 8) + '...',
                message: 'App token (client_credentials) obtained — search calls will use this token',
            };
        } catch (err: any) {
            report.step0_app_token = { ok: false, error: err.message, message: 'App token failed — will fall back to user token for searches' };
            // Not fatal — we continue with user token
        }

        // Step 2: Get valid token (with auto-refresh)
        let accessToken: string | null = null;
        try {
            accessToken = await getValidMeliToken();
            report.step2_token = {
                ok: true,
                tokenFirst8: accessToken.substring(0, 8) + '...',
                message: 'User token obtained successfully',
            };
        } catch (err: any) {
            report.step2_token = { ok: false, error: err.message };
            report.verdict = '❌ BLOCKED at Step 2: Cannot get a valid ML access token. Re-authenticate at /admin/integrations.';
            return report;
        }

        const authHeaders: Record<string, string> = { 'Authorization': `Bearer ${accessToken}` };
        const appAuthHeaders: Record<string, string> = { 'Authorization': `Bearer ${appToken ?? accessToken}` };

        // Step 3: Verify token via /users/me
        try {
            const meRes = await fetch('https://api.mercadolibre.com/users/me', { headers: authHeaders });
            const meData = await meRes.json() as any;
            report.step3_users_me = {
                ok: meRes.ok,
                httpStatus: meRes.status,
                userId: meData?.id ?? null,
                nickname: meData?.nickname ?? null,
                siteId: meData?.site_id ?? null,
                error: !meRes.ok ? (meData?.message || `HTTP ${meRes.status}`) : null,
            };
            if (!meRes.ok) {
                report.verdict = `❌ BLOCKED at Step 3: Token rejected (${meRes.status}: ${meData?.message}). Re-authenticate.`;
                return report;
            }
        } catch (err: any) {
            report.step3_users_me = { ok: false, error: err.message };
            report.verdict = '❌ BLOCKED at Step 3: Network error reaching ML API.';
            return report;
        }

        // Step 4: Check category attribute names
        try {
            const catRes = await fetch(
                `https://api.mercadolibre.com/categories/${categoryId}/attributes`,
                { headers: authHeaders }
            );
            const catData = await catRes.json() as any[];
            const attrIds = Array.isArray(catData) ? catData.map((a: any) => a.id) : [];
            const hasWidth = attrIds.includes('SECTION_WIDTH');
            const hasAR = attrIds.includes('AUTOMOTIVE_TIRE_ASPECT_RATIO');
            const hasRim = attrIds.includes('RIM_DIAMETER');
            const hasMfgSize = attrIds.includes('MANUFACTURER_TIRE_SIZE');
            report.step4_category_attrs = {
                ok: catRes.ok,
                httpStatus: catRes.status,
                categoryId,
                totalAttributes: attrIds.length,
                hasSECTION_WIDTH: hasWidth,
                hasAUTOMOTIVE_TIRE_ASPECT_RATIO: hasAR,
                hasRIM_DIAMETER: hasRim,
                hasMANUFACTURER_TIRE_SIZE: hasMfgSize,
                verdict: (hasWidth && hasAR && hasRim)
                    ? 'All 3 size attributes present'
                    : 'SOME SIZE ATTRIBUTES MISSING — ML may have renamed them, causing zero results',
            };
        } catch (err: any) {
            report.step4_category_attrs = { ok: false, error: err.message };
        }

        // Step 5: Strategy S1 — keyword search WITH APP TOKEN (the fixed approach)
        try {
            const url = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=5&sort=price_asc`;
            const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN — key fix
            const body = await r.json() as any;
            report.step5_attr_search = {
                ok: r.ok,
                httpStatus: r.status,
                url,
                totalResults: body?.paging?.total ?? null,
                returnedCount: (body?.results ?? []).length,
                firstItem: body?.results?.[0]
                    ? { id: body.results[0].id, title: body.results[0].title, price: body.results[0].price }
                    : null,
                rawError: !r.ok ? body : null,
                error: !r.ok ? (body?.message ?? body?.error ?? `HTTP ${r.status}`) : null,
            };
        } catch (err: any) {
            report.step5_attr_search = { ok: false, error: err.message };
        }

        // Step 5b: Strategy D — catalog product items (WITH auth, avoids search endpoint)
        try {
            // Try first discovered productId, or a known catalog product for 120/70R17
            const testProductId = report.step5_attr_search?.ok === false ? 'MLAP9213' : null; // fallback known product
            const prodRes = await fetch(
                `https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=3`,
                { headers: appAuthHeaders }
            );
            if (prodRes.ok) {
                const prodData = await prodRes.json() as any;
                const firstProd = (prodData.results || [])[0];
                if (firstProd?.id) {
                    const itemsRes = await fetch(
                        `https://api.mercadolibre.com/products/${firstProd.id}/items?site_id=MLM&limit=5`,
                        { headers: appAuthHeaders }
                    );
                    const itemsBody = await itemsRes.json() as any;
                    const items: any[] = itemsBody.results ?? itemsBody.items ?? (Array.isArray(itemsBody) ? itemsBody : []);
                    report.step5b_catalog_items = {
                        ok: itemsRes.ok,
                        httpStatus: itemsRes.status,
                        catalogProductId: firstProd.id,
                        returnedCount: items.length,
                        firstItem: items[0] ? { id: items[0].id, title: items[0].title, price: items[0].price } : null,
                        rawError: !itemsRes.ok ? itemsBody : null,
                        error: !itemsRes.ok ? (itemsBody?.message ?? itemsBody?.error ?? `HTTP ${itemsRes.status}`) : null,
                    };
                } else {
                    report.step5b_catalog_items = { ok: false, error: 'No catalog products found for this size' };
                }
            } else {
                const errBody = await prodRes.json().catch(() => ({})) as any;
                report.step5b_catalog_items = { ok: false, httpStatus: prodRes.status, error: errBody?.message ?? `HTTP ${prodRes.status}` };
            }
        } catch (err: any) {
            report.step5b_catalog_items = { ok: false, error: err.message };
        }
        // Step 6: Strategy S2 — attribute search WITH APP TOKEN
        try {
            const sizeStr = `${width}/${aspectRatio}R${diameter}`;
            const url = `https://api.mercadolibre.com/sites/MLM/search?category=${categoryId}&SECTION_WIDTH=${width}&AUTOMOTIVE_TIRE_ASPECT_RATIO=${aspectRatio}&RIM_DIAMETER=${diameter}&limit=5&sort=price_asc`;
            const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN
            const body = await r.json() as any;
            report.step6_size_string_search = {
                ok: r.ok,
                httpStatus: r.status,
                sizeStr,
                url,
                totalResults: body?.paging?.total ?? null,
                returnedCount: (body?.results ?? []).length,
                rawError: !r.ok ? body : null,
                error: !r.ok ? (body?.message ?? body?.error ?? `HTTP ${r.status}`) : null,
            };
        } catch (err: any) {
            report.step6_size_string_search = { ok: false, error: err.message };
        }

        // Step 7: Our seller items
        const sellerId = meliConfig?.userId ? String(meliConfig.userId) : null;
        let firstItemId: string | null = null;
        if (sellerId) {
            try {
                const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=5`;
                const r = await fetch(url, { headers: authHeaders });
                const body = await r.json() as any;
                firstItemId = (body?.results ?? [])[0] ?? null;
                report.step7_seller_items = {
                    ok: r.ok,
                    httpStatus: r.status,
                    sellerId,
                    totalItems: body?.paging?.total ?? null,
                    firstIds: (body?.results ?? []).slice(0, 5),
                    error: !r.ok ? (body?.message || body?.error || `HTTP ${r.status}`) : null,
                };
            } catch (err: any) {
                report.step7_seller_items = { ok: false, sellerId, error: err.message };
            }
        } else {
            report.step7_seller_items = {
                ok: false,
                error: 'No sellerId in config/integrations.meli',
            };
        }

        // Step 7b: Test price_to_win on the first of our active items
        // This is the CORE endpoint of the new implementation — must be ✅ for scans to work.
        if (firstItemId) {
            try {
                const ptwRes = await fetch(
                    `https://api.mercadolibre.com/items/${firstItemId}/price_to_win`,
                    { headers: authHeaders }  // seller user token required
                );
                const ptwBody = await ptwRes.json() as any;
                report.step7b_price_to_win = {
                    ok: ptwRes.ok,
                    httpStatus: ptwRes.status,
                    testedItemId: firstItemId,
                    status: ptwBody.status ?? null,          // 'winner' | 'not_winner' | 'not_eligible'
                    priceToWin: ptwBody.price_to_win ?? null,
                    rawResponse: ptwBody,
                    error: !ptwRes.ok ? (ptwBody.message ?? ptwBody.error ?? `HTTP ${ptwRes.status}`) : null,
                    note: ptwRes.ok
                        ? (ptwBody.status === 'not_eligible'
                            ? 'Item not part of ML catalog — price_to_win not available for this listing'
                            : 'price_to_win endpoint working correctly')
                        : 'price_to_win failed — scans will not return competitive data',
                };
            } catch (err: any) {
                report.step7b_price_to_win = { ok: false, testedItemId: firstItemId, error: err.message };
            }
        } else {
            report.step7b_price_to_win = { ok: false, error: 'No active items found to test price_to_win' };
        }

        // Step 8: Firestore write/read round-trip
        try {
            const testRef = db.collection('price_intelligence').doc('diag-test-tmp');
            await testRef.set({ _diagTest: true, ranAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            const check = await testRef.get();
            await testRef.delete();
            report.step8_firestore = {
                ok: check.exists,
                message: check.exists ? 'Firestore write/read OK' : 'Write ok but read failed',
            };
        } catch (err: any) {
            report.step8_firestore = { ok: false, error: err.message };
        }

        // Final verdict — based on price_to_win approach (new authoritative method)
        const ptwOk = report.step7b_price_to_win?.ok === true;
        const ptwElig = report.step7b_price_to_win?.status !== 'not_eligible';
        const authOk = report.step2_token?.ok && report.step3_users_me?.ok;

        if (!authOk) {
            report.verdict = '❌ BLOCKED: Authentication broken — reconnect MercadoLibre in /admin/integrations.';
        } else if (!report.step7_seller_items?.ok || !report.step7_seller_items?.totalItems) {
            report.verdict = '⚠️ No active items found. Add a MercadoLibre listing to enable Price Intelligence.';
        } else if (!ptwOk) {
            report.verdict = `⚠️ price_to_win endpoint failed (HTTP ${report.step7b_price_to_win?.httpStatus}). Check seller permissions or re-authenticate.`;
        } else if (!ptwElig) {
            report.verdict = '⚠️ Tested item is not in ML catalog so price_to_win returned not_eligible. Scan the correct tire size (one you have listed in the catalog).';
        } else {
            report.verdict = `✅ Pipeline OK — price_to_win working (status: ${report.step7b_price_to_win?.status}, ptw: $${report.step7b_price_to_win?.priceToWin ?? 'N/A'}). Ready to scan.`;
        }

        console.log('[PriceIntelDiag]', report.verdict);
        return report;
    });


// ═══════════════════════════════════════════════════════════════════════════════
// ─── Paid Media Intelligence ──────────────────────────────────────────────────
// Pulls Meta Ads + Google Ads snapshots daily → stores in Firestore.
// Tokens/credentials stay server-side (config/integrations → meta / google).
//
// Firestore paths written:
//   advertising_snapshots/{YYYY-MM-DD}/meta/{campaignId}   → MetaInsights
//   advertising_snapshots/{YYYY-MM-DD}/google/{campaignId} → GoogleInsights
//   advertising_cache/latest                                → PaidMediaDailySummary
// ═══════════════════════════════════════════════════════════════════════════════

/** Reads paid media credentials from config/integrations */
