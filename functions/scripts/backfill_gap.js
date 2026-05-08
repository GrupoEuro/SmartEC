/**
 * Direct admin backfill script — uses the same ADC that Firebase CLI uses.
 * Bypasses the callable auth check by using the Admin SDK directly.
 *
 * Run: GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/grupoeuroproy_gmail_com_application_default_credentials.json node functions/scripts/backfill_gap.js
 */

process.env.GOOGLE_APPLICATION_CREDENTIALS = require('os').homedir() + '/.config/firebase/grupoeuroproy_gmail_com_application_default_credentials.json';

const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'tiendapraxis',
});

const db = admin.firestore();

// Gap window: 11:40 PM CST May 6 → 10:40 AM CST May 7
// = 05:40 UTC May 7 → 16:40 UTC May 7
// Add 30-min buffer on each side
const FROM_DATE = '2026-05-07T05:10:00.000-00:00'; // 11:10 PM CST May 6
const TO_DATE   = '2026-05-07T16:50:00.000-00:00'; // 10:50 AM CST May 7

async function parseAndSaveOrder(mo, shipData, billingData) {
    // Replicate parseAndSaveMeliOrder logic inline (simplified)
    let internalStatus = 'pending';
    if (mo.status === 'paid') internalStatus = 'processing';
    const hasDeliveredTag = mo.tags && mo.tags.includes('delivered');
    const realShippingStatus = shipData?.status || mo.shipping?.status;
    if (realShippingStatus === 'shipped') internalStatus = 'shipped';
    if (hasDeliveredTag || realShippingStatus === 'delivered') internalStatus = 'delivered';
    if (mo.status === 'cancelled' || mo.status === 'invalid') internalStatus = 'cancelled';

    return {
        id: `meli_${mo.id}`,
        orderNumber: `ML-${mo.id}`,
        sourceChannel: 'mercadolibre',
        externalOrderId: String(mo.id),
        customer: {
            name: `${mo.buyer?.first_name || ''} ${mo.buyer?.last_name || ''}`.trim() || mo.buyer?.nickname || 'Meli Buyer',
            email: mo.buyer?.email || `${mo.buyer?.id}@mercadolibre.com`,
        },
        status: internalStatus,
        total: mo.total_amount,
        subtotal: mo.total_amount,
        items: (mo.order_items || []).map(item => ({
            productId: item.item.id,
            productName: item.item.title,
            name: item.item.title,
            price: item.unit_price,
            quantity: item.quantity,
            subtotal: item.unit_price * item.quantity,
        })),
        createdAt: mo.date_created ? new Date(mo.date_created) : new Date(),
        updatedAt: mo.date_last_updated ? new Date(mo.date_last_updated) : new Date(),
    };
}

async function main() {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli;

    if (!meliConfig?.accessToken || !meliConfig?.userId) {
        console.error('[Backfill] MeLi config not found.');
        process.exit(1);
    }

    const headers = { 'Authorization': `Bearer ${meliConfig.accessToken}` };
    const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_asc&limit=50&order.date_created.from=${encodeURIComponent(FROM_DATE)}&order.date_created.to=${encodeURIComponent(TO_DATE)}`;

    console.log(`[Backfill] Fetching orders from ${FROM_DATE} to ${TO_DATE}`);
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const err = await res.text();
        console.error('[Backfill] MeLi API error:', res.status, err);
        process.exit(1);
    }

    const json = await res.json();
    const orders = json.results || [];
    console.log(`[Backfill] Found ${orders.length} orders. Saving...`);

    let saved = 0;
    for (const mo of orders) {
        try {
            // Fetch shipment
            let shipData = null;
            if (mo.shipping?.id) {
                const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                    headers: { ...headers, 'x-format-new': 'true' }
                });
                if (sRes.ok) shipData = await sRes.json();
            }

            const orderData = await parseAndSaveOrder(mo, shipData, null);
            await db.collection('orders').doc(`meli_${mo.id}`).set(orderData, { merge: true });
            console.log(`  ✓ Saved ML-${mo.id} | ${mo.date_created} | $${mo.total_amount} | ${mo.status}`);
            saved++;
        } catch (e) {
            console.warn(`  ✗ Skipped ML-${mo.id}:`, e.message);
        }
    }

    console.log(`\n[Backfill] Done. Saved ${saved}/${orders.length} orders.`);

    if (orders.length === 0) {
        console.log('[Backfill] No orders found in that window — the gap may be a real business gap (no sales late night).');
    }

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
