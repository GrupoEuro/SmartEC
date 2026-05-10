/**
 * invoice.ts
 * Facturapi/MeLi billing integration: generateInvoice, testMeliBilling.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';
import { getValidMeliToken } from './meli-shared';

export const generateInvoice = functions
    .runWith({ timeoutSeconds: 90 })
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        return { success: false, message: 'Facturapi module temporarily disabled for MeLi data debugging.' };
    });

// ─── Debug: Test MercadoLibre Billing Info ────────────────────────────────

export const testMeliBilling = functions.https.onRequest(async (req: any, res: any) => {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }

        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=5`;
        const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await apiRes.json() as any;
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
            } else {
                bDataV2 = { error: bRes.status, text: await bRes.text() };
            }

            // Try v1
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
            });
            if (bRes1.ok) {
                bDataV1 = await bRes1.json();
            } else {
                bDataV1 = { error: bRes1.status, text: await bRes1.text() };
            }

            results.push({
                orderId: mo.id,
                buyerName: mo.buyer?.nickname || mo.buyer?.first_name,
                requestedInvoice: !!bDataV2?.billing_info?.doc_number && bDataV2.billing_info.doc_number.toUpperCase() !== 'XAXX010101000',
                rawBillingInfoV2: bDataV2,
                rawBillingInfoV1: bDataV1
            });
        }

        res.json({ success: true, disclaimer: "Raw MercadoLibre API Response", data: results });
    } catch (err: any) {
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

