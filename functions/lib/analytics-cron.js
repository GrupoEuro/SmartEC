"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotProjectionsCallable = exports.snapshotProjections = exports.meliPriceScanDiag = exports.backfillAnalytics = exports.meliEnrichInventoryVelocityCallable = exports.meliEnrichInventoryVelocity = exports.cleanupAbandonedCheckouts = exports.aggregateDailyStats = exports.backfillMonthlyStats = exports.detectAbandonedCartsHttp = exports.detectAbandonedCarts = void 0;
/**
 * analytics-cron.ts
 * Scheduled analytics: abandoned cart detection, daily stats aggregation,
 * MeLi inventory velocity enrichment, price scan diagnostics, paid media sync.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const meli_shared_1 = require("./meli-shared");
const inbox_1 = require("./inbox");
const ABANDON_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
async function runAbandonedCartDetection() {
    const now = Date.now();
    const cutoff = admin.firestore.Timestamp.fromMillis(now - ABANDON_THRESHOLD_MS);
    const batch = shared_1.db.batch();
    let cartCount = 0;
    let guestCount = 0;
    // Helper: write a cartSnapshot event doc
    async function writeAbandonedSnapshot(data, collection_) {
        var _a, _b, _c, _d, _e;
        try {
            const items = (_a = data.items) !== null && _a !== void 0 ? _a : [];
            const cartValue = Array.isArray(items)
                ? items.reduce((sum, i) => { var _a; return sum + (((_a = i.product) === null || _a === void 0 ? void 0 : _a.price) || 0) * (i.quantity || 1); }, 0)
                : 0;
            await shared_1.db.collection('cartSnapshots').add({
                sessionId: (_b = data.sessionId) !== null && _b !== void 0 ? _b : 'unknown',
                userId: (_c = data.userId) !== null && _c !== void 0 ? _c : null,
                email: (_d = data.email) !== null && _d !== void 0 ? _d : null,
                event: 'abandoned_detected',
                items: items,
                cartValue,
                attribution: (_e = data.attribution) !== null && _e !== void 0 ? _e : null,
                createdAt: admin.firestore.Timestamp.now(),
                source: collection_,
            });
        }
        catch (e) {
            console.warn('[AbandonDetect] Snapshot write failed:', e);
        }
    }
    // ── Scan: carts/{uid} ──────────────────────────────────────────────────────
    const cartSnap = await shared_1.db.collection('carts')
        .where('status', 'in', ['active', 'checkout_started'])
        .where('lastUpdated', '<=', cutoff)
        .limit(200)
        .get();
    for (const docSnap of cartSnap.docs) {
        const data = docSnap.data();
        // Guard: require at least one item
        if (!Array.isArray(data.items) || data.items.length === 0)
            continue;
        batch.update(docSnap.ref, {
            status: 'abandoned',
            abandonedAt: admin.firestore.Timestamp.now(),
            lastUpdated: admin.firestore.Timestamp.now(),
        });
        await writeAbandonedSnapshot(data, 'carts');
        cartCount++;
    }
    // ── Scan: guestCarts/{sessionId} ───────────────────────────────────────────
    const guestSnap = await shared_1.db.collection('guestCarts')
        .where('status', 'in', ['active', 'checkout_started'])
        .where('lastUpdated', '<=', cutoff)
        .limit(200)
        .get();
    for (const docSnap of guestSnap.docs) {
        const data = docSnap.data();
        if (!Array.isArray(data.items) || data.items.length === 0)
            continue;
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
exports.detectAbandonedCarts = functions.pubsub
    .schedule('every 30 minutes')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    try {
        const result = await runAbandonedCartDetection();
        console.log('[AbandonDetect] Run complete:', result);
    }
    catch (err) {
        console.error('[AbandonDetect] Fatal error:', err.message);
    }
});
// ── Manual HTTP trigger for testing (staff only — validate via token or restrict in rules) ──
exports.detectAbandonedCartsHttp = functions.https.onCall(async (_data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Manager+ required.');
    }
    const result = await runAbandonedCartDetection();
    return Object.assign({ success: true }, result);
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
exports.backfillMonthlyStats = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin required.');
    }
    const { fromMonth, toMonth } = data;
    if (!fromMonth || !toMonth) {
        throw new functions.https.HttpsError('invalid-argument', 'fromMonth and toMonth required (format: YYYY-MM).');
    }
    // Build the list of months to process
    const months = [];
    let [year, mon] = fromMonth.split('-').map(Number);
    const [toYear, toMon] = toMonth.split('-').map(Number);
    while (year < toYear || (year === toYear && mon <= toMon)) {
        months.push(`${year}-${String(mon).padStart(2, '0')}`);
        mon++;
        if (mon > 12) {
            mon = 1;
            year++;
        }
    }
    const results = [];
    for (const monthStr of months) {
        const [y, m] = monthStr.split('-').map(Number);
        const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
        const endDate = new Date(y, m, 0, 23, 59, 59, 999); // last ms of month
        const ordersSnap = await shared_1.db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
            .get();
        // Aggregate by day
        const dayMap = {};
        let monthSales = 0, monthOrders = 0, monthPieces = 0;
        ordersSnap.docs.forEach(docSnap => {
            var _a, _b, _c, _d, _e;
            const order = docSnap.data();
            // Skip cancelled/refunded/returned — they don't count toward revenue
            if (['cancelled', 'refunded', 'returned'].includes(order['status']))
                return;
            const orderDate = (_c = (_b = (_a = order['createdAt']) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : new Date();
            const dayKey = String(orderDate.getDate()).padStart(2, '0');
            const total = Number((_d = order['total']) !== null && _d !== void 0 ? _d : 0);
            const pieces = ((_e = order['items']) !== null && _e !== void 0 ? _e : [])
                .reduce((s, item) => s + (Number(item.quantity) || 1), 0);
            if (!dayMap[dayKey])
                dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
            dayMap[dayKey].sales += total;
            dayMap[dayKey].orders += 1;
            dayMap[dayKey].pieces += pieces;
            monthSales += total;
            monthOrders += 1;
            monthPieces += pieces;
        });
        // Write in batches (max 500 ops per batch; we only have ~31 days + 1 parent = fine)
        const monthRef = shared_1.db.collection('monthly_stats').doc(monthStr);
        const batch = shared_1.db.batch();
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
exports.aggregateDailyStats = functions.pubsub
    .schedule('0 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    var _a, _b, _c, _d, _e, _f;
    // Force evaluation in Mexico City Timezone
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const today = new Date(nowStr);
    const DAYS_TO_SYNC = 1; // ✅ Only sync TODAY on the hourly schedule.
    // Historical backfill is handled by backfillMonthlyStats (callable).
    // ── Canonical non-revenue statuses (mirrors order.model.ts) ──────────
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    // ── Canonical channel resolution (mirrors ops queue getLegacyChannel) ─
    const resolveChannel = (order) => {
        const sc = order.sourceChannel;
        const ft = order.fulfillmentType;
        if (!sc || sc === 'storefront')
            return 'WEB';
        if (sc === 'pos')
            return 'POS';
        if (sc === 'on_behalf')
            return 'ON_BEHALF';
        if (sc === 'amazon')
            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (sc === 'mercadolibre')
            return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
    };
    let totalBqOrdersAppended = 0;
    let lastSyncDateStr = '';
    for (let i = DAYS_TO_SYNC - 1; i >= 0; i--) {
        const now = new Date(today);
        now.setDate(now.getDate() - i);
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-based
        const day = now.getDate(); // 1-based
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${monthStr}-${dayStr}`; // YYYY-MM-DD
        lastSyncDateStr = dateStr;
        // Construct boundaries explicitly using UTC-6 (Mexico City Standard Time)
        const startOfDay = new Date(`${dateStr}T00:00:00-06:00`);
        const endOfDay = new Date(`${dateStr}T23:59:59.999-06:00`);
        // ── Read target day's orders ───────────────────────────────────────────────
        const ordersSnap = await shared_1.db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();
        // ── Aggregate: totals + per-channel breakdowns ────────────────────────
        let totalSales = 0, totalOrders = 0, totalPieces = 0;
        const byChannel = {};
        ordersSnap.docs.forEach(docSnap => {
            var _a, _b;
            const order = docSnap.data();
            if (NON_REVENUE.includes(order['status']))
                return; // skip ghost & void orders
            const revenue = Number((_a = order['total']) !== null && _a !== void 0 ? _a : 0);
            const units = ((_b = order['items']) !== null && _b !== void 0 ? _b : [])
                .reduce((s, item) => s + (Number(item.quantity) || 1), 0);
            const channel = resolveChannel(order);
            totalSales += revenue;
            totalOrders += 1;
            totalPieces += units;
            if (!byChannel[channel])
                byChannel[channel] = { revenue: 0, orders: 0, units: 0 };
            byChannel[channel].revenue += revenue;
            byChannel[channel].orders += 1;
            byChannel[channel].units += units;
        });
        const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
        const ts = admin.firestore.FieldValue.serverTimestamp();
        // ── 1. Legacy monthly_stats (backward compat) ─────────────────────────
        const monthRef = shared_1.db.collection('monthly_stats').doc(monthStr);
        const dayRef = monthRef.collection('days').doc(dayStr);
        await dayRef.set({
            day: dayStr, month: monthStr,
            sales: totalSales, orders: totalOrders, pieces: totalPieces,
            updatedAt: ts,
        });
        // ── 2. analytics_daily/{YYYY-MM-DD} ──────────────────────────────────
        const dt = new Date(`${dateStr}T12:00:00`);
        await shared_1.db.collection('analytics_daily').doc(dateStr).set({
            date: dateStr,
            month: monthStr,
            dayOfWeek: (dt.getDay() + 6) % 7,
            totalRevenue: totalSales,
            totalOrders,
            totalUnits: totalPieces,
            avgTicket,
            byChannel,
            updatedAt: ts,
        }, { merge: true });
        // ── 3. analytics_channel_snapshots/{channel}/{YYYY-MM-DD} ─────────────
        const batch = shared_1.db.batch();
        for (const [channel, data] of Object.entries(byChannel)) {
            const snapRef = shared_1.db
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
            const meliConfig = await (0, meli_shared_1.getMeliConfig)();
            if ((meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.accessToken) && (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) && byChannel['MELI_FULL']) {
                const token = await (0, meli_shared_1.getValidMeliToken)();
                const visitsRes = await fetch(`https://api.mercadolibre.com/users/${meliConfig.userId}/items_visits/time_window?last=1&unit=day`, { headers: { Authorization: `Bearer ${token}` } });
                if (visitsRes.ok) {
                    const visitsJson = await visitsRes.json();
                    const totalVisits = (_a = visitsJson === null || visitsJson === void 0 ? void 0 : visitsJson.total_visits) !== null && _a !== void 0 ? _a : 0;
                    const meliFullOrders = (_b = byChannel['MELI_FULL'].orders) !== null && _b !== void 0 ? _b : 0;
                    const conversionRate = totalVisits > 0
                        ? parseFloat(((meliFullOrders / totalVisits) * 100).toFixed(2))
                        : 0;
                    const meliSnapRef = shared_1.db
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
        }
        catch (meliErr) {
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
            await (0, inbox_1.appendOrdersToBQForDate)(dateStr, bqPayload);
            totalBqOrdersAppended += bqPayload.length;
        }
        catch (bqErr) {
            console.warn(`[DailyStats] BigQuery append failed for ${dateStr} (non-critical):`, bqErr);
        }
        // ── 5b. Forecast Accuracy Feedback (ensemble + per-model) ──────────────
        // Now that we have final actuals for dateStr, compute accuracy for:
        //   1. The ensemble forecast (forecastRevenue) → forecastAccuracy
        //   2. Each individual model (forecastByModel.modelA/B/C) → forecastAccuracyByModel
        // The per-model accuracy feeds the adaptive weight computation in snapshotProjections.
        try {
            const dailyDocRef = shared_1.db.collection('analytics_daily').doc(dateStr);
            const dailyDoc = await dailyDocRef.get();
            if (dailyDoc.exists) {
                const dailyData = dailyDoc.data();
                const forecastRev = dailyData['forecastRevenue'];
                if (forecastRev && forecastRev > 0 && totalSales >= 0) {
                    const accuracy = totalSales / forecastRev;
                    const bias = totalSales - forecastRev;
                    // Per-model accuracy (actual / model_forecast)
                    const byModel = dailyData['forecastByModel'];
                    const modelAccuracy = {};
                    if (byModel) {
                        for (const key of ['modelA', 'modelB', 'modelC']) {
                            const mForecast = byModel[key];
                            if (mForecast && mForecast > 0) {
                                modelAccuracy[key] = parseFloat((totalSales / mForecast).toFixed(4));
                            }
                        }
                    }
                    await dailyDocRef.set(Object.assign({ forecastAccuracy: parseFloat(accuracy.toFixed(4)), forecastBias: parseFloat(bias.toFixed(2)) }, (Object.keys(modelAccuracy).length > 0 ? { forecastAccuracyByModel: modelAccuracy } : {})), { merge: true });
                    console.log(`[DailyStats] Forecast accuracy for ${dateStr}: ` +
                        `${(accuracy * 100).toFixed(1)}% (actual=$${totalSales.toFixed(0)}, ` +
                        `forecast=$${forecastRev.toFixed(0)}, bias=$${bias.toFixed(0)}` +
                        `${Object.keys(modelAccuracy).length > 0 ? `, per-model: A=${(_c = modelAccuracy['modelA']) === null || _c === void 0 ? void 0 : _c.toFixed(2)}, B=${(_d = modelAccuracy['modelB']) === null || _d === void 0 ? void 0 : _d.toFixed(2)}, C=${(_e = modelAccuracy['modelC']) === null || _e === void 0 ? void 0 : _e.toFixed(2)}` : ''})`);
                }
            }
        }
        catch (accErr) {
            console.warn(`[DailyStats] Forecast accuracy write failed for ${dateStr} (non-critical):`, accErr);
        }
    }
    // ── 6. Re-sum current month aggregate ──────────────────────────────────
    // Instead of incrementing, we recalculate the whole month to ensure it perfectly
    // matches the days we just overwrote, maintaining absolute consistency.
    try {
        const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const ts = admin.firestore.FieldValue.serverTimestamp();
        const monthRef = shared_1.db.collection('monthly_stats').doc(currentMonthStr);
        const allDaysSnap = await monthRef.collection('days').get();
        let mSales = 0, mOrders = 0, mPieces = 0;
        allDaysSnap.docs.forEach(d => {
            var _a, _b, _c;
            mSales += Number((_a = d.data()['sales']) !== null && _a !== void 0 ? _a : 0);
            mOrders += Number((_b = d.data()['orders']) !== null && _b !== void 0 ? _b : 0);
            mPieces += Number((_c = d.data()['pieces']) !== null && _c !== void 0 ? _c : 0);
        });
        await monthRef.set({ month: currentMonthStr, sales: mSales, orders: mOrders, pieces: mPieces, updatedAt: ts }, { merge: true });
        await shared_1.db.collection('analytics_monthly').doc(currentMonthStr).set({
            month: currentMonthStr,
            totalRevenue: mSales,
            totalOrders: mOrders,
            totalUnits: mPieces,
            updatedAt: ts,
        }, { merge: true });
        // ── 7. Write BQ sync status ───────────────────────────────────────────────
        await shared_1.db.collection('system_logs').doc('bq_sync_status').set({
            lastSyncDate: lastSyncDateStr,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            ordersAppended: totalBqOrdersAppended,
            status: 'success',
            errorMessage: null,
        }, { merge: true });
    }
    catch (err) {
        console.warn('[DailyStats] Aggregate monthly/status write failed:', err);
        await shared_1.db.collection('system_logs').doc('bq_sync_status').set({
            lastSyncDate: lastSyncDateStr,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            ordersAppended: 0,
            status: 'error',
            errorMessage: (_f = err === null || err === void 0 ? void 0 : err.message) !== null && _f !== void 0 ? _f : 'unknown',
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
exports.cleanupAbandonedCheckouts = functions.pubsub
    .schedule('5,35 * * * *') // every 30 min at :05 and :35
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    var _a;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago
    const snap = await shared_1.db.collection('orders')
        .where('status', '==', 'pending_payment')
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(cutoff))
        .limit(100)
        .get();
    if (snap.empty) {
        console.log('[CleanupCheckouts] No abandoned checkouts found.');
        return;
    }
    console.log(`[CleanupCheckouts] Cancelling ${snap.size} abandoned checkout(s).`);
    const batch = shared_1.db.batch();
    for (const orderDoc of snap.docs) {
        const data = orderDoc.data();
        const history = (_a = data['history']) !== null && _a !== void 0 ? _a : [];
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
            .replace(/-/g, '_'); // → "2026_04_28"
        await shared_1.db.collection('system_logs').doc('abandon_stats').set({
            [`daily.${today}`]: admin.firestore.FieldValue.increment(snap.size),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (logErr) {
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
async function computeInventoryVelocity() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const now = new Date();
    const start30 = new Date(now);
    start30.setDate(now.getDate() - 30);
    const start7 = new Date(now);
    start7.setDate(now.getDate() - 7);
    // 1. Load all MELI_FULL revenue orders from last 30 days
    const ordersSnap = await shared_1.db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('fulfillmentType', '==', 'platform')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start30))
        .get();
    // 2. Build SKU velocity maps: { sku → { units30d, units7d } }
    const velocityMap = {};
    const itemIdMap = {};
    for (const snap of ordersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status']))
            continue;
        const orderDate = order['createdAt'].toDate();
        const inLast7 = orderDate >= start7;
        const items = ((_a = order['items']) !== null && _a !== void 0 ? _a : []);
        for (const item of items) {
            const sku = ((_b = item.sku) !== null && _b !== void 0 ? _b : '').trim();
            const mlId = ((_d = (_c = item.mlItemId) !== null && _c !== void 0 ? _c : item.productId) !== null && _d !== void 0 ? _d : '').trim();
            const qty = Number(item.quantity) || 1;
            if (sku) {
                if (!velocityMap[sku])
                    velocityMap[sku] = { units30d: 0, units7d: 0 };
                velocityMap[sku].units30d += qty;
                if (inLast7)
                    velocityMap[sku].units7d += qty;
            }
            if (mlId) {
                if (!itemIdMap[mlId])
                    itemIdMap[mlId] = { units30d: 0, units7d: 0 };
                itemIdMap[mlId].units30d += qty;
                if (inLast7)
                    itemIdMap[mlId].units7d += qty;
            }
        }
    }
    // 3. Load all FBM inventory docs
    const invSnap = await shared_1.db.collection('meli_fbm_inventory').get();
    const errors = [];
    const batch = shared_1.db.batch();
    let updated = 0;
    for (const invDoc of invSnap.docs) {
        try {
            const data = invDoc.data();
            const sku = ((_e = data['sku']) !== null && _e !== void 0 ? _e : '').trim();
            const mlId = ((_f = data['mlItemId']) !== null && _f !== void 0 ? _f : '').trim();
            // Prefer SKU match, fall back to ML Item ID
            const vel = (sku && velocityMap[sku]) ? velocityMap[sku]
                : (mlId && itemIdMap[mlId]) ? itemIdMap[mlId]
                    : null;
            const units30d = (_g = vel === null || vel === void 0 ? void 0 : vel.units30d) !== null && _g !== void 0 ? _g : 0;
            const units7d = (_h = vel === null || vel === void 0 ? void 0 : vel.units7d) !== null && _h !== void 0 ? _h : 0;
            const vel30 = units30d / 30;
            const vel7 = units7d / 7;
            const available = Number((_k = (_j = data['availableQuantity']) !== null && _j !== void 0 ? _j : data['fullStock']) !== null && _k !== void 0 ? _k : 0);
            const daysOfCoverage = vel30 > 0 ? Math.floor(available / vel30) : 9999;
            const targetDays = 45;
            const replenish = vel30 > 0
                ? Math.max(0, Math.ceil((targetDays * vel30) - available))
                : 0;
            let alertLevel;
            if (available === 0)
                alertLevel = 'stockout';
            else if (daysOfCoverage < 7)
                alertLevel = 'critical';
            else if (daysOfCoverage < 21)
                alertLevel = 'low';
            else
                alertLevel = 'ok';
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
        }
        catch (err) {
            errors.push(`${invDoc.id}: ${(_l = err === null || err === void 0 ? void 0 : err.message) !== null && _l !== void 0 ? _l : err}`);
        }
    }
    await batch.commit();
    return { updated, errors };
}
exports.meliEnrichInventoryVelocity = functions.pubsub
    .schedule('0 6 * * 1') // Every Monday 06:00 MX
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    const result = await computeInventoryVelocity();
    console.log(`[VelocityEnrich] updated=${result.updated}, errors=${result.errors.length}`);
    if (result.errors.length)
        console.warn('[VelocityEnrich] errors:', result.errors);
});
exports.meliEnrichInventoryVelocityCallable = functions
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
exports.backfillAnalytics = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const resolveChannel = (order) => {
        const sc = order.sourceChannel;
        const ft = order.fulfillmentType;
        if (!sc || sc === 'storefront')
            return 'WEB';
        if (sc === 'pos')
            return 'POS';
        if (sc === 'on_behalf')
            return 'ON_BEHALF';
        if (sc === 'amazon')
            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (sc === 'mercadolibre')
            return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
    };
    const toMxDateStr = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    // Date range: default = start of 2024 to yesterday
    const now = new Date();
    const fromDate = (data === null || data === void 0 ? void 0 : data.fromDate)
        ? new Date(data.fromDate + 'T06:00:00')
        : new Date('2024-01-01T06:00:00');
    const toDate = (data === null || data === void 0 ? void 0 : data.toDate)
        ? new Date(data.toDate + 'T23:59:59')
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    // Load ALL orders in range in one query (< 100K docs — manageable in 1GB)
    const allOrdersSnap = await shared_1.db.collection('orders')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
        .get();
    console.log(`[BackfillAnalytics] Total orders loaded: ${allOrdersSnap.size}`);
    // Group orders by MX date key
    const dateMap = {}; // dateStr → channelId → metrics
    for (const snap of allOrdersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status']))
            continue;
        const orderDate = order['createdAt'].toDate();
        const dateKey = toMxDateStr(orderDate);
        const channel = resolveChannel(order);
        const revenue = Number((_a = order['total']) !== null && _a !== void 0 ? _a : 0);
        const units = ((_b = order['items']) !== null && _b !== void 0 ? _b : [])
            .reduce((s, i) => s + (Number(i.quantity) || 1), 0);
        if (!dateMap[dateKey])
            dateMap[dateKey] = {};
        if (!dateMap[dateKey][channel])
            dateMap[dateKey][channel] = { revenue: 0, orders: 0, units: 0 };
        dateMap[dateKey][channel].revenue += revenue;
        dateMap[dateKey][channel].orders += 1;
        dateMap[dateKey][channel].units += units;
    }
    // Write analytics_daily and analytics_channel_snapshots in batches of 400
    const ts = admin.firestore.FieldValue.serverTimestamp();
    let writeCount = 0;
    let batch = shared_1.db.batch();
    let batchSize = 0;
    const flushBatch = async () => {
        if (batchSize > 0) {
            await batch.commit();
            batch = shared_1.db.batch();
            batchSize = 0;
        }
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
            totalRevenue += ch.revenue;
            totalOrders += ch.orders;
            totalUnits += ch.units;
        }
        const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const dailyRef = shared_1.db.collection('analytics_daily').doc(dateStr);
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
            const snapRef = shared_1.db
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
        if (batchSize >= 400)
            await flushBatch();
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
exports.meliPriceScanDiag = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const width = (_a = data === null || data === void 0 ? void 0 : data.width) !== null && _a !== void 0 ? _a : 120;
    const aspectRatio = (_b = data === null || data === void 0 ? void 0 : data.aspectRatio) !== null && _b !== void 0 ? _b : 70;
    const diameter = (_c = data === null || data === void 0 ? void 0 : data.diameter) !== null && _c !== void 0 ? _c : 17;
    const categoryId = (_d = data === null || data === void 0 ? void 0 : data.categoryId) !== null && _d !== void 0 ? _d : 'MLM169975';
    const report = {
        version: '2026-04-17-v1',
        testedSize: `${width}/${aspectRatio}R${diameter}`,
        ranAt: new Date().toISOString(),
    };
    // Step 1: Read integrations config
    let meliConfig = null;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const raw = (_f = (_e = configDoc.data()) === null || _e === void 0 ? void 0 : _e.meli) !== null && _f !== void 0 ? _f : null;
        meliConfig = raw;
        report.step1_config = {
            ok: !!raw,
            docExists: configDoc.exists,
            hasAccessToken: !!(raw === null || raw === void 0 ? void 0 : raw.accessToken),
            hasRefreshToken: !!(raw === null || raw === void 0 ? void 0 : raw.refreshToken),
            hasAppId: !!(raw === null || raw === void 0 ? void 0 : raw.appId),
            hasClientSecret: !!(raw === null || raw === void 0 ? void 0 : raw.clientSecret),
            hasUserId: !!(raw === null || raw === void 0 ? void 0 : raw.userId),
            connected: (_g = raw === null || raw === void 0 ? void 0 : raw.connected) !== null && _g !== void 0 ? _g : false,
            expiresAt: (raw === null || raw === void 0 ? void 0 : raw.expiresAt) ? new Date(raw.expiresAt).toISOString() : null,
            tokenExpiresIn: (raw === null || raw === void 0 ? void 0 : raw.expiresAt)
                ? `${Math.round((raw.expiresAt - Date.now()) / 60000)} min`
                : 'unknown',
            accessTokenFirst8: (raw === null || raw === void 0 ? void 0 : raw.accessToken)
                ? `${String(raw.accessToken).substring(0, 8)}...`
                : null,
        };
    }
    catch (err) {
        report.step1_config = { ok: false, error: err.message };
    }
    // Step 0: Test app-level token (client_credentials) — the key fix for GCP IP blocking
    let appToken = null;
    try {
        appToken = await (0, meli_shared_1.getAppLevelToken)();
        report.step0_app_token = {
            ok: true,
            tokenFirst8: appToken.substring(0, 8) + '...',
            message: 'App token (client_credentials) obtained — search calls will use this token',
        };
    }
    catch (err) {
        report.step0_app_token = { ok: false, error: err.message, message: 'App token failed — will fall back to user token for searches' };
        // Not fatal — we continue with user token
    }
    // Step 2: Get valid token (with auto-refresh)
    let accessToken = null;
    try {
        accessToken = await (0, meli_shared_1.getValidMeliToken)();
        report.step2_token = {
            ok: true,
            tokenFirst8: accessToken.substring(0, 8) + '...',
            message: 'User token obtained successfully',
        };
    }
    catch (err) {
        report.step2_token = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 2: Cannot get a valid ML access token. Re-authenticate at /admin/integrations.';
        return report;
    }
    const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders = { 'Authorization': `Bearer ${appToken !== null && appToken !== void 0 ? appToken : accessToken}` };
    // Step 3: Verify token via /users/me
    try {
        const meRes = await fetch('https://api.mercadolibre.com/users/me', { headers: authHeaders });
        const meData = await meRes.json();
        report.step3_users_me = {
            ok: meRes.ok,
            httpStatus: meRes.status,
            userId: (_h = meData === null || meData === void 0 ? void 0 : meData.id) !== null && _h !== void 0 ? _h : null,
            nickname: (_j = meData === null || meData === void 0 ? void 0 : meData.nickname) !== null && _j !== void 0 ? _j : null,
            siteId: (_k = meData === null || meData === void 0 ? void 0 : meData.site_id) !== null && _k !== void 0 ? _k : null,
            error: !meRes.ok ? ((meData === null || meData === void 0 ? void 0 : meData.message) || `HTTP ${meRes.status}`) : null,
        };
        if (!meRes.ok) {
            report.verdict = `❌ BLOCKED at Step 3: Token rejected (${meRes.status}: ${meData === null || meData === void 0 ? void 0 : meData.message}). Re-authenticate.`;
            return report;
        }
    }
    catch (err) {
        report.step3_users_me = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 3: Network error reaching ML API.';
        return report;
    }
    // Step 4: Check category attribute names
    try {
        const catRes = await fetch(`https://api.mercadolibre.com/categories/${categoryId}/attributes`, { headers: authHeaders });
        const catData = await catRes.json();
        const attrIds = Array.isArray(catData) ? catData.map((a) => a.id) : [];
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
    }
    catch (err) {
        report.step4_category_attrs = { ok: false, error: err.message };
    }
    // Step 5: Strategy S1 — keyword search WITH APP TOKEN (the fixed approach)
    try {
        const url = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=5&sort=price_asc`;
        const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN — key fix
        const body = await r.json();
        report.step5_attr_search = {
            ok: r.ok,
            httpStatus: r.status,
            url,
            totalResults: (_m = (_l = body === null || body === void 0 ? void 0 : body.paging) === null || _l === void 0 ? void 0 : _l.total) !== null && _m !== void 0 ? _m : null,
            returnedCount: ((_o = body === null || body === void 0 ? void 0 : body.results) !== null && _o !== void 0 ? _o : []).length,
            firstItem: ((_p = body === null || body === void 0 ? void 0 : body.results) === null || _p === void 0 ? void 0 : _p[0])
                ? { id: body.results[0].id, title: body.results[0].title, price: body.results[0].price }
                : null,
            rawError: !r.ok ? body : null,
            error: !r.ok ? ((_r = (_q = body === null || body === void 0 ? void 0 : body.message) !== null && _q !== void 0 ? _q : body === null || body === void 0 ? void 0 : body.error) !== null && _r !== void 0 ? _r : `HTTP ${r.status}`) : null,
        };
    }
    catch (err) {
        report.step5_attr_search = { ok: false, error: err.message };
    }
    // Step 5b: Strategy D — catalog product items (WITH auth, avoids search endpoint)
    try {
        // Try first discovered productId, or a known catalog product for 120/70R17
        const testProductId = ((_s = report.step5_attr_search) === null || _s === void 0 ? void 0 : _s.ok) === false ? 'MLAP9213' : null; // fallback known product
        const prodRes = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=3`, { headers: appAuthHeaders });
        if (prodRes.ok) {
            const prodData = await prodRes.json();
            const firstProd = (prodData.results || [])[0];
            if (firstProd === null || firstProd === void 0 ? void 0 : firstProd.id) {
                const itemsRes = await fetch(`https://api.mercadolibre.com/products/${firstProd.id}/items?site_id=MLM&limit=5`, { headers: appAuthHeaders });
                const itemsBody = await itemsRes.json();
                const items = (_u = (_t = itemsBody.results) !== null && _t !== void 0 ? _t : itemsBody.items) !== null && _u !== void 0 ? _u : (Array.isArray(itemsBody) ? itemsBody : []);
                report.step5b_catalog_items = {
                    ok: itemsRes.ok,
                    httpStatus: itemsRes.status,
                    catalogProductId: firstProd.id,
                    returnedCount: items.length,
                    firstItem: items[0] ? { id: items[0].id, title: items[0].title, price: items[0].price } : null,
                    rawError: !itemsRes.ok ? itemsBody : null,
                    error: !itemsRes.ok ? ((_w = (_v = itemsBody === null || itemsBody === void 0 ? void 0 : itemsBody.message) !== null && _v !== void 0 ? _v : itemsBody === null || itemsBody === void 0 ? void 0 : itemsBody.error) !== null && _w !== void 0 ? _w : `HTTP ${itemsRes.status}`) : null,
                };
            }
            else {
                report.step5b_catalog_items = { ok: false, error: 'No catalog products found for this size' };
            }
        }
        else {
            const errBody = await prodRes.json().catch(() => ({}));
            report.step5b_catalog_items = { ok: false, httpStatus: prodRes.status, error: (_x = errBody === null || errBody === void 0 ? void 0 : errBody.message) !== null && _x !== void 0 ? _x : `HTTP ${prodRes.status}` };
        }
    }
    catch (err) {
        report.step5b_catalog_items = { ok: false, error: err.message };
    }
    // Step 6: Strategy S2 — attribute search WITH APP TOKEN
    try {
        const sizeStr = `${width}/${aspectRatio}R${diameter}`;
        const url = `https://api.mercadolibre.com/sites/MLM/search?category=${categoryId}&SECTION_WIDTH=${width}&AUTOMOTIVE_TIRE_ASPECT_RATIO=${aspectRatio}&RIM_DIAMETER=${diameter}&limit=5&sort=price_asc`;
        const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN
        const body = await r.json();
        report.step6_size_string_search = {
            ok: r.ok,
            httpStatus: r.status,
            sizeStr,
            url,
            totalResults: (_z = (_y = body === null || body === void 0 ? void 0 : body.paging) === null || _y === void 0 ? void 0 : _y.total) !== null && _z !== void 0 ? _z : null,
            returnedCount: ((_0 = body === null || body === void 0 ? void 0 : body.results) !== null && _0 !== void 0 ? _0 : []).length,
            rawError: !r.ok ? body : null,
            error: !r.ok ? ((_2 = (_1 = body === null || body === void 0 ? void 0 : body.message) !== null && _1 !== void 0 ? _1 : body === null || body === void 0 ? void 0 : body.error) !== null && _2 !== void 0 ? _2 : `HTTP ${r.status}`) : null,
        };
    }
    catch (err) {
        report.step6_size_string_search = { ok: false, error: err.message };
    }
    // Step 7: Our seller items
    const sellerId = (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) ? String(meliConfig.userId) : null;
    let firstItemId = null;
    if (sellerId) {
        try {
            const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=5`;
            const r = await fetch(url, { headers: authHeaders });
            const body = await r.json();
            firstItemId = (_4 = ((_3 = body === null || body === void 0 ? void 0 : body.results) !== null && _3 !== void 0 ? _3 : [])[0]) !== null && _4 !== void 0 ? _4 : null;
            report.step7_seller_items = {
                ok: r.ok,
                httpStatus: r.status,
                sellerId,
                totalItems: (_6 = (_5 = body === null || body === void 0 ? void 0 : body.paging) === null || _5 === void 0 ? void 0 : _5.total) !== null && _6 !== void 0 ? _6 : null,
                firstIds: ((_7 = body === null || body === void 0 ? void 0 : body.results) !== null && _7 !== void 0 ? _7 : []).slice(0, 5),
                error: !r.ok ? ((body === null || body === void 0 ? void 0 : body.message) || (body === null || body === void 0 ? void 0 : body.error) || `HTTP ${r.status}`) : null,
            };
        }
        catch (err) {
            report.step7_seller_items = { ok: false, sellerId, error: err.message };
        }
    }
    else {
        report.step7_seller_items = {
            ok: false,
            error: 'No sellerId in config/integrations.meli',
        };
    }
    // Step 7b: Test price_to_win on the first of our active items
    // This is the CORE endpoint of the new implementation — must be ✅ for scans to work.
    if (firstItemId) {
        try {
            const ptwRes = await fetch(`https://api.mercadolibre.com/items/${firstItemId}/price_to_win`, { headers: authHeaders } // seller user token required
            );
            const ptwBody = await ptwRes.json();
            report.step7b_price_to_win = {
                ok: ptwRes.ok,
                httpStatus: ptwRes.status,
                testedItemId: firstItemId,
                status: (_8 = ptwBody.status) !== null && _8 !== void 0 ? _8 : null,
                priceToWin: (_9 = ptwBody.price_to_win) !== null && _9 !== void 0 ? _9 : null,
                rawResponse: ptwBody,
                error: !ptwRes.ok ? ((_11 = (_10 = ptwBody.message) !== null && _10 !== void 0 ? _10 : ptwBody.error) !== null && _11 !== void 0 ? _11 : `HTTP ${ptwRes.status}`) : null,
                note: ptwRes.ok
                    ? (ptwBody.status === 'not_eligible'
                        ? 'Item not part of ML catalog — price_to_win not available for this listing'
                        : 'price_to_win endpoint working correctly')
                    : 'price_to_win failed — scans will not return competitive data',
            };
        }
        catch (err) {
            report.step7b_price_to_win = { ok: false, testedItemId: firstItemId, error: err.message };
        }
    }
    else {
        report.step7b_price_to_win = { ok: false, error: 'No active items found to test price_to_win' };
    }
    // Step 8: Firestore write/read round-trip
    try {
        const testRef = shared_1.db.collection('price_intelligence').doc('diag-test-tmp');
        await testRef.set({ _diagTest: true, ranAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const check = await testRef.get();
        await testRef.delete();
        report.step8_firestore = {
            ok: check.exists,
            message: check.exists ? 'Firestore write/read OK' : 'Write ok but read failed',
        };
    }
    catch (err) {
        report.step8_firestore = { ok: false, error: err.message };
    }
    // Final verdict — based on price_to_win approach (new authoritative method)
    const ptwOk = ((_12 = report.step7b_price_to_win) === null || _12 === void 0 ? void 0 : _12.ok) === true;
    const ptwElig = ((_13 = report.step7b_price_to_win) === null || _13 === void 0 ? void 0 : _13.status) !== 'not_eligible';
    const authOk = ((_14 = report.step2_token) === null || _14 === void 0 ? void 0 : _14.ok) && ((_15 = report.step3_users_me) === null || _15 === void 0 ? void 0 : _15.ok);
    if (!authOk) {
        report.verdict = '❌ BLOCKED: Authentication broken — reconnect MercadoLibre in /admin/integrations.';
    }
    else if (!((_16 = report.step7_seller_items) === null || _16 === void 0 ? void 0 : _16.ok) || !((_17 = report.step7_seller_items) === null || _17 === void 0 ? void 0 : _17.totalItems)) {
        report.verdict = '⚠️ No active items found. Add a MercadoLibre listing to enable Price Intelligence.';
    }
    else if (!ptwOk) {
        report.verdict = `⚠️ price_to_win endpoint failed (HTTP ${(_18 = report.step7b_price_to_win) === null || _18 === void 0 ? void 0 : _18.httpStatus}). Check seller permissions or re-authenticate.`;
    }
    else if (!ptwElig) {
        report.verdict = '⚠️ Tested item is not in ML catalog so price_to_win returned not_eligible. Scan the correct tire size (one you have listed in the catalog).';
    }
    else {
        report.verdict = `✅ Pipeline OK — price_to_win working (status: ${(_19 = report.step7b_price_to_win) === null || _19 === void 0 ? void 0 : _19.status}, ptw: $${(_21 = (_20 = report.step7b_price_to_win) === null || _20 === void 0 ? void 0 : _20.priceToWin) !== null && _21 !== void 0 ? _21 : 'N/A'}). Ready to scan.`;
    }
    console.log('[PriceIntelDiag]', report.verdict);
    return report;
});
/**
 * Fit Holt-Winters multiplicative seasonality model on a daily revenue series.
 *
 * @param data   Daily revenue values in chronological order. Zeros are tolerated.
 * @param alpha  Level smoothing factor  (0 < α < 1, suggested 0.3)
 * @param beta   Trend smoothing factor  (0 < β < 1, suggested 0.1)
 * @param gamma  Seasonal smoothing      (0 < γ < 1, suggested 0.15)
 * @param phi    Damping parameter (Gardner 1985) — prevents trend over-extrapolation
 * @param period Seasonality period in days (7 for weekly)
 * @param startDow ISO weekday (Mon=0) of data[0]
 */
function hwFit(data, alpha = 0.30, beta = 0.10, gamma = 0.15, phi = 0.90, period = 7, startDow = 0) {
    if (data.length < period * 2) {
        const avg = data.reduce((s, v) => s + v, 0) / Math.max(data.length, 1);
        return { level: avg, trend: 0, seasonal: new Array(period).fill(1.0) };
    }
    const clean = data.map(v => Math.max(v, 1));
    const p1mean = clean.slice(0, period).reduce((s, v) => s + v, 0) / period;
    const p2mean = clean.slice(period, period * 2).reduce((s, v) => s + v, 0) / period;
    let L = p1mean;
    let T = (p2mean - p1mean) / period;
    const numInitSeasons = Math.min(4, Math.floor(clean.length / period));
    const seasonal = new Array(period).fill(0);
    const seasonalCount = new Array(period).fill(0);
    for (let s = 0; s < numInitSeasons; s++) {
        const slice = clean.slice(s * period, (s + 1) * period);
        const sliceMean = slice.reduce((a, b) => a + b, 0) / period;
        if (sliceMean === 0)
            continue;
        for (let j = 0; j < period; j++) {
            const isoJ = (startDow + s * period + j) % period;
            seasonal[isoJ] += slice[j] / sliceMean;
            seasonalCount[isoJ]++;
        }
    }
    for (let j = 0; j < period; j++) {
        seasonal[j] = seasonalCount[j] > 0 ? seasonal[j] / seasonalCount[j] : 1.0;
    }
    const sSum = seasonal.reduce((a, b) => a + b, 0);
    if (sSum > 0)
        for (let j = 0; j < period; j++)
            seasonal[j] = (seasonal[j] / sSum) * period;
    for (let t = 0; t < clean.length; t++) {
        const isoT = (startDow + t) % period;
        const sT = seasonal[isoT] || 1;
        const prevL = L;
        const prevT = T;
        L = alpha * (clean[t] / sT) + (1 - alpha) * (prevL + phi * prevT);
        T = beta * (L - prevL) + (1 - beta) * (phi * prevT);
        seasonal[isoT] = gamma * (clean[t] / Math.max(L, 1)) + (1 - gamma) * sT;
    }
    const sSum2 = seasonal.reduce((a, b) => a + b, 0);
    if (sSum2 > 0)
        for (let j = 0; j < period; j++)
            seasonal[j] = (seasonal[j] / sSum2) * period;
    return { level: L, trend: T, seasonal };
}
function hwForecast(state, firstDow, h, phi = 0.90) {
    const { level, trend, seasonal } = state;
    const period = seasonal.length;
    return Array.from({ length: h }, (_, i) => {
        const isoDay = (firstDow + i) % period;
        const dampedTrend = trend * phi * (1 - Math.pow(phi, i + 1)) / (1 - phi);
        return Math.max(0, (level + dampedTrend) * (seasonal[isoDay] || 1));
    });
}
function recentDowForecast(cyDailyActuals, cyDailyDates, targetDow) {
    const sameDow = [];
    for (let i = cyDailyActuals.length - 1; i >= 0 && sameDow.length < 3; i--) {
        const dt = new Date(cyDailyDates[i] + 'T12:00:00');
        const dow = (dt.getDay() + 6) % 7;
        if (dow === targetDow && cyDailyActuals[i] > 0) {
            sameDow.unshift(cyDailyActuals[i]);
        }
    }
    if (sameDow.length === 0)
        return 0;
    if (sameDow.length === 1)
        return sameDow[0];
    const weights = sameDow.length === 3 ? [0.2, 0.3, 0.5] : [0.4, 0.6];
    let ewm = 0;
    for (let i = 0; i < sameDow.length; i++)
        ewm += sameDow[i] * weights[i];
    if (sameDow.length >= 2) {
        const lastTwo = sameDow.slice(-2);
        const weekOverWeek = lastTwo[1] / lastTwo[0];
        const dampedMomentum = 1 + (weekOverWeek - 1) * 0.5;
        ewm *= Math.max(0.7, Math.min(1.3, dampedMomentum));
    }
    return ewm;
}
function weightedRunRateForecast(cyDailyActuals, cyDailyDates, targetDow, dowFactors) {
    if (cyDailyActuals.length === 0)
        return 0;
    const neutralRates = [];
    for (let i = 0; i < cyDailyActuals.length; i++) {
        if (cyDailyActuals[i] <= 0)
            continue;
        const dt = new Date(cyDailyDates[i] + 'T12:00:00');
        const dow = (dt.getDay() + 6) % 7;
        const factor = dowFactors[dow] || 1;
        neutralRates.push(cyDailyActuals[i] / factor);
    }
    if (neutralRates.length === 0)
        return 0;
    const alpha = 0.85;
    let weightedSum = 0;
    let weightSum = 0;
    for (let i = 0; i < neutralRates.length; i++) {
        const w = Math.pow(alpha, neutralRates.length - 1 - i);
        weightedSum += neutralRates[i] * w;
        weightSum += w;
    }
    const neutralRate = weightedSum / weightSum;
    const targetFactor = dowFactors[targetDow] || 1;
    return Math.max(0, neutralRate * targetFactor);
}
function computeAdaptiveWeights(modelAccuracies, minDays = 7) {
    const equal = { wA: 1 / 3, wB: 1 / 3, wC: 1 / 3 };
    const validA = modelAccuracies.modelA.filter(v => v > 0 && isFinite(v));
    const validB = modelAccuracies.modelB.filter(v => v > 0 && isFinite(v));
    const validC = modelAccuracies.modelC.filter(v => v > 0 && isFinite(v));
    if (validA.length < minDays || validB.length < minDays || validC.length < minDays)
        return equal;
    const mape = (arr) => {
        const recent = arr.slice(-14);
        return recent.reduce((s, v) => s + Math.abs(v - 1) * 100, 0) / recent.length;
    };
    const mA = Math.max(mape(validA), 0.1);
    const mB = Math.max(mape(validB), 0.1);
    const mC = Math.max(mape(validC), 0.1);
    const invA = 1 / mA, invB = 1 / mB, invC = 1 / mC;
    const total = invA + invB + invC;
    let wA = Math.max(0.15, Math.min(0.60, invA / total));
    let wB = Math.max(0.15, Math.min(0.60, invB / total));
    let wC = Math.max(0.15, Math.min(0.60, invC / total));
    const wTotal = wA + wB + wC;
    wA /= wTotal;
    wB /= wTotal;
    wC /= wTotal;
    return { wA, wB, wC };
}
function convergenceFactor(dayOfMonth, daysInMonth) {
    return 1 - Math.pow(dayOfMonth / daysInMonth, 2);
}
function computeTrackingSignal(ensembleAccuracies, // actual/forecast ratios, recent last
lambda = 0.3) {
    const noSignal = {
        signal: 0, smoothedError: 0, smoothedAbsError: 0,
        consecutiveSameSign: 0, driftDetected: false, driftDirection: 'none',
    };
    const valid = ensembleAccuracies.filter(v => v > 0 && isFinite(v));
    if (valid.length < 5)
        return noSignal;
    let smoothedError = 0;
    let smoothedAbsError = 0;
    let consecutiveSameSign = 0;
    let lastSign = 0;
    for (const accuracy of valid) {
        const error = accuracy - 1; // >0 means under-predicted, <0 means over-predicted
        smoothedError = lambda * error + (1 - lambda) * smoothedError;
        smoothedAbsError = lambda * Math.abs(error) + (1 - lambda) * smoothedAbsError;
        const sign = error > 0 ? 1 : error < 0 ? -1 : 0;
        if (sign !== 0 && sign === lastSign) {
            consecutiveSameSign++;
        }
        else {
            consecutiveSameSign = 1;
        }
        lastSign = sign;
    }
    const signal = smoothedAbsError > 0.001
        ? Math.abs(smoothedError) / smoothedAbsError
        : 0;
    // Drift detected: signal > 0.5 AND 5+ consecutive same-direction errors
    const driftDetected = signal > 0.5 && consecutiveSameSign >= 5;
    const driftDirection = !driftDetected ? 'none'
        : smoothedError > 0 ? 'under' // actuals > forecasts → we under-predict
            : 'over'; // actuals < forecasts → we over-predict
    return {
        signal: parseFloat(signal.toFixed(4)),
        smoothedError: parseFloat(smoothedError.toFixed(6)),
        smoothedAbsError: parseFloat(smoothedAbsError.toFixed(6)),
        consecutiveSameSign,
        driftDetected,
        driftDirection,
    };
}
/**
 * Adjusts ensemble weights when tracking signal detects structural drift.
 * Reduces Model A (HW, anchored to LY history) and boosts Model B+C (CY-reactive)
 * to accelerate self-correction during regime changes.
 */
function applyDriftCorrection(weights, tracking) {
    if (!tracking.driftDetected)
        return weights;
    // Severity: how strong is the drift signal (0.5 to 1.0)
    const severity = Math.min(1.0, (tracking.signal - 0.5) * 2); // normalize 0.5-1.0 → 0-1
    // Reduce Model A by up to 50% of its weight, redistribute to B+C
    const aReduction = weights.wA * severity * 0.5;
    let wA = weights.wA - aReduction;
    let wB = weights.wB + aReduction * 0.6; // B gets 60% (most reactive)
    let wC = weights.wC + aReduction * 0.4; // C gets 40%
    // Re-normalize
    const total = wA + wB + wC;
    wA /= total;
    wB /= total;
    wC /= total;
    return { wA, wB, wC };
}
function getEasterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}
function getCalendarEffect(date) {
    var _a;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const FIXED_HOLIDAYS = {
        '01-01': 0.10, '02-05': 0.65, '03-21': 0.65, '05-01': 0.15,
        '09-16': 0.35, '11-02': 0.55, '11-20': 0.65, '12-12': 0.70,
        '12-24': 0.25, '12-25': 0.05, '12-31': 0.30,
    };
    let effect = (_a = FIXED_HOLIDAYS[mmdd]) !== null && _a !== void 0 ? _a : 1.0;
    const easter = getEasterDate(date.getFullYear());
    const dayFromEaster = Math.round((new Date(date.getFullYear(), date.getMonth(), day).getTime() - easter.getTime()) / 86400000);
    if (dayFromEaster === -3)
        effect = Math.min(effect, 0.40);
    if (dayFromEaster === -2)
        effect = Math.min(effect, 0.20);
    if (dayFromEaster === -1)
        effect = Math.min(effect, 0.55);
    if (dayFromEaster === 0)
        effect = Math.min(effect, 0.30);
    if (effect === 1.0) {
        if (day >= 14 && day <= 16)
            effect *= 1.12;
        if (day >= 28)
            effect *= 1.15;
    }
    return Math.max(0.05, Math.min(effect, 1.5));
}
function computeVelocityBias(actuals, forecasts) {
    const pairs = actuals.map((a, i) => ({ a, f: forecasts[i] })).filter(p => p.f > 100 && p.a >= 0);
    if (pairs.length < 5)
        return 1.0;
    const logRatios = pairs.map(p => Math.log(Math.max(p.a, 1) / p.f));
    const geomMean = Math.exp(logRatios.reduce((s, v) => s + v, 0) / logRatios.length);
    const bias = 0.6 + 0.4 * geomMean;
    return Math.max(0.3, Math.min(bias, 2.5));
}
exports.snapshotProjections = functions.pubsub
    .schedule('55 23 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    var _a, _b;
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const today = new Date(nowStr);
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayDay = today.getDate();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const toMxDs = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    const todayStr = toMxDs(today);
    console.log(`[SnapshotProjections] Running for ${monthStr}, today=${todayDay}, daysLeft=${daysInMonth - todayDay}`);
    const trainStart = new Date(year, month - 24, 1);
    const trainEnd = new Date(year, month, todayDay - 1);
    const trainStartStr = toMxDs(trainStart);
    const trainEndStr = toMxDs(trainEnd);
    const trainSnap = await shared_1.db.collection('analytics_daily')
        .where('date', '>=', trainStartStr)
        .where('date', '<=', trainEndStr)
        .orderBy('date', 'asc')
        .get();
    const revByDate = {};
    const modelAccuracyMap = {};
    trainSnap.forEach(doc => {
        var _a, _b, _c, _d;
        const d = doc.data();
        revByDate[doc.id] = (_a = d['totalRevenue']) !== null && _a !== void 0 ? _a : 0;
        const byModel = d['forecastAccuracyByModel'];
        if (byModel) {
            modelAccuracyMap[doc.id] = { mA: (_b = byModel.modelA) !== null && _b !== void 0 ? _b : 0, mB: (_c = byModel.modelB) !== null && _c !== void 0 ? _c : 0, mC: (_d = byModel.modelC) !== null && _d !== void 0 ? _d : 0 };
        }
    });
    const trainSeries = [];
    const trainDates = [];
    const cur = new Date(trainStart);
    while (cur <= trainEnd) {
        const ds = toMxDs(cur);
        trainSeries.push((_a = revByDate[ds]) !== null && _a !== void 0 ? _a : 0);
        trainDates.push(ds);
        cur.setDate(cur.getDate() + 1);
    }
    if (trainSeries.length < 14) {
        console.warn('[SnapshotProjections] Insufficient training data — aborting.');
        return;
    }
    const cyMonthStart = `${monthStr}-01`;
    const cyMonthEnd = `${monthStr}-${String(todayDay).padStart(2, '0')}`;
    const cySnap = await shared_1.db.collection('analytics_daily')
        .where('date', '>=', cyMonthStart)
        .where('date', '<=', cyMonthEnd)
        .orderBy('date', 'asc')
        .get();
    const cyDailyActuals = [];
    const cyDailyDates = [];
    cySnap.forEach(doc => {
        var _a;
        const d = doc.data();
        cyDailyActuals.push((_a = d['totalRevenue']) !== null && _a !== void 0 ? _a : 0);
        cyDailyDates.push(d['date']);
    });
    const last28Dates = trainDates.slice(-28);
    const modelAcc = {
        modelA: last28Dates.map(d => { var _a, _b; return (_b = (_a = modelAccuracyMap[d]) === null || _a === void 0 ? void 0 : _a.mA) !== null && _b !== void 0 ? _b : 0; }),
        modelB: last28Dates.map(d => { var _a, _b; return (_b = (_a = modelAccuracyMap[d]) === null || _a === void 0 ? void 0 : _a.mB) !== null && _b !== void 0 ? _b : 0; }),
        modelC: last28Dates.map(d => { var _a, _b; return (_b = (_a = modelAccuracyMap[d]) === null || _a === void 0 ? void 0 : _a.mC) !== null && _b !== void 0 ? _b : 0; }),
    };
    // Load ensemble-level accuracy for tracking signal (Trigg & Leach)
    const ensembleAccFromSnap = [];
    trainSnap.forEach(doc => {
        const d = doc.data();
        const acc = d['forecastAccuracy'];
        if (acc && acc > 0 && isFinite(acc)) {
            ensembleAccFromSnap.push(acc);
        }
    });
    const trackingSignal = computeTrackingSignal(ensembleAccFromSnap.slice(-28));
    const trainStartDow = (new Date(trainStartStr + 'T12:00:00-06:00').getDay() + 6) % 7;
    const fullModel = hwFit(trainSeries, 0.30, 0.10, 0.15, 0.90, 7, trainStartDow);
    const last14Dates = trainDates.slice(-14);
    const last14Actuals = last14Dates.map(d => { var _a; return (_a = revByDate[d]) !== null && _a !== void 0 ? _a : 0; });
    const preSeriesLen = trainSeries.length - 14;
    const preSeries = trainSeries.slice(0, preSeriesLen);
    const preModel = preSeries.length >= 14
        ? hwFit(preSeries, 0.30, 0.10, 0.15, 0.90, 7, trainStartDow)
        : fullModel;
    const first14Dow = (new Date(last14Dates[0] + 'T12:00:00-06:00').getDay() + 6) % 7;
    const last14Preds = hwForecast(preModel, first14Dow, 14, 0.90);
    const biasCorrection = computeVelocityBias(last14Actuals, last14Preds);
    const dowBuckets = Array.from({ length: 7 }, () => []);
    for (let i = 0; i < cyDailyActuals.length; i++) {
        if (cyDailyActuals[i] > 0) {
            const dt = new Date(cyDailyDates[i] + 'T12:00:00');
            dowBuckets[(dt.getDay() + 6) % 7].push(cyDailyActuals[i]);
        }
    }
    const dowMeans = dowBuckets.map(b => b.length > 0 ? b.reduce((a, v) => a + v, 0) / b.length : 0);
    const overallMean = dowMeans.reduce((a, v) => a + v, 0) / 7;
    const dowFactors = overallMean > 0 ? dowMeans.map(m => m / overallMean) : new Array(7).fill(1);
    const baseWeights = computeAdaptiveWeights(modelAcc);
    const weights = applyDriftCorrection(baseWeights, trackingSignal);
    const remainingDays = daysInMonth - todayDay;
    if (remainingDays <= 0)
        return;
    const firstForecastDate = new Date(year, month, todayDay + 1);
    const firstForecastDow = (firstForecastDate.getDay() + 6) % 7;
    const hwForecasts = hwForecast(fullModel, firstForecastDow, remainingDays, 0.90);
    console.log(`[SnapshotProjections] HW fit (damped φ=0.9): level=${fullModel.level.toFixed(0)}, ` +
        `trend=${fullModel.trend.toFixed(2)}, ` +
        `seasonal=[${fullModel.seasonal.map(s => s.toFixed(2)).join(',')}]`);
    console.log(`[SnapshotProjections] Adaptive weights: A=${weights.wA.toFixed(2)}, B=${weights.wB.toFixed(2)}, C=${weights.wC.toFixed(2)}` +
        (trackingSignal.driftDetected ? ` [DRIFT CORRECTED from A:${baseWeights.wA.toFixed(2)}/B:${baseWeights.wB.toFixed(2)}/C:${baseWeights.wC.toFixed(2)}]` : ''));
    console.log(`[SnapshotProjections] Velocity bias: ${biasCorrection.toFixed(3)}`);
    console.log(`[SnapshotProjections] Tracking signal: ${trackingSignal.signal.toFixed(3)}, ` +
        `streak=${trackingSignal.consecutiveSameSign}, drift=${trackingSignal.driftDetected ? trackingSignal.driftDirection : 'none'}`);
    // ── 3-Model Ensemble Forecast Loop ────────────────────────────────────
    let batch = shared_1.db.batch();
    let batchOps = 0;
    let eomForecastSum = 0;
    const cyMtdActuals = cyDailyActuals.reduce((s, v) => s + v, 0);
    for (let i = 0; i < remainingDays; i++) {
        const forecastDate = new Date(year, month, todayDay + 1 + i);
        const dateStr = toMxDs(forecastDate);
        const calEffect = getCalendarEffect(forecastDate);
        const targetDow = (firstForecastDow + i) % 7;
        // Model A: Damped HW + velocity bias + calendar
        const modelA = Math.max(0, hwForecasts[i] * biasCorrection * calEffect);
        // Model B: CY Recent Day-of-Week Velocity
        const modelB = Math.max(0, recentDowForecast(cyDailyActuals, cyDailyDates, targetDow) * calEffect);
        // Model C: DoW-Normalized Weighted Run-Rate
        const modelC = Math.max(0, weightedRunRateForecast(cyDailyActuals, cyDailyDates, targetDow, dowFactors) * calEffect);
        // Ensemble: adaptive weighted average
        const ensemble = (modelA * weights.wA) + (modelB * weights.wB) + (modelC * weights.wC);
        const finalF = Math.max(0, ensemble);
        eomForecastSum += finalF;
        const docRef = shared_1.db.collection('analytics_daily').doc(dateStr);
        batch.set(docRef, {
            date: dateStr,
            month: monthStr,
            forecastRevenue: parseFloat(finalF.toFixed(2)),
            forecastMethod: 'ensemble_v2',
            forecastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            forecastByModel: {
                modelA: parseFloat(modelA.toFixed(2)),
                modelB: parseFloat(modelB.toFixed(2)),
                modelC: parseFloat(modelC.toFixed(2)),
            },
            forecastWeights: {
                wA: parseFloat(weights.wA.toFixed(4)),
                wB: parseFloat(weights.wB.toFixed(4)),
                wC: parseFloat(weights.wC.toFixed(4)),
            },
            forecastComponents: {
                hwRaw: parseFloat(hwForecasts[i].toFixed(2)),
                velocityBias: parseFloat(biasCorrection.toFixed(4)),
                calendarEffect: parseFloat(calEffect.toFixed(4)),
            },
        }, { merge: true });
        batchOps++;
        if (batchOps >= 400) {
            await batch.commit();
            batch = shared_1.db.batch();
            batchOps = 0;
        }
    }
    // ── Write EOM projection + tracking signal to today's doc ──────────────
    const eomProjection = cyMtdActuals + eomForecastSum;
    const convFactor = convergenceFactor(todayDay, daysInMonth);
    const todayDocRef = shared_1.db.collection('analytics_daily').doc(todayStr);
    batch.set(todayDocRef, {
        eomProjection: parseFloat(eomProjection.toFixed(2)),
        eomConvergence: parseFloat(convFactor.toFixed(4)),
        eomForecastMethod: 'ensemble_v2',
        eomUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        trackingSignal: {
            signal: trackingSignal.signal,
            smoothedError: trackingSignal.smoothedError,
            smoothedAbsError: trackingSignal.smoothedAbsError,
            consecutiveSameSign: trackingSignal.consecutiveSameSign,
            driftDetected: trackingSignal.driftDetected,
            driftDirection: trackingSignal.driftDirection,
        },
    }, { merge: true });
    batchOps++;
    if (batchOps > 0)
        await batch.commit();
    console.log(`[SnapshotProjections] ✓ Wrote ${remainingDays} ensemble forecasts for ${monthStr} ` +
        `(bias=${biasCorrection.toFixed(3)}, weights=A:${weights.wA.toFixed(2)}/B:${weights.wB.toFixed(2)}/C:${weights.wC.toFixed(2)}, ` +
        `EOM=$${eomProjection.toFixed(0)}, first=$${(_b = hwForecasts[0]) === null || _b === void 0 ? void 0 : _b.toFixed(0)})`);
});
// Also expose as callable for on-demand refresh (admin only)
exports.snapshotProjectionsCallable = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin required.');
    }
    // Re-use the same logic via a direct invocation
    await exports.snapshotProjections.run(null);
    return { success: true };
});
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// \u2500\u2500\u2500 Paid Media Intelligence \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Pulls Meta Ads + Google Ads snapshots daily \u2192 stores in Firestore.
// Tokens/credentials stay server-side (config/integrations \u2192 meta / google).
//
// Firestore paths written:
//   advertising_snapshots/{YYYY-MM-DD}/meta/{campaignId}   \u2192 MetaInsights
//   advertising_snapshots/{YYYY-MM-DD}/google/{campaignId} \u2192 GoogleInsights
//   advertising_cache/latest                                \u2192 PaidMediaDailySummary
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
/** Reads paid media credentials from config/integrations */
//# sourceMappingURL=analytics-cron.js.map