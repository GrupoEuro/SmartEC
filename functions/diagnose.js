/**
 * diagnose.js — Local address diagnostic
 * Run: GOOGLE_CLOUD_PROJECT=tiendapraxis node diagnose.js
 * Reads Firestore + calls MeLi API directly. No Cloud Function. No CORS.
 */
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'tiendapraxis' });
const db = admin.firestore();

async function main() {
    console.log('\n🔍 [Diagnostic] Starting — reading Firestore + MeLi API...\n');

    // 1. Get MeLi access token from Firestore config
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliToken = configDoc.data()?.meli?.accessToken;
    if (!meliToken) { console.error('❌ No MeLi accessToken in config/integrations'); process.exit(1); }
    console.log('✅ MeLi token found\n');

    const headers = { 'Authorization': `Bearer ${meliToken}` };

    // 2. Read last 80 orders (no composite index needed — single field orderBy)
    const snap = await db.collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(80)
        .get();

    const all   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const meli  = all.filter(d => d.sourceChannel === 'mercadolibre');
    const noState = meli.filter(d => !String(d.shippingAddress?.state ?? '').trim());
    const hasState = meli.filter(d =>  String(d.shippingAddress?.state ?? '').trim());

    console.log(`📦 Orders read      : ${snap.size}`);
    console.log(`🛒 MeLi orders      : ${meli.length}`);
    console.log(`❌ Missing state    : ${noState.length}`);
    console.log(`✅ Has state        : ${hasState.length}\n`);

    if (noState.length === 0) {
        console.log('🎉 All sampled MeLi orders already have state!');
        process.exit(0);
    }

    // 3. Sample up to 5 orders missing state and probe MeLi APIs
    const sample = noState.slice(0, 5);
    console.log(`\n--- Probing ${sample.length} orders without state ---\n`);

    for (const order of sample) {
        const shipId  = String(order.shippingId || order.meliShipmentId || '');
        const meliOId = order.id.startsWith('meli_') ? order.id.replace('meli_', '') : '';

        console.log(`┌─ ${order.id}`);
        console.log(`│  shipId       : ${shipId  || '⚠️  MISSING'}`);
        console.log(`│  meliOrderId  : ${meliOId || '⚠️  MISSING'}`);
        console.log(`│  currentState : ${order.shippingAddress?.state  || '(empty)'}`);
        console.log(`│  currentCity  : ${order.shippingAddress?.city   || '(empty)'}`);
        console.log(`│  currentZip   : ${order.shippingAddress?.zipCode || '(empty)'}`);

        // API 1: /shipments/{id}
        if (shipId) {
            try {
                const r = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`,
                    { headers: { ...headers, 'x-format-new': 'true' } });
                const j = r.ok ? await r.json() : null;
                const ra = j?.receiver_address;
                console.log(`│  /shipments    : HTTP ${r.status} | logisticType=${j?.logistic_type} | hasRecvAddr=${!!ra}`);
                if (ra) {
                    console.log(`│    state       : ${ra.state?.name        ?? '(missing)'}`);
                    console.log(`│    city        : ${ra.city?.name ?? ra.municipality?.name ?? '(missing)'}`);
                    console.log(`│    zip         : ${ra.zip_code            ?? '(missing)'}`);
                    console.log(`│    rawSnippet  : ${JSON.stringify(ra).slice(0, 200)}`);
                } else {
                    console.log(`│    receiver_address is NULL`);
                    if (j) console.log(`│    rawResponse : ${JSON.stringify(j).slice(0, 300)}`);
                }
            } catch(e) { console.log(`│  /shipments    : ERROR ${e.message}`); }
        } else {
            console.log(`│  /shipments    : SKIPPED — no shippingId`);
        }

        // API 2: /orders/{id}/billing_info
        if (meliOId) {
            try {
                const r = await fetch(`https://api.mercadolibre.com/orders/${meliOId}/billing_info`,
                    { headers: { ...headers, 'x-version': '2' } });
                const j = r.ok ? await r.json() : null;
                const ba = j?.billing_info?.address ?? j?.address ?? null;
                console.log(`│  /billing_info : HTTP ${r.status} | hasAddr=${!!ba}`);
                if (ba) {
                    console.log(`│    state       : ${ba.state?.name ?? '(missing)'}`);
                    console.log(`│    city        : ${ba.city?.name  ?? '(missing)'}`);
                    console.log(`│    zip         : ${ba.zip_code    ?? '(missing)'}`);
                } else {
                    console.log(`│    rawResponse : ${JSON.stringify(j).slice(0, 300)}`);
                }
            } catch(e) { console.log(`│  /billing_info : ERROR ${e.message}`); }
        } else {
            console.log(`│  /billing_info : SKIPPED — cannot extract orderId`);
        }

        // API 3: GET /orders/{id} — the full order resource embeds receiver_address directly
        if (meliOId) {
            try {
                const r = await fetch(`https://api.mercadolibre.com/orders/${meliOId}`,
                    { headers });
                const j = r.ok ? await r.json() : null;
                const sa  = j?.shipping;
                const ra  = sa?.receiver_address;
                console.log(`│  /orders (full): HTTP ${r.status} | shipping.id=${sa?.id ?? 'n/a'}`);
                if (ra) {
                    console.log(`│    state       : ${ra.state?.name ?? '(missing)'}`);
                    console.log(`│    city        : ${ra.city?.name  ?? '(missing)'}`);
                    console.log(`│    zip         : ${ra.zip_code    ?? '(missing)'}`);
                    console.log(`│    rawSnippet  : ${JSON.stringify(ra).slice(0, 200)}`);
                } else {
                    console.log(`│    shipping.receiver_address is NULL`);
                    if (sa) console.log(`│    shipping keys: ${Object.keys(sa).join(', ')}`);
                }
            } catch(e) { console.log(`│  /orders (full): ERROR ${e.message}`); }
        }

    }

    process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
