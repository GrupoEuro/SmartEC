"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meliGetShippingLabel = exports.testMeliApi = exports.meliSyncHistorical = exports.meliAnalyzeHistoricalSync = exports.meliBackfillShippingCosts = exports.meliSyncOrders = void 0;
/**
 * meli-orders.ts
 * MercadoLibre order sync: meliSyncOrders, meliBackfillShippingCosts,
 * meliAnalyzeHistoricalSync, meliSyncHistorical, meliGetShippingLabel.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const meli_shared_1 = require("./meli-shared");
// 4. Sync Orders (Callable)
// Syncs orders from last sync date to now, using a date cursor for accuracy.
exports.meliSyncOrders = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        // Auto-refresh token before sync
        const accessToken = await (0, meli_shared_1.getValidMeliToken)();
        // Use lastSyncDate cursor to get only new orders since last run
        const lastSyncDate = meliConfig.lastSyncDate
            ? new Date(meliConfig.lastSyncDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
        const dateFrom = lastSyncDate.toISOString().replace('.000Z', '.000-00:00');
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_asc&limit=50&order.date_created.from=${encodeURIComponent(dateFrom)}`;
        console.log(`[Meli] Syncing orders since: ${dateFrom}`);
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const json = await res.json();
        if (!res.ok) {
            console.error('[Meli] Sync Orders Error:', json);
            throw new Error(JSON.stringify(json));
        }
        const meliOrders = json.results || [];
        // Fetch shipments + shipment costs + billing_info + MP payment in parallel
        const shipmentsMap = {};
        const shipmentCostsMap = {}; // senders[0].cost = real seller shipping deduction
        const billingMap = {};
        const mpPaymentMap = {}; // MercadoPago payment detail — authoritative CFF source
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
            try {
                // Shipment details (status, address, SLA, logistic type)
                if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'x-format-new': 'true' }
                    });
                    if (sRes.ok) {
                        shipmentsMap[mo.shipping.id] = await sRes.json();
                    }
                    else {
                        console.warn(`[Meli Sync] Shipment ${mo.shipping.id} fetch failed: ${sRes.status}`);
                        shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: (_c = (_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.logistic_type) !== null && _c !== void 0 ? _c : null };
                    }
                    // ── Shipment Costs (seller-absorbed shipping fee) ──────────────────
                    // /shipments/{id}/costs → senders[0].cost = exact MXN taken from seller
                    // Only available for non-Full, non-pickup shipments after payment.
                    // For MeLi Full (fulfillment), this returns cost=0 (logistics pre-paid).
                    try {
                        const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        if (cRes.ok) {
                            const costsJson = await cRes.json();
                            // senders[0].cost = net cost after MeLi seller-reputation discount
                            const senderCost = (_f = (_e = (_d = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.cost) !== null && _f !== void 0 ? _f : 0;
                            const grossAmount = (_g = costsJson === null || costsJson === void 0 ? void 0 : costsJson.gross_amount) !== null && _g !== void 0 ? _g : 0;
                            // buyer_cost = what the buyer paid for shipping
                            const buyerCost = (_l = (_h = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyer_cost) !== null && _h !== void 0 ? _h : (_k = (_j = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyers) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.cost) !== null && _l !== void 0 ? _l : 0;
                            // Sum all discounts that MeLi covers (loyalty, mandatory subsidies)
                            const meliSubsidy = (((_o = (_m = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.discounts) || [])
                                .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                            shipmentCostsMap[mo.shipping.id] = {
                                seller_cost: senderCost,
                                gross_amount: grossAmount,
                                buyer_cost: buyerCost,
                                meli_subsidy: meliSubsidy, // what MeLi covers
                            };
                        }
                    }
                    catch (_) { /* non-critical — skip */ }
                }
                // ── MercadoPago Payment API — most authoritative source for CFF ──────
                // payment.shipping_amount = exact shipping charged by MeLi (incl. Full CFF)
                // payment.fee_details[] = MP processing fee breakdown
                // This is the ONLY reliable source for Full fulfillment shipping deductions.
                const paymentId = (_q = (_p = mo.payments) === null || _p === void 0 ? void 0 : _p[0]) === null || _q === void 0 ? void 0 : _q.id;
                if (paymentId) {
                    try {
                        const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                        if (mpRes.ok) {
                            const mpData = await mpRes.json();
                            // collection wraps the payment — actual data inside .collection
                            const col = (_r = mpData === null || mpData === void 0 ? void 0 : mpData.collection) !== null && _r !== void 0 ? _r : mpData;
                            mpPaymentMap[mo.id] = {
                                // Total shipping amount in the payment (buyer side + subsidy)
                                shipping_amount: (_s = col === null || col === void 0 ? void 0 : col.shipping_amount) !== null && _s !== void 0 ? _s : 0,
                                // MP platform fee (separate from ML marketplace fee)
                                mp_fee: ((col === null || col === void 0 ? void 0 : col.fee_details) || [])
                                    .filter((f) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                                    .reduce((s, f) => s + (f.amount || 0), 0),
                                // Net amount after all deductions
                                net_received_amount: (_u = (_t = col === null || col === void 0 ? void 0 : col.net_received_amount) !== null && _t !== void 0 ? _t : col === null || col === void 0 ? void 0 : col.net_amount) !== null && _u !== void 0 ? _u : 0,
                            };
                        }
                    }
                    catch (_) { /* non-critical */ }
                }
                // Billing info (try v2 for Mexico, fallback v1)
                const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'x-version': '2' }
                });
                if (bRes.ok)
                    billingMap[mo.id] = await bRes.json();
                else {
                    const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    if (bRes1.ok)
                        billingMap[mo.id] = await bRes1.json();
                }
            }
            catch (e) { /* skip non-critical */ }
        }));
        let importedCount = 0;
        // Pre-fetch existing originalName for all orders in parallel (non-blocking)
        const existingNameMap = new Map();
        await Promise.all(meliOrders.map(async (mo) => {
            var _a, _b;
            try {
                const snap = await shared_1.db.collection('orders').doc(`meli_${mo.id}`).get();
                const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                if (orig)
                    existingNameMap.set(String(mo.id), orig);
            }
            catch (_) { /* skip */ }
        }));
        for (const mo of meliOrders) {
            const orderRef = shared_1.db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const shipCosts = ((_c = mo.shipping) === null || _c === void 0 ? void 0 : _c.id) ? shipmentCostsMap[mo.shipping.id] : null;
            const mpPayment = (_d = mpPaymentMap[mo.id]) !== null && _d !== void 0 ? _d : null;
            // Construct Eurollantas Order object using helper
            const newOrder = (0, meli_shared_1.parseAndSaveMeliOrder)(mo, shipData, billingMap[mo.id]);
            // ── Shipping cost resolution — 4-source priority chain ────────────────────────
            //  1. /shipments/{id}/costs → senders[0].cost  — exact for Classic / Flex
            //  2. /collections/{paymentId} → shipping_amount — ground truth for Full CFF
            //     MercadoPago processes the CFF as part of the payment's shipping_amount.
            //     For seller-paid Free Shipping on Full: seller absorbs 100% of shipping_amount.
            //  3. order.shipping_cost  — sometimes carries Full CFF; used as last API fallback.
            //  4. 0 + cff_pending:true — only when no source has data.
            const mpShipAmount = (_e = mpPayment === null || mpPayment === void 0 ? void 0 : mpPayment.shipping_amount) !== null && _e !== void 0 ? _e : 0;
            const buyerShipCost = (_f = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.buyer_cost) !== null && _f !== void 0 ? _f : 0;
            const shippingSellerCost = (() => {
                var _a, _b;
                // Source 1 — /shipments/costs (exact, Classic/Flex post-payment)
                const fromCosts = (_a = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.seller_cost) !== null && _a !== void 0 ? _a : 0;
                if (fromCosts > 0)
                    return fromCosts;
                // Source 2 — MercadoPago payment.shipping_amount (Full CFF ground truth)
                if (mpShipAmount > 0) {
                    const isFull = newOrder.fulfillmentType === 'platform';
                    if (isFull) {
                        // Full: seller absorbs the entire CFF amount
                        console.log(`[Meli] Full CFF via payment.shipping_amount=${mpShipAmount} order=${mo.id}`);
                        return mpShipAmount;
                    }
                    // Classic Free Shipping: seller only absorbs delta above buyer's contribution
                    if (mpShipAmount > buyerShipCost) {
                        return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
                    }
                }
                // Source 3 — order.shipping_cost (sometimes has CFF, sometimes 0)
                const fromOrder = (_b = newOrder.orderShippingCost) !== null && _b !== void 0 ? _b : 0;
                if (fromOrder > 0) {
                    console.log(`[Meli] shipping_cost from order=${fromOrder} for order ${mo.id}`);
                    return fromOrder;
                }
                return 0;
            })();
            const shippingGrossAmount = (_g = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.gross_amount) !== null && _g !== void 0 ? _g : mpShipAmount;
            const shippingMeliSubsidy = (_h = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.meli_subsidy) !== null && _h !== void 0 ? _h : 0;
            // cff_pending only when Full + ALL sources returned 0
            const cffPending = newOrder.fulfillmentType === 'platform'
                && shippingSellerCost === 0
                && mpShipAmount === 0;
            // ── Complete net_receipt formula ───────────────────────────────────────────
            // Verified cent-perfect against 5 real ML sale screenshots + 55-order CSV:
            //   net = total − rawCommission − retIVA − retISR − shipping − refunds + mlBonus
            //
            // retIVA = (total/1.16) × 8%   ← SAT Art.18-J LIVA (50% of 16% on pre-IVA base)
            // retISR = (total/1.16) × 2.5% ← SAT Art.113-A LISR (platform sellers, MX)
            const IVA_INCLUSIVE_DIVISOR = 1.16;
            const meliCommission = (_j = newOrder.marketplaceFee) !== null && _j !== void 0 ? _j : 0;
            const totalAmount = (_k = newOrder.total) !== null && _k !== void 0 ? _k : 0;
            const preIvaAmount = totalAmount / IVA_INCLUSIVE_DIVISOR;
            const retencionIVA = Math.round(preIvaAmount * 0.08 * 100) / 100;
            const retencionISR = Math.round(preIvaAmount * 0.025 * 100) / 100;
            const totalImpuestos = retencionIVA + retencionISR;
            const refundedAmount = (_l = newOrder.refundedAmount) !== null && _l !== void 0 ? _l : 0;
            const mlBonus = (_m = newOrder.mlBonus) !== null && _m !== void 0 ? _m : 0;
            const netReceipt = Math.round(Math.max(0, totalAmount
                - meliCommission
                - retencionIVA
                - retencionISR
                - shippingSellerCost
                - refundedAmount
                + mlBonus) * 100) / 100;
            // Merge ALL financial fields into the order document
            const orderWithFinancials = Object.assign(Object.assign({}, newOrder), { 
                // Shipping breakdown (full audit trail)
                shipping_seller_cost: shippingSellerCost, shipping_gross_amount: shippingGrossAmount, shipping_meli_subsidy: shippingMeliSubsidy, mp_shipping_amount: mpShipAmount, buyer_shipping_cost: buyerShipCost, cff_pending: cffPending, 
                // SAT tax retentions (recoverable in annual declaration)
                retencion_iva: retencionIVA, retencion_isr: retencionISR, total_impuestos: totalImpuestos, 
                // Adjustments
                refunded_amount: refundedAmount, ml_bonus: mlBonus, 
                // Advertising
                is_ad_driven: (_o = newOrder.isAdDriven) !== null && _o !== void 0 ? _o : false, 
                // 💰 The bottom line
                net_receipt: netReceipt });
            // Preserve the first human-readable name — MeLi anonymizes buyer names on older orders
            const preserved = existingNameMap.get(String(mo.id));
            const isAnon = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            if (preserved && !isAnon(preserved)) {
                orderWithFinancials.customer.originalName = preserved;
            }
            else if (preserved && isAnon(preserved) && orderWithFinancials.customer.originalName && !isAnon(orderWithFinancials.customer.originalName)) {
                // Stored was anonymized but new name is readable — upgrade!
            }
            else if (preserved) {
                orderWithFinancials.customer.originalName = preserved;
            }
            await orderRef.set(orderWithFinancials, { merge: true });
            importedCount++;
        }
        // Save lastSyncDate cursor to Firestore
        await shared_1.db.collection('config').doc('integrations').set({
            meli: { lastSyncDate: new Date().toISOString() }
        }, { merge: true });
        // ── Avg shipping cost aggregation ────────────────────────────────────
        // After saving all orders, compute the real average shipping cost per
        // MeLi listing item ID from all orders that have shipping_seller_cost > 0.
        // Write these back to meli_listings so the Listings tab shows a real number.
        try {
            console.log('[Meli] Computing avg shipping cost per listing from order history...');
            // Query ALL MeLi orders that have a real shipping cost recorded
            const shippingOrdersSnap = await shared_1.db.collection('orders')
                .where('sourceChannel', '==', 'mercadolibre')
                .where('shipping_seller_cost', '>', 0)
                .get();
            // Group: meliItemId → { totalCost, count, sampleSizes }
            const itemShippingMap = new Map();
            shippingOrdersSnap.docs.forEach(doc => {
                var _a;
                const order = doc.data();
                const cost = (_a = order.shipping_seller_cost) !== null && _a !== void 0 ? _a : 0;
                if (cost <= 0)
                    return;
                // items[].productId is the MeLi item ID (e.g. MLM123456)
                const items = order.items || [];
                items.forEach((item) => {
                    const itemId = item.productId;
                    if (!itemId || !itemId.startsWith('MLM'))
                        return;
                    const existing = itemShippingMap.get(itemId);
                    if (existing) {
                        existing.totalCost += cost;
                        existing.count++;
                        existing.min = Math.min(existing.min, cost);
                        existing.max = Math.max(existing.max, cost);
                    }
                    else {
                        itemShippingMap.set(itemId, { totalCost: cost, count: 1, min: cost, max: cost });
                    }
                });
            });
            if (itemShippingMap.size > 0) {
                // Batch-write avg_shipping_cost back to meli_listings
                const AGG_BATCH_SIZE = 400;
                let aggBatch = shared_1.db.batch();
                let aggCount = 0;
                let totalUpdated = 0;
                for (const [itemId, stats] of itemShippingMap) {
                    const avg = Math.round((stats.totalCost / stats.count) * 100) / 100;
                    const listingRef = shared_1.db.collection('meli_listings').doc(itemId);
                    aggBatch.update(listingRef, {
                        avg_shipping_cost: avg,
                        min_shipping_cost: Math.round(stats.min * 100) / 100,
                        max_shipping_cost: Math.round(stats.max * 100) / 100,
                        shipping_sample_size: stats.count,
                        avg_shipping_updated: admin.firestore.FieldValue.serverTimestamp()
                    });
                    aggCount++;
                    totalUpdated++;
                    if (aggCount >= AGG_BATCH_SIZE) {
                        await aggBatch.commit();
                        aggBatch = shared_1.db.batch();
                        aggCount = 0;
                    }
                }
                if (aggCount > 0)
                    await aggBatch.commit();
                console.log(`[Meli] ✅ Avg shipping updated for ${totalUpdated} listings from ${shippingOrdersSnap.size} orders.`);
            }
            else {
                console.log('[Meli] No orders with shipping cost found — skipping avg shipping update.');
            }
        }
        catch (aggErr) {
            // Non-fatal: don't fail the entire sync if aggregation fails
            console.warn('[Meli] Avg shipping aggregation failed (non-fatal):', (_p = aggErr === null || aggErr === void 0 ? void 0 : aggErr.message) !== null && _p !== void 0 ? _p : aggErr);
        }
        console.log(`[Meli] Successfully synced ${importedCount} orders since ${dateFrom}.`);
        return { success: true, imported: importedCount, totalProcessed: meliOrders.length, syncedFrom: dateFrom };
    }
    catch (err) {
        console.error('[Meli] Sync Orders failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// 4b. Backfill Shipping Costs (Callable)
// One-time fix: finds all MeLi orders that have a shipmentId but shipping_seller_cost = 0 or missing,
// re-fetches /shipments/{id}/costs for each, and writes the real amounts.
// Safe to call multiple times — only updates orders where cost is 0.
exports.meliBackfillShippingCosts = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!(meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.accessToken))
            throw new Error('MeLi not connected.');
        const accessToken = await (0, meli_shared_1.getValidMeliToken)();
        // Find all MeLi orders that have a shipmentId but 0 or missing shipping cost, or are cff_pending
        const ordersSnap = await shared_1.db.collection('orders')
            .where('sourceChannel', '==', 'mercadolibre')
            .get();
        // Filter to those that need backfilling
        const toBackfill = ordersSnap.docs.filter(doc => {
            const d = doc.data();
            const hasCost = d.shipping_seller_cost != null && d.shipping_seller_cost > 0;
            const hasShipId = d.shipmentId || d.shippingId || d.meliShipmentId;
            const isCffPending = d.cff_pending === true;
            return (hasShipId && !hasCost) || isCffPending;
        });
        console.log(`[Meli Backfill] Found ${toBackfill.length} orders to backfill (of ${ordersSnap.size} total MeLi orders)`);
        if (toBackfill.length === 0) {
            return { success: true, updated: 0, message: 'All orders already have shipping costs.' };
        }
        // Fetch /costs for each in controlled concurrency (5 at a time to stay under rate limits)
        const CONCURRENCY = 5;
        let updatedCount = 0;
        let skippedCount = 0;
        for (let i = 0; i < toBackfill.length; i += CONCURRENCY) {
            const chunk = toBackfill.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async (doc) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
                const data = doc.data();
                // Try all possible shipment ID fields
                const shipmentId = data.shipmentId || data.shippingId || data.meliShipmentId || null;
                if (!shipmentId) {
                    skippedCount++;
                    return;
                }
                let sellerCost = 0;
                let grossAmount = 0;
                let meliSubsidy = 0;
                let buyerShipCost = 0;
                try {
                    const cRes = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}/costs`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    if (cRes.ok) {
                        const costsJson = await cRes.json();
                        sellerCost = (_c = (_b = (_a = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.cost) !== null && _c !== void 0 ? _c : 0;
                        grossAmount = (_d = costsJson === null || costsJson === void 0 ? void 0 : costsJson.gross_amount) !== null && _d !== void 0 ? _d : 0;
                        buyerShipCost = (_h = (_e = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyer_cost) !== null && _e !== void 0 ? _e : (_g = (_f = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyers) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.cost) !== null && _h !== void 0 ? _h : 0;
                        meliSubsidy = (((_k = (_j = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.discounts) || [])
                            .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                    }
                }
                catch (e) {
                    console.warn(`[Meli Backfill] Costs API failed for shipment ${shipmentId}:`, e);
                }
                // MercadoPago payment API fallback (CFF ground truth for Full)
                let mpShipAmount = 0;
                const paymentId = (_m = (_l = data.payments) === null || _l === void 0 ? void 0 : _l[0]) === null || _m === void 0 ? void 0 : _m.id;
                if (paymentId) {
                    try {
                        const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                        if (mpRes.ok) {
                            const mpData = await mpRes.json();
                            const col = (_o = mpData === null || mpData === void 0 ? void 0 : mpData.collection) !== null && _o !== void 0 ? _o : mpData;
                            mpShipAmount = (_p = col === null || col === void 0 ? void 0 : col.shipping_amount) !== null && _p !== void 0 ? _p : 0;
                        }
                    }
                    catch (e) {
                        console.warn(`[Meli Backfill] MP payment fetch failed for payment ${paymentId}:`, e);
                    }
                }
                // Priority shipping cost resolution logic
                const shippingSellerCost = (() => {
                    var _a;
                    if (sellerCost > 0)
                        return sellerCost;
                    if (mpShipAmount > 0) {
                        const isFull = data.fulfillmentType === 'platform';
                        if (isFull)
                            return mpShipAmount;
                        if (mpShipAmount > buyerShipCost) {
                            return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
                        }
                    }
                    const fromOrder = (_a = data.orderShippingCost) !== null && _a !== void 0 ? _a : 0;
                    if (fromOrder > 0)
                        return fromOrder;
                    return 0;
                })();
                if (shippingSellerCost === 0) {
                    skippedCount++;
                    return;
                } // No cost available yet (pending shipment)
                const shippingGrossAmount = grossAmount > 0 ? grossAmount : mpShipAmount;
                const shippingMeliSubsidy = meliSubsidy;
                // ── Recompute net_receipt with full formula (backfill path) ───────────────
                const commission = (_q = data.marketplaceFee) !== null && _q !== void 0 ? _q : 0;
                const total = (_r = data.total) !== null && _r !== void 0 ? _r : 0;
                const preIva = total / 1.16;
                const retIVA = Math.round(preIva * 0.08 * 100) / 100;
                const retISR = Math.round(preIva * 0.025 * 100) / 100;
                const refunded = (_s = data.refundedAmount) !== null && _s !== void 0 ? _s : 0;
                const bonus = (_t = data.mlBonus) !== null && _t !== void 0 ? _t : 0;
                const netReceipt = Math.round(Math.max(0, total - commission - shippingSellerCost - retIVA - retISR - refunded + bonus) * 100) / 100;
                await doc.ref.update({
                    shipping_seller_cost: shippingSellerCost,
                    shipping_gross_amount: shippingGrossAmount,
                    shipping_meli_subsidy: shippingMeliSubsidy,
                    mp_shipping_amount: mpShipAmount,
                    buyer_shipping_cost: buyerShipCost,
                    retencion_iva: retIVA,
                    retencion_isr: retISR,
                    total_impuestos: retIVA + retISR,
                    refunded_amount: (_u = data.refundedAmount) !== null && _u !== void 0 ? _u : 0,
                    ml_bonus: (_v = data.mlBonus) !== null && _v !== void 0 ? _v : 0,
                    cff_pending: false,
                    net_receipt: netReceipt,
                    shipping_backfilled: true,
                });
                updatedCount++;
            }));
            // Brief rate-limit pause between batches
            if (i + CONCURRENCY < toBackfill.length) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        console.log(`[Meli Backfill] ✅ Updated ${updatedCount} orders. Skipped ${skippedCount}.`);
        // Re-run avg shipping aggregation now that we have real data
        try {
            const shippingOrdersSnap = await shared_1.db.collection('orders')
                .where('sourceChannel', '==', 'mercadolibre')
                .where('shipping_seller_cost', '>', 0)
                .get();
            const itemShippingMap = new Map();
            shippingOrdersSnap.docs.forEach(doc => {
                var _a;
                const order = doc.data();
                const cost = (_a = order.shipping_seller_cost) !== null && _a !== void 0 ? _a : 0;
                if (cost <= 0)
                    return;
                (order.items || []).forEach((item) => {
                    const itemId = item.productId;
                    if (!itemId || !itemId.startsWith('MLM'))
                        return;
                    const existing = itemShippingMap.get(itemId);
                    if (existing) {
                        existing.totalCost += cost;
                        existing.count++;
                        existing.min = Math.min(existing.min, cost);
                        existing.max = Math.max(existing.max, cost);
                    }
                    else {
                        itemShippingMap.set(itemId, { totalCost: cost, count: 1, min: cost, max: cost });
                    }
                });
            });
            if (itemShippingMap.size > 0) {
                const AGG_BATCH_SIZE = 400;
                let aggBatch = shared_1.db.batch();
                let aggCount = 0;
                for (const [itemId, stats] of itemShippingMap) {
                    const avg = Math.round((stats.totalCost / stats.count) * 100) / 100;
                    aggBatch.update(shared_1.db.collection('meli_listings').doc(itemId), {
                        avg_shipping_cost: avg,
                        min_shipping_cost: Math.round(stats.min * 100) / 100,
                        max_shipping_cost: Math.round(stats.max * 100) / 100,
                        shipping_sample_size: stats.count,
                        avg_shipping_updated: admin.firestore.FieldValue.serverTimestamp()
                    });
                    if (++aggCount >= AGG_BATCH_SIZE) {
                        await aggBatch.commit();
                        aggBatch = shared_1.db.batch();
                        aggCount = 0;
                    }
                }
                if (aggCount > 0)
                    await aggBatch.commit();
                console.log(`[Meli Backfill] ✅ Avg shipping updated for ${itemShippingMap.size} listings.`);
            }
        }
        catch (aggErr) {
            console.warn('[Meli Backfill] Avg aggregation failed (non-fatal):', aggErr === null || aggErr === void 0 ? void 0 : aggErr.message);
        }
        return {
            success: true,
            totalMeliOrders: ordersSnap.size,
            ordersNeedingBackfill: toBackfill.length,
            updated: updatedCount,
            skipped: skippedCount,
        };
    }
    catch (err) {
        console.error('[Meli Backfill] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// 5. Analyze Historical Sync (Callable)
// Returns the exact count of historical orders available on MercadoLibre
exports.meliAnalyzeHistoricalSync = functions.runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&limit=1&order.date_created.from=2026-01-01T00:00:00.000-00:00`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await res.json();
        if (!res.ok)
            throw new Error(JSON.stringify(json));
        const totalRecords = ((_b = json.paging) === null || _b === void 0 ? void 0 : _b.total) || 0;
        return { success: true, totalRecords };
    }
    catch (err) {
        console.error('[Meli] Analyze Historical Sync failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// 6. Sync Historical Orders (Callable)
// Syncs a specific chunk of historical orders using Chunked Batching Architecture
exports.meliSyncHistorical = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const offset = data.offset || 0;
    const limit = data.limit || 50; // max batch operations is 50 for Meli search API
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=${limit}&offset=${offset}&order.date_created.from=2026-01-01T00:00:00.000-00:00`;
        console.log(`[Meli Historical Sync] Fetching batch from Meli: ${url}`);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await res.json();
        if (!res.ok)
            throw new Error(JSON.stringify(json));
        const meliOrders = json.results || [];
        if (meliOrders.length === 0) {
            return { success: true, processed: 0, message: 'No more orders to sync.' };
        }
        // Fetch shipments + shipment costs + billing_info + MP payment in parallel
        const shipmentsMap = {};
        const shipmentCostsMap = {};
        const billingMap = {};
        const mpPaymentMap = {};
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
            try {
                if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                        headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-format-new': 'true' }
                    });
                    if (sRes.ok) {
                        shipmentsMap[mo.shipping.id] = await sRes.json();
                    }
                    else {
                        console.warn(`[Meli Historical] Shipment ${mo.shipping.id} fetch failed: ${sRes.status} — fulfillmentType may be wrong`);
                        shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: (_c = (_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.logistic_type) !== null && _c !== void 0 ? _c : null };
                    }
                    // /shipments/{id}/costs — exact seller cost for Classic/Flex
                    try {
                        const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, {
                            headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                        });
                        if (cRes.ok) {
                            const costsJson = await cRes.json();
                            const senderCost = (_f = (_e = (_d = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.cost) !== null && _f !== void 0 ? _f : 0;
                            const grossAmount = (_g = costsJson === null || costsJson === void 0 ? void 0 : costsJson.gross_amount) !== null && _g !== void 0 ? _g : 0;
                            const buyerCost = (_l = (_h = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyer_cost) !== null && _h !== void 0 ? _h : (_k = (_j = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyers) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.cost) !== null && _l !== void 0 ? _l : 0;
                            const meliSubsidy = (((_o = (_m = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.discounts) || [])
                                .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                            shipmentCostsMap[mo.shipping.id] = { seller_cost: senderCost, gross_amount: grossAmount, buyer_cost: buyerCost, meli_subsidy: meliSubsidy };
                        }
                    }
                    catch (_) { /* skip */ }
                }
                // /collections/{paymentId} — MP ground truth for Full CFF
                const paymentId = (_q = (_p = mo.payments) === null || _p === void 0 ? void 0 : _p[0]) === null || _q === void 0 ? void 0 : _q.id;
                if (paymentId) {
                    try {
                        const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
                        if (mpRes.ok) {
                            const mpData = await mpRes.json();
                            const col = (_r = mpData === null || mpData === void 0 ? void 0 : mpData.collection) !== null && _r !== void 0 ? _r : mpData;
                            mpPaymentMap[mo.id] = {
                                shipping_amount: (_s = col === null || col === void 0 ? void 0 : col.shipping_amount) !== null && _s !== void 0 ? _s : 0,
                                mp_fee: ((col === null || col === void 0 ? void 0 : col.fee_details) || [])
                                    .filter((f) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                                    .reduce((s, f) => s + (f.amount || 0), 0),
                                net_received_amount: (_u = (_t = col === null || col === void 0 ? void 0 : col.net_received_amount) !== null && _t !== void 0 ? _t : col === null || col === void 0 ? void 0 : col.net_amount) !== null && _u !== void 0 ? _u : 0,
                            };
                        }
                    }
                    catch (_) { /* skip */ }
                }
                const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                    headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' }
                });
                if (bRes.ok)
                    billingMap[mo.id] = await bRes.json();
                else {
                    const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                        headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                    });
                    if (bRes1.ok)
                        billingMap[mo.id] = await bRes1.json();
                }
            }
            catch (e) { /* skip */ }
        }));
        const batch = shared_1.db.batch();
        // Pre-fetch existing originalNames in parallel before batch-writing
        const origNameMap = new Map();
        await Promise.all(meliOrders.map(async (mo) => {
            var _a, _b;
            try {
                const snap = await shared_1.db.collection('orders').doc(`meli_${mo.id}`).get();
                const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                if (orig)
                    origNameMap.set(String(mo.id), orig);
            }
            catch (_) { /* skip */ }
        }));
        for (const mo of meliOrders) {
            const orderRef = shared_1.db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const shipCosts = ((_c = mo.shipping) === null || _c === void 0 ? void 0 : _c.id) ? shipmentCostsMap[mo.shipping.id] : null;
            const mpPayment = (_d = mpPaymentMap[mo.id]) !== null && _d !== void 0 ? _d : null;
            const newOrder = (0, meli_shared_1.parseAndSaveMeliOrder)(mo, shipData, billingMap[mo.id]);
            // Same 4-source shipping resolution as quick sync
            const mpShipAmount = (_e = mpPayment === null || mpPayment === void 0 ? void 0 : mpPayment.shipping_amount) !== null && _e !== void 0 ? _e : 0;
            const buyerShipCost = (_f = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.buyer_cost) !== null && _f !== void 0 ? _f : 0;
            const shippingSellerCost = (() => {
                var _a, _b;
                const fromCosts = (_a = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.seller_cost) !== null && _a !== void 0 ? _a : 0;
                if (fromCosts > 0)
                    return fromCosts;
                if (mpShipAmount > 0) {
                    if (newOrder.fulfillmentType === 'platform')
                        return mpShipAmount;
                    if (mpShipAmount > buyerShipCost)
                        return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
                }
                const fromOrder = (_b = newOrder.orderShippingCost) !== null && _b !== void 0 ? _b : 0;
                if (fromOrder > 0)
                    return fromOrder;
                return 0;
            })();
            const shippingGrossAmount = (_g = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.gross_amount) !== null && _g !== void 0 ? _g : mpShipAmount;
            const shippingMeliSubsidy = (_h = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.meli_subsidy) !== null && _h !== void 0 ? _h : 0;
            const cffPending = newOrder.fulfillmentType === 'platform' && shippingSellerCost === 0 && mpShipAmount === 0;
            // SAT retentions
            const IVA_INCLUSIVE_DIVISOR = 1.16;
            const totalAmount = (_j = newOrder.total) !== null && _j !== void 0 ? _j : 0;
            const preIvaAmount = totalAmount / IVA_INCLUSIVE_DIVISOR;
            const retencionIVA = Math.round(preIvaAmount * 0.08 * 100) / 100;
            const retencionISR = Math.round(preIvaAmount * 0.025 * 100) / 100;
            const netReceipt = Math.round(Math.max(0, totalAmount - ((_k = newOrder.marketplaceFee) !== null && _k !== void 0 ? _k : 0) - retencionIVA - retencionISR
                - shippingSellerCost - ((_l = newOrder.refundedAmount) !== null && _l !== void 0 ? _l : 0) + ((_m = newOrder.mlBonus) !== null && _m !== void 0 ? _m : 0)) * 100) / 100;
            // Merge shipping + financial fields
            const orderWithFinancials = Object.assign(Object.assign({}, newOrder), { shipping_seller_cost: shippingSellerCost, shipping_gross_amount: shippingGrossAmount, shipping_meli_subsidy: shippingMeliSubsidy, mp_shipping_amount: mpShipAmount, buyer_shipping_cost: buyerShipCost, cff_pending: cffPending, retencion_iva: retencionIVA, retencion_isr: retencionISR, total_impuestos: retencionIVA + retencionISR, refunded_amount: (_o = newOrder.refundedAmount) !== null && _o !== void 0 ? _o : 0, ml_bonus: (_p = newOrder.mlBonus) !== null && _p !== void 0 ? _p : 0, is_ad_driven: (_q = newOrder.isAdDriven) !== null && _q !== void 0 ? _q : false, net_receipt: netReceipt });
            // Restore the original readable name if we already have one stored
            const isAnonH = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            const preservedOrig = origNameMap.get(String(mo.id));
            if (preservedOrig && !isAnonH(preservedOrig)) {
                orderWithFinancials.customer.originalName = preservedOrig;
            }
            else if (preservedOrig && isAnonH(preservedOrig) && !isAnonH(orderWithFinancials.customer.originalName)) {
                // Upgrade: stored was anonymized, new is readable
            }
            else if (preservedOrig) {
                orderWithFinancials.customer.originalName = preservedOrig;
            }
            // ✅ merge:true — NEVER deletes any existing fields
            batch.set(orderRef, orderWithFinancials, { merge: true });
        }
        await batch.commit();
        console.log(`[Meli Historical Sync] Batched ${meliOrders.length} orders. Offset: ${offset}`);
        return { success: true, processed: meliOrders.length, hasMore: (offset + limit) < (((_r = json.paging) === null || _r === void 0 ? void 0 : _r.total) || 0) };
    }
    catch (err) {
        console.error('[Meli Historical Sync] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// 7. Temporary Debug Endpoint to Check Order JSON Payload Structure
exports.testMeliApi = functions.runWith({ timeoutSeconds: 120 }).https.onRequest(async (req, res) => {
    var _a, _b, _c;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).send('MercadoLibre not configured.');
            return;
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&limit=10&offset=0`;
        const mRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await mRes.json();
        const orders = json.results || [];
        // Return the raw shipping object from the first few orders
        const shippingSamples = orders.slice(0, 3).map((o) => ({
            order_id: o.id,
            status: o.status,
            tags: o.tags,
            shipping: o.shipping
        }));
        // Also fetch one individual shipment to check structure
        let individualShipment = null;
        if ((_c = (_b = orders[0]) === null || _b === void 0 ? void 0 : _b.shipping) === null || _c === void 0 ? void 0 : _c.id) {
            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${orders[0].shipping.id}`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-format-new': 'true' }
            });
            individualShipment = await sRes.json();
        }
        res.json({ success: true, shippingSamples, individualShipment });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 8. Get Meli Shipping Label (Callable)
// MercadoLibre only allows getting labels for Meli Classic (merchant fulfilled) orders.
exports.meliGetShippingLabel = functions.runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const shippingId = data.shippingId;
    if (!shippingId)
        throw new functions.https.HttpsError('invalid-argument', 'shippingId is required');
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shippingId}&response_type=pdf`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        if (!res.ok) {
            const errJson = await res.json();
            throw new Error(errJson.message || 'Failed to fetch shipping label from MercadoLibre.');
        }
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Pdf = buffer.toString('base64');
        return { success: true, pdfBase64: base64Pdf };
    }
    catch (err) {
        console.error('[Meli Label] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ─── MercadoLibre Full Inventory Sync ───────────────────────────────────────
//# sourceMappingURL=meli-orders.js.map