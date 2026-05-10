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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
        // Fetch shipments + shipment costs + billing_info in parallel
        const shipmentsMap = {};
        const shipmentCostsMap = {}; // senders[0].cost = real seller shipping deduction
        const billingMap = {};
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
                            // Sum all discounts that MeLi covers (loyalty, mandatory subsidies)
                            const meliSubsidy = (((_j = (_h = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.discounts) || [])
                                .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                            shipmentCostsMap[mo.shipping.id] = {
                                seller_cost: senderCost,
                                gross_amount: grossAmount,
                                meli_subsidy: meliSubsidy, // what MeLi covers
                            };
                        }
                    }
                    catch (_) { /* non-critical — skip */ }
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
            // Construct Eurollantas Order object using helper
            const newOrder = (0, meli_shared_1.parseAndSaveMeliOrder)(mo, shipData, billingMap[mo.id]);
            // ── Shipping cost deducted from seller ──────────────────────────────────
            // For Classic/Flex + "Envío Gratis": seller absorbs shipping
            //   → senders[0].cost from /shipments/{id}/costs
            // For MeLi Full (fulfillment): cost = 0 (MeLi handles logistics)
            // For pickup / no envíos: cost = 0
            const shippingSellerCost = (_d = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.seller_cost) !== null && _d !== void 0 ? _d : 0;
            const shippingGrossAmount = (_e = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.gross_amount) !== null && _e !== void 0 ? _e : 0;
            const shippingMeliSubsidy = (_f = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.meli_subsidy) !== null && _f !== void 0 ? _f : 0;
            // net_receipt = what seller actually receives after all MeLi deductions
            // = order total − MeLi commission − seller-absorbed shipping cost
            const meliCommission = (_g = newOrder.marketplaceFee) !== null && _g !== void 0 ? _g : 0;
            const totalAmount = (_h = newOrder.total) !== null && _h !== void 0 ? _h : 0;
            const netReceipt = Math.max(0, totalAmount - meliCommission - shippingSellerCost);
            // Merge financials into the order via spread (avoids TS strict type errors)
            const orderWithFinancials = Object.assign(Object.assign({}, newOrder), { shipping_seller_cost: shippingSellerCost, shipping_gross_amount: shippingGrossAmount, shipping_meli_subsidy: shippingMeliSubsidy, net_receipt: netReceipt });
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
            console.warn('[Meli] Avg shipping aggregation failed (non-fatal):', (_j = aggErr === null || aggErr === void 0 ? void 0 : aggErr.message) !== null && _j !== void 0 ? _j : aggErr);
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
        // Find all MeLi orders that have a shipmentId but 0 or missing shipping cost
        const ordersSnap = await shared_1.db.collection('orders')
            .where('sourceChannel', '==', 'mercadolibre')
            .get();
        // Filter to those that need backfilling
        const toBackfill = ordersSnap.docs.filter(doc => {
            const d = doc.data();
            const hasCost = d.shipping_seller_cost != null && d.shipping_seller_cost > 0;
            const hasShipId = d.shipmentId || d.shippingId || d.meliShipmentId;
            return hasShipId && !hasCost;
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
                var _a, _b, _c, _d, _e, _f, _g, _h;
                const data = doc.data();
                // Try all possible shipment ID fields
                const shipmentId = data.shipmentId || data.shippingId || data.meliShipmentId || null;
                if (!shipmentId) {
                    skippedCount++;
                    return;
                }
                try {
                    const cRes = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}/costs`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    if (!cRes.ok) {
                        skippedCount++;
                        return;
                    }
                    const costsJson = await cRes.json();
                    const sellerCost = (_c = (_b = (_a = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.cost) !== null && _c !== void 0 ? _c : 0;
                    const grossAmount = (_d = costsJson === null || costsJson === void 0 ? void 0 : costsJson.gross_amount) !== null && _d !== void 0 ? _d : 0;
                    const meliSubsidy = (((_f = (_e = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.discounts) || [])
                        .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                    if (sellerCost === 0) {
                        skippedCount++;
                        return;
                    } // No cost available yet (pending shipment)
                    // Recompute net_receipt with real shipping cost
                    const commission = (_g = data.marketplaceFee) !== null && _g !== void 0 ? _g : 0;
                    const total = (_h = data.total) !== null && _h !== void 0 ? _h : 0;
                    const netReceipt = Math.max(0, total - commission - sellerCost);
                    await doc.ref.update({
                        shipping_seller_cost: sellerCost,
                        shipping_gross_amount: grossAmount,
                        shipping_meli_subsidy: meliSubsidy,
                        net_receipt: netReceipt,
                        shipping_backfilled: true,
                    });
                    updatedCount++;
                }
                catch (e) {
                    console.warn(`[Meli Backfill] Failed for shipment ${shipmentId}:`, e);
                    skippedCount++;
                }
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
    var _a, _b, _c;
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
        // Fetch shipments + billing_info in parallel
        const shipmentsMap = {};
        const billingMap = {};
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a, _b, _c;
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
            const newOrder = (0, meli_shared_1.parseAndSaveMeliOrder)(mo, shipData, billingMap[mo.id]);
            // Restore the original readable name if we already have one stored
            const isAnonH = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            const preservedOrig = origNameMap.get(String(mo.id));
            if (preservedOrig && !isAnonH(preservedOrig)) {
                newOrder.customer.originalName = preservedOrig;
            }
            else if (preservedOrig && isAnonH(preservedOrig) && !isAnonH(newOrder.customer.originalName)) {
                // Upgrade: stored was anonymized, new is readable
            }
            else if (preservedOrig) {
                newOrder.customer.originalName = preservedOrig;
            }
            // Upsert the order
            batch.set(orderRef, newOrder, { merge: true });
        }
        await batch.commit();
        console.log(`[Meli Historical Sync] Batched ${meliOrders.length} orders. Offset: ${offset}`);
        return { success: true, processed: meliOrders.length, hasMore: (offset + limit) < (((_c = json.paging) === null || _c === void 0 ? void 0 : _c.total) || 0) };
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