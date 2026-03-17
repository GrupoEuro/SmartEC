const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

const ORDER_ID = '2000015427160774';

async function testOrderData() {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli;
    if (!meliConfig?.accessToken) {
        console.error('No MeLi token found.');
        process.exit(1);
    }
    const token = meliConfig.accessToken;
    const headers = { 'Authorization': `Bearer ${token}` };

    // ── 1. ORDER (base) ─────────────────────────────────────────────────────
    console.log('\n\n══════════════════════════════════════════');
    console.log('1. GET /orders/' + ORDER_ID);
    console.log('══════════════════════════════════════════');
    const orderRes = await fetch(`https://api.mercadolibre.com/orders/${ORDER_ID}`, { headers });
    const order = await orderRes.json();
    console.log('status:', order.status);
    console.log('buyer:', JSON.stringify(order.buyer, null, 2));
    console.log('shipping id:', order.shipping?.id);
    console.log('cancel_detail:', JSON.stringify(order.cancel_detail, null, 2));
    console.log('tags:', order.tags);
    console.log('order_items:', JSON.stringify(order.order_items?.map(i => ({
        title: i.item?.title,
        seller_sku: i.item?.seller_sku,
        unit_price: i.unit_price,
        quantity: i.quantity,
        sale_fee: i.sale_fee
    })), null, 2));

    // ── 2. SHIPMENT ──────────────────────────────────────────────────────────
    const shipId = order.shipping?.id;
    if (shipId) {
        console.log('\n\n══════════════════════════════════════════');
        console.log('2. GET /shipments/' + shipId);
        console.log('══════════════════════════════════════════');
        const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, { headers });
        const ship = await shipRes.json();
        console.log('logistic_type:', ship.logistic_type);
        console.log('status:', ship.status);
        console.log('tracking_number:', ship.tracking_number);
        console.log('tracking_method:', ship.tracking_method);
        console.log('receiver_address FULL:');
        console.log(JSON.stringify(ship.receiver_address, null, 2));
        console.log('status_history:', JSON.stringify(ship.status_history, null, 2));
    }

    // ── 3. BILLING INFO (v2 → fallback v1) ──────────────────────────────────
    console.log('\n\n══════════════════════════════════════════');
    console.log('3. GET /orders/' + ORDER_ID + '/billing_info');
    console.log('══════════════════════════════════════════');
    // Try v2 first (required for Mexico cart purchases)
    const billV2Res = await fetch(
        `https://api.mercadolibre.com/orders/${ORDER_ID}/billing_info`,
        { headers: { ...headers, 'x-version': '2' } }
    );
    const billV2 = await billV2Res.json();
    console.log('[v2] HTTP status:', billV2Res.status);
    console.log('[v2] body:', JSON.stringify(billV2, null, 2));

    if (billV2Res.status !== 200) {
        // Fallback to v1
        const billV1Res = await fetch(
            `https://api.mercadolibre.com/orders/${ORDER_ID}/billing_info`,
            { headers }
        );
        const billV1 = await billV1Res.json();
        console.log('[v1] HTTP status:', billV1Res.status);
        console.log('[v1] body:', JSON.stringify(billV1, null, 2));
    }

    process.exit(0);
}

testOrderData().catch(e => { console.error(e); process.exit(1); });
