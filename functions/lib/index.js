"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMeliRawOrderDebug = exports.meliWebhook = exports.meliSyncOrdersCron = exports.meliSyncFullInventory = exports.meliGetShippingLabel = exports.testMeliApi = exports.meliSyncHistorical = exports.meliAnalyzeHistoricalSync = exports.meliSyncOrders = exports.meliRefreshTokenScheduled = exports.meliCallback = exports.meliAuthUrl = exports.skydropxGetTracking = exports.skydropxCreateLabel = exports.skydropxGetRates = exports.backfillUserClaims = exports.syncUserClaims = exports.processPayment = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mercadopago_1 = require("mercadopago");
admin.initializeApp();
const db = admin.firestore();
// ─── MercadoPago Payment Processing ─────────────────────────────────────────
exports.processPayment = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to process a payment.');
    }
    const { token, amount, email, description, orderId, installments, paymentMethodId, issuerId } = data;
    if (!token || !amount || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required payment parameters.');
    }
    let accessToken = process.env.MP_ACCESS_TOKEN;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const mpConfig = ((_a = integrationsDoc.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) || {};
            if (mpConfig.accessToken) {
                accessToken = mpConfig.accessToken;
            }
        }
    }
    catch (err) {
        console.warn('Could not read MP keys from config/integrations', err);
    }
    if (!accessToken) {
        console.error("Missing MP_ACCESS_TOKEN");
        throw new functions.https.HttpsError('internal', 'Server configuration error. Missing Access Token.');
    }
    const client = new mercadopago_1.MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
    const payment = new mercadopago_1.Payment(client);
    try {
        const paymentData = {
            transaction_amount: Number(amount),
            token: token,
            description: description || 'Storefront Order',
            installments: Number(installments) || 1,
            payment_method_id: paymentMethodId,
            issuer_id: issuerId,
            payer: { email },
            metadata: { order_id: orderId || '' }
        };
        const result = await payment.create({ body: paymentData });
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: result.status,
                paymentId: result.id,
                paymentMethod: result.payment_method_id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.error("Failed to update order status:", err));
        }
        return { success: true, status: result.status, paymentId: result.id, statusDetail: result.status_detail };
    }
    catch (error) {
        console.error('MercadoPago Payment Create Error:', error);
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError: error.message || 'Unknown processing error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.error("Failed to update rejected status:", err));
        }
        throw new functions.https.HttpsError('internal', error.message || 'Payment processing failed.');
    }
});
// ─── Firebase Custom Claims: Role Sync ───────────────────────────────────────
//
// This function triggers whenever a user document in `users/{uid}` is written.
// It reads the `role` field and sets it as a Custom Claim on the Firebase Auth
// token, making `request.auth.token.role` available in all Firestore rules.
//
// Valid roles: SUPER_ADMIN | ADMIN | MANAGER | STAFF | CUSTOMER
//
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER'];
exports.syncUserClaims = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
    const uid = context.params.uid;
    // Document was deleted — revoke claims
    if (!change.after.exists) {
        await admin.auth().setCustomUserClaims(uid, { role: null });
        console.log(`[Claims] Cleared claims for deleted user: ${uid}`);
        return;
    }
    const data = change.after.data();
    if (!data)
        return;
    const role = VALID_ROLES.includes(data.role) ? data.role : 'CUSTOMER';
    try {
        await admin.auth().setCustomUserClaims(uid, { role });
        console.log(`[Claims] Set role='${role}' for uid=${uid}`);
    }
    catch (err) {
        console.error(`[Claims] Failed to set claim for uid=${uid}:`, err);
    }
});
// ─── Backfill: Set Custom Claims for All Existing Users ──────────────────────
//
// Call this ONE TIME via Firebase Console or CLI after deploying to push Claims
// to all existing users who had roles set before this function existed.
// Only callable by SUPER_ADMIN (verified via existing claims or first-run flag).
//
exports.backfillUserClaims = functions.https.onCall(async (data, context) => {
    var _a, _b;
    // Only allow this to run if the caller is already SUPER_ADMIN
    // OR if there are no admin claims yet (first-time setup)
    const callerRole = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'SUPER_ADMIN') {
        throw new functions.https.HttpsError('permission-denied', 'Only SUPER_ADMIN can trigger the claims backfill.');
    }
    const usersSnapshot = await db.collection('users').get();
    const results = [];
    for (const doc of usersSnapshot.docs) {
        const userData = doc.data();
        const uid = doc.id;
        const role = VALID_ROLES.includes(userData.role) ? userData.role : 'CUSTOMER';
        const email = userData.email || 'unknown';
        try {
            await admin.auth().setCustomUserClaims(uid, { role });
            results.push({ uid, email, role, status: 'ok' });
        }
        catch (err) {
            results.push({ uid, email, role, status: `error: ${err.message}` });
        }
    }
    console.log(`[Claims Backfill] Processed ${results.length} users.`);
    return { processed: results.length, results };
});
// ─── SkyDropX PRO: Shipping Integration ───────────────────────────────────────
//
// Proxies all SkyDropX PRO API calls — API key never hits the browser.
//
// Set these environment variables before deploying (add to .env or Secret Manager):
//   SKYDROPX_API_KEY           = <from SkyDropX PRO dashboard › Conexiones › API>
//   SKYDROPX_ORIGIN_NAME       = Importadora Euro
//   SKYDROPX_ORIGIN_PHONE      = +524441234567
//   SKYDROPX_ORIGIN_STREET     = Av. Salvador Nava
//   SKYDROPX_ORIGIN_NUMBER     = 804
//   SKYDROPX_ORIGIN_COLONIA    = Col. Nuevo Paseo
//   SKYDROPX_ORIGIN_CITY       = San Luis Potosí
//   SKYDROPX_ORIGIN_STATE      = San Luis Potosí
//   SKYDROPX_ORIGIN_ZIPCODE    = 78140
//   SKYDROPX_ORIGIN_COUNTRY    = MX
//
// ─────────────────────────────────────────────────────────────────────────────
const SKYDROPX_BASE = 'https://api.skydropx.com/v1';
async function skydropxHeaders() {
    var _a;
    let apiKey = process.env.SKYDROPX_API_KEY;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const skydropxConfig = ((_a = integrationsDoc.data()) === null || _a === void 0 ? void 0 : _a.skydropx) || {};
            if (skydropxConfig.apiKey) {
                apiKey = skydropxConfig.apiKey;
            }
        }
    }
    catch (err) {
        console.warn('Could not read SkyDropX API key from config/integrations', err);
    }
    if (!apiKey)
        throw new functions.https.HttpsError('internal', 'SkyDropX API key not configured.');
    return {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
}
/**
 * Builds the origin address for SkyDropX.
 * Priority:
 *   1. config/shipping document in Firestore  (structured, managed from admin panel)
 *   2. config/website general fields           (phone, email, companyName)
 *   3. Environment variable fallbacks
 *   4. Hardcoded defaults (Av. Salvador Nava 704-1)
 */
async function originAddress() {
    var _a, _b;
    let companyName = process.env.SKYDROPX_ORIGIN_NAME || 'Importadora Euro';
    let phone = process.env.SKYDROPX_ORIGIN_PHONE || '';
    let email = 'ventas@importadoraeuro.com';
    let street = process.env.SKYDROPX_ORIGIN_STREET || 'Av. Salvador Nava';
    let number = process.env.SKYDROPX_ORIGIN_NUMBER || '704-1';
    let colonia = process.env.SKYDROPX_ORIGIN_COLONIA || 'Col. Nuevo Paseo';
    let city = process.env.SKYDROPX_ORIGIN_CITY || 'San Luis Potosí';
    let province = process.env.SKYDROPX_ORIGIN_STATE || 'San Luis Potosí';
    let zip = process.env.SKYDROPX_ORIGIN_ZIPCODE || '78140';
    try {
        // 1. Try config/website for company name, phone and email
        const websiteDoc = await db.collection('config').doc('website').get();
        if (websiteDoc.exists) {
            const general = ((_a = websiteDoc.data()) === null || _a === void 0 ? void 0 : _a.general) || {};
            if (general.companyName)
                companyName = general.companyName;
            if (general.phone)
                phone = general.phone;
            if (general.email)
                email = general.email;
        }
        // 2. Try config/shipping for full structured origin address
        const shippingDoc = await db.collection('config').doc('shipping').get();
        if (shippingDoc.exists) {
            const origin = ((_b = shippingDoc.data()) === null || _b === void 0 ? void 0 : _b.origin) || {};
            if (origin.street)
                street = origin.street;
            if (origin.number)
                number = origin.number;
            if (origin.colonia)
                colonia = origin.colonia;
            if (origin.city)
                city = origin.city;
            if (origin.province)
                province = origin.province;
            if (origin.zip)
                zip = origin.zip;
        }
    }
    catch (err) {
        console.warn('[SkyDropX] Could not read Firestore config, using defaults:', err);
    }
    return {
        name: companyName,
        company: companyName,
        phone,
        email,
        address1: `${street} ${number}`,
        address2: colonia,
        city,
        province,
        zip,
        country_code: process.env.SKYDROPX_ORIGIN_COUNTRY || 'MX',
    };
}
// ── 1. Get Shipping Rates ──────────────────────────────────────────────────────
// Calls POST /quotations, waits 2.5s for async processing, then fetches rates.
exports.skydropxGetRates = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { orderId, parcel, addressTo } = data;
    if (!parcel)
        throw new functions.https.HttpsError('invalid-argument', 'parcel required.');
    if (!orderId && !(addressTo === null || addressTo === void 0 ? void 0 : addressTo.zip))
        throw new functions.https.HttpsError('invalid-argument', 'orderId or addressTo with a zip code required.');
    let finalAddressTo = addressTo;
    if (orderId && !finalAddressTo) {
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists)
            throw new functions.https.HttpsError('not-found', 'Order not found.');
        const order = orderDoc.data();
        const addr = order.shippingAddress;
        finalAddressTo = {
            name: ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.name) || 'Cliente',
            phone: ((_b = order.customer) === null || _b === void 0 ? void 0 : _b.phone) || '',
            email: ((_c = order.customer) === null || _c === void 0 ? void 0 : _c.email) || '',
            address1: `${addr.street} ${addr.exteriorNumber}`,
            address2: addr.colonia || '',
            city: addr.city,
            province: addr.state,
            zip: addr.zipCode,
            country_code: 'MX',
        };
    }
    const body = {
        address_from: await originAddress(),
        address_to: finalAddressTo,
        parcel: {
            mass_unit: 'kg',
            distance_unit: 'cm',
            weight: parcel.weight || 5,
            height: parcel.height || 30,
            width: parcel.width || 30,
            length: parcel.length || 20,
        },
    };
    try {
        // Create quotation
        const quoteRes = await fetch(`${SKYDROPX_BASE}/quotations`, {
            method: 'POST',
            headers: await skydropxHeaders(),
            body: JSON.stringify(body),
        });
        const quoteJson = await quoteRes.json();
        if (!quoteRes.ok)
            throw new Error(`Quotation failed: ${JSON.stringify(quoteJson)}`);
        const quotationId = (_d = quoteJson.data) === null || _d === void 0 ? void 0 : _d.id;
        if (!quotationId)
            throw new Error('No quotation ID returned from SkyDropX.');
        // SkyDropX processes rates asynchronously — poll after short wait
        await new Promise(r => setTimeout(r, 2500));
        const ratesRes = await fetch(`${SKYDROPX_BASE}/quotations/${quotationId}`, {
            headers: await skydropxHeaders(),
        });
        const ratesJson = await ratesRes.json();
        // Rates come as JSON:API `included` array
        const included = ratesJson.included || [];
        const rates = included
            .filter((r) => r.type === 'rates')
            .map((r) => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                rateId: r.id,
                carrier: ((_a = r.attributes) === null || _a === void 0 ? void 0 : _a.carrier) || '',
                serviceName: ((_b = r.attributes) === null || _b === void 0 ? void 0 : _b.service_level_name) || ((_c = r.attributes) === null || _c === void 0 ? void 0 : _c.service_name) || '',
                price: parseFloat(((_d = r.attributes) === null || _d === void 0 ? void 0 : _d.amount) || '0'),
                currency: ((_e = r.attributes) === null || _e === void 0 ? void 0 : _e.currency) || 'MXN',
                estimatedDays: (_g = (_f = r.attributes) === null || _f === void 0 ? void 0 : _f.estimated_days) !== null && _g !== void 0 ? _g : null,
            });
        })
            .sort((a, b) => a.price - b.price); // cheapest first
        return { quotationId, rates };
    }
    catch (err) {
        console.error('[SkyDropX] GetRates error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX rate error: ${err.message}`);
    }
});
// ── 2. Create Shipment + Generate Label (one step) ────────────────────────────
// Creates a shipment with the selected rate, then auto-updates Firestore order
// with trackingNumber, carrier, shippingLabelUrl, and sets status = 'shipped'.
exports.skydropxCreateLabel = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { orderId, rateId } = data;
    if (!orderId || !rateId)
        throw new functions.https.HttpsError('invalid-argument', 'orderId and rateId required.');
    try {
        // Step A: Create shipment with selected rate
        const shipRes = await fetch(`${SKYDROPX_BASE}/shipments`, {
            method: 'POST',
            headers: await skydropxHeaders(),
            body: JSON.stringify({ rate_id: rateId, address_from: await originAddress(), metadata: { order_id: orderId } }),
        });
        const shipJson = await shipRes.json();
        if (!shipRes.ok)
            throw new Error(`Shipment failed: ${JSON.stringify(shipJson)}`);
        const attrs = ((_a = shipJson.data) === null || _a === void 0 ? void 0 : _a.attributes) || {};
        const trackingNumber = attrs.tracking_number || '';
        const carrier = attrs.carrier || '';
        const labelUrl = attrs.label_url || '';
        // Auto-update Firestore order
        await db.collection('orders').doc(orderId).update({
            trackingNumber,
            carrier,
            shippingLabelUrl: labelUrl,
            shippingMethod: 'NATIONAL_CARRIER',
            status: 'shipped',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion({
                status: 'shipped',
                note: `Guía SkyDropX generada. Carrier: ${carrier}. Tracking: ${trackingNumber}`,
                timestamp: new Date(),
                updatedBy: context.auth.uid,
            }),
        });
        console.log(`[SkyDropX] Label created — order: ${orderId}, tracking: ${trackingNumber}`);
        return { trackingNumber, carrier, labelUrl, shipmentId: (_b = shipJson.data) === null || _b === void 0 ? void 0 : _b.id };
    }
    catch (err) {
        console.error('[SkyDropX] CreateLabel error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX label error: ${err.message}`);
    }
});
// ── 3. Get Live Tracking Status ────────────────────────────────────────────────
exports.skydropxGetTracking = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { trackingNumber } = data;
    if (!trackingNumber)
        throw new functions.https.HttpsError('invalid-argument', 'trackingNumber required.');
    try {
        const res = await fetch(`${SKYDROPX_BASE}/tracking/${encodeURIComponent(trackingNumber)}`, {
            headers: await skydropxHeaders(),
        });
        const json = await res.json();
        if (!res.ok)
            throw new Error(JSON.stringify(json));
        const attrs = ((_a = json.data) === null || _a === void 0 ? void 0 : _a.attributes) || {};
        return {
            trackingNumber,
            status: attrs.status || 'unknown',
            statusDetail: attrs.status_detail || '',
            estimatedDelivery: attrs.estimated_delivery || null,
            events: (attrs.tracking_events || []).map((e) => ({
                status: e.status,
                description: e.description,
                location: e.location,
                occurredAt: e.occurred_at,
            })),
        };
    }
    catch (err) {
        console.error('[SkyDropX] Tracking error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX tracking error: ${err.message}`);
    }
});
// ─── MercadoLibre Integration (OAuth2 & Sync) ──────────────────────────────────
// Get Meli Config helper
async function getMeliConfig() {
    var _a;
    const doc = await db.collection('config').doc('integrations').get();
    if (!doc.exists)
        throw new Error('Integrations config not found');
    const config = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.meli;
    if (!config || !config.appId || !config.clientSecret || !config.redirectUri) {
        throw new Error('MercadoLibre not fully configured in /admin/integrations');
    }
    return config;
}
// 1. Generate Auth URL (Callable)
exports.meliAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const config = await getMeliConfig();
        // Meli Mexico auth URL
        const url = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${config.appId}&redirect_uri=${encodeURIComponent(config.redirectUri)}`;
        return { url };
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// 2. OAuth Callback (HTTP Endpoint)
// The frontend will redirect here after the user logs in to Meli.
exports.meliCallback = functions.https.onRequest(async (req, res) => {
    // CORS headers just in case
    res.set('Access-Control-Allow-Origin', '*');
    const code = req.query.code;
    if (!code) {
        res.status(400).send('Missing authorization code');
        return;
    }
    try {
        const config = await getMeliConfig();
        // Exchange code for tokens
        const bodyParams = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.appId,
            client_secret: config.clientSecret,
            code: code,
            redirect_uri: 'https://us-central1-tiendapraxis.cloudfunctions.net/meliCallback'
        });
        console.log(`[Meli] Exchanging token with body: ${bodyParams.toString()}`);
        const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: bodyParams.toString()
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            console.error('Meli Token Error:', tokenData);
            res.status(500).send(`Failed to exchange token: ${JSON.stringify(tokenData)}`);
            return;
        }
        // Save tokens to Firestore
        const expiresAt = Date.now() + (tokenData.expires_in * 1000); // Usually 21600 seconds (6 hours)
        await db.collection('config').doc('integrations').set({
            meli: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: expiresAt,
                userId: tokenData.user_id,
                connected: true
            }
        }, { merge: true });
        console.log('[Meli] Successfully authenticated and saved tokens for user:', tokenData.user_id);
        // Redirect back to the admin integrations page
        res.redirect(`${req.headers.origin || 'http://localhost:4300'}/admin/settings/integrations?meli_success=true`);
    }
    catch (err) {
        console.error('[Meli] Callback error:', err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    }
});
// 3. Refresh Token (Scheduled Cron Job - Every 4 hours)
exports.meliRefreshTokenScheduled = functions.pubsub.schedule('every 4 hours').onRun(async (context) => {
    console.log('[Meli] Running scheduled token refresh...');
    try {
        const config = await getMeliConfig();
        if (!config.refreshToken) {
            console.log('[Meli] No refresh token available. Skipping.');
            return null;
        }
        const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.appId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken
            }).toString()
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            console.error('[Meli] Scheduled refresh failed:', tokenData);
            // Optionally flag connected as false if refresh fails permanently
            if (tokenData.error === 'invalid_grant') {
                await db.collection('config').doc('integrations').set({
                    meli: { connected: false }
                }, { merge: true });
            }
            return null;
        }
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);
        await db.collection('config').doc('integrations').set({
            meli: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: expiresAt,
                connected: true
            }
        }, { merge: true });
        console.log('[Meli] Successfully refreshed tokens automatically.');
        return null;
    }
    catch (err) {
        console.error('[Meli] Scheduled refresh error:', err);
        return null;
    }
});
// Helper: Parse and construct Eurollantas Order object from a Meli Order, Ship Data, and Billing Info
function parseAndSaveMeliOrder(mo, shipData, billingData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    let internalStatus = 'pending';
    if (mo.status === 'paid')
        internalStatus = 'processing';
    const hasDeliveredTag = mo.tags && mo.tags.includes('delivered');
    const hasNotDeliveredTag = mo.tags && mo.tags.includes('not_delivered');
    const realShippingStatus = (shipData === null || shipData === void 0 ? void 0 : shipData.status) || ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.status);
    if (hasNotDeliveredTag || realShippingStatus === 'shipped')
        internalStatus = 'shipped';
    if (hasDeliveredTag || realShippingStatus === 'delivered')
        internalStatus = 'delivered';
    if (mo.status === 'cancelled' || mo.status === 'invalid' || realShippingStatus === 'cancelled')
        internalStatus = 'cancelled';
    const isMeliFull = (shipData === null || shipData === void 0 ? void 0 : shipData.logistic_type) === 'fulfillment' || (mo.tags && mo.tags.includes('fulfillment'));
    const fType = isMeliFull ? 'platform' : 'merchant';
    // Extract Handling Limit (Native Meli SLA Dispatch Deadline)
    // MercadoLibre provides this in shipping_option.estimated_handling_limit.date
    let nativeSla = null;
    if ((_c = (_b = shipData === null || shipData === void 0 ? void 0 : shipData.shipping_option) === null || _b === void 0 ? void 0 : _b.estimated_handling_limit) === null || _c === void 0 ? void 0 : _c.date) {
        nativeSla = new Date(shipData.shipping_option.estimated_handling_limit.date);
    }
    else if ((_e = (_d = shipData === null || shipData === void 0 ? void 0 : shipData.shipping_option) === null || _d === void 0 ? void 0 : _d.estimated_delivery_time) === null || _e === void 0 ? void 0 : _e.date) {
        // Fallback to delivery time if handling limit is absent
        nativeSla = new Date(shipData.shipping_option.estimated_delivery_time.date);
    }
    // Build timeline history map
    const history = [];
    if (mo.date_created) {
        history.push({
            status: 'pending',
            timestamp: new Date(mo.date_created),
            note: 'Placed on MercadoLibre',
            updatedBy: 'system'
        });
    }
    const paidDate = (mo.payments && mo.payments.length > 0 && mo.payments[0].date_approved) || mo.date_closed;
    if (paidDate) {
        history.push({
            status: 'processing',
            timestamp: new Date(paidDate),
            note: 'Payment approved',
            updatedBy: 'system'
        });
    }
    if (shipData && shipData.status_history) {
        if (shipData.status_history.date_shipped) {
            history.push({
                status: 'shipped',
                timestamp: new Date(shipData.status_history.date_shipped),
                note: 'Shipped via ' + (shipData.tracking_method || 'MercadoEnvíos'),
                carrier: shipData.tracking_method || 'MercadoEnvíos',
                trackingNumber: shipData.tracking_number || '',
                updatedBy: 'system'
            });
        }
        if (shipData.status_history.date_delivered) {
            history.push({
                status: 'delivered',
                timestamp: new Date(shipData.status_history.date_delivered),
                note: 'Delivered to buyer',
                updatedBy: 'system'
            });
        }
    }
    else if (hasDeliveredTag) {
        history.push({
            status: 'delivered',
            timestamp: mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp(),
            note: 'Marked delivered via ML tags',
            updatedBy: 'system'
        });
    }
    if (internalStatus === 'cancelled') {
        const cd = mo.cancel_detail;
        // Build a readable note from cancel_detail when available
        let cancelNote = 'Cancelled on MercadoLibre';
        if (cd) {
            const parts = [];
            if (cd.requested_by)
                parts.push(`By: ${cd.requested_by}`);
            if (cd.group)
                parts.push(`Group: ${cd.group}`);
            if (cd.code)
                parts.push(`Code: ${cd.code}`);
            if (cd.description)
                parts.push(cd.description);
            if (parts.length)
                cancelNote = parts.join(' · ');
        }
        history.push({
            status: 'cancelled',
            timestamp: (cd === null || cd === void 0 ? void 0 : cd.date)
                ? new Date(cd.date)
                : (mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp()),
            note: cancelNote,
            updatedBy: 'system'
        });
    }
    return Object.assign(Object.assign({ id: `meli_${mo.id}`, orderNumber: `ML-${mo.id}`, sourceChannel: 'mercadolibre', fulfillmentType: fType, shippingId: ((_f = mo.shipping) === null || _f === void 0 ? void 0 : _f.id) ? String(mo.shipping.id) : '', externalOrderId: String(mo.id), 
        // Store pack_id separately — since 2024 all MeLi orders belong to a pack.
        // pack_id is what webhooks typically reference; mo.id is the seller-visible order ID.
        meliPackId: mo.pack_id ? String(mo.pack_id) : null, customer: {
            id: `ml_${(_g = mo.buyer) === null || _g === void 0 ? void 0 : _g.id}`,
            name: mo.buyer ? `${mo.buyer.first_name || ''} ${mo.buyer.last_name || ''}`.trim() || mo.buyer.nickname || 'Meli Buyer' : 'Meli Buyer',
            email: ((_h = mo.buyer) === null || _h === void 0 ? void 0 : _h.email) || `${(_j = mo.buyer) === null || _j === void 0 ? void 0 : _j.id}@mercadolibre.com`,
            phone: ((_l = (_k = mo.buyer) === null || _k === void 0 ? void 0 : _k.phone) === null || _l === void 0 ? void 0 : _l.number) || ((_o = (_m = mo.buyer) === null || _m === void 0 ? void 0 : _m.phone) === null || _o === void 0 ? void 0 : _o.area_code) ? `${((_q = (_p = mo.buyer) === null || _p === void 0 ? void 0 : _p.phone) === null || _q === void 0 ? void 0 : _q.area_code) || ''}${((_s = (_r = mo.buyer) === null || _r === void 0 ? void 0 : _r.phone) === null || _s === void 0 ? void 0 : _s.number) || ''}` : '',
            isGuest: true
        }, status: internalStatus, history: history, items: (mo.order_items || []).map((item) => ({
            productId: item.item.id,
            productName: item.item.title,
            name: item.item.title,
            price: item.unit_price,
            quantity: item.quantity,
            subtotal: item.unit_price * item.quantity,
            sku: item.item.seller_sku || ''
        })), total: mo.total_amount, subtotal: mo.total_amount, marketplaceFee: (mo.order_items || []).reduce((acc, val) => acc + (val.sale_fee || 0), 0), paymentStatus: mo.payments && mo.payments.length > 0 && mo.payments[0].status === 'approved' ? 'approved' : 'pending', shippingAddress: (() => {
            var _a, _b, _c, _d, _e;
            const recvAddr = shipData === null || shipData === void 0 ? void 0 : shipData.receiver_address;
            if (recvAddr) {
                return {
                    street: recvAddr.street_name || 'N/A',
                    exteriorNumber: recvAddr.street_number || '',
                    interiorNumber: '',
                    // 'comment' field = delivery references (NOT interior number)
                    references: recvAddr.comment || '',
                    colonia: ((_a = recvAddr.neighborhood) === null || _a === void 0 ? void 0 : _a.name) || '',
                    city: ((_b = recvAddr.city) === null || _b === void 0 ? void 0 : _b.name) || ((_c = recvAddr.municipality) === null || _c === void 0 ? void 0 : _c.name) || '',
                    state: ((_d = recvAddr.state) === null || _d === void 0 ? void 0 : _d.name) || '',
                    zipCode: recvAddr.zip_code || '',
                    country: ((_e = recvAddr.country) === null || _e === void 0 ? void 0 : _e.id) || 'MX',
                    // Recipient name ("Recibe:") from the shipment receiver
                    recipientName: recvAddr.receiver_name || ''
                };
            }
            return {
                street: 'MercadoEnvíos',
                exteriorNumber: '',
                interiorNumber: '',
                references: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'MX',
                recipientName: ''
            };
        })(), createdAt: mo.date_created ? new Date(mo.date_created) : admin.firestore.FieldValue.serverTimestamp(), updatedAt: mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp(), nativeSla: nativeSla }, (billingData && !billingData.error ? (() => {
        var _a, _b, _c, _d, _e;
        // MeLi returns different shapes in v1 vs v2. Normalize both.
        const bi = billingData.billing_info || billingData;
        const rfcNumber = ((_a = bi === null || bi === void 0 ? void 0 : bi.identification) === null || _a === void 0 ? void 0 : _a.number) || null;
        return {
            meliInvoice: {
                name: (bi === null || bi === void 0 ? void 0 : bi.first_name)
                    ? `${bi.first_name} ${bi.last_name || ''}`.trim()
                    : null,
                rfc: rfcNumber,
                identificationType: ((_b = bi === null || bi === void 0 ? void 0 : bi.identification) === null || _b === void 0 ? void 0 : _b.type) || 'RFC',
                // Billing address (often different from shipping address)
                billingAddress: (bi === null || bi === void 0 ? void 0 : bi.address) ? {
                    street: bi.address.street_name || '',
                    exteriorNumber: bi.address.street_number || '',
                    city: ((_c = bi.address.city) === null || _c === void 0 ? void 0 : _c.name) || bi.address.city || '',
                    state: ((_d = bi.address.state) === null || _d === void 0 ? void 0 : _d.name) || bi.address.state || '',
                    zipCode: bi.address.zip_code || '',
                    country: ((_e = bi.address.country) === null || _e === void 0 ? void 0 : _e.id) || 'MX'
                } : null,
                // CFDI use code: S01=Sin efectos, G01=Adquisición, G03=Gastos grles
                cfdiUse: (bi === null || bi === void 0 ? void 0 : bi.cfdi_use) || null,
                // Taxpayer type: 'Persona Física' | 'Persona Moral'
                taxpayerType: (bi === null || bi === void 0 ? void 0 : bi.taxpayer_type) || null,
                activityDescription: (bi === null || bi === void 0 ? void 0 : bi.activity_description) || null,
                // true = generic RFC, buyer did NOT request nominal invoice
                isGenericRfc: rfcNumber === 'XAXX010101000' || rfcNumber === 'XEXX010101000'
            }
        };
    })() : {})), (mo.cancel_detail ? {
        meliCancellation: {
            requestedBy: mo.cancel_detail.requested_by || null,
            group: mo.cancel_detail.group || null,
            code: mo.cancel_detail.code || null,
            description: mo.cancel_detail.description || null,
            date: mo.cancel_detail.date ? new Date(mo.cancel_detail.date) : null,
            originalStatus: mo.status || null // e.g. 'cancelled' | 'invalid'
        }
    } : {}));
}
// 4. Sync Orders (Callable)
// Syncs orders from last sync date to now, using a date cursor for accuracy.
exports.meliSyncOrders = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        // Use lastSyncDate cursor to get only new orders since last run
        const lastSyncDate = meliConfig.lastSyncDate
            ? new Date(meliConfig.lastSyncDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
        const dateFrom = lastSyncDate.toISOString().replace('.000Z', '.000-00:00');
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_asc&limit=50&order.date_created.from=${encodeURIComponent(dateFrom)}`;
        console.log(`[Meli] Syncing orders since: ${dateFrom}`);
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${meliConfig.accessToken}`
            }
        });
        const json = await res.json();
        if (!res.ok) {
            console.error('[Meli] Sync Orders Error:', json);
            throw new Error(JSON.stringify(json));
        }
        const meliOrders = json.results || [];
        // Fetch shipments + billing_info in parallel
        const shipmentsMap = {};
        const billingMap = {};
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a;
            try {
                // Shipment
                if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                        headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                    });
                    if (sRes.ok)
                        shipmentsMap[mo.shipping.id] = await sRes.json();
                }
                // Billing info (try v2 for Mexico, fallback v1)
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
            catch (e) { /* skip non-critical */ }
        }));
        let importedCount = 0;
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            // Construct Eurollantas Order object using helper
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
            await orderRef.set(newOrder, { merge: true });
            importedCount++;
        }
        // Save lastSyncDate cursor to Firestore
        await db.collection('config').doc('integrations').set({
            meli: { lastSyncDate: new Date().toISOString() }
        }, { merge: true });
        console.log(`[Meli] Successfully synced ${importedCount} orders since ${dateFrom}.`);
        return { success: true, imported: importedCount, totalProcessed: meliOrders.length, syncedFrom: dateFrom };
    }
    catch (err) {
        console.error('[Meli] Sync Orders failed:', err);
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
        const configDoc = await db.collection('config').doc('integrations').get();
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
        const configDoc = await db.collection('config').doc('integrations').get();
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
            var _a;
            try {
                if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                        headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                    });
                    if (sRes.ok)
                        shipmentsMap[mo.shipping.id] = await sRes.json();
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
        const batch = db.batch();
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
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
        const configDoc = await db.collection('config').doc('integrations').get();
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
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
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
        const configDoc = await db.collection('config').doc('integrations').get();
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
exports.meliSyncFullInventory = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to sync FBM inventory.');
    }
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre is not connected or missing tokens.');
        }
        // @ts-ignore
        const fetch = require('node-fetch');
        // 1. Fetch fulfillment items by paging through user items
        let offset = 0;
        const limit = 50;
        const allItemIds = [];
        while (true) {
            const searchUrl = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?logistic_type=fulfillment&limit=${limit}&offset=${offset}`;
            const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
            if (!searchRes.ok) {
                console.error('[Meli FBM] Search failed:', await searchRes.text());
                throw new functions.https.HttpsError('internal', 'MercadoLibre API search failed.');
            }
            const searchJson = await searchRes.json();
            if (!searchJson.results || searchJson.results.length === 0)
                break;
            allItemIds.push(...searchJson.results);
            if (searchJson.results.length < limit)
                break;
            offset += limit;
        }
        if (allItemIds.length === 0) {
            return { success: true, message: 'No FBM items found.', syncedCount: 0 };
        }
        // 2. Fetch full item details in chunks of 20 (max per MULTIGET api)
        const chunkSize = 20;
        let syncedCount = 0;
        const batch = db.batch();
        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsUrl = `https://api.mercadolibre.com/items?ids=${chunk.join(',')}`;
            const itemsRes = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
            if (!itemsRes.ok) {
                console.error(`[Meli FBM] Failed to fetch items chunk ${i}`, await itemsRes.text());
                continue;
            }
            const itemsJson = await itemsRes.json();
            for (const itemObj of itemsJson) {
                if (itemObj.code !== 200 || !itemObj.body)
                    continue;
                const body = itemObj.body;
                // Extract SKU
                const skuAttr = (_b = body.attributes) === null || _b === void 0 ? void 0 : _b.find((a) => a.id === 'SELLER_SKU');
                const sku = skuAttr ? skuAttr.value_name : null;
                // Firestore document IDs cannot contain forward slashes
                // Some SKUs like "80/90-17-EY..." contain them.
                const rawDocId = String(sku || body.id);
                const safeDocId = rawDocId.replace(/\//g, '_');
                const inventoryRef = db.collection('meli_fbm_inventory').doc(safeDocId);
                batch.set(inventoryRef, {
                    mlItemId: body.id,
                    sku: sku,
                    title: body.title,
                    inventoryId: body.inventory_id || null,
                    availableQuantity: body.available_quantity || 0,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                syncedCount++;
            }
        }
        // 3. Commit batch to Firestore
        await batch.commit();
        return { success: true, syncedCount };
    }
    catch (e) {
        console.error('Error in meliSyncFullInventory:', e);
        throw new functions.https.HttpsError('internal', 'sync failed');
    }
});
// 12. Automated Sync: Cron Sweep (Catch-all for missed webhooks)
exports.meliSyncOrdersCron = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
    var _a, _b;
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            console.log('[Meli Cron] Not connected. Skipping.');
            return;
        }
        const lastSyncDate = meliConfig.lastSyncDate
            ? new Date(meliConfig.lastSyncDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dateFrom = lastSyncDate.toISOString().replace('.000Z', '.000-00:00');
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_asc&limit=50&order.date_created.from=${encodeURIComponent(dateFrom)}`;
        console.log(`[Meli Cron] Sweeping orders since: ${dateFrom}`);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        if (!res.ok) {
            const errJson = await res.json();
            throw new Error(JSON.stringify(errJson));
        }
        const json = await res.json();
        const meliOrders = json.results || [];
        const shipmentsMap = {};
        const billingMap = {};
        await Promise.all(meliOrders
            .map(async (mo) => {
            var _a;
            try {
                if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                        headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
                    });
                    if (sRes.ok)
                        shipmentsMap[mo.shipping.id] = await sRes.json();
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
        let importedCount = 0;
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
            await orderRef.set(newOrder, { merge: true });
            importedCount++;
        }
        if (importedCount > 0) {
            await db.collection('config').doc('integrations').set({
                meli: { lastSyncDate: new Date().toISOString() }
            }, { merge: true });
        }
        console.log(`[Meli Cron] Success. Upserted ${importedCount} orders.`);
    }
    catch (err) {
        console.error('[Meli Cron] Failed:', err);
    }
});
// 13. Automated Sync: Webhook (Real-Time push)
exports.meliWebhook = functions.https.onRequest(async (req, res) => {
    var _a;
    // MercadoLibre heavily monitors Webhook response times.
    // Spec requires HTTP 200/201 ACK immediately.
    res.status(200).send('OK');
    try {
        const payload = req.body;
        // --- 1) Temporary Webhook Activity Log ---
        try {
            await db.collection('meli_webhook_logs').add({
                topic: (payload === null || payload === void 0 ? void 0 : payload.topic) || 'unknown',
                resource: (payload === null || payload === void 0 ? void 0 : payload.resource) || 'unknown',
                payload: payload || {},
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        catch (logErr) {
            console.error('[Meli Webhook] Failed to write to log:', logErr);
        }
        // --- 2) Process Orders ---
        if (payload && payload.topic === 'orders_v2' && payload.resource) {
            console.log(`[Meli Webhook] Processing event for resource: ${payload.resource}`);
            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
            if (!meliConfig || !meliConfig.accessToken)
                return;
            const headers = { 'Authorization': `Bearer ${meliConfig.accessToken}` };
            // Fetch the resource — may be a pack or a single order
            const resourceUrl = `https://api.mercadolibre.com${payload.resource}`;
            const resourceRes = await fetch(resourceUrl, { headers });
            if (!resourceRes.ok)
                throw new Error(`Failed to fetch resource: ${resourceRes.status}`);
            const resourceData = await resourceRes.json();
            // ── PACK ORDER HANDLING ────────────────────────────────────────────
            // Since 2024 ALL MeLi orders are pack orders.
            // The webhook resource may point to /orders/{pack_id} OR /orders/{order_id}.
            // A pack response has `orders` array; an individual order has `order_items`.
            // We collect the real individual order ID(s) to process.
            let singleOrderId = null;
            if (resourceData.order_items) {
                // This IS an individual order already — use its id directly
                singleOrderId = String(resourceData.id);
            }
            else if (resourceData.orders && Array.isArray(resourceData.orders)) {
                // This is a pack — process each individual order inside
                for (const packOrder of resourceData.orders) {
                    const orderId = String(packOrder.id || packOrder.order_id);
                    await processAndSaveMeliOrderById(orderId, meliConfig.accessToken, headers);
                }
                return;
            }
            else if (payload.resource.includes('/orders/')) {
                // Unknown shape — extract the ID from the URL and try fetching directly
                const idMatch = payload.resource.match(/\/orders\/(\d+)/);
                if (idMatch)
                    singleOrderId = idMatch[1];
            }
            if (singleOrderId) {
                const moRes = await fetch(`https://api.mercadolibre.com/orders/${singleOrderId}`, { headers });
                if (!moRes.ok)
                    throw new Error(`Failed to fetch order ${singleOrderId}: ${moRes.status}`);
                const mo = await moRes.json();
                await processAndSaveMeliOrderFromData(mo, meliConfig.accessToken, headers);
            }
        }
    }
    catch (err) {
        console.error('[Meli Webhook] Error processing payload:', err);
    }
});
// ── Webhook helpers ─────────────────────────────────────────────────────────
async function processAndSaveMeliOrderById(orderId, token, headers) {
    const moRes = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, { headers });
    if (!moRes.ok) {
        console.error(`[Meli Webhook] Could not fetch order ${orderId}: ${moRes.status}`);
        return;
    }
    const mo = await moRes.json();
    await processAndSaveMeliOrderFromData(mo, token, headers);
}
async function processAndSaveMeliOrderFromData(mo, token, headers) {
    var _a;
    // Fetch shipment
    let shipData = null;
    if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
        const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, { headers });
        if (sRes.ok)
            shipData = await sRes.json();
    }
    // Fetch billing info (v2 for Mexico, fallback v1)
    let billingData = null;
    try {
        const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
            headers: Object.assign(Object.assign({}, headers), { 'x-version': '2' })
        });
        if (bRes.ok)
            billingData = await bRes.json();
        else {
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, { headers });
            if (bRes1.ok)
                billingData = await bRes1.json();
        }
    }
    catch (e) { /* non-critical */ }
    const newOrder = parseAndSaveMeliOrder(mo, shipData, billingData);
    // Use the REAL individual order id (what the seller sees on MeLi) as the doc key
    const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
    await orderRef.set(newOrder, { merge: true });
    console.log(`[Meli Webhook] Saved order ML-${mo.id} (pack_id: ${mo.pack_id || 'n/a'})`);
}
exports.getMeliRawOrderDebug = functions.runWith({ timeoutSeconds: 500 }).https.onRequest(async (req, res) => {
    var _a;
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }
        // Fetch ALL 2026 orders starting late Dec 2025 to catch timezone bleed (Mexico vs Argentina vs UTC)
        let offset = 0;
        const limit = 50;
        let hasMore = true;
        const allOrders = [];
        while (hasMore && offset < 2000) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&order.date_created.from=2025-12-30T00:00:00.000-00:00&sort=date_desc&limit=${limit}&offset=${offset}`;
            const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
            if (!apiRes.ok)
                break;
            const json = await apiRes.json();
            const meliOrders = json.results || [];
            if (meliOrders.length === 0)
                break;
            allOrders.push(...meliOrders);
            offset += limit;
            if (json.paging && json.paging.total <= allOrders.length)
                hasMore = false;
        }
        // We want to test different mathematical grouping rules month-by-month for 2026
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const analysis = {};
        for (const mo of allOrders) {
            // Group by Mexico Time (UTC-6)
            const dateStr = mo.date_created || mo.date_closed;
            if (!dateStr)
                continue;
            const dateUTC = new Date(dateStr);
            const dateMX = new Date(dateUTC.getTime() - (6 * 60 * 60 * 1000));
            if (dateMX.getUTCFullYear() !== 2026)
                continue; // Only care about 2026
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
                mo.order_items.forEach((item) => {
                    itemsQty += (item.quantity || 0);
                    itemsSubtotal += (item.quantity * item.unit_price);
                });
            }
            m.totalUnitsIncCancelled += itemsQty;
            if (isCancelled) {
                m.cancelledOrderCount++;
            }
            else {
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
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
//# sourceMappingURL=index.js.map