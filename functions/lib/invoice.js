"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testMeliBilling = exports.generateInvoice = void 0;
/**
 * invoice.ts
 * Facturapi/MeLi billing integration: generateInvoice, testMeliBilling.
 */
const functions = require("firebase-functions");
const shared_1 = require("./shared");
exports.generateInvoice = functions
    .runWith({ timeoutSeconds: 90 })
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    return { success: false, message: 'Facturapi module temporarily disabled for MeLi data debugging.' };
});
// ─── Debug: Test MercadoLibre Billing Info ────────────────────────────────
exports.testMeliBilling = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=5`;
        const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await apiRes.json();
        const meliOrders = json.results || [];
        const results = [];
        for (const mo of meliOrders) {
            let bDataV2 = null;
            let bDataV1 = null;
            // Try v2
            const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' }
            });
            if (bRes.ok) {
                bDataV2 = await bRes.json();
            }
            else {
                bDataV2 = { error: bRes.status, text: await bRes.text() };
            }
            // Try v1
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
            });
            if (bRes1.ok) {
                bDataV1 = await bRes1.json();
            }
            else {
                bDataV1 = { error: bRes1.status, text: await bRes1.text() };
            }
            results.push({
                orderId: mo.id,
                buyerName: ((_b = mo.buyer) === null || _b === void 0 ? void 0 : _b.nickname) || ((_c = mo.buyer) === null || _c === void 0 ? void 0 : _c.first_name),
                requestedInvoice: !!((_d = bDataV2 === null || bDataV2 === void 0 ? void 0 : bDataV2.billing_info) === null || _d === void 0 ? void 0 : _d.doc_number) && bDataV2.billing_info.doc_number.toUpperCase() !== 'XAXX010101000',
                rawBillingInfoV2: bDataV2,
                rawBillingInfoV1: bDataV1
            });
        }
        res.json({ success: true, disclaimer: "Raw MercadoLibre API Response", data: results });
    }
    catch (err) {
        console.error('Debug endpoint error:', err);
        res.status(500).json({ error: err.message });
    }
});
// ─── backfillOrdersToBigQuery — callable ──────────────────────────────────────
//
// Loads ALL historical orders + order_items into BigQuery tables.
// Tables: euro_analytics.orders  /  euro_analytics.order_items
// Both are DATE-partitioned (order_date) and clustered by source_channel.
//
// BigQuery is created on the fly if it doesn't exist.
// Run once after deploy; the dailyStats cron keeps it up to date thereafter.
//
// Returns: { ordersWritten, itemsWritten, dataset }
// ─────────────────────────────────────────────────────────────────────────────
//# sourceMappingURL=invoice.js.map