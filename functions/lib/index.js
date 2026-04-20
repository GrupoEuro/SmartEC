"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meliPriceScanDiag = exports.aggregateDailyStats = exports.backfillMonthlyStats = exports.detectAbandonedCartsHttp = exports.detectAbandonedCarts = exports.getMeliRawOrderDebug = exports.meliWebhook = exports.meliSyncOrdersCron = exports.prunePriceHistory = exports.meliPriceScan = exports.meliSyncListings = exports.meliSyncFullInventory = exports.meliGetShippingLabel = exports.testMeliApi = exports.meliSyncHistorical = exports.meliAnalyzeHistoricalSync = exports.meliBackfillShippingCosts = exports.meliSyncOrders = exports.meliRefreshTokenScheduled = exports.meliCallback = exports.meliAuthUrl = exports.skydropxGetTracking = exports.skydropxCreateLabel = exports.skydropxRawTest = exports.skydropxGetRates = exports.skydropxTestConnection = exports.backfillUserClaims = exports.syncUserClaims = exports.mpDiag = exports.mpCallback = exports.mpAuthUrl = exports.mpWebhook = exports.processPayment = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mercadopago_1 = require("mercadopago");
admin.initializeApp();
const db = admin.firestore();
// ─── MercadoPago Payment Processing ─────────────────────────────────────────
exports.processPayment = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        console.warn('[processPayment] Guest checkout — no Firebase auth. Validating inputs.');
    }
    const { token, amount, email, description, orderId, orderNumber, installments, paymentMethodId, issuerId } = data;
    if (!token || !amount || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required payment parameters.');
    }
    // Load MP credentials + installments policy from Firestore
    let accessToken = process.env.MP_ACCESS_TOKEN;
    let installmentsEnabled = false;
    let maxInstallments = 1;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const mpConfig = ((_a = integrationsDoc.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) || {};
            if (mpConfig.accessToken)
                accessToken = mpConfig.accessToken;
            installmentsEnabled = (_b = mpConfig.installmentsEnabled) !== null && _b !== void 0 ? _b : false;
            maxInstallments = (_c = mpConfig.maxInstallments) !== null && _c !== void 0 ? _c : 1;
        }
    }
    catch (err) {
        console.warn('Could not read MP config from Firestore:', err);
    }
    if (!accessToken) {
        throw new functions.https.HttpsError('internal', 'Server configuration error. Missing Access Token.');
    }
    // Enforce installments policy
    let finalInstallments = 1;
    if (installmentsEnabled) {
        finalInstallments = Math.min(Number(installments) || 1, maxInstallments);
    }
    const client = new mercadopago_1.MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const payment = new mercadopago_1.Payment(client);
    try {
        const paymentData = {
            transaction_amount: Number(amount),
            token,
            description: description || `Orden ${orderNumber || orderId || ''} — Storefront`,
            installments: finalInstallments,
            payment_method_id: paymentMethodId,
            issuer_id: issuerId,
            three_d_secure_mode: 'optional',
            payer: {
                email,
                identification: { type: 'RFC', number: 'XAXX010101000' }
            },
            metadata: { order_id: orderId || '', order_number: orderNumber || '' }
        };
        const result = await payment.create({ body: paymentData });
        // 3DS challenge required
        if (result.status === 'pending' && result.status_detail === 'pending_challenge') {
            const challengeUrl = (_d = result.three_ds_info) === null || _d === void 0 ? void 0 : _d.external_resource_url;
            console.log(`[processPayment] 3DS challenge for order ${orderId}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'pending_3ds',
                    paymentId: result.id,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }).catch(e => console.error('Failed to update order for 3DS:', e));
            }
            return { success: false, requires3DS: true, challengeUrl, paymentId: result.id,
                status: result.status, statusDetail: result.status_detail };
        }
        // Payment approved/rejected/in_process
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: result.status,
                paymentId: result.id,
                paymentMethod: result.payment_method_id,
                installments: result.installments,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.error('Failed to update order status:', e));
        }
        return { success: true, status: result.status, paymentId: result.id,
            statusDetail: result.status_detail };
    }
    catch (error) {
        console.error('MercadoPago Payment Error:', error);
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError: error.message || 'Unknown error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.error('Failed to update rejected status:', e));
        }
        throw new functions.https.HttpsError('internal', error.message || 'Payment processing failed.');
    }
});
// ─── MercadoPago Webhook ──────────────────────────────────────────────────────
// Receives payment status updates from MP's notification system.
// Register this URL in MP Developer Panel → Notifications → Webhook:
//   https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook
exports.mpWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    try {
        const topic = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.type) || req.query['topic'];
        const resourceId = ((_c = (_b = req.body) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.id) || req.query['id'];
        console.log('[mpWebhook] Received:', topic, resourceId);
        if (topic !== 'payment' || !resourceId) {
            res.status(200).send('OK');
            return;
        }
        let accessToken = process.env.MP_ACCESS_TOKEN;
        try {
            const snap = await db.collection('config').doc('integrations').get();
            const t = (_e = (_d = snap.data()) === null || _d === void 0 ? void 0 : _d.mercadopago) === null || _e === void 0 ? void 0 : _e.accessToken;
            if (t)
                accessToken = t;
        }
        catch (e) { /* fall back to env */ }
        if (!accessToken) {
            res.status(500).send('No access token');
            return;
        }
        const mpClient = new mercadopago_1.MercadoPagoConfig({ accessToken });
        const paymentApi = new mercadopago_1.Payment(mpClient);
        const paymentData = await paymentApi.get({ id: String(resourceId) });
        const orderId = (_f = paymentData.metadata) === null || _f === void 0 ? void 0 : _f.order_id;
        if (!orderId) {
            res.status(200).send('No order_id in metadata');
            return;
        }
        const statusMap = {
            approved: 'approved', rejected: 'rejected', cancelled: 'cancelled',
            refunded: 'refunded', pending: 'pending', in_process: 'pending', authorized: 'pending'
        };
        const newStatus = (_g = statusMap[paymentData.status || '']) !== null && _g !== void 0 ? _g : 'unknown';
        await db.collection('orders').doc(orderId).update(Object.assign(Object.assign({ paymentStatus: newStatus, paymentId: paymentData.id, paymentMethod: paymentData.payment_method_id, installments: paymentData.installments, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, (newStatus === 'approved' ? { status: 'paid' } : {})), (newStatus === 'rejected' ? { status: 'payment_failed' } : {})));
        console.log(`[mpWebhook] Order ${orderId} payment → ${newStatus}`);
        res.status(200).send('OK');
    }
    catch (err) {
        console.error('[mpWebhook] Error:', err);
        res.status(500).send('Internal Error');
    }
});
// ─── MercadoPago OAuth: Generate Auth URL ────────────────────────────────────
//
// Callable from Angular: httpsCallable(functions, 'mpAuthUrl')
// Returns the URL to redirect the browser to for MP OAuth authorization.
// Requires config/integrations → mercadopago.appId + mercadopago.clientSecret
// to be saved in Firestore first (Admin → Integrations panel).
//
exports.mpAuthUrl = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const mpConfig = ((_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) || {};
        const appId = mpConfig.appId || mpConfig.clientId;
        if (!appId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoPago App ID not configured. Save it in Admin → Integrations first.');
        }
        const redirectUri = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback';
        const state = Math.random().toString(36).substring(2, 15);
        await db.collection('config').doc('integrations').set({ mercadopago: { oauthState: state } }, { merge: true });
        const SCOPES = ['read', 'offline_access', 'write'].join(' ');
        const url = `https://auth.mercadopago.com.mx/authorization?client_id=${appId}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;
        return { url, redirectUri };
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ─── MercadoPago OAuth: Callback Handler ─────────────────────────────────────
//
// HTTP endpoint — register this exact URL in MP Developer Panel → Configuración
// avanzada → URL de redireccionamiento:
//   https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback
//
// MP redirects here after user authorizes. We exchange the code for tokens
// and persist them to Firestore (config/integrations → mercadopago).
//
exports.mpCallback = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e;
    res.set('Access-Control-Allow-Origin', '*');
    const code = req.query['code'];
    const state = req.query['state'];
    const error = req.query['error'];
    const ADMIN_URL = 'https://us-central1-tiendapraxis.cloudfunctions.net'; // fallback
    const REDIRECT_BACK = 'http://localhost:4200/admin/settings/integrations'; // dev; override in prod
    if (error) {
        console.error('[mpCallback] OAuth denied:', error);
        res.redirect(`${REDIRECT_BACK}?mp_error=${encodeURIComponent(error)}`);
        return;
    }
    if (!code) {
        res.status(400).send('Missing authorization code');
        return;
    }
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const mpConfig = ((_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) || {};
        const appId = mpConfig.appId || mpConfig.clientId;
        const clientSecret = mpConfig.clientSecret || mpConfig.appSecret;
        const redirectUri = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback';
        if (!appId || !clientSecret) {
            res.status(500).send('Missing MercadoPago App ID or Client Secret in Firestore.');
            return;
        }
        if (state && mpConfig.oauthState && state !== mpConfig.oauthState) {
            console.warn('[mpCallback] State mismatch — possible CSRF');
            res.status(403).send('Invalid state parameter');
            return;
        }
        const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: appId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('[mpCallback] Token exchange failed:', JSON.stringify(tokenData));
            res.status(500).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
            return;
        }
        const expiresAt = Date.now() + ((tokenData.expires_in || 21600) * 1000);
        await db.collection('config').doc('integrations').set({
            mercadopago: {
                accessToken: tokenData.access_token,
                refreshToken: (_b = tokenData.refresh_token) !== null && _b !== void 0 ? _b : null,
                publicKey: (_d = (_c = tokenData.public_key) !== null && _c !== void 0 ? _c : mpConfig.publicKey) !== null && _d !== void 0 ? _d : '',
                userId: (_e = tokenData.user_id) !== null && _e !== void 0 ? _e : null,
                expiresAt,
                connected: true,
                oauthState: null,
            }
        }, { merge: true });
        console.log('[mpCallback] ✅ MercadoPago OAuth success. User ID:', tokenData.user_id);
        res.redirect(`${REDIRECT_BACK}?mp_success=true`);
    }
    catch (err) {
        console.error('[mpCallback] Error:', err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    }
});
// ─── MercadoPago Diagnostic Tool ─────────────────────────────────────────────
//
// Callable: httpsCallable(functions, 'mpDiag')
// Backs the /admin/integrations/mp-debug Payment Tester UI.
// Accepts { step: string, ...params } and runs the requested check.
//
exports.mpDiag = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const FN_VER = 'v5-2026-04-18'; // bump this on every deploy to confirm version
    // Load credentials from Firestore
    const configSnap = await db.collection('config').doc('integrations').get();
    const mpConfig = (_b = (_a = configSnap.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) !== null && _b !== void 0 ? _b : {};
    const accessToken = (_d = (_c = mpConfig.accessToken) !== null && _c !== void 0 ? _c : process.env.MP_ACCESS_TOKEN) !== null && _d !== void 0 ? _d : '';
    if (!accessToken) {
        return { ok: false, error: 'No Access Token found in config/integrations → mercadopago' };
    }
    const step = data === null || data === void 0 ? void 0 : data.step;
    // ── Step: /users/me ───────────────────────────────────────────────────────
    if (step === 'users_me') {
        try {
            const r = await fetch('https://api.mercadopago.com/users/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const body = await r.json();
            if (!r.ok)
                return { ok: false, error: (_f = (_e = body.message) !== null && _e !== void 0 ? _e : body.error) !== null && _f !== void 0 ? _f : 'Token rejected', status: r.status };
            return {
                ok: true,
                userId: body.id,
                nickname: body.nickname,
                email: body.email,
                site_id: body.site_id,
            };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    }
    // ── Step: Payment methods ─────────────────────────────────────────────────
    if (step === 'payment_methods') {
        try {
            const r = await fetch('https://api.mercadopago.com/v1/payment_methods', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const body = await r.json();
            if (!r.ok)
                return { ok: false, error: (_g = body.message) !== null && _g !== void 0 ? _g : 'Could not retrieve payment methods', status: r.status };
            const methods = (Array.isArray(body) ? body : []).map((m) => m.id);
            return {
                ok: true,
                count: methods.length,
                sample: methods.slice(0, 5),
            };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    }
    // ── Step: Test payment — creates a real Checkout Pro preference ───────────
    // This is the ACTUAL flow production uses (not card API hacks).
    // A successful preference proves: token valid, payment config correct, checkout works.
    if (step === 'test_payment') {
        const { amount = 100, description = 'Diagnóstico integración — Eurollantas' } = data !== null && data !== void 0 ? data : {};
        try {
            const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `mpdiag-pref-${Date.now()}`,
                },
                body: JSON.stringify({
                    items: [{
                            id: 'mp-diag-001',
                            title: description,
                            quantity: 1,
                            currency_id: 'MXN',
                            unit_price: Number(amount),
                        }],
                    payer: { email: 'test@eurollantas.com.mx' },
                    external_reference: `mp-diag-${Date.now()}`,
                    back_urls: {
                        success: 'https://eurollantas.com.mx',
                        failure: 'https://eurollantas.com.mx',
                        pending: 'https://eurollantas.com.mx',
                    },
                    auto_return: 'approved',
                    statement_descriptor: 'EUROLLANTAS',
                }),
            });
            const pref = await prefRes.json();
            if (!prefRes.ok || !pref.id) {
                return {
                    ok: false,
                    status: prefRes.status,
                    error: (_l = (_h = pref.message) !== null && _h !== void 0 ? _h : (_k = (_j = pref.cause) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.description) !== null && _l !== void 0 ? _l : 'Preference creation failed',
                    fnVer: FN_VER,
                    raw: pref,
                };
            }
            return {
                ok: true,
                preferenceId: pref.id,
                initPoint: (_m = pref.sandbox_init_point) !== null && _m !== void 0 ? _m : pref.init_point,
                status: 'preference_created',
                fnVer: FN_VER,
                raw: {
                    id: pref.id,
                    sandbox_url: pref.sandbox_init_point,
                    expires: pref.date_of_expiration,
                    fnVer: FN_VER,
                },
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Webhook endpoint reachability ───────────────────────────────────
    if (step === 'webhook_check') {
        const webhookUrl = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook';
        try {
            // Send a GET — the webhook rejects non-POST but a 405 confirms it's alive
            const r = await fetch(webhookUrl, { method: 'GET' });
            const alive = r.status === 405 || r.status === 200; // 405 = correct (only POST allowed)
            return {
                ok: alive,
                status: r.status,
                url: webhookUrl,
                detail: alive ? 'Endpoint responds correctly (405 Method Not Allowed = ✅)' : `Unexpected status ${r.status}`,
            };
        }
        catch (e) {
            return { ok: false, error: `Unreachable: ${e.message}`, url: webhookUrl };
        }
    }
    return { ok: false, error: `Unknown step: "${step}"`, fnVer: FN_VER };
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
const SKYDROPX_BASE = 'https://pro.skydropx.com/api/v1';
const SKYDROPX_OAUTH_URL = 'https://pro.skydropx.com/api/v1/oauth/token';
/**
 * Reads credentials from Firestore and returns OAuth Bearer headers.
 * PRO API uses: Authorization: Bearer {access_token} via client_credentials OAuth.
 */
async function skydropxHeaders() {
    var _a;
    let apiKey = process.env.SKYDROPX_API_KEY;
    let apiSecret = process.env.SKYDROPX_API_SECRET;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const sky = ((_a = integrationsDoc.data()) === null || _a === void 0 ? void 0 : _a.skydropx) || {};
            if (sky.apiKey)
                apiKey = sky.apiKey;
            if (sky.apiSecret)
                apiSecret = sky.apiSecret;
        }
    }
    catch (err) {
        console.warn('[SkyDropX] Could not read credentials from Firestore:', err);
    }
    if (!apiKey)
        throw new functions.https.HttpsError('internal', 'SkyDropX API key not configured.');
    if (!apiSecret)
        throw new functions.https.HttpsError('internal', 'SkyDropX API secret not configured.');
    // Exchange client credentials for a Bearer access token
    const tokenRes = await fetch(SKYDROPX_OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: apiKey,
            client_secret: apiSecret,
        }).toString(),
    });
    const tokenText = await tokenRes.text();
    let tokenData;
    try {
        tokenData = JSON.parse(tokenText);
    }
    catch (_b) {
        tokenData = null;
    }
    if (!tokenRes.ok || !(tokenData === null || tokenData === void 0 ? void 0 : tokenData.access_token)) {
        const msg = (tokenData === null || tokenData === void 0 ? void 0 : tokenData.error_description) || (tokenData === null || tokenData === void 0 ? void 0 : tokenData.error) || tokenText || `HTTP ${tokenRes.status}`;
        throw new functions.https.HttpsError('unauthenticated', `SkyDropX auth failed: ${msg}`);
    }
    console.log('[SkyDropX] OAuth token obtained, expires_in:', tokenData.expires_in);
    return {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
}
// ── 0. Test Connection ─────────────────────────────────────────────────────────
// Validates stored credentials by performing the OAuth2 token exchange.
// If a valid access_token comes back, credentials are correct.
// (Skydropx PRO has no /carriers endpoint — token exchange alone proves auth.)
exports.skydropxTestConnection = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    let apiKey = process.env.SKYDROPX_API_KEY;
    let apiSecret = process.env.SKYDROPX_API_SECRET;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const sky = ((_a = integrationsDoc.data()) === null || _a === void 0 ? void 0 : _a.skydropx) || {};
            console.log('[SkyDropX] Firestore skydropx keys present:', Object.keys(sky));
            if (sky.apiKey)
                apiKey = sky.apiKey;
            if (sky.apiSecret)
                apiSecret = sky.apiSecret;
        }
        else {
            console.warn('[SkyDropX] config/integrations doc does not exist');
        }
    }
    catch (err) {
        console.warn('[SkyDropX] Could not read from Firestore:', err);
    }
    console.log(`[SkyDropX] Credential check — apiKey: ${!!apiKey}, apiSecret: ${!!apiSecret}`);
    if (!apiKey || !apiSecret) {
        return { success: false, message: 'API Key and Secret are required. Please save them first.' };
    }
    try {
        const tokenRes = await fetch(SKYDROPX_OAUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: apiKey,
                client_secret: apiSecret,
            }).toString(),
        });
        const tokenText = await tokenRes.text();
        console.log(`[SkyDropX] OAuth status: ${tokenRes.status}, body: ${tokenText.substring(0, 300)}`);
        let tokenData;
        try {
            tokenData = JSON.parse(tokenText);
        }
        catch (_b) {
            tokenData = null;
        }
        if (tokenRes.ok && (tokenData === null || tokenData === void 0 ? void 0 : tokenData.access_token)) {
            return { success: true, message: 'Credentials verified — Skydropx PRO connection successful.' };
        }
        else {
            const msg = (tokenData === null || tokenData === void 0 ? void 0 : tokenData.error_description) || (tokenData === null || tokenData === void 0 ? void 0 : tokenData.error) || tokenText || `HTTP ${tokenRes.status}`;
            return { success: false, message: `Auth failed: ${msg}` };
        }
    }
    catch (err) {
        console.error('[SkyDropX] TestConnection fetch error:', err.message);
        throw new functions.https.HttpsError('internal', err.message || 'Connection test failed.');
    }
});
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
        street1: `${street} ${number}`,
        street2: colonia,
        city,
        province,
        zip_code: zip,
        country: process.env.SKYDROPX_ORIGIN_COUNTRY || 'MX',
    };
}
// ── 1. Get Shipping Rates ─────────────────────────────────────────────────────
// OAuth Bearer + pro.skydropx.com/api/v1/quotations
// Body: { zip_from, zip_to (strings), parcel: { weight, height, width, length } as strings }
exports.skydropxGetRates = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { orderId, zipTo, parcel } = data;
    if (!parcel)
        throw new functions.https.HttpsError('invalid-argument', 'parcel is required.');
    let destinationZip = zipTo;
    if (!destinationZip && orderId) {
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists)
            throw new functions.https.HttpsError('not-found', 'Order not found.');
        destinationZip = (_b = (_a = orderDoc.data()) === null || _a === void 0 ? void 0 : _a.shippingAddress) === null || _b === void 0 ? void 0 : _b.zipCode;
    }
    if (!destinationZip || destinationZip.length < 4) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid destination zip code (zipTo) is required.');
    }
    let originZip = process.env.SKYDROPX_ORIGIN_ZIPCODE || '78140';
    try {
        const shippingDoc = await db.collection('config').doc('shipping').get();
        if (shippingDoc.exists) {
            const z = (_d = (_c = shippingDoc.data()) === null || _c === void 0 ? void 0 : _c.origin) === null || _d === void 0 ? void 0 : _d.zip;
            if (z)
                originZip = z;
        }
    }
    catch (_h) {
        console.warn('[SkyDropX] Could not read origin zip, using default.');
    }
    const headers = await skydropxHeaders();
    // Look up destination zip for correct area_level info (Skydropx validates zip matches state)
    let destLevel1 = 'México';
    let destLevel2 = String(destinationZip);
    let destLevel3 = 'Centro';
    try {
        const zipRes = await fetch(`https://api.zippopotam.us/mx/${destinationZip}`);
        if (zipRes.ok) {
            const zipData = await zipRes.json();
            if (((_e = zipData.places) === null || _e === void 0 ? void 0 : _e.length) > 0) {
                const place = zipData.places[0];
                destLevel1 = place.state || destLevel1;
                destLevel2 = place['place name'] || destLevel2;
                destLevel3 = place['place name'] || destLevel3;
            }
        }
    }
    catch (_j) {
        console.warn('[SkyDropX] Could not look up destination zip, using fallback.');
    }
    // Official Skydropx PRO quotation body — Rails API requires quotation:{} root wrapper
    const quotationPayload = {
        address_from: { country_code: 'MX', postal_code: originZip, area_level1: 'San Luis Potosí', area_level2: 'San Luis Potosí', area_level3: 'Centro' },
        address_to: { country_code: 'MX', postal_code: String(destinationZip), area_level1: destLevel1, area_level2: destLevel2, area_level3: destLevel3 },
        parcels: [{
                weight: Math.max(1, Math.round(parcel.weight || 5)),
                height: Math.max(1, Math.round(parcel.height || 30)),
                width: Math.max(1, Math.round(parcel.width || 30)),
                length: Math.max(1, Math.round(parcel.length || 20)),
            }],
        package_protected: false,
        declared_value: 0,
        declared_amount: 0,
        requested_carriers: [],
    };
    const body = { quotation: quotationPayload };
    console.log('[SkyDropX] Quotation — URL: POST', `${SKYDROPX_BASE}/quotations`);
    console.log('[SkyDropX] Body:', JSON.stringify(body));
    try {
        const createRes = await fetch(`${SKYDROPX_BASE}/quotations`, {
            method: 'POST', headers, body: JSON.stringify(body),
        });
        const createText = await createRes.text();
        console.log(`[SkyDropX] Create response ${createRes.status}:`, createText.substring(0, 500));
        if (!createRes.ok) {
            throw new Error(`Quotation failed (${createRes.status}): ${createText}\n--- SENT BODY ---\n${JSON.stringify(body, null, 2)}`);
        }
        const createJson = JSON.parse(createText);
        const quotationId = createJson.id;
        if (!quotationId)
            throw new Error('No quotation ID returned from API.');
        // PRO API is async — poll until is_completed: true (max 18 seconds)
        const completed = await pollQuotation(quotationId, headers);
        console.log(`[SkyDropX] Quotation ${quotationId} completed. Rates: ${(_g = (_f = completed.rates) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0}`);
        const rates = extractRates(completed);
        console.log(`[SkyDropX] Parsed ${rates.length} priced rate(s)`);
        return { rates };
    }
    catch (err) {
        console.error('[SkyDropX] GetRates error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX rate error: ${err.message}`);
    }
});
/**
 * Polls GET /quotations/{id} until is_completed:true or max attempts reached.
 * Skydropx PRO API is async — the POST creates the job, GET returns results.
 */
async function pollQuotation(quotationId, headers, maxAttempts = 12, intervalMs = 1500) {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await sleep(intervalMs);
        const res = await fetch(`${SKYDROPX_BASE}/quotations/${quotationId}`, { headers });
        const text = await res.text();
        if (!res.ok)
            throw new Error(`Poll failed (${res.status}): ${text}`);
        const json = JSON.parse(text);
        const hasPrice = Array.isArray(json.rates) && json.rates.some((r) => r.total || r.amount);
        console.log(`[SkyDropX] Poll ${attempt}/${maxAttempts}: is_completed=${json.is_completed}, priced=${hasPrice}`);
        if (json.is_completed || hasPrice)
            return json;
    }
    throw new Error(`Quotation ${quotationId} timed out after ${maxAttempts * intervalMs / 1000}s`);
}
// ── 1b. Raw API Test (Debug) v5 ─────────────────────────────────────────────
// NEVER throws. Returns all 3 steps raw.
exports.skydropxRawTest = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const BUILD_VERSION = '2026-03-25-v7';
    const result = { version: BUILD_VERSION, step1_credentials: null, step2_oauth: null, step3_quotation: null };
    // Step 1: Read credentials from Firestore
    let apiKey = process.env.SKYDROPX_API_KEY || null;
    let apiSecret = process.env.SKYDROPX_API_SECRET || null;
    try {
        const fsDoc = await db.collection('config').doc('integrations').get();
        if (fsDoc.exists) {
            const sky = ((_a = fsDoc.data()) === null || _a === void 0 ? void 0 : _a.skydropx) || {};
            if (sky.apiKey)
                apiKey = sky.apiKey;
            if (sky.apiSecret)
                apiSecret = sky.apiSecret;
        }
        result.step1_credentials = {
            docExists: fsDoc.exists,
            hasApiKey: !!apiKey,
            apiKeyFirst8: apiKey ? apiKey.substring(0, 8) + '...' : null,
            hasApiSecret: !!apiSecret,
        };
    }
    catch (e) {
        result.step1_credentials = { error: e.message };
    }
    // Step 2: OAuth token exchange
    let bearerToken = null;
    if (apiKey && apiSecret) {
        try {
            const tokenRes = await fetch(SKYDROPX_OAUTH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: apiKey, client_secret: apiSecret }).toString(),
            });
            const tokenText = await tokenRes.text();
            let tokenJson = null;
            try {
                tokenJson = JSON.parse(tokenText);
            }
            catch (_e) {
                tokenJson = tokenText;
            }
            result.step2_oauth = { status: tokenRes.status, body: tokenJson };
            if (tokenRes.ok && (tokenJson === null || tokenJson === void 0 ? void 0 : tokenJson.access_token))
                bearerToken = tokenJson.access_token;
        }
        catch (e) {
            result.step2_oauth = { error: e.message };
        }
    }
    else {
        result.step2_oauth = { skipped: 'Missing apiKey or apiSecret' };
    }
    // Step 3: Quotation — PRO API with ALL required fields (per official docs)
    if (bearerToken) {
        const zip_from = '78140';
        // Use a well-known zip as default to avoid address mismatch errors
        // 64000 = Monterrey, Nuevo León (Monterrey Centro)
        const zip_to = String((data === null || data === void 0 ? void 0 : data.zipTo) || '64000');
        const p = (data === null || data === void 0 ? void 0 : data.parcel) || { weight: 5, height: 30, width: 30, length: 20 };
        // Lookup zip_to area info (required to match SEPOMEX data)
        let destLevel1 = 'Nuevo León';
        let destLevel2 = 'Monterrey';
        let destLevel3 = 'Monterrey Centro';
        try {
            const zipRes = await fetch(`https://api.zippopotam.us/mx/${zip_to}`);
            if (zipRes.ok) {
                const zipData = await zipRes.json();
                if (((_b = zipData.places) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                    const place = zipData.places[0];
                    destLevel1 = place.state || destLevel1;
                    destLevel2 = place['place name'] || destLevel2;
                    destLevel3 = place['place name'] || destLevel3;
                }
            }
        }
        catch ( /* use defaults */_f) { /* use defaults */ }
        // Official Skydropx PRO quotation body — Rails API requires quotation:{} root wrapper
        const quotationPayload = {
            address_from: {
                country_code: 'MX',
                postal_code: zip_from,
                area_level1: 'San Luis Potosí',
                area_level2: 'San Luis Potosí',
                area_level3: 'Centro',
            },
            address_to: {
                country_code: 'MX',
                postal_code: zip_to,
                area_level1: destLevel1,
                area_level2: destLevel2,
                area_level3: destLevel3,
            },
            parcels: [{
                    weight: Math.max(1, Math.round(p.weight || 5)),
                    height: Math.max(1, Math.round(p.height || 30)),
                    width: Math.max(1, Math.round(p.width || 30)),
                    length: Math.max(1, Math.round(p.length || 20)),
                }],
            package_protected: false,
            declared_value: 0,
            declared_amount: 0,
            requested_carriers: [],
        };
        const body = { quotation: quotationPayload };
        result.step3_quotation = Object.assign(Object.assign({}, result.step3_quotation), { sentBody: body });
        try {
            const createRes = await fetch(`${SKYDROPX_BASE}/quotations`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body),
            });
            const createText = await createRes.text();
            let createJson = null;
            try {
                createJson = JSON.parse(createText);
            }
            catch (_g) {
                createJson = createText;
            }
            if (createRes.ok && (createJson === null || createJson === void 0 ? void 0 : createJson.id)) {
                // Poll until completed
                const authHeaders = { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
                try {
                    const completed = await pollQuotation(createJson.id, authHeaders);
                    result.step3_quotation = {
                        url: `${SKYDROPX_BASE}/quotations`,
                        status: createRes.status,
                        quotationId: createJson.id,
                        sentBody: body,
                        response: completed,
                    };
                }
                catch (pollErr) {
                    result.step3_quotation = {
                        url: `${SKYDROPX_BASE}/quotations`,
                        status: createRes.status,
                        quotationId: createJson.id,
                        sentBody: body,
                        initialResponse: createJson,
                        pollError: pollErr.message,
                    };
                }
            }
            else {
                result.step3_quotation = { url: `${SKYDROPX_BASE}/quotations`, status: createRes.status, sentBody: body, response: createJson };
            }
        }
        catch (e) {
            result.step3_quotation = { error: e.message, sentBody: body };
        }
    }
    else {
        result.step3_quotation = { skipped: 'No OAuth token — check steps 1 & 2' };
    }
    console.log('[SkyDropX] RawTest v5:', JSON.stringify({ version: BUILD_VERSION, s1: result.step1_credentials, s2: (_c = result.step2_oauth) === null || _c === void 0 ? void 0 : _c.status, s3: (_d = result.step3_quotation) === null || _d === void 0 ? void 0 : _d.status }));
    return result;
});
/**
 * Extracts and normalises rate objects from Skydropx PRO API response.
 *
 * PRO API: POST /api/v1/quotations
 * Response structure (per official docs, 2025):
 * {
 *   id: string,
 *   is_completed: boolean,
 *   quotation_scope: { carriers_scoped_to: string },
 *   rates: [
 *     { id, success, provider_name, provider_display_name, provider_service_name,
 *       provider_service_code, status, currency_code, amount, total, days, ... }
 *   ]
 * }
 * Use `total` as the final price (includes all fees), fall back to `amount`.
 */
function extractRates(json) {
    // PRO response: rates is a direct array inside the response object
    const ratesArr = Array.isArray(json.rates) ? json.rates
        : Array.isArray(json.data) ? json.data
            : Array.isArray(json) ? json
                : [];
    return ratesArr
        .filter((r) => r && r.id && (r.total !== undefined || r.amount !== undefined))
        .map((r) => {
        var _a, _b, _c;
        const price = parseFloat(String((_b = (_a = r.total) !== null && _a !== void 0 ? _a : r.amount) !== null && _b !== void 0 ? _b : '0'));
        return {
            rateId: r.id,
            carrier: r.provider_name || r.provider_display_name || '',
            serviceName: r.provider_service_name || r.provider_service_code || '',
            price,
            currency: r.currency_code || 'MXN',
            estimatedDays: (_c = r.days) !== null && _c !== void 0 ? _c : null,
            status: r.status || '',
            success: r.success !== false,
        };
    })
        .filter((r) => r.price > 0 && r.success)
        .sort((a, b) => a.price - b.price);
}
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
/**
 * Refreshes the MeLi access token if it is expired or expiring within 30 minutes.
 * Returns the current valid access token string.
 * Throws if no refresh token is available or the refresh fails.
 */
async function getValidMeliToken() {
    var _a;
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
    if (!meliConfig || !meliConfig.accessToken) {
        throw new Error('MercadoLibre not connected. No access token found.');
    }
    // Proactively refresh if: no expiresAt stored, or token expires in <30 min
    const thirtyMin = 30 * 60 * 1000;
    const needsRefresh = !meliConfig.expiresAt || (meliConfig.expiresAt - Date.now()) < thirtyMin;
    if (!needsRefresh) {
        console.log('[Meli] Token is valid, no refresh needed.');
        return meliConfig.accessToken;
    }
    console.log('[Meli] Token expired or expiring soon — attempting refresh...');
    if (!meliConfig.refreshToken) {
        console.warn('[Meli] No refresh token available. User must re-authenticate.');
        return meliConfig.accessToken;
    }
    const appId = meliConfig.appId;
    const clientSecret = meliConfig.clientSecret;
    if (!appId || !clientSecret) {
        console.warn('[Meli] Missing app credentials for refresh. Using existing token.');
        return meliConfig.accessToken;
    }
    try {
        const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: appId,
                client_secret: clientSecret,
                refresh_token: meliConfig.refreshToken,
            }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('[Meli] Token refresh failed:', JSON.stringify(tokenData));
            if (tokenData.error === 'invalid_grant') {
                await db.collection('config').doc('integrations').set({ meli: { connected: false } }, { merge: true });
                throw new Error('MeLi refresh token expired. Please re-authenticate in /admin/integrations.');
            }
            console.warn('[Meli] Falling back to existing token.');
            return meliConfig.accessToken;
        }
        const newExpiresAt = Date.now() + (tokenData.expires_in * 1000);
        await db.collection('config').doc('integrations').set({
            meli: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: newExpiresAt,
                connected: true,
            }
        }, { merge: true });
        console.log('[Meli] Token refreshed successfully. Expires at:', new Date(newExpiresAt).toISOString());
        return tokenData.access_token;
    }
    catch (err) {
        console.error('[Meli] Token refresh error:', err.message);
        return meliConfig.accessToken;
    }
}
/**
 * App-level token using client_credentials grant.
 * This is the CORRECT token type for reading public ML marketplace data from a server.
 * Unlike the user OAuth token, ML does NOT block client_credentials requests from GCP IPs.
 * Cached in Firestore with a 6-hour TTL to minimise token API calls.
 */
async function getAppLevelToken() {
    var _a, _b, _c;
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = (_b = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli) !== null && _b !== void 0 ? _b : {};
    const appId = meliConfig.appId;
    const clientSecret = meliConfig.clientSecret;
    if (!appId || !clientSecret) {
        console.warn('[Meli:AppToken] Missing appId/clientSecret — falling back to user token');
        return getValidMeliToken();
    }
    // Check cached app token (valid for most of its 6h window)
    const cached = meliConfig.appAccessToken;
    const cachedExp = (_c = meliConfig.appTokenExpiresAt) !== null && _c !== void 0 ? _c : 0;
    if (cached && (cachedExp - Date.now()) > 10 * 60 * 1000) {
        console.log('[Meli:AppToken] Cache HIT — reusing app token');
        return cached;
    }
    console.log('[Meli:AppToken] Fetching new app-level token (client_credentials)...');
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: appId,
            client_secret: clientSecret,
        }).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        console.error('[Meli:AppToken] client_credentials fetch failed:', JSON.stringify(data));
        // Fallback to user token — better than nothing
        return getValidMeliToken();
    }
    const expiresAt = Date.now() + (data.expires_in * 1000);
    await db.collection('config').doc('integrations').set({
        meli: { appAccessToken: data.access_token, appTokenExpiresAt: expiresAt }
    }, { merge: true });
    console.log('[Meli:AppToken] New app token cached, expires:', new Date(expiresAt).toISOString());
    return data.access_token;
}
// 1. Generate Auth URL (Callable)
exports.meliAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const config = await getMeliConfig();
        // ── Scopes requested — must match what is activated in App Center ─────────
        // offline_access  = enables token refresh (long-lived sessions)
        // read            = public marketplace search (listings, prices, categories)
        // write           = create/update/pause/delete listings (Publicación y sincronización)
        // read_orders     = read order details, shipping, returns (Ventas y envíos)
        // write_orders    = manage fulfillment, dispatches, chargebacks
        // read_messages   = read buyer/seller pre & post-sale messages
        // write_messages  = send messages to buyers
        // read_billing    = access income, movements, account balance (Facturación)
        // read_promotions = access existing offers and coupons
        // write_promotions= create/manage promotions and coupons
        // read_ads        = access advertising campaigns (Publicidad)
        // write_ads       = create/manage advertising campaigns
        // read_users      = access account info via /users/me
        const SCOPES = [
            'offline_access', 'read', 'write',
            'read_orders', 'write_orders',
            'read_messages', 'write_messages',
            'read_billing',
            'read_promotions', 'write_promotions',
            'read_ads', 'write_ads',
            'read_users',
        ].join(' ');
        const url = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${config.appId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=${encodeURIComponent(SCOPES)}`;
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
exports.meliRefreshTokenScheduled = functions.pubsub.schedule('every 4 hours').onRun(async (_ctx) => {
    console.log('[Meli] Running scheduled token refresh...');
    try {
        const config = await getMeliConfig();
        if (!config.refreshToken) {
            console.log('[Meli] No refresh token available. Skipping.');
            return;
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
            if (tokenData.error === 'invalid_grant') {
                await db.collection('config').doc('integrations').set({
                    meli: { connected: false }
                }, { merge: true });
            }
            return;
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
    }
    catch (err) {
        console.error('[Meli] Scheduled refresh error:', err);
    }
});
// Helper: Parse and construct Eurollantas Order object from a Meli Order, Ship Data, and Billing Info
function parseAndSaveMeliOrder(mo, shipData, billingData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
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
    // Detect fulfillment type using 3 signals in priority order:
    // 1. shipment.logistic.type  (nested — correct path per ML /shipments API docs)
    // 2. shipment.logistic_type  (top-level fallback — field exists on items/.., sometimes null here)
    // 3. order item logistic_type (item-level fallback when shipment fetch silently failed)
    const logisticType = (_d = (_c = (_b = shipData === null || shipData === void 0 ? void 0 : shipData.logistic) === null || _b === void 0 ? void 0 : _b.type // ← correct nested path
    ) !== null && _c !== void 0 ? _c : shipData === null || shipData === void 0 ? void 0 : shipData.logistic_type // ← top-level fallback
    ) !== null && _d !== void 0 ? _d : (_g = (_f = (_e = mo.order_items) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.item) === null || _g === void 0 ? void 0 : _g.logistic_type; // ← item-level last resort
    const fType = logisticType === 'fulfillment' ? 'platform' : // MELI Full — ML warehouse packs & ships
        logisticType === 'self_service' ? 'flex' : // MELI Flex — seller packs, same-day delivery
            'merchant'; // Classic   — seller packs, standard MercadoEnvíos
    // ── Extract Handling Limit (Native MeLi SLA Dispatch Deadline) ──────────
    // With x-format-new:true, the field is shipping_option.estimated_handling_limit.date
    let nativeSla = null;
    if ((_j = (_h = shipData === null || shipData === void 0 ? void 0 : shipData.shipping_option) === null || _h === void 0 ? void 0 : _h.estimated_handling_limit) === null || _j === void 0 ? void 0 : _j.date) {
        nativeSla = new Date(shipData.shipping_option.estimated_handling_limit.date);
    }
    else if ((_l = (_k = shipData === null || shipData === void 0 ? void 0 : shipData.shipping_option) === null || _k === void 0 ? void 0 : _k.estimated_delivery_time) === null || _l === void 0 ? void 0 : _l.date) {
        nativeSla = new Date(shipData.shipping_option.estimated_delivery_time.date);
    }
    // ── MeLi Delay flag — most authoritative source ────────────────────────
    // The 'delay' array on shipment object (x-format-new) contains entries like
    // { type: 'shipping_delayed' } when MeLi has officially flagged a dispatch delay.
    const meliDelayTypes = ((shipData === null || shipData === void 0 ? void 0 : shipData.delay) || []).map((d) => d.type || d).filter(Boolean);
    const meliDelayed = meliDelayTypes.length > 0;
    // ── Build timeline history ─────────────────────────────────────────────
    const history = [];
    // Actual ship & delivery dates from status_history (new format) or dates object (old format)
    const rawDateShipped = (_q = (_o = (_m = shipData === null || shipData === void 0 ? void 0 : shipData.status_history) === null || _m === void 0 ? void 0 : _m.date_shipped // new format (x-format-new)
    ) !== null && _o !== void 0 ? _o : (_p = shipData === null || shipData === void 0 ? void 0 : shipData.dates) === null || _p === void 0 ? void 0 : _p.date_shipped // old format fallback
    ) !== null && _q !== void 0 ? _q : null;
    const rawDateDelivered = (_u = (_s = (_r = shipData === null || shipData === void 0 ? void 0 : shipData.status_history) === null || _r === void 0 ? void 0 : _r.date_delivered // new format
    ) !== null && _s !== void 0 ? _s : (_t = shipData === null || shipData === void 0 ? void 0 : shipData.dates) === null || _t === void 0 ? void 0 : _t.date_delivered // old format fallback
    ) !== null && _u !== void 0 ? _u : null;
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
    if (rawDateShipped) {
        history.push({
            status: 'shipped',
            timestamp: new Date(rawDateShipped),
            note: 'Shipped via ' + ((shipData === null || shipData === void 0 ? void 0 : shipData.tracking_method) || 'MercadoEnvíos'),
            carrier: (shipData === null || shipData === void 0 ? void 0 : shipData.tracking_method) || 'MercadoEnvíos',
            trackingNumber: (shipData === null || shipData === void 0 ? void 0 : shipData.tracking_number) || '',
            updatedBy: 'system'
        });
    }
    if (rawDateDelivered) {
        history.push({
            status: 'delivered',
            timestamp: new Date(rawDateDelivered),
            note: 'Delivered to buyer',
            updatedBy: 'system'
        });
    }
    else if (!rawDateShipped && hasDeliveredTag) {
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
    // ── Smart buyer name extraction ──────────────────────────────────────────────
    // MeLi anonymizes buyer names: "Juan Garcia" → "SAJU960995" or "VALENCIALIZ20220830234831"
    // Detection: ALL_UPPERCASE string with digits, no spaces → it's an anonymized code.
    const isAnonymizedMeliName = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
    const rawFirstName = ((_v = mo.buyer) === null || _v === void 0 ? void 0 : _v.first_name) || '';
    const rawLastName = ((_w = mo.buyer) === null || _w === void 0 ? void 0 : _w.last_name) || '';
    const rawFullName = `${rawFirstName} ${rawLastName}`.trim();
    const nickname = ((_x = mo.buyer) === null || _x === void 0 ? void 0 : _x.nickname) || '';
    // Priority: readable full name → readable nickname → anonymized code → fallback
    let buyerDisplayName;
    if (rawFullName && !isAnonymizedMeliName(rawFullName)) {
        buyerDisplayName = rawFullName; // "Juan Carlos Saucedo Chavez"
    }
    else if (nickname && !isAnonymizedMeliName(nickname)) {
        buyerDisplayName = nickname; // Readable nickname (e.g. "juansaucedo99")
    }
    else {
        buyerDisplayName = rawFullName || nickname || 'Meli Buyer'; // Anonymized, best we have
    }
    const buyerIsAnonymized = isAnonymizedMeliName(buyerDisplayName);
    return Object.assign(Object.assign({ id: `meli_${mo.id}`, orderNumber: `ML-${mo.id}`, sourceChannel: 'mercadolibre', fulfillmentType: fType, shippingId: ((_y = mo.shipping) === null || _y === void 0 ? void 0 : _y.id) ? String(mo.shipping.id) : '', externalOrderId: String(mo.id), 
        // Store pack_id separately — since 2024 all MeLi orders belong to a pack.
        // pack_id is what webhooks typically reference; mo.id is the seller-visible order ID.
        meliPackId: mo.pack_id ? String(mo.pack_id) : null, customer: {
            id: `ml_${(_z = mo.buyer) === null || _z === void 0 ? void 0 : _z.id}`,
            // current name — may transition from real name to anonymized code over time
            name: buyerDisplayName,
            // originalName: first readable version captured — the write logic preserves this on updates
            originalName: buyerDisplayName,
            // Extra MeLi identity fields — stored for UI display and support
            meliNickname: nickname || null,
            meliAnonymizedId: isAnonymizedMeliName(rawFullName) ? rawFullName : (isAnonymizedMeliName(nickname) ? nickname : null),
            isAnonymized: buyerIsAnonymized,
            email: ((_0 = mo.buyer) === null || _0 === void 0 ? void 0 : _0.email) || `${(_1 = mo.buyer) === null || _1 === void 0 ? void 0 : _1.id}@mercadolibre.com`,
            phone: ((_3 = (_2 = mo.buyer) === null || _2 === void 0 ? void 0 : _2.phone) === null || _3 === void 0 ? void 0 : _3.number) || ((_5 = (_4 = mo.buyer) === null || _4 === void 0 ? void 0 : _4.phone) === null || _5 === void 0 ? void 0 : _5.area_code) ? `${((_7 = (_6 = mo.buyer) === null || _6 === void 0 ? void 0 : _6.phone) === null || _7 === void 0 ? void 0 : _7.area_code) || ''}${((_9 = (_8 = mo.buyer) === null || _8 === void 0 ? void 0 : _8.phone) === null || _9 === void 0 ? void 0 : _9.number) || ''}` : '',
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
        })(), createdAt: mo.date_created ? new Date(mo.date_created) : admin.firestore.FieldValue.serverTimestamp(), updatedAt: mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp(), nativeSla: nativeSla, 
        // Top-level ship/delivery timestamps for fast SLA evaluation without scanning history
        shippedAt: rawDateShipped ? new Date(rawDateShipped) : null, deliveredAt: rawDateDelivered ? new Date(rawDateDelivered) : null, 
        // meliDelayed: true means MercadoLibre's own system flagged this as a dispatch delay
        meliDelayed: meliDelayed, meliDelayTypes: meliDelayTypes }, (billingData && !billingData.error ? (() => {
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
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
                const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                if (orig)
                    existingNameMap.set(String(mo.id), orig);
            }
            catch (_) { /* skip */ }
        }));
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const shipCosts = ((_c = mo.shipping) === null || _c === void 0 ? void 0 : _c.id) ? shipmentCostsMap[mo.shipping.id] : null;
            // Construct Eurollantas Order object using helper
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
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
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!(meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.accessToken))
            throw new Error('MeLi not connected.');
        const accessToken = await getValidMeliToken();
        // Find all MeLi orders that have a shipmentId but 0 or missing shipping cost
        const ordersSnap = await db.collection('orders')
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
            const shippingOrdersSnap = await db.collection('orders')
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
        const batch = db.batch();
        // Pre-fetch existing originalNames in parallel before batch-writing
        const origNameMap = new Map();
        await Promise.all(meliOrders.map(async (mo) => {
            var _a, _b;
            try {
                const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                if (orig)
                    origNameMap.set(String(mo.id), orig);
            }
            catch (_) { /* skip */ }
        }));
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
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
exports.meliSyncFullInventory = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to sync FBM inventory.');
    }
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre is not connected or missing tokens.');
        }
        // 1. Fetch ALL fulfillment item IDs (paginated)
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
        console.log(`[Meli FBM] Found ${allItemIds.length} Full items. Fetching details + real stock...`);
        // 2. Fetch full item details in chunks of 20 (MULTIGET API limit)
        const chunkSize = 20;
        let syncedCount = 0;
        const firestoreBatch = db.batch();
        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsUrl = `https://api.mercadolibre.com/items?ids=${chunk.join(',')}`;
            const itemsRes = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
            if (!itemsRes.ok) {
                console.error(`[Meli FBM] Failed to fetch items chunk starting at ${i}`, await itemsRes.text());
                continue;
            }
            const itemsJson = await itemsRes.json();
            for (const itemObj of itemsJson) {
                if (itemObj.code !== 200 || !itemObj.body)
                    continue;
                const body = itemObj.body;
                // Extract SKU from SELLER_SKU attribute
                const skuAttr = (_b = body.attributes) === null || _b === void 0 ? void 0 : _b.find((a) => a.id === 'SELLER_SKU');
                const sku = skuAttr ? skuAttr.value_name : null;
                // Extract user_product_id — may be at root or inside first variation
                const userProductId = body.user_product_id ||
                    ((_d = (_c = body.variations) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.user_product_id) ||
                    null;
                // 3. Query REAL Full warehouse stock via /user-products/{id}/stock
                let fullStock = body.available_quantity || 0;
                let fullStockReserved = 0;
                if (userProductId) {
                    try {
                        const stockRes = await fetch(`https://api.mercadolibre.com/user-products/${userProductId}/stock`, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
                        if (stockRes.ok) {
                            const stockJson = await stockRes.json();
                            const meliFacility = (stockJson.locations || []).find((l) => l.type === 'meli_facility');
                            if (meliFacility) {
                                fullStock = (_e = meliFacility.available_quantity) !== null && _e !== void 0 ? _e : fullStock;
                                fullStockReserved = (_f = meliFacility.not_available_quantity) !== null && _f !== void 0 ? _f : 0;
                            }
                        }
                        else {
                            console.warn(`[Meli FBM] Stock fetch failed for user_product_id=${userProductId}: ${stockRes.status}`);
                        }
                    }
                    catch (stockErr) {
                        console.warn(`[Meli FBM] Stock fetch error for ${userProductId}:`, stockErr);
                    }
                }
                // Firestore document IDs cannot contain forward slashes
                // Some SKUs like "80/90-17-EY..." contain them.
                const rawDocId = String(sku || body.id);
                const safeDocId = rawDocId.replace(/\//g, '_');
                const inventoryRef = db.collection('meli_fbm_inventory').doc(safeDocId);
                firestoreBatch.set(inventoryRef, {
                    mlItemId: body.id,
                    sku: sku,
                    title: body.title,
                    status: body.status || 'active',
                    price: body.price || 0,
                    permalink: body.permalink || null,
                    thumbnail: body.thumbnail || null,
                    inventoryId: body.inventory_id || null,
                    userProductId: userProductId,
                    availableQuantity: fullStock,
                    fullStock: fullStock,
                    fullStockReserved: fullStockReserved,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                syncedCount++;
            }
        }
        // 4. Commit batch to Firestore
        await firestoreBatch.commit();
        console.log(`[Meli FBM] Synced ${syncedCount} FBM items with real warehouse stock.`);
        return { success: true, syncedCount };
    }
    catch (e) {
        console.error('Error in meliSyncFullInventory:', e);
        throw new functions.https.HttpsError('internal', e.message || 'sync failed');
    }
});
// ─── MercadoLibre Listings Sync (Publications Price Analyzer) ────────────────
// Fetches ALL seller listings + calculates published price, MeLi fees, and net receipt.
// Results stored in meli_listings/{item_id} for the Publications tab in the Hub.
exports.meliSyncListings = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    try {
        // ── Auto-refresh token if expired or expiring soon ────────────────────────
        // MeLi tokens expire every 6h. getValidMeliToken() refreshes proactively
        // if expiry is within 30 min, so syncs never fail due to stale tokens.
        const accessToken = await getValidMeliToken();
        // Still need userId from config
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
        }
        const authHeaders = { Authorization: `Bearer ${accessToken}` };
        // ── Step 1: Collect ALL item IDs via offset pagination (robust for any catalog size) ─
        const allItemIds = [];
        const pageLimit = 100;
        let offset = 0;
        let totalFromApi = 0;
        console.log('[Meli Listings] Starting item ID collection via offset pagination...');
        while (true) {
            const searchUrl = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?limit=${pageLimit}&offset=${offset}`;
            const searchRes = await fetch(searchUrl, { headers: authHeaders });
            if (!searchRes.ok) {
                const errText = await searchRes.text();
                console.error('[Meli Listings] Search page failed:', searchRes.status, errText);
                break;
            }
            const searchJson = await searchRes.json();
            const results = searchJson.results || [];
            totalFromApi = ((_b = searchJson.paging) === null || _b === void 0 ? void 0 : _b.total) || totalFromApi;
            console.log(`[Meli Listings] Page offset=${offset}: got ${results.length} ids, total=${totalFromApi}`);
            if (results.length === 0)
                break;
            allItemIds.push(...results);
            offset += results.length;
            if (results.length < pageLimit || allItemIds.length >= totalFromApi)
                break;
            // Small rate-limit buffer between pages
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (allItemIds.length === 0) {
            console.warn('[Meli Listings] No item IDs found via offset pagination.');
            return { success: true, syncedCount: 0, message: 'No listings found in account.' };
        }
        console.log(`[Meli Listings] Collected ${allItemIds.length} item IDs. Fetching details + fees...`);
        // Listing type display name map (MLM)
        const listingTypeNames = {
            'gold_pro': 'Premium',
            'gold_special': 'Clásica',
            'gold': 'Oro',
            'free': 'Gratis',
            'bronze': 'Bronce',
            'silver': 'Plata',
        };
        // ── Step 2: Multiget item details in chunks of 20 ────────────────────
        const chunkSize = 20;
        const BATCH_LIMIT = 400; // Firestore max is 500; keep margin
        let syncedCount = 0;
        let currentBatch = db.batch();
        let batchCount = 0;
        // Fee cache: key = "${listingTypeId}_${roundedPrice}_${categoryId}" → fee data
        // ⚠️ /listing_prices returns an ARRAY — one entry per listing type.
        //    We filter to find the entry matching the item's listing_type_id.
        // Fields stored:
        //   selling_fee_amount → total MeLi commission in MXN
        //   selling_fee_percent → commission % (from API, not recalculated)
        //   fixed_fee → fixed per-unit charge (often 0 in MLM)
        //   financing_fee → cost MeLi deducts when buyers pay in MSI installments
        //                    (can be 2–3% of sale price — real money!)
        const feeCache = new Map();
        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsRes = await fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(',')}`, { headers: authHeaders });
            if (!itemsRes.ok) {
                console.error(`[Meli Listings] Multiget chunk i=${i} failed:`, itemsRes.status);
                continue;
            }
            const itemsJson = await itemsRes.json();
            for (const wrapper of itemsJson) {
                if (wrapper.code !== 200 || !wrapper.body)
                    continue;
                const item = wrapper.body;
                const price = item.price || 0;
                const listingTypeId = item.listing_type_id || 'free';
                const categoryId = item.category_id || '';
                // ── Step 3: Fee lookup (cached per unique price+type+category combo) ─
                const feeCacheKey = `${Math.round(price)}_${listingTypeId}_${categoryId}`;
                let feeData = feeCache.get(feeCacheKey);
                if (!feeData) {
                    try {
                        // listing_prices requires auth for seller-specific rates and returns an ARRAY
                        let feeUrl = `https://api.mercadolibre.com/sites/MLM/listing_prices?price=${price}&listing_type_id=${listingTypeId}`;
                        if (categoryId)
                            feeUrl += `&category_id=${categoryId}`;
                        const feeRes = await fetch(feeUrl, { headers: authHeaders }); // auth for seller-specific rates
                        if (feeRes.ok) {
                            // Response is an array — find the entry for our listing_type_id
                            const feeArray = await feeRes.json();
                            const feeEntry = Array.isArray(feeArray)
                                ? feeArray.find((e) => e.listing_type_id === listingTypeId)
                                : feeArray; // fallback: treat as single object (old format)
                            if (feeEntry) {
                                // ── CONFIRMED real API response format for MLM ────────────
                                // {
                                //   "sale_fee_amount": 463.27,          ← NOTE: sale_, not selling_
                                //   "sale_fee_details": {
                                //     "percentage_fee": 16.5,           ← direct number
                                //     "fixed_fee": 0,                   ← direct number
                                //     "gross_amount": 463.27
                                //   }
                                // }
                                // ─────────────────────────────────────────────────────────
                                // Commission total in MXN — field is "sale_fee_amount" in real API
                                const commissionAmount = (_d = (_c = feeEntry.sale_fee_amount // real API field
                                ) !== null && _c !== void 0 ? _c : feeEntry.selling_fee_amount // fallback alias
                                ) !== null && _d !== void 0 ? _d : 0;
                                const rawDetails = (_e = feeEntry.sale_fee_details) !== null && _e !== void 0 ? _e : {};
                                let pct = 0;
                                let fixedFee = 0;
                                let financing = 0;
                                if (Array.isArray(rawDetails)) {
                                    // Older array format: [{name:'percentage_fee', value:16.5}, ...]
                                    const pctEntry = rawDetails.find((d) => d.name === 'percentage_fee');
                                    const fixEntry = rawDetails.find((d) => d.name === 'fixed_fee');
                                    const finEntry = rawDetails.find((d) => d.name === 'financing_add_on_fee' || d.name === 'financing_fee');
                                    pct = Number((_g = (_f = pctEntry === null || pctEntry === void 0 ? void 0 : pctEntry.percentage_fee) !== null && _f !== void 0 ? _f : pctEntry === null || pctEntry === void 0 ? void 0 : pctEntry.value) !== null && _g !== void 0 ? _g : 0);
                                    fixedFee = Number((_j = (_h = fixEntry === null || fixEntry === void 0 ? void 0 : fixEntry.amount) !== null && _h !== void 0 ? _h : fixEntry === null || fixEntry === void 0 ? void 0 : fixEntry.value) !== null && _j !== void 0 ? _j : 0);
                                    financing = Number((_l = (_k = finEntry === null || finEntry === void 0 ? void 0 : finEntry.amount) !== null && _k !== void 0 ? _k : finEntry === null || finEntry === void 0 ? void 0 : finEntry.value) !== null && _l !== void 0 ? _l : 0);
                                }
                                else if (rawDetails && typeof rawDetails === 'object') {
                                    // Current object format: {percentage_fee: 16.5, fixed_fee: 0, ...}
                                    // Values are DIRECT NUMBERS, not nested objects
                                    pct = Number((_m = rawDetails['percentage_fee']) !== null && _m !== void 0 ? _m : 0);
                                    fixedFee = Number((_o = rawDetails['fixed_fee']) !== null && _o !== void 0 ? _o : 0);
                                    financing = Number((_q = (_p = rawDetails['financing_add_on_fee']) !== null && _p !== void 0 ? _p : rawDetails['financing_fee']) !== null && _q !== void 0 ? _q : 0);
                                }
                                // If API gave us %, use it; otherwise derive from amount/price
                                const sellingFeePercent = pct > 0
                                    ? pct
                                    : (price > 0 ? Math.round((commissionAmount / price) * 1000) / 10 : 0);
                                feeData = {
                                    selling_fee_amount: commissionAmount,
                                    selling_fee_percent: sellingFeePercent,
                                    fixed_fee: fixedFee,
                                    financing_fee: financing,
                                };
                                // Log first fee lookup per sync
                                if (feeCache.size === 0) {
                                    console.log(`[Meli Listings] ✅ Fee [${listingTypeId}] @ $${price}: commission=$${commissionAmount} (${sellingFeePercent}%), fixed=$${fixedFee}, financing=$${financing}`);
                                    console.log(`[Meli Listings] Raw feeEntry:`, JSON.stringify(feeEntry).substring(0, 600));
                                }
                            }
                            else {
                                console.warn(`[Meli Listings] No fee entry for listing_type_id=${listingTypeId} in response for item ${item.id}`);
                                feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                            }
                            feeCache.set(feeCacheKey, feeData);
                        }
                        else {
                            const errText = await feeRes.text();
                            console.warn(`[Meli Listings] Fee API returned ${feeRes.status} for ${item.id}:`, errText.substring(0, 200));
                            feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                        }
                    }
                    catch (feeErr) {
                        console.warn(`[Meli Listings] Fee fetch failed for ${item.id}:`, feeErr);
                        feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                    }
                }
                // ── Step 4: Calculate net_amount ─────────────────────────────
                // NOTE on shipping:
                // The /listing_prices endpoint does NOT give us a reliable per-listing
                // shipping cost because it varies dynamically by buyer location, weight,
                // and volume. What we CAN tell is:
                //   - item.shipping.free_shipping = seller absorbs cost of shipping
                //   - item.shipping.logistic_type  = 'fulfillment' | 'me2' | 'not_specified'
                // Actual shipping cost per sale comes from /shipments/{id} (order-level).
                // Here we only include what the listing_prices API tells us for sure.
                const totalSellerCost = feeData.selling_fee_amount
                    + feeData.fixed_fee
                    + feeData.financing_fee; // financing cost if buyers use MSI
                const netAmount = Math.max(0, price - totalSellerCost);
                const netPercent = price > 0 ? Math.round((netAmount / price) * 1000) / 10 : 0;
                const feeHasData = feeData.selling_fee_amount > 0 || feeData.selling_fee_percent > 0;
                // Shipping flags from item body
                const freeShipping = ((_r = item.shipping) === null || _r === void 0 ? void 0 : _r.free_shipping) === true;
                // Local pickup only (no Mercado Envíos)
                const localPickupOnly = !freeShipping && (((_s = item.shipping) === null || _s === void 0 ? void 0 : _s.logistic_type) === 'not_specified' || !((_t = item.shipping) === null || _t === void 0 ? void 0 : _t.logistic_type));
                // Extract logistic type
                const logisticType = ((_u = item.shipping) === null || _u === void 0 ? void 0 : _u.logistic_type) || 'not_specified';
                const isFull = logisticType === 'fulfillment';
                // ── Shipping dimensions from item (set by seller at listing creation) ──
                // Format: "LxWxH,weightGrams"  e.g. "30x20x10,5000"
                // These are the physical dimensions that determine the shipping rate.
                const rawDims = (_w = (_v = item.shipping) === null || _v === void 0 ? void 0 : _v.dimensions) !== null && _w !== void 0 ? _w : null;
                let shipping_weight_g = null;
                let shipping_dims_cm = null;
                if (rawDims) {
                    const parts = rawDims.split(',');
                    const weightPart = parts[1] ? parseInt(parts[1], 10) : NaN;
                    if (!isNaN(weightPart))
                        shipping_weight_g = weightPart;
                    const dimPart = parts[0] ? parts[0].split('x').map(Number) : [];
                    if (dimPart.length === 3 && dimPart.every(n => !isNaN(n))) {
                        shipping_dims_cm = { l: dimPart[0], w: dimPart[1], h: dimPart[2] };
                    }
                }
                // Extract user_product_id
                const userProductId = item.user_product_id || ((_y = (_x = item.variations) === null || _x === void 0 ? void 0 : _x[0]) === null || _y === void 0 ? void 0 : _y.user_product_id) || null;
                // ── Kit / Combo / Bundle detection ───────────────────────────
                // Three reliable signals from MeLi (checked in priority order):
                //
                // 1. PACK_CONTENT attribute — MeLi's own classification for packs/kits.
                //    E.g. "2 llantas" or "4 piezas" written by seller explicitly.
                // 2. bundle_items array — explicit bundle components linked by MeLi.
                // 3. item_relations with type 'pack' or 'bundle' — cross-links to
                //    component items.
                const itemAttributes = item.attributes || [];
                const packContentAttr = itemAttributes.find((a) => a.id === 'PACK_CONTENT' || a.id === 'ITEM_AMOUNT');
                const hasPackAttribute = packContentAttr && packContentAttr.value_name
                    && packContentAttr.value_name !== '1';
                // ── Tire size attributes (for Price Intelligence cross-reference) ─
                const tireWidthAttr = itemAttributes.find((a) => a.id === 'TIRE_WIDTH');
                const aspectRatioAttr = itemAttributes.find((a) => a.id === 'ASPECT_RATIO');
                const rimDiameterAttr = itemAttributes.find((a) => a.id === 'RIM_DIAMETER');
                const tireWidth_pi = tireWidthAttr ? (Number(tireWidthAttr.value_name) || null) : null;
                const tireAspectRatio_pi = aspectRatioAttr ? (Number(aspectRatioAttr.value_name) || null) : null;
                const tireDiameter_pi = rimDiameterAttr ? (Number(rimDiameterAttr.value_name) || null) : null;
                const itemRelations = item.item_relations || [];
                const bundleItems = item.bundle_items || [];
                const hasBundleItems = bundleItems.length > 0;
                const hasRelations = itemRelations.some((r) => r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK');
                // Explicit boolean — Firestore rejects undefined
                const isCombo = Boolean(hasBundleItems || hasRelations || hasPackAttribute);
                const bundleComponents = hasBundleItems
                    ? bundleItems.map((b) => ({ item_id: b.item_id || b.id, quantity: b.quantity || 1 }))
                    : itemRelations
                        .filter((r) => r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK')
                        .map((r) => ({ item_id: r.id, quantity: r.quantity || 1 }));
                // item_type: 'kit' when MeLi bundle_items or PACK attribute,
                //            'combo' when item_relations pack,
                //            'single' otherwise
                const itemType = isCombo
                    ? (hasBundleItems || Boolean(hasPackAttribute) ? 'kit' : 'combo')
                    : 'single';
                // Pack quantity from attribute (e.g. "2" for a 2-pack) — null, never undefined
                const rawPackQty = packContentAttr ? parseInt(packContentAttr.value_name, 10) : NaN;
                const packQty = isNaN(rawPackQty) ? null : rawPackQty;
                // ── Step 5: Batch write to meli_listings/{item_id} ───────────
                const listingRef = db.collection('meli_listings').doc(item.id);
                currentBatch.set(listingRef, {
                    id: item.id,
                    title: item.title,
                    status: item.status || 'active',
                    price: price,
                    currency_id: item.currency_id || 'MXN',
                    listing_type_id: listingTypeId,
                    listing_type_name: listingTypeNames[listingTypeId] || listingTypeId,
                    sold_quantity: item.sold_quantity || 0,
                    available_quantity: item.available_quantity || 0,
                    health: (_z = item.health) !== null && _z !== void 0 ? _z : null,
                    logistic_type: logisticType,
                    is_full: isFull,
                    // ── Shipping info ────────────────────────────────────────
                    // free_shipping: true = seller absorbs shipping cost (envío gratis al comprador)
                    // logistic_type: 'fulfillment' | 'me2' | 'not_specified'
                    // dimensions: physical size/weight set by seller — determines shipping rate
                    free_shipping: freeShipping,
                    local_pickup_only: localPickupOnly,
                    shipping_dims_raw: rawDims,
                    shipping_weight_g: shipping_weight_g,
                    shipping_dims_cm: shipping_dims_cm,
                    // avg_shipping_cost: populated after order sync (see aggregation step)
                    user_product_id: userProductId,
                    category_id: categoryId,
                    seller_custom_field: item.seller_custom_field || null,
                    permalink: item.permalink || null,
                    thumbnail: item.thumbnail || null,
                    // ── Fee breakdown from /sites/MLM/listing_prices (with auth) ────
                    selling_fee_amount: feeData.selling_fee_amount,
                    selling_fee_percent: feeData.selling_fee_percent,
                    fixed_fee: feeData.fixed_fee,
                    financing_fee: feeData.financing_fee,
                    net_amount: netAmount,
                    net_percent: netPercent,
                    fee_has_data: feeHasData,
                    // ── Kit / Combo / Bundle ─────────────────────────────────
                    item_type: itemType,
                    is_combo: isCombo,
                    pack_qty: packQty,
                    bundle_components: bundleComponents,
                    // ── Tire size for Price Intelligence (auto cross-reference) ─
                    tireWidth: tireWidth_pi,
                    tireAspectRatio: tireAspectRatio_pi,
                    tireDiameter: tireDiameter_pi,
                    lastSync: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                syncedCount++;
                batchCount++;
                // Commit if approaching Firestore batch limit
                if (batchCount >= BATCH_LIMIT) {
                    await currentBatch.commit();
                    console.log(`[Meli Listings] Committed batch of ${batchCount} docs (total so far: ${syncedCount})`);
                    currentBatch = db.batch();
                    batchCount = 0;
                }
            }
            // Rate limit buffer between chunks
            if (i + chunkSize < allItemIds.length) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }
        // Commit any remaining docs
        if (batchCount > 0) {
            await currentBatch.commit();
        }
        console.log(`[Meli Listings] Synced ${syncedCount} listings. Unique fee combos cached: ${feeCache.size}.`);
        return { success: true, syncedCount, featureCombos: feeCache.size };
    }
    catch (e) {
        console.error('[Meli Listings] Sync failed:', e);
        throw new functions.https.HttpsError('internal', e.message || 'listings sync failed');
    }
});
// ─── Price Intelligence: Competitor Market Scan via ML Official API ───────────
//
// Callable from Angular: httpsCallable(functions, 'meliPriceScan')
// Input:  { width: number, aspectRatio: number, diameter: number, categoryId?: string, force?: boolean }
// Output: { cached: boolean, fingerprint: string, stats: object, count: number }
//
// Strategy: Uses ML attribute-based search (TIRE_WIDTH, ASPECT_RATIO, RIM_DIAMETER)
// to retrieve all competitor listings for an exact tire size — no URL management,
// no scraping. Results are cached in Firestore (price_intelligence/{fingerprint})
// with a 4-hour TTL to minimize API calls.
//
exports.meliPriceScan = functions.runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { width, aspectRatio, diameter, force = false } = data;
    // competitorItemIds: pre-populated by the client (browser-side ML search, not blocked)
    const clientCompetitorIds = Array.isArray(data.competitorItemIds)
        ? data.competitorItemIds.slice(0, 100)
        : [];
    let categoryId = (_a = data.categoryId) !== null && _a !== void 0 ? _a : 'MLM169975'; // may be overridden by autodiscovery below
    if (!width || !aspectRatio || !diameter) {
        throw new functions.https.HttpsError('invalid-argument', 'width, aspectRatio, and diameter are required.');
    }
    const fingerprint = `${width}_${aspectRatio}_R${diameter}`;
    console.log(`[PriceIntel] Scan requested: ${fingerprint} (category: ${categoryId}, force: ${force})`);
    // ── 1. Check Firestore cache (4-hour TTL) ─────────────────────────────────
    if (!force) {
        const cacheDoc = await db.collection('price_intelligence').doc(fingerprint).get();
        if (cacheDoc.exists) {
            const lastScanned = (_d = (_c = (_b = cacheDoc.data()) === null || _b === void 0 ? void 0 : _b.lastScanned) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c);
            const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
            if (lastScanned && lastScanned > fourHoursAgo) {
                console.log(`[PriceIntel] Cache HIT for ${fingerprint}`);
                return {
                    cached: true,
                    fingerprint,
                    stats: (_f = (_e = cacheDoc.data()) === null || _e === void 0 ? void 0 : _e.stats) !== null && _f !== void 0 ? _f : null,
                    count: ((_h = (_g = cacheDoc.data()) === null || _g === void 0 ? void 0 : _g.listings) !== null && _h !== void 0 ? _h : []).length
                };
            }
        }
    }
    // ── 2. Get ML access tokens ───────────────────────────────────────────────
    // userToken  → for seller-specific ops (our listings, mutations)
    // appToken   → for marketplace reads (search, item details)
    //              client_credentials grant; NOT blocked by ML's GCP IP filter
    const accessToken = await getValidMeliToken();
    const appToken = await getAppLevelToken();
    const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders = { 'Authorization': `Bearer ${appToken}` };
    // ── 3. Get our seller ID ──────────────────────────────────────────────────
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = (_j = configDoc.data()) === null || _j === void 0 ? void 0 : _j.meli;
    const sellerId = (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) ? String(meliConfig.userId) : null;
    if (!sellerId) {
        throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
    }
    // ── 4. Get product catalog IDs (used in Tier 2 below) ────────────────────
    // /products/search gives us catalog product IDs which we can then use to
    // query /sites/MLM/search?catalog_product_id= for exact product matches.
    // NOTE: The keyword formatted as "{width}/{aspectRatio}-{diameter}" covers
    // both metric and inch-style representations on MeLi.
    const keyword = `${width}/${aspectRatio}-${diameter}`;
    const keywordAlt = `${width}/${aspectRatio}R${diameter}`;
    let productIds = [];
    try {
        const prodRes = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(keywordAlt)}&category=${categoryId}&limit=15`, { headers: authHeaders });
        if (prodRes.ok) {
            const prodData = await prodRes.json();
            productIds = (prodData.results || []).map((p) => p.id).filter(Boolean).slice(0, 10);
            console.log(`[PriceIntel] Found ${productIds.length} product catalog entries`);
        }
        else {
            console.warn(`[PriceIntel] Products search returned ${prodRes.status} — will rely on keyword search only`);
        }
    }
    catch (err) {
        console.warn('[PriceIntel] Products search failed (non-fatal):', err.message);
    }
    // ── 5. Fetch our own seller's listed items for this size ──────────────────
    // /users/{id}/items/search returns ALL our active item IDs. We then bulk-fetch
    // their details via /items?ids= to get price and other metadata.
    let ourItemIds = new Set();
    let ourItemDetailsMap = new Map();
    try {
        // Paginate our seller items (up to 200 total to keep within timeout)
        const ourItemsRes = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100`, { headers: authHeaders });
        if (ourItemsRes.ok) {
            const ourItemsData = await ourItemsRes.json();
            const allOurIds = ourItemsData.results || [];
            const total = (_l = (_k = ourItemsData.paging) === null || _k === void 0 ? void 0 : _k.total) !== null && _l !== void 0 ? _l : allOurIds.length;
            console.log(`[PriceIntel] Seller has ${total} active items total (first page: ${allOurIds.length})`);
            // Fetch second page if there are more than 100 items
            if (total > 100) {
                try {
                    const page2Res = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100&offset=100`, { headers: authHeaders });
                    if (page2Res.ok) {
                        const page2Data = await page2Res.json();
                        allOurIds.push(...(page2Data.results || []));
                    }
                }
                catch ( /* non-fatal */_11) { /* non-fatal */ }
            }
            console.log(`[PriceIntel] Total our item IDs to check: ${allOurIds.length}`);
            // Bulk-fetch details in batches of 20
            for (let i = 0; i < allOurIds.length; i += 20) {
                const batch = allOurIds.slice(i, i + 20);
                const detailsRes = await fetch(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,category_id,attributes,status,catalog_product_id,sold_quantity,listing_type_id,shipping,permalink,thumbnail`, { headers: authHeaders });
                if (detailsRes.ok) {
                    const details = await detailsRes.json();
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            const item = entry.body;
                            // ML-confirmed attribute IDs (from category MLM169975 attrs step):
                            const attrs = item.attributes || [];
                            const atWidth = (_m = attrs.find((a) => ['SECTION_WIDTH', 'TIRE_WIDTH', 'TIRE_SIZE_WIDTH'].includes(a.id))) === null || _m === void 0 ? void 0 : _m.value_name;
                            const atAR = (_o = attrs.find((a) => ['AUTOMOTIVE_TIRE_ASPECT_RATIO', 'ASPECT_RATIO', 'TIRE_ASPECT_RATIO'].includes(a.id))) === null || _o === void 0 ? void 0 : _o.value_name;
                            const atDiam = (_p = attrs.find((a) => ['RIM_DIAMETER', 'TIRE_RIM_DIAMETER'].includes(a.id))) === null || _p === void 0 ? void 0 : _p.value_name;
                            const titleHasWidth = (_q = item.title) === null || _q === void 0 ? void 0 : _q.includes(String(width));
                            const titleHasAR = (_r = item.title) === null || _r === void 0 ? void 0 : _r.includes(String(aspectRatio));
                            const titleHasDiam = ((_s = item.title) === null || _s === void 0 ? void 0 : _s.includes(String(diameter))) ||
                                ((_t = item.title) === null || _t === void 0 ? void 0 : _t.toLowerCase().includes(`r${diameter}`)) ||
                                ((_u = item.title) === null || _u === void 0 ? void 0 : _u.toLowerCase().includes(`-${diameter}`));
                            const titleMatch = titleHasWidth && titleHasAR && titleHasDiam;
                            const attrsMatch = atWidth && String(atWidth) === String(width) &&
                                atAR && String(atAR) === String(aspectRatio) &&
                                atDiam && String(atDiam) === String(diameter);
                            if (attrsMatch || titleMatch) {
                                ourItemIds.add(item.id);
                                ourItemDetailsMap.set(item.id, item);
                                console.log(`[PriceIntel] Our item matches ${fingerprint}: ${item.id} "${item.title}" (cat: ${item.category_id})`);
                                // ── Category autodiscovery ──────────────────────────────
                                // Use the REAL category from our own listing instead of
                                // the hardcoded constant (ML sometimes changes mappings).
                                if (item.category_id && item.category_id !== categoryId) {
                                    console.log(`[PriceIntel] ⚠️  Category override: ${categoryId} → ${item.category_id} (from our item)`);
                                    categoryId = item.category_id;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    catch (err) {
        console.warn('[PriceIntel] Could not fetch our seller items:', err.message);
        // Non-fatal — continue without "our listing" identification
    }
    // Also check meli_listings in Firestore (already synced with tire attributes)
    const ourListingsSnap = await db.collection('meli_listings')
        .where('tireWidth', '==', width)
        .where('tireAspectRatio', '==', aspectRatio)
        .where('tireDiameter', '==', diameter)
        .get();
    for (const doc of ourListingsSnap.docs) {
        ourItemIds.add(doc.id);
    }
    console.log(`[PriceIntel] Total our item IDs for ${fingerprint}: ${ourItemIds.size}`);
    // ── 6. Find which of our own items match this tire size ────────────────────
    const ourMatchingItems = [];
    for (const [, item] of ourItemDetailsMap) {
        ourMatchingItems.push(item);
    }
    console.log(`[PriceIntel] ${ourMatchingItems.length} of our items match ${fingerprint}`);
    console.log(`[PriceIntel] ${clientCompetitorIds.length} competitor IDs received from browser/client`);
    // NOTE: We do NOT return early here on 0 matching items anymore.
    // price_to_win (step 7) will run for our items and the ScraperAPI path
    // (step 6b) will attempt to find competitors. Both need to run regardless.
    // Only bail out completely if the seller has zero active items at all.
    const sellerHasActiveItems = ourItemDetailsMap.size > 0 || ourListingsSnap.size > 0;
    if (!sellerHasActiveItems && clientCompetitorIds.length === 0) {
        console.log(`[PriceIntel] No active items found for seller and no client IDs — returning noListing`);
        return {
            cached: false,
            fingerprint,
            noListing: true,
            stats: null,
            count: 0,
            message: `No publicación activa en ML ni competidores para ${fingerprint}.`,
        };
    }
    // ── 6b. Server-side competitor discovery via ScraperAPI proxy ─────────────
    // ML's /sites/MLM/search returns 403 from GCP datacenter IPs (WAF block).
    // ScraperAPI routes the request through residential IPs that ML does not block.
    // Sign up free at scraperapi.com (5,000 requests/month free tier).
    // Set the key: firebase functions:config:set scraperapi.key="YOUR_KEY"
    //
    // The clientCompetitorIds from the browser are used as a supplement if present.
    const competitorRawItems = [];
    const scraperApiKey = (_w = ((_v = functions.config().scraperapi) === null || _v === void 0 ? void 0 : _v.key)) !== null && _w !== void 0 ? _w : '';
    // Collect competitor IDs from all sources
    const competitorIdSet = new Set(clientCompetitorIds.filter(id => !ourItemIds.has(id)));
    if (scraperApiKey) {
        // ── ScraperAPI path: residential-IP ML search ─────────────────────────
        const searchQueries = [
            `${width}/${aspectRatio}R${diameter}`,
            `llanta moto ${width}/${aspectRatio}r${diameter}`,
        ];
        for (const q of searchQueries) {
            try {
                const mlSearchUrl = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(q)}&category=${categoryId}&limit=50&sort=price_asc`;
                const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(mlSearchUrl)}`;
                const searchRes = await fetch(proxyUrl, {
                    signal: AbortSignal.timeout(25000),
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    const results = (_x = searchData.results) !== null && _x !== void 0 ? _x : [];
                    console.log(`[PriceIntel] ScraperAPI search "${q}": ${results.length} hits`);
                    results.forEach((item) => {
                        if (item.id && !ourItemIds.has(item.id)) {
                            competitorIdSet.add(item.id);
                        }
                    });
                }
                else {
                    const errText = await searchRes.text().catch(() => '');
                    console.warn(`[PriceIntel] ScraperAPI HTTP ${searchRes.status} for "${q}":`, errText.slice(0, 200));
                }
            }
            catch (err) {
                console.warn(`[PriceIntel] ScraperAPI error for query "${q}":`, err.message);
            }
        }
        console.log(`[PriceIntel] Total competitor candidates after proxy search: ${competitorIdSet.size}`);
    }
    else {
        console.warn('[PriceIntel] No ScraperAPI key configured. Set with: firebase functions:config:set scraperapi.key="YOUR_KEY"');
        console.log(`[PriceIntel] Falling back to ${competitorIdSet.size} browser-provided IDs`);
    }
    const filteredCompetitorIds = [...competitorIdSet];
    if (filteredCompetitorIds.length > 0) {
        // ── Enrich competitor IDs → full item data (/items?ids=...) ─────────────
        // This endpoint works fine from GCP — only search is blocked.
        console.log(`[PriceIntel] Enriching ${filteredCompetitorIds.length} competitor IDs`);
        for (let i = 0; i < filteredCompetitorIds.length; i += 20) {
            const batch = filteredCompetitorIds.slice(i, i + 20);
            try {
                const detRes = await fetch(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail,attributes`, { headers: appAuthHeaders });
                if (detRes.ok) {
                    const details = await detRes.json();
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            competitorRawItems.push(entry.body);
                        }
                    }
                }
            }
            catch (err) {
                console.warn('[PriceIntel] Competitor enrich batch failed:', err.message);
            }
        }
        console.log(`[PriceIntel] Enriched ${competitorRawItems.length} competitor details`);
        // Seller nicknames (up to 15 unique sellers)
        const sellerIds = [...new Set(competitorRawItems.map((i) => String(i.seller_id)).filter(Boolean))].slice(0, 15);
        const sellerMap = new Map();
        for (const sid of sellerIds) {
            try {
                const sRes = await fetch(`https://api.mercadolibre.com/users/${sid}?attributes=id,nickname`, { headers: appAuthHeaders });
                if (sRes.ok) {
                    const sData = await sRes.json();
                    sellerMap.set(sid, (_y = sData.nickname) !== null && _y !== void 0 ? _y : sid);
                }
            }
            catch ( /* non-fatal */_12) { /* non-fatal */ }
        }
        for (const item of competitorRawItems) {
            item._sellerNickname = (_z = sellerMap.get(String(item.seller_id))) !== null && _z !== void 0 ? _z : null;
        }
    }
    // ── 7. Call GET /items/{id}/price_to_win for each of our matching items ───
    //
    // This is the OFFICIAL documented ML endpoint for competitive pricing intel:
    //   https://developers.mercadolibre.com (Precios competitivos > precio_para_ganar)
    // It returns ML's own buy-box analysis: what price we need to set to win,
    // what the current winning price is, and whether we are currently winning.
    // Requires the SELLER user token (not the app token).
    //
    const priceToWinResults = [];
    for (const item of ourMatchingItems) {
        try {
            const ptwRes = await fetch(`https://api.mercadolibre.com/items/${item.id}/price_to_win`, { headers: authHeaders } // must be seller user token
            );
            const ptwData = await ptwRes.json();
            if (ptwRes.ok) {
                priceToWinResults.push({
                    itemId: item.id,
                    title: item.title,
                    ourPrice: item.price,
                    status: (_0 = ptwData.status) !== null && _0 !== void 0 ? _0 : 'unknown',
                    priceToWin: (_1 = ptwData.price_to_win) !== null && _1 !== void 0 ? _1 : null,
                    catalogProductId: (_3 = (_2 = item.catalog_product_id) !== null && _2 !== void 0 ? _2 : ptwData.catalog_product_id) !== null && _3 !== void 0 ? _3 : null,
                    actions: (_4 = ptwData.actions) !== null && _4 !== void 0 ? _4 : [],
                    raw: ptwData,
                });
                console.log(`[PriceIntel] price_to_win ${item.id}: status=${ptwData.status}, ptw=${ptwData.price_to_win}`);
            }
            else {
                console.warn(`[PriceIntel] price_to_win ${item.id} HTTP ${ptwRes.status}:`, JSON.stringify(ptwData).slice(0, 200));
                priceToWinResults.push({
                    itemId: item.id,
                    title: item.title,
                    ourPrice: item.price,
                    status: 'api_error',
                    priceToWin: null,
                    catalogProductId: (_5 = item.catalog_product_id) !== null && _5 !== void 0 ? _5 : null,
                    raw: ptwData,
                });
            }
        }
        catch (err) {
            console.warn(`[PriceIntel] price_to_win error for ${item.id}:`, err.message);
        }
    }
    // ── 8. Enrich via catalog: get buy-box winner for each catalog product ─────
    //
    // For items that belong to a catalog product, GET /products/{catalog_product_id}
    // is a documented endpoint that returns the buy_box_winner item.
    // This gives us the actual winning competitor listing we can display in the table.
    //
    const catalogProductIds = new Set(priceToWinResults.map(r => r.catalogProductId).filter(Boolean));
    const competitorListingsMap = new Map();
    for (const cpId of catalogProductIds) {
        try {
            const cpRes = await fetch(`https://api.mercadolibre.com/products/${cpId}`, { headers: appAuthHeaders });
            if (!cpRes.ok) {
                console.warn(`[PriceIntel] /products/${cpId} → HTTP ${cpRes.status}`);
                continue;
            }
            const cpData = await cpRes.json();
            const bbWinner = cpData.buy_box_winner;
            if ((bbWinner === null || bbWinner === void 0 ? void 0 : bbWinner.item_id) && !ourItemIds.has(bbWinner.item_id)) {
                // Fetch the winner's item details
                try {
                    const bbRes = await fetch(`https://api.mercadolibre.com/items/${bbWinner.item_id}?attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail`, { headers: appAuthHeaders });
                    if (bbRes.ok) {
                        const bbItem = await bbRes.json();
                        // Fetch seller nickname
                        let sellerNickname = null;
                        try {
                            const sRes = await fetch(`https://api.mercadolibre.com/users/${bbItem.seller_id}?attributes=id,nickname,seller_reputation`, { headers: appAuthHeaders });
                            if (sRes.ok) {
                                const sData = await sRes.json();
                                sellerNickname = (_6 = sData.nickname) !== null && _6 !== void 0 ? _6 : null;
                            }
                        }
                        catch ( /* non-fatal */_13) { /* non-fatal */ }
                        competitorListingsMap.set(bbWinner.item_id, {
                            itemId: bbItem.id,
                            title: bbItem.title || '',
                            price: bbItem.price || 0,
                            sellerId: String((_7 = bbItem.seller_id) !== null && _7 !== void 0 ? _7 : ''),
                            sellerNickname,
                            sellerReputation: 'unknown',
                            soldQuantity: bbItem.sold_quantity || 0,
                            listingType: bbItem.listing_type_id || 'free',
                            isFreeShipping: ((_8 = bbItem.shipping) === null || _8 === void 0 ? void 0 : _8.free_shipping) === true,
                            isOurListing: false,
                            isBuyBoxWinner: true,
                            permalink: bbItem.permalink || '',
                            thumbnail: bbItem.thumbnail || '',
                            rank: 1,
                            scrapedAt: new Date(),
                        });
                        console.log(`[PriceIntel] Buy-box winner for catalog ${cpId}: ${bbItem.id} @ $${bbItem.price}`);
                    }
                }
                catch ( /* non-fatal */_14) { /* non-fatal */ }
            }
        }
        catch (err) {
            console.warn(`[PriceIntel] /products/${cpId} failed:`, err.message);
        }
    }
    // ── 9. Build listings table ────────────────────────────────────────────────
    const ourListingsForDb = ourMatchingItems.map((item, idx) => {
        var _a, _b;
        const ptw = priceToWinResults.find(r => r.itemId === item.id);
        return {
            itemId: item.id,
            title: item.title || '',
            price: item.price || 0,
            sellerId: sellerId,
            sellerNickname: 'PRAXIS MEXICO',
            sellerReputation: 'unknown',
            soldQuantity: item.sold_quantity || 0,
            listingType: item.listing_type_id || 'free',
            isFreeShipping: ((_a = item.shipping) === null || _a === void 0 ? void 0 : _a.free_shipping) === true,
            isOurListing: true,
            isWinner: (ptw === null || ptw === void 0 ? void 0 : ptw.status) === 'winner',
            priceToWin: (_b = ptw === null || ptw === void 0 ? void 0 : ptw.priceToWin) !== null && _b !== void 0 ? _b : null,
            permalink: item.permalink || '',
            thumbnail: item.thumbnail || '',
            rank: idx + 1,
            scrapedAt: new Date(),
        };
    });
    // Catalog buy-box competitors (from /products/{id})
    const catalogCompetitorListings = [...competitorListingsMap.values()];
    // Browser-search competitors (main source — real competitor data from ML search)
    const browserCompetitorListings = competitorRawItems
        .filter(item => !ourItemIds.has(item.id))
        .map((item, idx) => {
        var _a, _b, _c;
        return ({
            itemId: item.id,
            title: item.title || '',
            price: item.price || 0,
            sellerId: String((_a = item.seller_id) !== null && _a !== void 0 ? _a : ''),
            sellerNickname: (_b = item._sellerNickname) !== null && _b !== void 0 ? _b : null,
            sellerReputation: 'unknown',
            soldQuantity: item.sold_quantity || 0,
            listingType: item.listing_type_id || 'free',
            isFreeShipping: ((_c = item.shipping) === null || _c === void 0 ? void 0 : _c.free_shipping) === true,
            isOurListing: false,
            isBuyBoxWinner: false,
            permalink: item.permalink || '',
            thumbnail: item.thumbnail || '',
            rank: idx + 1,
            scrapedAt: new Date(),
        });
    });
    const allListings = [...ourListingsForDb, ...browserCompetitorListings, ...catalogCompetitorListings]
        .filter(l => l.price > 0)
        .sort((a, b) => a.price - b.price)
        .map((l, i) => (Object.assign(Object.assign({}, l), { rank: i + 1 })));
    const totalCompetitorCount = browserCompetitorListings.length + catalogCompetitorListings.length;
    console.log(`[PriceIntel] ${allListings.length} total listings (${ourListingsForDb.length} ours, ${browserCompetitorListings.length} browser, ${catalogCompetitorListings.length} catalog)`);
    // ── 10. Compute market statistics ─────────────────────────────────────────
    const ourPrices = ourMatchingItems.map(i => i.price).filter(p => p > 0);
    const ourPrice = ourPrices.length > 0 ? Math.min(...ourPrices) : null;
    // Competitor prices: browser search is primary; ptw & catalog are supplementary
    const eligiblePtw = priceToWinResults.filter(r => r.priceToWin && r.priceToWin > 0).map(r => r.priceToWin);
    const catalogPrices = catalogCompetitorListings.map(l => l.price).filter(p => p > 0);
    const browserPrices = browserCompetitorListings.map(l => l.price).filter(p => p > 0);
    const allCompetitorPrices = [...browserPrices, ...catalogPrices, ...eligiblePtw];
    const marketFloor = allCompetitorPrices.length > 0 ? Math.min(...allCompetitorPrices) : 0;
    const marketMax = allCompetitorPrices.length > 0 ? Math.max(...allCompetitorPrices) : 0;
    const marketMid = allCompetitorPrices.length > 0
        ? allCompetitorPrices.reduce((s, v) => s + v, 0) / allCompetitorPrices.length
        : 0;
    // Win status: true if our price ≤ market floor OR price_to_win says 'winner'
    const isWinning = priceToWinResults.some(r => r.status === 'winner') ||
        (ourPrice !== null && marketFloor > 0 && ourPrice <= marketFloor);
    const positionInMarket = isWinning ? 1 : (ourPrice !== null ? 2 : null);
    const stats = {
        lowestPrice: marketFloor,
        medianPrice: Math.round(marketMid * 100) / 100,
        highestPrice: marketMax || (ourPrice !== null && ourPrice !== void 0 ? ourPrice : 0),
        ourPrice,
        positionInMarket,
        totalCompetitors: totalCompetitorCount,
        priceToWin: marketFloor || ((_10 = (_9 = priceToWinResults.find(r => r.priceToWin)) === null || _9 === void 0 ? void 0 : _9.priceToWin) !== null && _10 !== void 0 ? _10 : null),
        isWinning,
        // dataSource tells the UI what drove the competitive intelligence:
        // 'price_to_win_api'  → only ML's own endpoint was used (no proxy/scraper)
        // 'catalog_buy_box'   → catalog product buy-box winner enrichment
        // 'scraper_search'    → ScraperAPI / Apify returned real search results
        dataSource: (browserCompetitorListings.length > 0 ? 'scraper_search' :
            catalogCompetitorListings.length > 0 ? 'catalog_buy_box' :
                priceToWinResults.some(r => r.priceToWin) ? 'price_to_win_api' :
                    'own_listings_only'),
        priceToWinDetails: priceToWinResults.map(r => ({
            itemId: r.itemId,
            ourPrice: r.ourPrice,
            status: r.status,
            priceToWin: r.priceToWin,
        })),
    };
    console.log(`[PriceIntel] Stats for ${fingerprint}:`, JSON.stringify(stats));
    // ── 11. Write live snapshot to Firestore ──────────────────────────────────
    const docRef = db.collection('price_intelligence').doc(fingerprint);
    await docRef.set({
        fingerprint,
        tireSize: { width, aspectRatio, diameter },
        lastScanned: admin.firestore.FieldValue.serverTimestamp(),
        listings: allListings,
        stats,
        priceToWinDetails: priceToWinResults, // raw per-item API data
    }, { merge: false });
    // ── 12. Write daily history snapshot ──────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const historyRef = docRef.collection('history').doc(today);
    const existingHistoryCount = await docRef.collection('history').count().get();
    const isBaseline = existingHistoryCount.data().count === 0;
    await historyRef.set(Object.assign({ date: today, scannedAt: admin.firestore.FieldValue.serverTimestamp(), stats, listingCount: allListings.length }, (isBaseline ? { isBaseline: true } : {})), { merge: true });
    if (isBaseline)
        console.log(`[PriceIntel] 📌 Baseline established for ${fingerprint} on ${today}`);
    // ── 13. Generate price alert if we're not winning ─────────────────────────
    if (!isWinning && ourPrice !== null && marketFloor > 0 && marketFloor < ourPrice * 0.95) {
        const gapPct = ((marketFloor - ourPrice) / ourPrice * 100);
        await db.collection('price_alerts').add({
            tireSize: fingerprint,
            ourPrice,
            competitorPrice: marketFloor,
            gap: `${gapPct.toFixed(1)}%`,
            alertType: 'undercut',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
        });
        console.log(`[PriceIntel] 🚨 Alert: ${fingerprint} market floor $${marketFloor} vs ours $${ourPrice} (${gapPct.toFixed(1)}%)`);
    }
    return {
        cached: false,
        fingerprint,
        stats,
        count: allListings.length,
        isBaseline,
    };
});
// ─── Price History Cleanup: Delete daily snapshots older than 90 days ─────────
//
// Scheduled: every day at 04:00 UTC.
// Iterates all price_intelligence documents, queries their history subcollection
// for docs with date < 90 days ago, and deletes them in batched writes.
// This keeps the collection size bounded at ~3,600 docs/year per size.
//
exports.prunePriceHistory = functions
    .runWith({ timeoutSeconds: 300, memory: '256MB' })
    .pubsub
    .schedule('0 4 * * *') // cron: daily at 04:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    console.log(`[PruneHistory] Pruning history docs older than ${cutoffStr}`);
    const fpSnap = await db.collection('price_intelligence').get();
    let totalDeleted = 0;
    for (const fpDoc of fpSnap.docs) {
        const historyRef = fpDoc.ref.collection('history');
        const oldDocs = await historyRef
            .where('date', '<', cutoffStr)
            .limit(500)
            .get();
        if (oldDocs.empty)
            continue;
        // Batch delete in chunks of 400 (safe under 500 limit)
        for (let i = 0; i < oldDocs.docs.length; i += 400) {
            const batch = db.batch();
            oldDocs.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
            totalDeleted += Math.min(400, oldDocs.docs.length - i);
        }
        console.log(`[PruneHistory] ${fpDoc.id}: deleted ${oldDocs.size} old docs`);
    }
    console.log(`[PruneHistory] Done. Total deleted: ${totalDeleted}`);
});
// 12. Automated Sync: Cron Sweep (Catch-all for missed webhooks)
exports.meliSyncOrdersCron = functions.pubsub.schedule('every 30 minutes').onRun(async (_ctx) => {
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
                        console.warn(`[Meli Cron] Shipment ${mo.shipping.id} fetch failed: ${sRes.status} — fulfillmentType may be wrong`);
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
        let importedCount = 0;
        // Pre-fetch existing originalNames in parallel to protect against ML name anonymization
        const cronOrigNames = new Map();
        await Promise.all(meliOrders.map(async (mo) => {
            var _a, _b;
            try {
                const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                if (orig)
                    cronOrigNames.set(String(mo.id), orig);
            }
            catch (_) { /* skip */ }
        }));
        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = ((_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.id) ? shipmentsMap[mo.shipping.id] : null;
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
            const isAnonC = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            const preservedCron = cronOrigNames.get(String(mo.id));
            if (preservedCron && !isAnonC(preservedCron)) {
                newOrder.customer.originalName = preservedCron;
            }
            else if (preservedCron && isAnonC(preservedCron) && !isAnonC(newOrder.customer.originalName)) {
                // Upgrade: stored was anonymized, new is readable
            }
            else if (preservedCron) {
                newOrder.customer.originalName = preservedCron;
            }
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
    var _a, _b, _c;
    // Fetch shipment
    let shipData = null;
    if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
        const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
            headers: Object.assign(Object.assign({}, headers), { 'x-format-new': 'true' })
        });
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
    // Preserve the original human-readable buyer name on webhook updates.
    // MeLi anonymizes buyer.first_name/last_name on older orders — we protect the
    // first name received so the UI always shows the readable version.
    try {
        const existingSnap = await orderRef.get();
        const existingOrigName = (_c = (_b = existingSnap.data()) === null || _b === void 0 ? void 0 : _b.customer) === null || _c === void 0 ? void 0 : _c.originalName;
        const isAnonW = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
        if (existingOrigName && !isAnonW(existingOrigName)) {
            // Keep the stored readable name
            newOrder.customer.originalName = existingOrigName;
        }
        else if (existingOrigName && isAnonW(existingOrigName) && !isAnonW(newOrder.customer.originalName)) {
            // Upgrade: stored was anonymized, new is readable — keep new one
        }
        else if (existingOrigName) {
            // Both anonymized — keep stored one for stability
            newOrder.customer.originalName = existingOrigName;
        }
        // If no originalName yet → this is the first write, keep the current name as originalName
    }
    catch (_) { /* non-critical — proceed without preservation */ }
    await orderRef.set(newOrder, { merge: true });
    console.log(`[Meli Webhook] Saved order ML-${mo.id} (pack_id: ${mo.pack_id || 'n/a'})`);
}
exports.getMeliRawOrderDebug = functions.https.onRequest(async (req, res) => {
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
async function runAbandonedCartDetection() {
    const now = Date.now();
    const cutoff = admin.firestore.Timestamp.fromMillis(now - ABANDON_THRESHOLD_MS);
    const batch = db.batch();
    let cartCount = 0;
    let guestCount = 0;
    // Helper: write a cartSnapshot event doc
    async function writeAbandonedSnapshot(data, collection_) {
        var _a, _b, _c, _d, _e;
        try {
            const items = (_a = data.items) !== null && _a !== void 0 ? _a : [];
            const cartValue = Array.isArray(items)
                ? items.reduce((sum, i) => { var _a; return sum + (((_a = i.product) === null || _a === void 0 ? void 0 : _a.price) || 0) * (i.quantity || 1); }, 0)
                : 0;
            await db.collection('cartSnapshots').add({
                sessionId: (_b = data.sessionId) !== null && _b !== void 0 ? _b : 'unknown',
                userId: (_c = data.userId) !== null && _c !== void 0 ? _c : null,
                email: (_d = data.email) !== null && _d !== void 0 ? _d : null,
                event: 'abandoned_detected',
                items: items,
                cartValue,
                attribution: (_e = data.attribution) !== null && _e !== void 0 ? _e : null,
                createdAt: admin.firestore.Timestamp.now(),
                source: collection_,
            });
        }
        catch (e) {
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
        if (!Array.isArray(data.items) || data.items.length === 0)
            continue;
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
        if (!Array.isArray(data.items) || data.items.length === 0)
            continue;
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
exports.detectAbandonedCarts = functions.pubsub
    .schedule('every 30 minutes')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    try {
        const result = await runAbandonedCartDetection();
        console.log('[AbandonDetect] Run complete:', result);
    }
    catch (err) {
        console.error('[AbandonDetect] Fatal error:', err.message);
    }
});
// ── Manual HTTP trigger for testing (staff only — validate via token or restrict in rules) ──
exports.detectAbandonedCartsHttp = functions.https.onCall(async (_data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Manager+ required.');
    }
    const result = await runAbandonedCartDetection();
    return Object.assign({ success: true }, result);
});
// ─── Monthly Stats Aggregation ─────────────────────────────────────────────────
// Firestore structure: monthly_stats/{YYYY-MM}          ← month aggregate
//                      monthly_stats/{YYYY-MM}/days/{DD} ← daily subcollection
/**
 * backfillMonthlyStats — callable (one-time per month range).
 * Reads all orders in [fromMonth, toMonth] and writes monthly_stats aggregates
 * including the daily subcollection. Safe to re-run: uses set() with merge.
 *
 * Input: { fromMonth: '2025-01', toMonth: '2025-02' }
 */
exports.backfillMonthlyStats = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin required.');
    }
    const { fromMonth, toMonth } = data;
    if (!fromMonth || !toMonth) {
        throw new functions.https.HttpsError('invalid-argument', 'fromMonth and toMonth required (format: YYYY-MM).');
    }
    // Build the list of months to process
    const months = [];
    let [year, mon] = fromMonth.split('-').map(Number);
    const [toYear, toMon] = toMonth.split('-').map(Number);
    while (year < toYear || (year === toYear && mon <= toMon)) {
        months.push(`${year}-${String(mon).padStart(2, '0')}`);
        mon++;
        if (mon > 12) {
            mon = 1;
            year++;
        }
    }
    const results = [];
    for (const monthStr of months) {
        const [y, m] = monthStr.split('-').map(Number);
        const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
        const endDate = new Date(y, m, 0, 23, 59, 59, 999); // last ms of month
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
            .get();
        // Aggregate by day
        const dayMap = {};
        let monthSales = 0, monthOrders = 0, monthPieces = 0;
        ordersSnap.docs.forEach(docSnap => {
            var _a, _b, _c, _d, _e;
            const order = docSnap.data();
            // Skip cancelled/refunded/returned — they don't count toward revenue
            if (['cancelled', 'refunded', 'returned'].includes(order['status']))
                return;
            const orderDate = (_c = (_b = (_a = order['createdAt']) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : new Date();
            const dayKey = String(orderDate.getDate()).padStart(2, '0');
            const total = Number((_d = order['total']) !== null && _d !== void 0 ? _d : 0);
            const pieces = ((_e = order['items']) !== null && _e !== void 0 ? _e : [])
                .reduce((s, item) => s + (Number(item.quantity) || 1), 0);
            if (!dayMap[dayKey])
                dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
            dayMap[dayKey].sales += total;
            dayMap[dayKey].orders += 1;
            dayMap[dayKey].pieces += pieces;
            monthSales += total;
            monthOrders += 1;
            monthPieces += pieces;
        });
        // Write in batches (max 500 ops per batch; we only have ~31 days + 1 parent = fine)
        const monthRef = db.collection('monthly_stats').doc(monthStr);
        const batch = db.batch();
        // Parent month aggregate
        batch.set(monthRef, {
            month: monthStr,
            sales: monthSales,
            orders: monthOrders,
            pieces: monthPieces,
            backfilled: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        // Daily subcollection docs
        for (const [day, dayData] of Object.entries(dayMap)) {
            const dayRef = monthRef.collection('days').doc(day);
            batch.set(dayRef, {
                day,
                month: monthStr,
                sales: dayData.sales,
                orders: dayData.orders,
                pieces: dayData.pieces,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        const entry = { month: monthStr, orders: monthOrders, sales: monthSales, days: Object.keys(dayMap).length };
        results.push(entry);
        console.log(`[Backfill] ${monthStr}: ${monthOrders} orders, $${monthSales.toFixed(0)}, ${Object.keys(dayMap).length} days`);
    }
    return { success: true, processed: months.length, results };
});
/**
 * aggregateDailyStats — scheduled nightly at 23:58 Mexico City time.
 * Writes today's order totals to monthly_stats/{YYYY-MM}/days/{DD}
 * and updates the parent month aggregate by re-summing all day docs.
 */
exports.aggregateDailyStats = functions.pubsub
    .schedule('58 23 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const day = now.getDate(); // 1-based
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const dayStr = String(day).padStart(2, '0');
    const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999);
    // Read today's orders
    const ordersSnap = await db.collection('orders')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
        .get();
    let sales = 0, orders = 0, pieces = 0;
    ordersSnap.docs.forEach(docSnap => {
        var _a, _b;
        const order = docSnap.data();
        if (['cancelled', 'refunded', 'returned'].includes(order['status']))
            return;
        sales += Number((_a = order['total']) !== null && _a !== void 0 ? _a : 0);
        orders += 1;
        pieces += ((_b = order['items']) !== null && _b !== void 0 ? _b : [])
            .reduce((s, item) => s + (Number(item.quantity) || 1), 0);
    });
    const monthRef = db.collection('monthly_stats').doc(monthStr);
    const dayRef = monthRef.collection('days').doc(dayStr);
    // Write today's daily doc
    await dayRef.set({
        day: dayStr,
        month: monthStr,
        sales,
        orders,
        pieces,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Re-sum ALL day docs to update the month aggregate accurately
    // (handles retroactive cancellations updating daily docs via backfill)
    const allDaysSnap = await monthRef.collection('days').get();
    let mSales = 0, mOrders = 0, mPieces = 0;
    allDaysSnap.docs.forEach(d => {
        var _a, _b, _c;
        mSales += Number((_a = d.data()['sales']) !== null && _a !== void 0 ? _a : 0);
        mOrders += Number((_b = d.data()['orders']) !== null && _b !== void 0 ? _b : 0);
        mPieces += Number((_c = d.data()['pieces']) !== null && _c !== void 0 ? _c : 0);
    });
    await monthRef.set({
        month: monthStr,
        sales: mSales,
        orders: mOrders,
        pieces: mPieces,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[DailyStats] ${monthStr}/${dayStr}: orders=${orders}, sales=$${sales.toFixed(0)}, pieces=${pieces}`);
    console.log(`[DailyStats] Month aggregate → orders=${mOrders}, sales=$${mSales.toFixed(0)}, pieces=${mPieces}`);
});
// ─── Price Intelligence Diagnostic ───────────────────────────────────────────
//
// Callable from Angular: httpsCallable(functions, 'meliPriceScanDiag')
// Tests every step of the meliPriceScan pipeline independently.
// Returns a detailed report — never throws, always returns all steps attempted.
//
exports.meliPriceScanDiag = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const width = (_a = data === null || data === void 0 ? void 0 : data.width) !== null && _a !== void 0 ? _a : 120;
    const aspectRatio = (_b = data === null || data === void 0 ? void 0 : data.aspectRatio) !== null && _b !== void 0 ? _b : 70;
    const diameter = (_c = data === null || data === void 0 ? void 0 : data.diameter) !== null && _c !== void 0 ? _c : 17;
    const categoryId = (_d = data === null || data === void 0 ? void 0 : data.categoryId) !== null && _d !== void 0 ? _d : 'MLM169975';
    const report = {
        version: '2026-04-17-v1',
        testedSize: `${width}/${aspectRatio}R${diameter}`,
        ranAt: new Date().toISOString(),
    };
    // Step 1: Read integrations config
    let meliConfig = null;
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const raw = (_f = (_e = configDoc.data()) === null || _e === void 0 ? void 0 : _e.meli) !== null && _f !== void 0 ? _f : null;
        meliConfig = raw;
        report.step1_config = {
            ok: !!raw,
            docExists: configDoc.exists,
            hasAccessToken: !!(raw === null || raw === void 0 ? void 0 : raw.accessToken),
            hasRefreshToken: !!(raw === null || raw === void 0 ? void 0 : raw.refreshToken),
            hasAppId: !!(raw === null || raw === void 0 ? void 0 : raw.appId),
            hasClientSecret: !!(raw === null || raw === void 0 ? void 0 : raw.clientSecret),
            hasUserId: !!(raw === null || raw === void 0 ? void 0 : raw.userId),
            connected: (_g = raw === null || raw === void 0 ? void 0 : raw.connected) !== null && _g !== void 0 ? _g : false,
            expiresAt: (raw === null || raw === void 0 ? void 0 : raw.expiresAt) ? new Date(raw.expiresAt).toISOString() : null,
            tokenExpiresIn: (raw === null || raw === void 0 ? void 0 : raw.expiresAt)
                ? `${Math.round((raw.expiresAt - Date.now()) / 60000)} min`
                : 'unknown',
            accessTokenFirst8: (raw === null || raw === void 0 ? void 0 : raw.accessToken)
                ? `${String(raw.accessToken).substring(0, 8)}...`
                : null,
        };
    }
    catch (err) {
        report.step1_config = { ok: false, error: err.message };
    }
    // Step 0: Test app-level token (client_credentials) — the key fix for GCP IP blocking
    let appToken = null;
    try {
        appToken = await getAppLevelToken();
        report.step0_app_token = {
            ok: true,
            tokenFirst8: appToken.substring(0, 8) + '...',
            message: 'App token (client_credentials) obtained — search calls will use this token',
        };
    }
    catch (err) {
        report.step0_app_token = { ok: false, error: err.message, message: 'App token failed — will fall back to user token for searches' };
        // Not fatal — we continue with user token
    }
    // Step 2: Get valid token (with auto-refresh)
    let accessToken = null;
    try {
        accessToken = await getValidMeliToken();
        report.step2_token = {
            ok: true,
            tokenFirst8: accessToken.substring(0, 8) + '...',
            message: 'User token obtained successfully',
        };
    }
    catch (err) {
        report.step2_token = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 2: Cannot get a valid ML access token. Re-authenticate at /admin/integrations.';
        return report;
    }
    const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders = { 'Authorization': `Bearer ${appToken !== null && appToken !== void 0 ? appToken : accessToken}` };
    // Step 3: Verify token via /users/me
    try {
        const meRes = await fetch('https://api.mercadolibre.com/users/me', { headers: authHeaders });
        const meData = await meRes.json();
        report.step3_users_me = {
            ok: meRes.ok,
            httpStatus: meRes.status,
            userId: (_h = meData === null || meData === void 0 ? void 0 : meData.id) !== null && _h !== void 0 ? _h : null,
            nickname: (_j = meData === null || meData === void 0 ? void 0 : meData.nickname) !== null && _j !== void 0 ? _j : null,
            siteId: (_k = meData === null || meData === void 0 ? void 0 : meData.site_id) !== null && _k !== void 0 ? _k : null,
            error: !meRes.ok ? ((meData === null || meData === void 0 ? void 0 : meData.message) || `HTTP ${meRes.status}`) : null,
        };
        if (!meRes.ok) {
            report.verdict = `❌ BLOCKED at Step 3: Token rejected (${meRes.status}: ${meData === null || meData === void 0 ? void 0 : meData.message}). Re-authenticate.`;
            return report;
        }
    }
    catch (err) {
        report.step3_users_me = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 3: Network error reaching ML API.';
        return report;
    }
    // Step 4: Check category attribute names
    try {
        const catRes = await fetch(`https://api.mercadolibre.com/categories/${categoryId}/attributes`, { headers: authHeaders });
        const catData = await catRes.json();
        const attrIds = Array.isArray(catData) ? catData.map((a) => a.id) : [];
        const hasWidth = attrIds.includes('SECTION_WIDTH');
        const hasAR = attrIds.includes('AUTOMOTIVE_TIRE_ASPECT_RATIO');
        const hasRim = attrIds.includes('RIM_DIAMETER');
        const hasMfgSize = attrIds.includes('MANUFACTURER_TIRE_SIZE');
        report.step4_category_attrs = {
            ok: catRes.ok,
            httpStatus: catRes.status,
            categoryId,
            totalAttributes: attrIds.length,
            hasSECTION_WIDTH: hasWidth,
            hasAUTOMOTIVE_TIRE_ASPECT_RATIO: hasAR,
            hasRIM_DIAMETER: hasRim,
            hasMANUFACTURER_TIRE_SIZE: hasMfgSize,
            verdict: (hasWidth && hasAR && hasRim)
                ? 'All 3 size attributes present'
                : 'SOME SIZE ATTRIBUTES MISSING — ML may have renamed them, causing zero results',
        };
    }
    catch (err) {
        report.step4_category_attrs = { ok: false, error: err.message };
    }
    // Step 5: Strategy S1 — keyword search WITH APP TOKEN (the fixed approach)
    try {
        const url = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=5&sort=price_asc`;
        const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN — key fix
        const body = await r.json();
        report.step5_attr_search = {
            ok: r.ok,
            httpStatus: r.status,
            url,
            totalResults: (_m = (_l = body === null || body === void 0 ? void 0 : body.paging) === null || _l === void 0 ? void 0 : _l.total) !== null && _m !== void 0 ? _m : null,
            returnedCount: ((_o = body === null || body === void 0 ? void 0 : body.results) !== null && _o !== void 0 ? _o : []).length,
            firstItem: ((_p = body === null || body === void 0 ? void 0 : body.results) === null || _p === void 0 ? void 0 : _p[0])
                ? { id: body.results[0].id, title: body.results[0].title, price: body.results[0].price }
                : null,
            rawError: !r.ok ? body : null,
            error: !r.ok ? ((_r = (_q = body === null || body === void 0 ? void 0 : body.message) !== null && _q !== void 0 ? _q : body === null || body === void 0 ? void 0 : body.error) !== null && _r !== void 0 ? _r : `HTTP ${r.status}`) : null,
        };
    }
    catch (err) {
        report.step5_attr_search = { ok: false, error: err.message };
    }
    // Step 5b: Strategy D — catalog product items (WITH auth, avoids search endpoint)
    try {
        // Try first discovered productId, or a known catalog product for 120/70R17
        const testProductId = ((_s = report.step5_attr_search) === null || _s === void 0 ? void 0 : _s.ok) === false ? 'MLAP9213' : null; // fallback known product
        const prodRes = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=3`, { headers: appAuthHeaders });
        if (prodRes.ok) {
            const prodData = await prodRes.json();
            const firstProd = (prodData.results || [])[0];
            if (firstProd === null || firstProd === void 0 ? void 0 : firstProd.id) {
                const itemsRes = await fetch(`https://api.mercadolibre.com/products/${firstProd.id}/items?site_id=MLM&limit=5`, { headers: appAuthHeaders });
                const itemsBody = await itemsRes.json();
                const items = (_u = (_t = itemsBody.results) !== null && _t !== void 0 ? _t : itemsBody.items) !== null && _u !== void 0 ? _u : (Array.isArray(itemsBody) ? itemsBody : []);
                report.step5b_catalog_items = {
                    ok: itemsRes.ok,
                    httpStatus: itemsRes.status,
                    catalogProductId: firstProd.id,
                    returnedCount: items.length,
                    firstItem: items[0] ? { id: items[0].id, title: items[0].title, price: items[0].price } : null,
                    rawError: !itemsRes.ok ? itemsBody : null,
                    error: !itemsRes.ok ? ((_w = (_v = itemsBody === null || itemsBody === void 0 ? void 0 : itemsBody.message) !== null && _v !== void 0 ? _v : itemsBody === null || itemsBody === void 0 ? void 0 : itemsBody.error) !== null && _w !== void 0 ? _w : `HTTP ${itemsRes.status}`) : null,
                };
            }
            else {
                report.step5b_catalog_items = { ok: false, error: 'No catalog products found for this size' };
            }
        }
        else {
            const errBody = await prodRes.json().catch(() => ({}));
            report.step5b_catalog_items = { ok: false, httpStatus: prodRes.status, error: (_x = errBody === null || errBody === void 0 ? void 0 : errBody.message) !== null && _x !== void 0 ? _x : `HTTP ${prodRes.status}` };
        }
    }
    catch (err) {
        report.step5b_catalog_items = { ok: false, error: err.message };
    }
    // Step 6: Strategy S2 — attribute search WITH APP TOKEN
    try {
        const sizeStr = `${width}/${aspectRatio}R${diameter}`;
        const url = `https://api.mercadolibre.com/sites/MLM/search?category=${categoryId}&SECTION_WIDTH=${width}&AUTOMOTIVE_TIRE_ASPECT_RATIO=${aspectRatio}&RIM_DIAMETER=${diameter}&limit=5&sort=price_asc`;
        const r = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN
        const body = await r.json();
        report.step6_size_string_search = {
            ok: r.ok,
            httpStatus: r.status,
            sizeStr,
            url,
            totalResults: (_z = (_y = body === null || body === void 0 ? void 0 : body.paging) === null || _y === void 0 ? void 0 : _y.total) !== null && _z !== void 0 ? _z : null,
            returnedCount: ((_0 = body === null || body === void 0 ? void 0 : body.results) !== null && _0 !== void 0 ? _0 : []).length,
            rawError: !r.ok ? body : null,
            error: !r.ok ? ((_2 = (_1 = body === null || body === void 0 ? void 0 : body.message) !== null && _1 !== void 0 ? _1 : body === null || body === void 0 ? void 0 : body.error) !== null && _2 !== void 0 ? _2 : `HTTP ${r.status}`) : null,
        };
    }
    catch (err) {
        report.step6_size_string_search = { ok: false, error: err.message };
    }
    // Step 7: Our seller items
    const sellerId = (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) ? String(meliConfig.userId) : null;
    let firstItemId = null;
    if (sellerId) {
        try {
            const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=5`;
            const r = await fetch(url, { headers: authHeaders });
            const body = await r.json();
            firstItemId = (_4 = ((_3 = body === null || body === void 0 ? void 0 : body.results) !== null && _3 !== void 0 ? _3 : [])[0]) !== null && _4 !== void 0 ? _4 : null;
            report.step7_seller_items = {
                ok: r.ok,
                httpStatus: r.status,
                sellerId,
                totalItems: (_6 = (_5 = body === null || body === void 0 ? void 0 : body.paging) === null || _5 === void 0 ? void 0 : _5.total) !== null && _6 !== void 0 ? _6 : null,
                firstIds: ((_7 = body === null || body === void 0 ? void 0 : body.results) !== null && _7 !== void 0 ? _7 : []).slice(0, 5),
                error: !r.ok ? ((body === null || body === void 0 ? void 0 : body.message) || (body === null || body === void 0 ? void 0 : body.error) || `HTTP ${r.status}`) : null,
            };
        }
        catch (err) {
            report.step7_seller_items = { ok: false, sellerId, error: err.message };
        }
    }
    else {
        report.step7_seller_items = {
            ok: false,
            error: 'No sellerId in config/integrations.meli',
        };
    }
    // Step 7b: Test price_to_win on the first of our active items
    // This is the CORE endpoint of the new implementation — must be ✅ for scans to work.
    if (firstItemId) {
        try {
            const ptwRes = await fetch(`https://api.mercadolibre.com/items/${firstItemId}/price_to_win`, { headers: authHeaders } // seller user token required
            );
            const ptwBody = await ptwRes.json();
            report.step7b_price_to_win = {
                ok: ptwRes.ok,
                httpStatus: ptwRes.status,
                testedItemId: firstItemId,
                status: (_8 = ptwBody.status) !== null && _8 !== void 0 ? _8 : null,
                priceToWin: (_9 = ptwBody.price_to_win) !== null && _9 !== void 0 ? _9 : null,
                rawResponse: ptwBody,
                error: !ptwRes.ok ? ((_11 = (_10 = ptwBody.message) !== null && _10 !== void 0 ? _10 : ptwBody.error) !== null && _11 !== void 0 ? _11 : `HTTP ${ptwRes.status}`) : null,
                note: ptwRes.ok
                    ? (ptwBody.status === 'not_eligible'
                        ? 'Item not part of ML catalog — price_to_win not available for this listing'
                        : 'price_to_win endpoint working correctly')
                    : 'price_to_win failed — scans will not return competitive data',
            };
        }
        catch (err) {
            report.step7b_price_to_win = { ok: false, testedItemId: firstItemId, error: err.message };
        }
    }
    else {
        report.step7b_price_to_win = { ok: false, error: 'No active items found to test price_to_win' };
    }
    // Step 8: Firestore write/read round-trip
    try {
        const testRef = db.collection('price_intelligence').doc('diag-test-tmp');
        await testRef.set({ _diagTest: true, ranAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const check = await testRef.get();
        await testRef.delete();
        report.step8_firestore = {
            ok: check.exists,
            message: check.exists ? 'Firestore write/read OK' : 'Write ok but read failed',
        };
    }
    catch (err) {
        report.step8_firestore = { ok: false, error: err.message };
    }
    // Final verdict — based on price_to_win approach (new authoritative method)
    const ptwOk = ((_12 = report.step7b_price_to_win) === null || _12 === void 0 ? void 0 : _12.ok) === true;
    const ptwElig = ((_13 = report.step7b_price_to_win) === null || _13 === void 0 ? void 0 : _13.status) !== 'not_eligible';
    const authOk = ((_14 = report.step2_token) === null || _14 === void 0 ? void 0 : _14.ok) && ((_15 = report.step3_users_me) === null || _15 === void 0 ? void 0 : _15.ok);
    if (!authOk) {
        report.verdict = '❌ BLOCKED: Authentication broken — reconnect MercadoLibre in /admin/integrations.';
    }
    else if (!((_16 = report.step7_seller_items) === null || _16 === void 0 ? void 0 : _16.ok) || !((_17 = report.step7_seller_items) === null || _17 === void 0 ? void 0 : _17.totalItems)) {
        report.verdict = '⚠️ No active items found. Add a MercadoLibre listing to enable Price Intelligence.';
    }
    else if (!ptwOk) {
        report.verdict = `⚠️ price_to_win endpoint failed (HTTP ${(_18 = report.step7b_price_to_win) === null || _18 === void 0 ? void 0 : _18.httpStatus}). Check seller permissions or re-authenticate.`;
    }
    else if (!ptwElig) {
        report.verdict = '⚠️ Tested item is not in ML catalog so price_to_win returned not_eligible. Scan the correct tire size (one you have listed in the catalog).';
    }
    else {
        report.verdict = `✅ Pipeline OK — price_to_win working (status: ${(_19 = report.step7b_price_to_win) === null || _19 === void 0 ? void 0 : _19.status}, ptw: $${(_21 = (_20 = report.step7b_price_to_win) === null || _20 === void 0 ? void 0 : _20.priceToWin) !== null && _21 !== void 0 ? _21 : 'N/A'}). Ready to scan.`;
    }
    console.log('[PriceIntelDiag]', report.verdict);
    return report;
});
//# sourceMappingURL=index.js.map