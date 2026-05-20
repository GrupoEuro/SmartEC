/**
 * meli-webhook.ts
 * MercadoLibre real-time webhooks: meliWebhook (onRequest),
 * getMeliRawOrderDebug (HTTP), processAndSaveMeliOrderById/FromData (internal).
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';
import { getValidMeliToken, parseAndSaveMeliOrder } from './meli-shared';

export const meliWebhook = functions.https.onRequest(async (req, res) => {
    try {
        const payload = req.body;

        // --- 1) Temporary Webhook Activity Log ---
        try {
            await db.collection('meli_webhook_logs').add({
                topic: payload?.topic || 'unknown',
                resource: payload?.resource || 'unknown',
                payload: payload || {},
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (logErr) {
            console.error('[Meli Webhook] Failed to write to log:', logErr);
        }

        // --- 2) Process Orders ---
        if (payload && payload.topic === 'orders_v2' && payload.resource) {
            console.log(`[Meli Webhook] Processing event for resource: ${payload.resource}`);

            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = configDoc.data()?.meli;
            if (!meliConfig || !meliConfig.accessToken) throw new Error('No access token');

            const headers = { 'Authorization': `Bearer ${meliConfig.accessToken}` };

            // Fetch the resource — may be a pack or a single order
            const resourceUrl = `https://api.mercadolibre.com${payload.resource}`;
            const resourceRes = await fetch(resourceUrl, { headers });
            if (!resourceRes.ok) throw new Error(`Failed to fetch resource: ${resourceRes.status}`);
            const resourceData = await resourceRes.json() as any;

            // ── PACK ORDER HANDLING ────────────────────────────────────────────
            // Since 2024 ALL MeLi orders are pack orders.
            // The webhook resource may point to /orders/{pack_id} OR /orders/{order_id}.
            // A pack response has `orders` array; an individual order has `order_items`.
            // We collect the real individual order ID(s) to process.
            let singleOrderId: string | null = null;

            if (resourceData.order_items) {
                // This IS an individual order already — use its id directly
                singleOrderId = String(resourceData.id);
            } else if (resourceData.orders && Array.isArray(resourceData.orders)) {
                // This is a pack — process each individual order inside
                for (const packOrder of resourceData.orders) {
                    const orderId = String(packOrder.id || packOrder.order_id);
                    await processAndSaveMeliOrderById(orderId, meliConfig.accessToken, headers);
                }
            } else if (payload.resource.includes('/orders/')) {
                // Unknown shape — extract the ID from the URL and try fetching directly
                const idMatch = payload.resource.match(/\/orders\/(\d+)/);
                if (idMatch) singleOrderId = idMatch[1];
            }

            if (singleOrderId) {
                const moRes = await fetch(`https://api.mercadolibre.com/orders/${singleOrderId}`, { headers });
                if (!moRes.ok) throw new Error(`Failed to fetch order ${singleOrderId}: ${moRes.status}`);
                const mo = await moRes.json() as any;
                await processAndSaveMeliOrderFromData(mo, meliConfig.accessToken, headers);
            }
        }

        // --- 3) Process Messages (Post-sale) & Questions (Pre-sale) ---
        if (payload && (payload.topic === 'messages' || payload.topic === 'questions') && payload.resource) {
            console.log(`[Meli Webhook] Processing ${payload.topic} for resource: ${payload.resource}`);

            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = configDoc.data()?.meli;
            if (!meliConfig || !meliConfig.accessToken) throw new Error('No access token');

            const headers = { 'Authorization': `Bearer ${meliConfig.accessToken}` };
            const resourceUrl = `https://api.mercadolibre.com${payload.resource}`;

            try {
                const resourceRes = await fetch(resourceUrl, { headers });
                if (resourceRes.ok) {
                    const messageData = await resourceRes.json() as any;

                    // Generate a safe document ID from the resource path (e.g., /messages/123 -> _messages_123)
                    const docId = payload.resource.replace(/[^a-zA-Z0-9]/g, '_');

                    await db.collection('meli_communications').doc(docId).set({
                        topic: payload.topic,
                        resource: payload.resource,
                        data: messageData,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        // Easily indexable metadata for future analytics
                        senderId: messageData.from?.user_id || messageData.sender_id || null,
                        orderId: messageData.message_attachments?.pack_id || messageData.message_attachments?.order_id || null,
                        itemId: messageData.item_id || null,
                        status: messageData.status || null
                    }, { merge: true }); // merge: true guarantees we never erase data if ML pings twice

                    console.log(`[Meli Webhook] Successfully stored ${payload.topic} data for ${payload.resource}`);
                } else {
                    console.error(`[Meli Webhook] Failed to fetch ${payload.topic}: ${resourceRes.status}`);
                }
            } catch (err) {
                console.error(`[Meli Webhook] Error fetching ${payload.topic}:`, err);
            }
        }
    } catch (err: any) {
        console.error('[Meli Webhook] Error processing payload:', err);
    } finally {
        res.status(200).send('OK');
    }
});

// ── Webhook helpers ─────────────────────────────────────────────────────────

async function processAndSaveMeliOrderById(orderId: string, token: string, headers: any) {
    const moRes = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, { headers });
    if (!moRes.ok) {
        console.error(`[Meli Webhook] Could not fetch order ${orderId}: ${moRes.status}`);
        return;
    }
    const mo = await moRes.json() as any;
    await processAndSaveMeliOrderFromData(mo, token, headers);
}

async function processAndSaveMeliOrderFromData(mo: any, token: string, headers: any) {
    // Fetch shipment
    let shipData = null;
    if (mo.shipping?.id) {
        const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
            headers: { ...headers, 'x-format-new': 'true' }
        });
        if (sRes.ok) shipData = await sRes.json();
    }

    // Fetch billing info (v2 for Mexico, fallback v1)
    let billingData = null;
    try {
        const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
            headers: { ...headers, 'x-version': '2' }
        });
        if (bRes.ok) billingData = await bRes.json();
        else {
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, { headers });
            if (bRes1.ok) billingData = await bRes1.json();
        }
    } catch (e) { /* non-critical */ }

    // ── Shipment Costs (same 4-source chain as meliSyncOrders) ────────────────
    let shipCosts: { seller_cost: number; gross_amount: number; buyer_cost: number; meli_subsidy: number } | null = null;
    if (mo.shipping?.id) {
        try {
            const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, { headers });
            if (cRes.ok) {
                const costsJson = await cRes.json() as any;
                const senderCost: number  = costsJson?.senders?.[0]?.cost ?? 0;
                const grossAmount: number = costsJson?.gross_amount ?? 0;
                const buyerCost: number   = costsJson?.buyer_cost ?? costsJson?.buyers?.[0]?.cost ?? 0;
                const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                    .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                shipCosts = { seller_cost: senderCost, gross_amount: grossAmount, buyer_cost: buyerCost, meli_subsidy: meliSubsidy };
            }
        } catch (_) { /* non-critical */ }
    }

    // ── MercadoPago Payment API (CFF ground truth for Full) ───────────────────
    let mpPayment: { shipping_amount: number; mp_fee: number; net_received_amount: number } | null = null;
    const paymentId = mo.payments?.[0]?.id;
    if (paymentId) {
        try {
            const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers });
            if (mpRes.ok) {
                const mpData = await mpRes.json() as any;
                const col = mpData?.collection ?? mpData;
                mpPayment = {
                    shipping_amount: col?.shipping_amount ?? 0,
                    mp_fee: (col?.fee_details || [])
                        .filter((f: any) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                        .reduce((s: number, f: any) => s + (f.amount || 0), 0),
                    net_received_amount: col?.net_received_amount ?? col?.net_amount ?? 0,
                };
            }
        } catch (_) { /* non-critical */ }
    }

    const newOrder = parseAndSaveMeliOrder(mo, shipData, billingData);

    // ── Resolve shipping seller cost ─────────────────────────────────────────
    const mpShipAmount:  number = mpPayment?.shipping_amount  ?? 0;
    const buyerShipCost: number = shipCosts?.buyer_cost        ?? 0;
    const shippingSellerCost: number = (() => {
        const fromCosts = shipCosts?.seller_cost ?? 0;
        if (fromCosts > 0) return fromCosts;
        if (mpShipAmount > 0) {
            if (newOrder.fulfillmentType === 'platform') return mpShipAmount;
            if (mpShipAmount > buyerShipCost) return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
        }
        const fromOrder = (newOrder as any).orderShippingCost ?? 0;
        if (fromOrder > 0) return fromOrder;
        return 0;
    })();
    const shippingGrossAmount: number = shipCosts?.gross_amount ?? mpShipAmount;
    const shippingMeliSubsidy: number = shipCosts?.meli_subsidy ?? 0;
    const cffPending: boolean = newOrder.fulfillmentType === 'platform' && shippingSellerCost === 0 && mpShipAmount === 0;

    // ── SAT tax retentions ───────────────────────────────────────────────────
    const IVA_INCLUSIVE_DIVISOR = 1.16;
    const totalAmount:   number = newOrder.total ?? 0;
    const preIvaAmount:  number = totalAmount / IVA_INCLUSIVE_DIVISOR;
    const retencionIVA:  number = Math.round(preIvaAmount * 0.08  * 100) / 100;
    const retencionISR:  number = Math.round(preIvaAmount * 0.025 * 100) / 100;
    const meliCommission: number = (newOrder as any).marketplaceFee ?? 0;
    const refundedAmount: number = (newOrder as any).refundedAmount ?? 0;
    const mlBonus: number        = (newOrder as any).mlBonus ?? 0;
    const netReceipt: number = Math.round(Math.max(0,
        totalAmount - meliCommission - retencionIVA - retencionISR
        - shippingSellerCost - refundedAmount + mlBonus
    ) * 100) / 100;

    // Merge financial fields into the order before saving
    const orderWithFinancials = {
        ...newOrder,
        shipping_seller_cost:  shippingSellerCost,
        shipping_gross_amount: shippingGrossAmount,
        shipping_meli_subsidy: shippingMeliSubsidy,
        mp_shipping_amount:    mpShipAmount,
        buyer_shipping_cost:   buyerShipCost,
        cff_pending:           cffPending,
        retencion_iva:         retencionIVA,
        retencion_isr:         retencionISR,
        total_impuestos:       retencionIVA + retencionISR,
        refunded_amount:       refundedAmount,
        ml_bonus:              mlBonus,
        net_receipt:           netReceipt,
    };

    // Use the REAL individual order id (what the seller sees on MeLi) as the doc key
    const orderRef = db.collection('orders').doc(`meli_${mo.id}`);

    // Preserve the original human-readable buyer name on webhook updates.
    // MeLi anonymizes buyer.first_name/last_name on older orders — we protect the
    // first name received so the UI always shows the readable version.
    try {
        const existingSnap = await orderRef.get();
        const existingOrigName = existingSnap.data()?.customer?.originalName;
        const isAnonW = (s: string) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
        if (existingOrigName && !isAnonW(existingOrigName)) {
            orderWithFinancials.customer.originalName = existingOrigName;
        } else if (existingOrigName && isAnonW(existingOrigName) && !isAnonW(orderWithFinancials.customer.originalName)) {
            // Upgrade: stored was anonymized, new is readable — keep new one
        } else if (existingOrigName) {
            orderWithFinancials.customer.originalName = existingOrigName;
        }
    } catch (_) { /* non-critical — proceed without preservation */ }

    await orderRef.set(orderWithFinancials, { merge: true });

    console.log(`[Meli Webhook] Saved order ML-${mo.id} with shipping_cost=${shippingSellerCost} net=${netReceipt} (pack_id: ${mo.pack_id || 'n/a'})`);
}

export const getMeliRawOrderDebug = functions.https.onRequest(async (req: any, res: any) => {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }

        // Fetch ALL 2026 orders starting late Dec 2025 to catch timezone bleed (Mexico vs Argentina vs UTC)
        let offset = 0;
        const limit = 50;
        let hasMore = true;
        const allOrders: any[] = [];

        while (hasMore && offset < 2000) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&order.date_created.from=2025-12-30T00:00:00.000-00:00&sort=date_desc&limit=${limit}&offset=${offset}`;
            const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
            if (!apiRes.ok) break;

            const json = await apiRes.json() as any;
            const meliOrders = json.results || [];
            if (meliOrders.length === 0) break;

            allOrders.push(...meliOrders);
            offset += limit;
            if (json.paging && json.paging.total <= allOrders.length) hasMore = false;
        }

        // We want to test different mathematical grouping rules month-by-month for 2026
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const analysis: Record<string, any> = {};

        for (const mo of allOrders) {
            // Group by Mexico Time (UTC-6)
            const dateStr = mo.date_created || mo.date_closed;
            if (!dateStr) continue;

            const dateUTC = new Date(dateStr);
            const dateMX = new Date(dateUTC.getTime() - (6 * 60 * 60 * 1000));

            if (dateMX.getUTCFullYear() !== 2026) continue; // Only care about 2026

            const monthName = months[dateMX.getUTCMonth()];
            if (!analysis[monthName]) {
                analysis[monthName] = {
                    totalAmountIncCancelled: 0,
                    totalAmountActiveOnly: 0,
                    paidAmountActiveOnly: 0,
                    unitPriceSumActiveOnly: 0,
                    totalUnitsActiveOnly: 0,
                    totalUnitsIncCancelled: 0,
                    activeOrderCount: 0,
                    cancelledOrderCount: 0
                };
            }

            const isCancelled = (mo.status === 'cancelled' || mo.status === 'invalid');
            const m = analysis[monthName];

            m.totalAmountIncCancelled += (mo.total_amount || 0);

            let itemsQty = 0;
            let itemsSubtotal = 0;
            if (mo.order_items && Array.isArray(mo.order_items)) {
                mo.order_items.forEach((item: any) => {
                    itemsQty += (item.quantity || 0);
                    itemsSubtotal += (item.quantity * item.unit_price);
                });
            }
            m.totalUnitsIncCancelled += itemsQty;

            if (isCancelled) {
                m.cancelledOrderCount++;
            } else {
                m.activeOrderCount++;
                m.totalAmountActiveOnly += (mo.total_amount || 0);
                m.paidAmountActiveOnly += (mo.paid_amount || 0);
                m.unitPriceSumActiveOnly += itemsSubtotal;
                m.totalUnitsActiveOnly += itemsQty;
            }
        }

        res.status(200).json({
            success: true,
            totalScanned: allOrders.length,
            targetMatches: {
                "User Requested Jan": { sales: 275408, units: 343 },
                "User Requested Feb": { sales: 375912, units: 460 },
                "User Requested Mar": { sales: 170964, units: 216 }
            },
            analysis
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


// ─── Phase 3: Abandoned Cart Detector ────────────────────────────────────────
//
// Scheduled function that runs every 30 minutes.
// Scans `carts/` and `guestCarts/` for docs where:
//   - status is 'active' or 'checkout_started'
//   - lastUpdated is older than ABANDON_THRESHOLD_MS (60 minutes)
//
// On match: sets status = 'abandoned' and writes a cartSnapshot event.
//
// Deploy with: firebase deploy --only functions:detectAbandonedCarts
//
// ─────────────────────────────────────────────────────────────────────────────

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
