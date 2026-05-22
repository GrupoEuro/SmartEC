"use strict";
/**
 * meli-reconciliator.ts
 *
 * Callable Cloud Function: meliReconciliator
 *
 * Given a date range (dateFrom, dateTo in YYYY-MM-DD Mexico City time, UTC-6),
 * fetches ALL orders from MercadoLibre's API for that window,
 * cross-checks each against Firestore, and returns:
 *
 *  - orders:    per-order detail array (API total_amount, paid_amount, FS total, status on both sides)
 *  - perDay:    day-by-day aggregated comparison
 *  - missingOrderIds: IDs on MeLi API but absent from Firestore
 *  - summary:   aggregate counts + revenue sums
 *
 * TIMEZONE NOTE:
 *   Both the MeLi API query and the Firestore query use Mexico City (UTC-6) boundaries.
 *   The MeLi portal "Ventas de hoy" counter resets at midnight Argentina time (UTC-3) = 9pm CDMX,
 *   which is WHY the portal total ≠ our daily total — they are measuring different 24-hour windows.
 *   The XLS "Total (MXN)" column is the NET seller payout (after commission + shipping deduction)
 *   and will ALWAYS be lower than total_amount. This is expected.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.meliXlsAudit = exports.meliForceResync = exports.meliReconciliator = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const meli_shared_1 = require("./meli-shared");
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Mexico City UTC offset (no DST adjustment for simplicity — close enough for daily boundaries) */
const MX_UTC_OFFSET_HOURS = -6;
/** Convert a YYYY-MM-DD (Mexico City date) to UTC start/end Date objects */
function mxDayBounds(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Midnight CDMX = 06:00 UTC
    const start = new Date(Date.UTC(y, m - 1, d, 6, 0, 0, 0));
    // 23:59:59.999 CDMX = 05:59:59.999 UTC next day
    const end = new Date(Date.UTC(y, m - 1, d + 1, 5, 59, 59, 999));
    return { start, end };
}
/** Format a UTC Date as YYYY-MM-DD in Mexico City time */
function toMxDate(d) {
    const mx = new Date(d.getTime() + MX_UTC_OFFSET_HOURS * 3600000);
    const y = mx.getUTCFullYear();
    const mon = String(mx.getUTCMonth() + 1).padStart(2, '0');
    const day = String(mx.getUTCDate()).padStart(2, '0');
    return `${y}-${mon}-${day}`;
}
const NON_REVENUE_MELI = new Set(['cancelled', 'invalid']);
const NON_REVENUE_FS = new Set(['cancelled', 'refunded', 'returned',
    'pending_payment', 'refund_pending', 'payment_failed']);
// ── Main Callable ─────────────────────────────────────────────────────────────
exports.meliReconciliator = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { dateFrom, dateTo } = data;
    if (!dateFrom || !dateTo) {
        throw new functions.https.HttpsError('invalid-argument', 'dateFrom and dateTo (YYYY-MM-DD) are required.');
    }
    // ── 1. MeLi config ────────────────────────────────────────────────────
    const configDoc = await shared_1.db.collection('config').doc('integrations').get();
    const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
    if (!(meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId)) {
        throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
    }
    const accessToken = await (0, meli_shared_1.getValidMeliToken)();
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    // ── 2. CDMX date boundaries (used for BOTH the API query and Firestore) ─
    const fromBounds = mxDayBounds(dateFrom);
    const toBounds = mxDayBounds(dateTo);
    // MeLi API expects ISO-8601 with timezone offset
    const apiFrom = fromBounds.start.toISOString().replace('.000Z', '.000-00:00');
    const apiTo = toBounds.end.toISOString().replace('.999Z', '.999-00:00');
    console.log(`[Reconciliator] CDMX window: ${fromBounds.start.toISOString()} → ${toBounds.end.toISOString()}`);
    console.log(`[Reconciliator] NOTE: MeLi portal uses Argentina midnight (UTC-3) = 9pm CDMX — portal totals will differ by up to 3h of orders.`);
    // ── 3. Paginated MeLi API fetch ────────────────────────────────────────
    const meliMap = new Map();
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
        const url = `https://api.mercadolibre.com/orders/search`
            + `?seller=${meliConfig.userId}`
            + `&sort=date_asc`
            + `&limit=50`
            + `&offset=${offset}`
            + `&order.date_created.from=${encodeURIComponent(apiFrom)}`
            + `&order.date_created.to=${encodeURIComponent(apiTo)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const err = await res.json();
            throw new functions.https.HttpsError('internal', `MeLi API error: ${JSON.stringify(err)}`);
        }
        const json = await res.json();
        const page = ((_b = json.results) !== null && _b !== void 0 ? _b : []);
        const pTotal = ((_d = (_c = json.paging) === null || _c === void 0 ? void 0 : _c.total) !== null && _d !== void 0 ? _d : 0);
        for (const mo of page) {
            meliMap.set(String(mo.id), {
                id: String(mo.id),
                total: (_e = mo.total_amount) !== null && _e !== void 0 ? _e : 0,
                paidAmount: (_g = (_f = mo.paid_amount) !== null && _f !== void 0 ? _f : mo.total_amount) !== null && _g !== void 0 ? _g : 0,
                status: mo.status,
                date: new Date(mo.date_created),
            });
        }
        console.log(`[Reconciliator] offset=${offset}: got ${page.length} (total=${pTotal})`);
        offset += 50;
        hasMore = offset < pTotal && page.length > 0;
    }
    console.log(`[Reconciliator] MeLi total fetched: ${meliMap.size}`);
    // ── 4. Firestore orders in same CDMX window ────────────────────────────
    const fsSnap = await shared_1.db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromBounds.start))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toBounds.end))
        .get();
    const fsMap = new Map();
    fsSnap.forEach(doc => {
        var _a, _b, _c;
        const d = doc.data();
        const extId = d.externalOrderId || doc.id.replace('meli_', '');
        const ts = d.createdAt instanceof admin.firestore.Timestamp
            ? d.createdAt.toDate()
            : new Date((_a = d.createdAt) !== null && _a !== void 0 ? _a : 0);
        fsMap.set(extId, { id: extId, total: (_b = d.total) !== null && _b !== void 0 ? _b : 0, status: (_c = d.status) !== null && _c !== void 0 ? _c : 'unknown', date: ts });
    });
    console.log(`[Reconciliator] Firestore orders: ${fsMap.size}`);
    // ── 5. Build per-order detail list ─────────────────────────────────────
    const allIds = new Set([...meliMap.keys(), ...fsMap.keys()]);
    const orders = [];
    for (const id of allIds) {
        const mo = meliMap.get(id);
        const fo = fsMap.get(id);
        // Skip pure cancellations from BOTH sides
        if (mo && NON_REVENUE_MELI.has(mo.status) && !fo)
            continue;
        if (fo && NON_REVENUE_FS.has(fo.status) && !mo)
            continue;
        const date = mo ? toMxDate(mo.date) : toMxDate(fo.date);
        const inMeli = !!mo && !NON_REVENUE_MELI.has(mo.status);
        const inFs = !!fo && !NON_REVENUE_FS.has(fo.status);
        orders.push({
            id,
            date,
            meliStatus: (_h = mo === null || mo === void 0 ? void 0 : mo.status) !== null && _h !== void 0 ? _h : '—',
            meliTotal: (_j = mo === null || mo === void 0 ? void 0 : mo.total) !== null && _j !== void 0 ? _j : 0,
            meliPaid: (_k = mo === null || mo === void 0 ? void 0 : mo.paidAmount) !== null && _k !== void 0 ? _k : 0,
            fsTotal: fo ? fo.total : null,
            fsStatus: fo ? fo.status : null,
            inMeli,
            inFirestore: !!fo,
        });
    }
    orders.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    // ── 6. Build per-day aggregation ───────────────────────────────────────
    const dayMap = new Map();
    const ensureDay = (ds) => {
        if (!dayMap.has(ds)) {
            dayMap.set(ds, { date: ds, meliTotal: 0, meliPaid: 0, fsTotal: 0,
                meliOrders: 0, fsOrders: 0, delta: 0, missingIds: [] });
        }
        return dayMap.get(ds);
    };
    for (const o of orders) {
        const day = ensureDay(o.date);
        if (o.inMeli) {
            day.meliTotal += o.meliTotal;
            day.meliPaid += o.meliPaid;
            day.meliOrders += 1;
            if (!o.inFirestore)
                day.missingIds.push(o.id);
        }
        if (o.inFirestore && o.fsTotal !== null) {
            day.fsTotal += o.fsTotal;
            day.fsOrders += 1;
        }
    }
    const perDay = [...dayMap.values()]
        .map(d => (Object.assign(Object.assign({}, d), { delta: d.meliTotal - d.fsTotal })))
        .sort((a, b) => a.date.localeCompare(b.date));
    // ── 7. Aggregate summary ───────────────────────────────────────────────
    const allMissingIds = orders.filter(o => o.inMeli && !o.inFirestore).map(o => o.id);
    const extraIds = orders.filter(o => !o.inMeli && o.inFirestore).map(o => o.id);
    const totalMeliRevenue = perDay.reduce((s, d) => s + d.meliTotal, 0);
    const totalMeliPaid = perDay.reduce((s, d) => s + d.meliPaid, 0);
    const totalFsRevenue = perDay.reduce((s, d) => s + d.fsTotal, 0);
    return {
        success: true,
        dateFrom,
        dateTo,
        orders,
        perDay,
        missingOrderIds: allMissingIds,
        extraOrderIds: extraIds,
        summary: {
            meliOrderCount: meliMap.size,
            fsOrderCount: fsMap.size,
            missingCount: allMissingIds.length,
            totalMeliRevenue: Math.round(totalMeliRevenue * 100) / 100,
            totalMeliPaid: Math.round(totalMeliPaid * 100) / 100,
            totalFsRevenue: Math.round(totalFsRevenue * 100) / 100,
            totalDelta: Math.round((totalMeliRevenue - totalFsRevenue) * 100) / 100,
        },
    };
});
// ── Force Re-Sync ─────────────────────────────────────────────────────────────
exports.meliForceResync = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const orderIds = (_a = data.orderIds) !== null && _a !== void 0 ? _a : [];
    if (!orderIds.length)
        throw new functions.https.HttpsError('invalid-argument', 'orderIds array required.');
    if (orderIds.length > 200)
        throw new functions.https.HttpsError('invalid-argument', 'Max 200 IDs per call.');
    const accessToken = await (0, meli_shared_1.getValidMeliToken)();
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    let synced = 0, failed = 0;
    for (const id of orderIds) {
        try {
            const moRes = await fetch(`https://api.mercadolibre.com/orders/${id}`, { headers });
            if (!moRes.ok) {
                failed++;
                continue;
            }
            const mo = await moRes.json();
            let shipData = null;
            if ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) {
                const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, { headers: Object.assign(Object.assign({}, headers), { 'x-format-new': 'true' }) });
                if (sRes.ok)
                    shipData = await sRes.json();
            }
            let billingData = null;
            try {
                const bRes = await fetch(`https://api.mercadolibre.com/orders/${id}/billing_info`, { headers: Object.assign(Object.assign({}, headers), { 'x-version': '2' }) });
                if (bRes.ok)
                    billingData = await bRes.json();
            }
            catch (_) { /* non-critical */ }
            await (0, meli_shared_1.processAndSaveMeliOrderFromData)(mo, accessToken, {
                shipData,
                billingData
            });
            synced++;
        }
        catch (e) {
            console.error(`[ForceResync] ${id}:`, e.message);
            failed++;
        }
    }
    return { success: true, synced, failed };
});
exports.meliXlsAudit = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const inputOrders = (_a = data.orders) !== null && _a !== void 0 ? _a : [];
    if (!inputOrders.length) {
        throw new functions.https.HttpsError('invalid-argument', 'orders array required.');
    }
    if (inputOrders.length > 500) {
        throw new functions.https.HttpsError('invalid-argument', 'Max 500 orders per call.');
    }
    console.log(`[XlsAudit] Checking ${inputOrders.length} XLS orders against Firestore`);
    // Batch Firestore reads (max 500 per getAll)
    const docRefs = inputOrders.map(o => shared_1.db.collection('orders').doc(`meli_${o.id}`));
    const snapshots = await shared_1.db.getAll(...docRefs);
    const MX_OFF = -6;
    const toMxDateLocal = (d) => {
        const mx = new Date(d.getTime() + MX_OFF * 3600000);
        return `${mx.getUTCFullYear()}-${String(mx.getUTCMonth() + 1).padStart(2, '0')}-${String(mx.getUTCDate()).padStart(2, '0')}`;
    };
    const results = [];
    for (let i = 0; i < inputOrders.length; i++) {
        const xls = inputOrders[i];
        const snap = snapshots[i];
        let fsTotal = null;
        let fsStatus = null;
        let fsDate = null;
        if (snap.exists) {
            const d = snap.data();
            fsTotal = (_b = d.total) !== null && _b !== void 0 ? _b : null;
            fsStatus = (_c = d.status) !== null && _c !== void 0 ? _c : null;
            const ts = d.createdAt instanceof admin.firestore.Timestamp
                ? d.createdAt.toDate() : new Date((_d = d.createdAt) !== null && _d !== void 0 ? _d : 0);
            fsDate = toMxDateLocal(ts);
        }
        results.push({
            id: xls.id,
            xlsDate: xls.xlsDate,
            xlsStatus: xls.xlsStatus,
            xlsGross: xls.xlsGross,
            xlsNet: xls.xlsNet,
            fsTotal,
            fsStatus,
            fsDate,
            inFirestore: snap.exists,
            grossDelta: fsTotal !== null
                ? Math.round((xls.xlsGross - fsTotal) * 100) / 100
                : xls.xlsGross,
        });
    }
    const missing = results.filter(r => !r.inFirestore);
    const mismatched = results.filter(r => r.inFirestore && Math.abs(r.grossDelta) > 1);
    const ok = results.filter(r => r.inFirestore && Math.abs(r.grossDelta) <= 1);
    const xlsGrossTotal = inputOrders.reduce((s, o) => s + o.xlsGross, 0);
    const xlsNetTotal = inputOrders.reduce((s, o) => s + o.xlsNet, 0);
    const fsTotal = results.filter(r => r.inFirestore).reduce((s, r) => { var _a; return s + ((_a = r.fsTotal) !== null && _a !== void 0 ? _a : 0); }, 0);
    const missingRevenue = missing.reduce((s, r) => s + r.xlsGross, 0);
    console.log(`[XlsAudit] ok=${ok.length}, missing=${missing.length}, mismatch=${mismatched.length}`);
    return {
        success: true,
        totalXlsOrders: inputOrders.length,
        totalOk: ok.length,
        totalMissing: missing.length,
        totalMismatched: mismatched.length,
        xlsGrossTotal: Math.round(xlsGrossTotal * 100) / 100,
        xlsNetTotal: Math.round(xlsNetTotal * 100) / 100,
        fsTotal: Math.round(fsTotal * 100) / 100,
        missingRevenue: Math.round(missingRevenue * 100) / 100,
        orders: results,
    };
});
//# sourceMappingURL=meli-reconciliator.js.map