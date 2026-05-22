/**
 * meli-orders.ts
 * MercadoLibre order sync: meliSyncOrders, meliBackfillShippingCosts,
 * meliAnalyzeHistoricalSync, meliSyncHistorical, meliGetShippingLabel.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';
import { getValidMeliToken, parseAndSaveMeliOrder, processAndSaveMeliOrderFromData } from './meli-shared';

// 4. Sync Orders (Callable)
// Syncs orders from last sync date to now, using a date cursor for accuracy.
export const meliSyncOrders = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }

        // Auto-refresh token before sync
        const accessToken = await getValidMeliToken();

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


        const json = await res.json() as any;
        if (!res.ok) {
            console.error('[Meli] Sync Orders Error:', json);
            throw new Error(JSON.stringify(json));
        }

        const meliOrders = json.results || [];

        // Fetch shipments + shipment costs + billing_info + MP payment in parallel
        const shipmentsMap: any = {};
        const shipmentCostsMap: any = {};  // senders[0].cost = real seller shipping deduction
        const billingMap: any = {};
        const mpPaymentMap: any = {};      // MercadoPago payment detail — authoritative CFF source
        await Promise.all(
            meliOrders
                .map(async (mo: any) => {
                    try {
                        // Shipment details (status, address, SLA, logistic type)
                        if (mo.shipping?.id) {
                            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                                headers: { 'Authorization': `Bearer ${accessToken}`, 'x-format-new': 'true' }
                            });
                            if (sRes.ok) {
                                shipmentsMap[mo.shipping.id] = await sRes.json();
                            } else {
                                console.warn(`[Meli Sync] Shipment ${mo.shipping.id} fetch failed: ${sRes.status}`);
                                shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: mo.shipping?.logistic_type ?? null };
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
                                    const costsJson = await cRes.json() as any;
                                    // senders[0].cost = net cost after MeLi seller-reputation discount
                                    const senderCost: number = costsJson?.senders?.[0]?.cost ?? 0;
                                    const grossAmount: number = costsJson?.gross_amount ?? 0;
                                    // buyer_cost = what the buyer paid for shipping
                                    const buyerCost: number = costsJson?.buyer_cost ?? costsJson?.buyers?.[0]?.cost ?? 0;
                                    // Sum all discounts that MeLi covers (loyalty, mandatory subsidies)
                                    const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                                        .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                                    shipmentCostsMap[mo.shipping.id] = {
                                        seller_cost: senderCost,      // what seller pays (net of discounts)
                                        gross_amount: grossAmount,     // full carrier rate
                                        buyer_cost: buyerCost,         // what buyer paid
                                        meli_subsidy: meliSubsidy,     // what MeLi covers
                                    };
                                }
                            } catch (_) { /* non-critical — skip */ }
                        }

                        // ── MercadoPago Payment API — most authoritative source for CFF ──────
                        // payment.shipping_amount = exact shipping charged by MeLi (incl. Full CFF)
                        // payment.fee_details[] = MP processing fee breakdown
                        // This is the ONLY reliable source for Full fulfillment shipping deductions.
                        const paymentId = mo.payments?.[0]?.id;
                        if (paymentId) {
                            try {
                                const mpRes = await fetch(
                                    `https://api.mercadolibre.com/collections/${paymentId}`,
                                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                                );
                                if (mpRes.ok) {
                                    const mpData = await mpRes.json() as any;
                                    // collection wraps the payment — actual data inside .collection
                                    const col = mpData?.collection ?? mpData;
                                    mpPaymentMap[mo.id] = {
                                        // Total shipping amount in the payment (buyer side + subsidy)
                                        shipping_amount:  col?.shipping_amount  ?? 0,
                                        // MP platform fee (separate from ML marketplace fee)
                                        mp_fee:           (col?.fee_details || [])
                                            .filter((f: any) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                                            .reduce((s: number, f: any) => s + (f.amount || 0), 0),
                                        // Net amount after all deductions
                                        net_received_amount: col?.net_received_amount ?? col?.net_amount ?? 0,
                                    };
                                }
                            } catch (_) { /* non-critical */ }
                        }

                        // Billing info (try v2 for Mexico, fallback v1)
                        const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                            headers: { 'Authorization': `Bearer ${accessToken}`, 'x-version': '2' }
                        });
                        if (bRes.ok) billingMap[mo.id] = await bRes.json();
                        else {
                            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            if (bRes1.ok) billingMap[mo.id] = await bRes1.json();
                        }
                    } catch (e) { /* skip non-critical */ }
                })
        );

        let importedCount = 0;

        // Pre-fetch existing originalName for all orders in parallel (non-blocking)
        const existingNameMap = new Map<string, string>();
        await Promise.all(
            meliOrders.map(async (mo: any) => {
                try {
                    const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                    const orig = snap.data()?.customer?.originalName;
                    if (orig) existingNameMap.set(String(mo.id), orig);
                } catch (_) { /* skip */ }
            })
        );

        for (const mo of meliOrders) {
            const shipData  = mo.shipping?.id ? shipmentsMap[mo.shipping.id]     : null;
            const shipCosts = mo.shipping?.id ? shipmentCostsMap[mo.shipping.id] : null;
            const mpPayment = mpPaymentMap[mo.id] ?? null;

            await processAndSaveMeliOrderFromData(mo, accessToken, {
                shipData,
                billingData: billingMap[mo.id],
                shipCosts,
                mpPayment
            });
            importedCount++;
        }

        // Save lastSyncDate cursor to Firestore
        await db.collection('config').doc('integrations').set({
            meli: { lastSyncDate: new Date().toISOString() }
        }, { merge: true });

        // ── Avg shipping cost aggregation ────────────────────────────────────
        // After saving all orders, compute the real average shipping cost per
        // MeLi listing item ID from all orders that have shipping_seller_cost > 0.
        // Write these back to meli_listings so the Listings tab shows a real number.
        try {
            console.log('[Meli] Computing avg shipping cost per listing from order history...');

            // Query ALL MeLi orders that have a real shipping cost recorded
            const shippingOrdersSnap = await db.collection('orders')
                .where('sourceChannel', '==', 'mercadolibre')
                .where('shipping_seller_cost', '>', 0)
                .get();

            // Group: meliItemId → { totalCost, count, sampleSizes }
            const itemShippingMap = new Map<string, { totalCost: number; count: number; min: number; max: number }>();

            shippingOrdersSnap.docs.forEach(doc => {
                const order = doc.data();
                const cost: number = order.shipping_seller_cost ?? 0;
                if (cost <= 0) return;

                // items[].productId is the MeLi item ID (e.g. MLM123456)
                const items: any[] = order.items || [];
                items.forEach((item: any) => {
                    const itemId: string = item.productId;
                    if (!itemId || !itemId.startsWith('MLM')) return;

                    const existing = itemShippingMap.get(itemId);
                    if (existing) {
                        existing.totalCost += cost;
                        existing.count++;
                        existing.min = Math.min(existing.min, cost);
                        existing.max = Math.max(existing.max, cost);
                    } else {
                        itemShippingMap.set(itemId, { totalCost: cost, count: 1, min: cost, max: cost });
                    }
                });
            });

            if (itemShippingMap.size > 0) {
                // Batch-write avg_shipping_cost back to meli_listings
                const AGG_BATCH_SIZE = 400;
                let aggBatch = db.batch();
                let aggCount = 0;
                let totalUpdated = 0;

                for (const [itemId, stats] of itemShippingMap) {
                    const avg = Math.round((stats.totalCost / stats.count) * 100) / 100;
                    const listingRef = db.collection('meli_listings').doc(itemId);
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
                        aggBatch = db.batch();
                        aggCount = 0;
                    }
                }
                if (aggCount > 0) await aggBatch.commit();

                console.log(`[Meli] ✅ Avg shipping updated for ${totalUpdated} listings from ${shippingOrdersSnap.size} orders.`);
            } else {
                console.log('[Meli] No orders with shipping cost found — skipping avg shipping update.');
            }
        } catch (aggErr: any) {
            // Non-fatal: don't fail the entire sync if aggregation fails
            console.warn('[Meli] Avg shipping aggregation failed (non-fatal):', aggErr?.message ?? aggErr);
        }

        console.log(`[Meli] Successfully synced ${importedCount} orders since ${dateFrom}.`);
        return { success: true, imported: importedCount, totalProcessed: meliOrders.length, syncedFrom: dateFrom };

    } catch (err: any) {
        console.error('[Meli] Sync Orders failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// 4b. Backfill Shipping Costs (Callable)
// One-time fix: finds all MeLi orders that have a shipmentId but shipping_seller_cost = 0 or missing,
// re-fetches /shipments/{id}/costs for each, and writes the real amounts.
// Safe to call multiple times — only updates orders where cost is 0.
export const meliBackfillShippingCosts = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

        try {
            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = configDoc.data()?.meli;
            if (!meliConfig?.accessToken) throw new Error('MeLi not connected.');

            const accessToken = await getValidMeliToken();

            // Find all MeLi orders that have a shipmentId but 0 or missing shipping cost, or are cff_pending
            const ordersSnap = await db.collection('orders')
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
                    const data = doc.data();
                    // Try all possible shipment ID fields
                    const shipmentId: string | null =
                        data.shipmentId || data.shippingId || data.meliShipmentId || null;
                    if (!shipmentId) { skippedCount++; return; }

                    let sellerCost = 0;
                    let grossAmount = 0;
                    let meliSubsidy = 0;
                    let buyerShipCost = 0;

                    try {
                        const cRes = await fetch(
                            `https://api.mercadolibre.com/shipments/${shipmentId}/costs`,
                            { headers: { 'Authorization': `Bearer ${accessToken}` } }
                        );
                        if (cRes.ok) {
                            const costsJson = await cRes.json() as any;
                            sellerCost = costsJson?.senders?.[0]?.cost ?? 0;
                            grossAmount = costsJson?.gross_amount ?? 0;
                            buyerShipCost = costsJson?.buyer_cost ?? costsJson?.buyers?.[0]?.cost ?? 0;
                            meliSubsidy = (costsJson?.senders?.[0]?.discounts || [])
                                .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                        }
                    } catch (e) {
                        console.warn(`[Meli Backfill] Costs API failed for shipment ${shipmentId}:`, e);
                    }

                    // MercadoPago payment API fallback (CFF ground truth for Full)
                    let mpShipAmount = 0;
                    const paymentId = data.payments?.[0]?.id;
                    if (paymentId) {
                        try {
                            const mpRes = await fetch(
                                `https://api.mercadolibre.com/collections/${paymentId}`,
                                { headers: { 'Authorization': `Bearer ${accessToken}` } }
                            );
                            if (mpRes.ok) {
                                const mpData = await mpRes.json() as any;
                                const col = mpData?.collection ?? mpData;
                                mpShipAmount = col?.shipping_amount ?? 0;
                            }
                        } catch (e) {
                            console.warn(`[Meli Backfill] MP payment fetch failed for payment ${paymentId}:`, e);
                        }
                    }

                    // Priority shipping cost resolution logic
                    const shippingSellerCost: number = (() => {
                        if (sellerCost > 0) return sellerCost;
                        if (mpShipAmount > 0) {
                            const isFull = data.fulfillmentType === 'platform';
                            if (isFull) return mpShipAmount;
                            if (mpShipAmount > buyerShipCost) {
                                return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
                            }
                        }
                        const fromOrder = data.orderShippingCost ?? 0;
                        if (fromOrder > 0) return fromOrder;
                        return 0;
                    })();

                    if (shippingSellerCost === 0) { skippedCount++; return; } // No cost available yet (pending shipment)

                    const shippingGrossAmount = grossAmount > 0 ? grossAmount : mpShipAmount;
                    const shippingMeliSubsidy = meliSubsidy;

                    // ── Recompute net_receipt with full formula (backfill path) ───────────────
                    const commission: number  = data.marketplaceFee ?? 0;
                    const total: number       = data.total ?? 0;
                    const preIva: number      = total / 1.16;
                    const retIVA: number      = Math.round(preIva * 0.08  * 100) / 100;
                    const retISR: number      = Math.round(preIva * 0.025 * 100) / 100;
                    const refunded: number    = data.refundedAmount ?? 0;
                    const bonus: number       = data.mlBonus ?? 0;
                    const netReceipt: number  = Math.round(Math.max(0,
                        total - commission - shippingSellerCost - retIVA - retISR - refunded + bonus
                    ) * 100) / 100;

                    await doc.ref.update({
                        shipping_seller_cost: shippingSellerCost,
                        shipping_gross_amount: shippingGrossAmount,
                        shipping_meli_subsidy: shippingMeliSubsidy,
                        mp_shipping_amount: mpShipAmount,
                        buyer_shipping_cost: buyerShipCost,
                        retencion_iva: retIVA,
                        retencion_isr: retISR,
                        total_impuestos: retIVA + retISR,
                        refunded_amount: data.refundedAmount ?? 0,
                        ml_bonus: data.mlBonus ?? 0,
                        cff_pending: false,              // shipping cost now known
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
                const shippingOrdersSnap = await db.collection('orders')
                    .where('sourceChannel', '==', 'mercadolibre')
                    .where('shipping_seller_cost', '>', 0)
                    .get();

                const itemShippingMap = new Map<string, { totalCost: number; count: number; min: number; max: number }>();
                shippingOrdersSnap.docs.forEach(doc => {
                    const order = doc.data();
                    const cost: number = order.shipping_seller_cost ?? 0;
                    if (cost <= 0) return;
                    (order.items || []).forEach((item: any) => {
                        const itemId: string = item.productId;
                        if (!itemId || !itemId.startsWith('MLM')) return;
                        const existing = itemShippingMap.get(itemId);
                        if (existing) {
                            existing.totalCost += cost;
                            existing.count++;
                            existing.min = Math.min(existing.min, cost);
                            existing.max = Math.max(existing.max, cost);
                        } else {
                            itemShippingMap.set(itemId, { totalCost: cost, count: 1, min: cost, max: cost });
                        }
                    });
                });

                if (itemShippingMap.size > 0) {
                    const AGG_BATCH_SIZE = 400;
                    let aggBatch = db.batch();
                    let aggCount = 0;
                    for (const [itemId, stats] of itemShippingMap) {
                        const avg = Math.round((stats.totalCost / stats.count) * 100) / 100;
                        aggBatch.update(db.collection('meli_listings').doc(itemId), {
                            avg_shipping_cost: avg,
                            min_shipping_cost: Math.round(stats.min * 100) / 100,
                            max_shipping_cost: Math.round(stats.max * 100) / 100,
                            shipping_sample_size: stats.count,
                            avg_shipping_updated: admin.firestore.FieldValue.serverTimestamp()
                        });
                        if (++aggCount >= AGG_BATCH_SIZE) {
                            await aggBatch.commit();
                            aggBatch = db.batch();
                            aggCount = 0;
                        }
                    }
                    if (aggCount > 0) await aggBatch.commit();
                    console.log(`[Meli Backfill] ✅ Avg shipping updated for ${itemShippingMap.size} listings.`);
                }
            } catch (aggErr: any) {
                console.warn('[Meli Backfill] Avg aggregation failed (non-fatal):', aggErr?.message);
            }

            return {
                success: true,
                totalMeliOrders: ordersSnap.size,
                ordersNeedingBackfill: toBackfill.length,
                updated: updatedCount,
                skipped: skippedCount,
            };

        } catch (err: any) {
            console.error('[Meli Backfill] Failed:', err);
            throw new functions.https.HttpsError('internal', err.message);
        }
    });

// 5. Analyze Historical Sync (Callable)
// Returns the exact count of historical orders available on MercadoLibre
export const meliAnalyzeHistoricalSync = functions.runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }

        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&limit=1&order.date_created.from=2026-01-01T00:00:00.000-00:00`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });

        const json = await res.json() as any;
        if (!res.ok) throw new Error(JSON.stringify(json));

        const totalRecords = json.paging?.total || 0;
        return { success: true, totalRecords };

    } catch (err: any) {
        console.error('[Meli] Analyze Historical Sync failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// 6. Sync Historical Orders (Callable)
// Syncs a specific chunk of historical orders using Chunked Batching Architecture
export const meliSyncHistorical = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const offset = data.offset || 0;
    const limit = data.limit || 50; // max batch operations is 50 for Meli search API

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }

        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=${limit}&offset=${offset}&order.date_created.from=2026-01-01T00:00:00.000-00:00`;
        console.log(`[Meli Historical Sync] Fetching batch from Meli: ${url}`);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });

        const json = await res.json() as any;
        if (!res.ok) throw new Error(JSON.stringify(json));

        const meliOrders = json.results || [];
        if (meliOrders.length === 0) {
            return { success: true, processed: 0, message: 'No more orders to sync.' };
        }

        // Fetch shipments + shipment costs + billing_info + MP payment in parallel
        const shipmentsMap: any = {};
        const shipmentCostsMap: any = {};
        const billingMap: any = {};
        const mpPaymentMap: any = {};
        await Promise.all(
            meliOrders
                .map(async (mo: any) => {
                    try {
                        if (mo.shipping?.id) {
                            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-format-new': 'true' }
                            });
                            if (sRes.ok) {
                                shipmentsMap[mo.shipping.id] = await sRes.json();
                            } else {
                                console.warn(`[Meli Historical] Shipment ${mo.shipping.id} fetch failed: ${sRes.status} — fulfillmentType may be wrong`);
                                shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: mo.shipping?.logistic_type ?? null };
                            }
                            // /shipments/{id}/costs — exact seller cost for Classic/Flex
                            try {
                                const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, {
                                    headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                                });
                                if (cRes.ok) {
                                    const costsJson = await cRes.json() as any;
                                    const senderCost: number = costsJson?.senders?.[0]?.cost ?? 0;
                                    const grossAmount: number = costsJson?.gross_amount ?? 0;
                                    const buyerCost: number  = costsJson?.buyer_cost ?? costsJson?.buyers?.[0]?.cost ?? 0;
                                    const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                                        .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                                    shipmentCostsMap[mo.shipping.id] = { seller_cost: senderCost, gross_amount: grossAmount, buyer_cost: buyerCost, meli_subsidy: meliSubsidy };
                                }
                            } catch (_) { /* skip */ }
                        }
                        // /collections/{paymentId} — MP ground truth for Full CFF
                        const paymentId = mo.payments?.[0]?.id;
                        if (paymentId) {
                            try {
                                const mpRes = await fetch(
                                    `https://api.mercadolibre.com/collections/${paymentId}`,
                                    { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } }
                                );
                                if (mpRes.ok) {
                                    const mpData = await mpRes.json() as any;
                                    const col = mpData?.collection ?? mpData;
                                    mpPaymentMap[mo.id] = {
                                        shipping_amount: col?.shipping_amount ?? 0,
                                        mp_fee: (col?.fee_details || [])
                                            .filter((f: any) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                                            .reduce((s: number, f: any) => s + (f.amount || 0), 0),
                                        net_received_amount: col?.net_received_amount ?? col?.net_amount ?? 0,
                                    };
                                }
                            } catch (_) { /* skip */ }
                        }
                        const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                            headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' }
                        });
                        if (bRes.ok) billingMap[mo.id] = await bRes.json();
                        else {
                            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                            });
                            if (bRes1.ok) billingMap[mo.id] = await bRes1.json();
                        }
                    } catch (e) { /* skip */ }
                })
        );

        await Promise.all(
            meliOrders.map(async (mo: any) => {
                const shipData  = mo.shipping?.id ? shipmentsMap[mo.shipping.id]     : null;
                const shipCosts = mo.shipping?.id ? shipmentCostsMap[mo.shipping.id] : null;
                const mpPayment = mpPaymentMap[mo.id] ?? null;

                await processAndSaveMeliOrderFromData(mo, meliConfig.accessToken, {
                    shipData,
                    billingData: billingMap[mo.id],
                    shipCosts,
                    mpPayment
                });
            })
        );

        console.log(`[Meli Historical Sync] Batched ${meliOrders.length} orders. Offset: ${offset}`);
        return { success: true, processed: meliOrders.length, hasMore: (offset + limit) < (json.paging?.total || 0) };

    } catch (err: any) {
        console.error('[Meli Historical Sync] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// 7. Temporary Debug Endpoint to Check Order JSON Payload Structure
export const testMeliApi = functions.runWith({ timeoutSeconds: 120 }).https.onRequest(async (req, res) => {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).send('MercadoLibre not configured.');
            return;
        }

        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&limit=10&offset=0`;
        const mRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await mRes.json() as any;
        const orders = json.results || [];

        // Return the raw shipping object from the first few orders
        const shippingSamples = orders.slice(0, 3).map((o: any) => ({
            order_id: o.id,
            status: o.status,
            tags: o.tags,
            shipping: o.shipping
        }));

        // Also fetch one individual shipment to check structure
        let individualShipment = null;
        if (orders[0]?.shipping?.id) {
            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${orders[0].shipping.id}`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-format-new': 'true' }
            });
            individualShipment = await sRes.json();
        }

        res.json({ success: true, shippingSamples, individualShipment });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
// 8. Get Meli Shipping Label (Callable)
// MercadoLibre only allows getting labels for Meli Classic (merchant fulfilled) orders.
export const meliGetShippingLabel = functions.runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const shippingId = data.shippingId;
    if (!shippingId) throw new functions.https.HttpsError('invalid-argument', 'shippingId is required');

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }

        const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shippingId}&response_type=pdf`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });

        if (!res.ok) {
            const errJson = await res.json() as any;
            throw new Error(errJson.message || 'Failed to fetch shipping label from MercadoLibre.');
        }

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Pdf = buffer.toString('base64');

        return { success: true, pdfBase64: base64Pdf };
    } catch (err: any) {
        console.error('[Meli Label] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// ─── MercadoLibre Full Inventory Sync ───────────────────────────────────────

