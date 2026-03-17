/**
 * Reads the MeLi access token from Firestore REST API (no Admin SDK needed)
 * and calls the 3 MercadoLibre endpoints for order 2000015427160774.
 *
 * Run from: /functions directory with:
 *   FIREBASE_TOKEN=$(firebase login:ci --no-localhost 2>&1 | tail -1) node functions/test_meli_order_data2.js
 * Or with the access token retrieved from `firebase apps:sdkconfig` or curl.
 *
 * Alternatively: just needs the MeLi token directly. Set MELI_TOKEN env var.
 */

const https = require('https');

const ORDER_ID = '2000015427160774';
const MELI_TOKEN = process.env.MELI_TOKEN;

if (!MELI_TOKEN) {
    console.error('Set MELI_TOKEN env var. Get it from Firestore Console → config/integrations → meli.accessToken');
    process.exit(1);
}

function get(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            headers: { 'Authorization': `Bearer ${MELI_TOKEN}`, ...extraHeaders }
        };
        const req = https.get(url, opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                resolve({ status: res.statusCode, body: JSON.parse(data) });
            });
        });
        req.on('error', reject);
    });
}

async function run() {
    // 1. ORDER
    console.log('\n══════════════════════════════════════════');
    console.log('1. GET /orders/' + ORDER_ID);
    console.log('══════════════════════════════════════════');
    const { status: s1, body: order } = await get(`https://api.mercadolibre.com/orders/${ORDER_ID}`);
    console.log('HTTP:', s1);
    console.log('status:', order.status);
    console.log('tags:', order.tags);
    console.log('buyer FULL:', JSON.stringify(order.buyer, null, 2));
    console.log('shipping id:', order.shipping?.id);
    console.log('cancel_detail:', order.cancel_detail);
    console.log('order_items:', JSON.stringify(order.order_items?.map(i => ({
        title: i.item?.title, sku: i.item?.seller_sku, unit_price: i.unit_price, qty: i.quantity, sale_fee: i.sale_fee
    })), null, 2));
    console.log('payments (first):', JSON.stringify(order.payments?.[0], null, 2));

    // 2. SHIPMENT
    const shipId = order.shipping?.id;
    if (shipId) {
        console.log('\n══════════════════════════════════════════');
        console.log('2. GET /shipments/' + shipId);
        console.log('══════════════════════════════════════════');
        const { status: s2, body: ship } = await get(`https://api.mercadolibre.com/shipments/${shipId}`);
        console.log('HTTP:', s2);
        console.log('logistic_type:', ship.logistic_type);
        console.log('status:', ship.status);
        console.log('tracking_number:', ship.tracking_number);
        console.log('receiver_address FULL:', JSON.stringify(ship.receiver_address, null, 2));
        console.log('status_history:', JSON.stringify(ship.status_history, null, 2));
        console.log('comments:', ship.comments);
    }

    // 3. BILLING INFO v2
    console.log('\n══════════════════════════════════════════');
    console.log('3. GET /orders/' + ORDER_ID + '/billing_info [v2]');
    console.log('══════════════════════════════════════════');
    const { status: s3, body: bill2 } = await get(
        `https://api.mercadolibre.com/orders/${ORDER_ID}/billing_info`,
        { 'x-version': '2' }
    );
    console.log('HTTP:', s3);
    console.log('FULL RESPONSE:', JSON.stringify(bill2, null, 2));

    if (s3 !== 200) {
        console.log('\n  → Falling back to v1...');
        const { status: s3b, body: bill1 } = await get(
            `https://api.mercadolibre.com/orders/${ORDER_ID}/billing_info`
        );
        console.log('HTTP v1:', s3b);
        console.log('FULL RESPONSE v1:', JSON.stringify(bill1, null, 2));
    }
}

run().catch(e => { console.error(e); process.exit(1); });
