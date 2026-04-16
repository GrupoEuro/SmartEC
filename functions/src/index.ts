import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { MercadoPagoConfig, Payment } from 'mercadopago';

admin.initializeApp();
const db = admin.firestore();

// ─── MercadoPago Payment Processing ─────────────────────────────────────────

export const processPayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        console.warn('[processPayment] Guest checkout — no Firebase auth. Validating inputs.');
    }

    const { token, amount, email, description, orderId, orderNumber,
            installments, paymentMethodId, issuerId } = data;

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
            const mpConfig = integrationsDoc.data()?.mercadopago || {};
            if (mpConfig.accessToken) accessToken = mpConfig.accessToken;
            installmentsEnabled = mpConfig.installmentsEnabled ?? false;
            maxInstallments     = mpConfig.maxInstallments ?? 1;
        }
    } catch (err) {
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

    const client  = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const payment = new Payment(client);

    try {
        const paymentData: any = {
            transaction_amount:  Number(amount),
            token,
            description:         description || `Orden ${orderNumber || orderId || ''} — Storefront`,
            installments:        finalInstallments,
            payment_method_id:   paymentMethodId,
            issuer_id:           issuerId,
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
            const challengeUrl = (result as any).three_ds_info?.external_resource_url;
            console.log(`[processPayment] 3DS challenge for order ${orderId}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'pending_3ds',
                    paymentId:     result.id,
                    updatedAt:     admin.firestore.FieldValue.serverTimestamp()
                }).catch(e => console.error('Failed to update order for 3DS:', e));
            }
            return { success: false, requires3DS: true, challengeUrl, paymentId: result.id,
                     status: result.status, statusDetail: result.status_detail };
        }

        // Payment approved/rejected/in_process
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: result.status,
                paymentId:     result.id,
                paymentMethod: result.payment_method_id,
                installments:  result.installments,
                updatedAt:     admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.error('Failed to update order status:', e));
        }

        return { success: true, status: result.status, paymentId: result.id,
                 statusDetail: result.status_detail };

    } catch (error: any) {
        console.error('MercadoPago Payment Error:', error);
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError:  error.message || 'Unknown error',
                updatedAt:     admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.error('Failed to update rejected status:', e));
        }
        throw new functions.https.HttpsError('internal', error.message || 'Payment processing failed.');
    }
});

// ─── MercadoPago Webhook ──────────────────────────────────────────────────────
// Receives payment status updates from MP's notification system.
// Register this URL in MP Developer Panel → Notifications → Webhook:
//   https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook

export const mpWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
    try {
        const topic      = req.body?.type || req.query['topic'];
        const resourceId = req.body?.data?.id || req.query['id'];
        console.log('[mpWebhook] Received:', topic, resourceId);

        if (topic !== 'payment' || !resourceId) { res.status(200).send('OK'); return; }

        let accessToken = process.env.MP_ACCESS_TOKEN;
        try {
            const snap = await db.collection('config').doc('integrations').get();
            const t = snap.data()?.mercadopago?.accessToken;
            if (t) accessToken = t;
        } catch (e) { /* fall back to env */ }

        if (!accessToken) { res.status(500).send('No access token'); return; }

        const mpClient   = new MercadoPagoConfig({ accessToken });
        const paymentApi = new Payment(mpClient);
        const paymentData = await paymentApi.get({ id: String(resourceId) });

        const orderId = paymentData.metadata?.order_id;
        if (!orderId) { res.status(200).send('No order_id in metadata'); return; }

        const statusMap: Record<string, string> = {
            approved: 'approved', rejected: 'rejected', cancelled: 'cancelled',
            refunded: 'refunded', pending: 'pending', in_process: 'pending', authorized: 'pending'
        };
        const newStatus = statusMap[paymentData.status || ''] ?? 'unknown';

        await db.collection('orders').doc(orderId).update({
            paymentStatus: newStatus,
            paymentId:     paymentData.id,
            paymentMethod: paymentData.payment_method_id,
            installments:  paymentData.installments,
            updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
            ...(newStatus === 'approved' ? { status: 'paid' } : {}),
            ...(newStatus === 'rejected' ? { status: 'payment_failed' } : {}),
        });

        console.log(`[mpWebhook] Order ${orderId} payment → ${newStatus}`);
        res.status(200).send('OK');
    } catch (err: any) {
        console.error('[mpWebhook] Error:', err);
        res.status(500).send('Internal Error');
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

export const syncUserClaims = functions.firestore
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
        if (!data) return;

        const role: string = VALID_ROLES.includes(data.role) ? data.role : 'CUSTOMER';

        try {
            await admin.auth().setCustomUserClaims(uid, { role });
            console.log(`[Claims] Set role='${role}' for uid=${uid}`);
        } catch (err) {
            console.error(`[Claims] Failed to set claim for uid=${uid}:`, err);
        }
    });


// ─── Backfill: Set Custom Claims for All Existing Users ──────────────────────
//
// Call this ONE TIME via Firebase Console or CLI after deploying to push Claims
// to all existing users who had roles set before this function existed.
// Only callable by SUPER_ADMIN (verified via existing claims or first-run flag).
//

export const backfillUserClaims = functions.https.onCall(async (data, context) => {
    // Only allow this to run if the caller is already SUPER_ADMIN
    // OR if there are no admin claims yet (first-time setup)
    const callerRole = context.auth?.token?.role;
    if (callerRole !== 'SUPER_ADMIN') {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Only SUPER_ADMIN can trigger the claims backfill.'
        );
    }

    const usersSnapshot = await db.collection('users').get();
    const results: { uid: string; email: string; role: string; status: string }[] = [];

    for (const doc of usersSnapshot.docs) {
        const userData = doc.data();
        const uid = doc.id;
        const role = VALID_ROLES.includes(userData.role) ? userData.role : 'CUSTOMER';
        const email = userData.email || 'unknown';

        try {
            await admin.auth().setCustomUserClaims(uid, { role });
            results.push({ uid, email, role, status: 'ok' });
        } catch (err: any) {
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

const SKYDROPX_BASE     = 'https://pro.skydropx.com/api/v1';
const SKYDROPX_OAUTH_URL = 'https://pro.skydropx.com/api/v1/oauth/token';

/**
 * Reads credentials from Firestore and returns OAuth Bearer headers.
 * PRO API uses: Authorization: Bearer {access_token} via client_credentials OAuth.
 */
async function skydropxHeaders(): Promise<Record<string, string>> {
    let apiKey    = process.env.SKYDROPX_API_KEY;
    let apiSecret = process.env.SKYDROPX_API_SECRET;

    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const sky = integrationsDoc.data()?.skydropx || {};
            if (sky.apiKey)    apiKey    = sky.apiKey;
            if (sky.apiSecret) apiSecret = sky.apiSecret;
        }
    } catch (err) {
        console.warn('[SkyDropX] Could not read credentials from Firestore:', err);
    }

    if (!apiKey)    throw new functions.https.HttpsError('internal', 'SkyDropX API key not configured.');
    if (!apiSecret) throw new functions.https.HttpsError('internal', 'SkyDropX API secret not configured.');

    // Exchange client credentials for a Bearer access token
    const tokenRes = await fetch(SKYDROPX_OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id:     apiKey,
            client_secret: apiSecret,
        }).toString(),
    });
    const tokenText = await tokenRes.text();
    let tokenData: any;
    try { tokenData = JSON.parse(tokenText); } catch { tokenData = null; }

    if (!tokenRes.ok || !tokenData?.access_token) {
        const msg = tokenData?.error_description || tokenData?.error || tokenText || `HTTP ${tokenRes.status}`;
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
export const skydropxTestConnection = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    let apiKey = process.env.SKYDROPX_API_KEY;
    let apiSecret = process.env.SKYDROPX_API_SECRET;

    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const sky = integrationsDoc.data()?.skydropx || {};
            console.log('[SkyDropX] Firestore skydropx keys present:', Object.keys(sky));
            if (sky.apiKey) apiKey = sky.apiKey;
            if (sky.apiSecret) apiSecret = sky.apiSecret;
        } else {
            console.warn('[SkyDropX] config/integrations doc does not exist');
        }
    } catch (err) {
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

        let tokenData: any;
        try { tokenData = JSON.parse(tokenText); } catch { tokenData = null; }

        if (tokenRes.ok && tokenData?.access_token) {
            return { success: true, message: 'Credentials verified — Skydropx PRO connection successful.' };
        } else {
            const msg = tokenData?.error_description || tokenData?.error || tokenText || `HTTP ${tokenRes.status}`;
            return { success: false, message: `Auth failed: ${msg}` };
        }
    } catch (err: any) {
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
            const general = websiteDoc.data()?.general || {};
            if (general.companyName) companyName = general.companyName;
            if (general.phone) phone = general.phone;
            if (general.email) email = general.email;
        }

        // 2. Try config/shipping for full structured origin address
        const shippingDoc = await db.collection('config').doc('shipping').get();
        if (shippingDoc.exists) {
            const origin = shippingDoc.data()?.origin || {};
            if (origin.street) street = origin.street;
            if (origin.number) number = origin.number;
            if (origin.colonia) colonia = origin.colonia;
            if (origin.city) city = origin.city;
            if (origin.province) province = origin.province;
            if (origin.zip) zip = origin.zip;
        }
    } catch (err) {
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
export const skydropxGetRates = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { orderId, zipTo, parcel } = data as {
        orderId?: string;
        zipTo?: string;
        parcel: { weight: number; height: number; width: number; length: number };
    };
    if (!parcel) throw new functions.https.HttpsError('invalid-argument', 'parcel is required.');

    let destinationZip = zipTo;
    if (!destinationZip && orderId) {
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) throw new functions.https.HttpsError('not-found', 'Order not found.');
        destinationZip = orderDoc.data()?.shippingAddress?.zipCode;
    }
    if (!destinationZip || destinationZip.length < 4) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid destination zip code (zipTo) is required.');
    }

    let originZip = process.env.SKYDROPX_ORIGIN_ZIPCODE || '78140';
    try {
        const shippingDoc = await db.collection('config').doc('shipping').get();
        if (shippingDoc.exists) { const z = shippingDoc.data()?.origin?.zip; if (z) originZip = z; }
    } catch { console.warn('[SkyDropX] Could not read origin zip, using default.'); }

    const headers = await skydropxHeaders();

    // Look up destination zip for correct area_level info (Skydropx validates zip matches state)
    let destLevel1 = 'México';
    let destLevel2 = String(destinationZip);
    let destLevel3 = 'Centro';
    try {
        const zipRes = await fetch(`https://api.zippopotam.us/mx/${destinationZip}`);
        if (zipRes.ok) {
            const zipData = await zipRes.json() as any;
            if (zipData.places?.length > 0) {
                const place = zipData.places[0];
                destLevel1 = place.state         || destLevel1;
                destLevel2 = place['place name'] || destLevel2;
                destLevel3 = place['place name'] || destLevel3;
            }
        }
    } catch { console.warn('[SkyDropX] Could not look up destination zip, using fallback.'); }

    // Official Skydropx PRO quotation body — Rails API requires quotation:{} root wrapper
    const quotationPayload = {
        address_from: { country_code: 'MX', postal_code: originZip, area_level1: 'San Luis Potosí', area_level2: 'San Luis Potosí', area_level3: 'Centro' },
        address_to:   { country_code: 'MX', postal_code: String(destinationZip), area_level1: destLevel1, area_level2: destLevel2, area_level3: destLevel3 },
        parcels: [{
            weight: Math.max(1, Math.round(parcel.weight || 5)),
            height: Math.max(1, Math.round(parcel.height || 30)),
            width:  Math.max(1, Math.round(parcel.width  || 30)),
            length: Math.max(1, Math.round(parcel.length || 20)),
        }],
        package_protected:  false,
        declared_value:     0,
        declared_amount:    0,
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

        const createJson = JSON.parse(createText) as any;
        const quotationId: string = createJson.id;
        if (!quotationId) throw new Error('No quotation ID returned from API.');

        // PRO API is async — poll until is_completed: true (max 18 seconds)
        const completed = await pollQuotation(quotationId, headers);
        console.log(`[SkyDropX] Quotation ${quotationId} completed. Rates: ${completed.rates?.length ?? 0}`);

        const rates = extractRates(completed);
        console.log(`[SkyDropX] Parsed ${rates.length} priced rate(s)`);
        return { rates };

    } catch (err: any) {
        console.error('[SkyDropX] GetRates error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX rate error: ${err.message}`);
    }
});


/**
 * Polls GET /quotations/{id} until is_completed:true or max attempts reached.
 * Skydropx PRO API is async — the POST creates the job, GET returns results.
 */
async function pollQuotation(quotationId: string, headers: Record<string, string>, maxAttempts = 12, intervalMs = 1500): Promise<any> {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await sleep(intervalMs);
        const res  = await fetch(`${SKYDROPX_BASE}/quotations/${quotationId}`, { headers });
        const text = await res.text();
        if (!res.ok) throw new Error(`Poll failed (${res.status}): ${text}`);
        const json  = JSON.parse(text);
        const hasPrice = Array.isArray(json.rates) && json.rates.some((r: any) => r.total || r.amount);
        console.log(`[SkyDropX] Poll ${attempt}/${maxAttempts}: is_completed=${json.is_completed}, priced=${hasPrice}`);
        if (json.is_completed || hasPrice) return json;
    }
    throw new Error(`Quotation ${quotationId} timed out after ${maxAttempts * intervalMs / 1000}s`);
}


// ── 1b. Raw API Test (Debug) v5 ─────────────────────────────────────────────
// NEVER throws. Returns all 3 steps raw.
export const skydropxRawTest = functions.https.onCall(async (data: any, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const BUILD_VERSION = '2026-03-25-v7';
    const result: any = { version: BUILD_VERSION, step1_credentials: null, step2_oauth: null, step3_quotation: null };

    // Step 1: Read credentials from Firestore
    let apiKey    = process.env.SKYDROPX_API_KEY    || null;
    let apiSecret = process.env.SKYDROPX_API_SECRET || null;
    try {
        const fsDoc = await db.collection('config').doc('integrations').get();
        if (fsDoc.exists) {
            const sky = fsDoc.data()?.skydropx || {};
            if (sky.apiKey)    apiKey    = sky.apiKey;
            if (sky.apiSecret) apiSecret = sky.apiSecret;
        }
        result.step1_credentials = {
            docExists:    fsDoc.exists,
            hasApiKey:    !!apiKey,
            apiKeyFirst8: apiKey    ? apiKey.substring(0, 8) + '...' : null,
            hasApiSecret: !!apiSecret,
        };
    } catch (e: any) {
        result.step1_credentials = { error: e.message };
    }

    // Step 2: OAuth token exchange
    let bearerToken: string | null = null;
    if (apiKey && apiSecret) {
        try {
            const tokenRes  = await fetch(SKYDROPX_OAUTH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: apiKey, client_secret: apiSecret }).toString(),
            });
            const tokenText = await tokenRes.text();
            let tokenJson: any = null;
            try { tokenJson = JSON.parse(tokenText); } catch { tokenJson = tokenText; }
            result.step2_oauth = { status: tokenRes.status, body: tokenJson };
            if (tokenRes.ok && tokenJson?.access_token) bearerToken = tokenJson.access_token;
        } catch (e: any) {
            result.step2_oauth = { error: e.message };
        }
    } else {
        result.step2_oauth = { skipped: 'Missing apiKey or apiSecret' };
    }

    // Step 3: Quotation — PRO API with ALL required fields (per official docs)
    if (bearerToken) {
        const zip_from = '78140';
        // Use a well-known zip as default to avoid address mismatch errors
        // 64000 = Monterrey, Nuevo León (Monterrey Centro)
        const zip_to   = String(data?.zipTo || '64000');
        const p        = data?.parcel || { weight: 5, height: 30, width: 30, length: 20 };

        // Lookup zip_to area info (required to match SEPOMEX data)
        let destLevel1 = 'Nuevo León';
        let destLevel2 = 'Monterrey';
        let destLevel3 = 'Monterrey Centro';
        try {
            const zipRes  = await fetch(`https://api.zippopotam.us/mx/${zip_to}`);
            if (zipRes.ok) {
                const zipData = await zipRes.json() as any;
                if (zipData.places?.length > 0) {
                    const place = zipData.places[0];
                    destLevel1 = place.state       || destLevel1;
                    destLevel2 = place['place name'] || destLevel2;
                    destLevel3 = place['place name'] || destLevel3;
                }
            }
        } catch { /* use defaults */ }

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
                width:  Math.max(1, Math.round(p.width  || 30)),
                length: Math.max(1, Math.round(p.length || 20)),
            }],
            package_protected:  false,
            declared_value:     0,
            declared_amount:    0,
            requested_carriers: [],
        };
        const body = { quotation: quotationPayload };
        result.step3_quotation = { ...result.step3_quotation, sentBody: body };
        try {
            const createRes = await fetch(`${SKYDROPX_BASE}/quotations`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body),
            });
            const createText = await createRes.text();
            let createJson: any = null;
            try { createJson = JSON.parse(createText); } catch { createJson = createText; }

            if (createRes.ok && createJson?.id) {
                // Poll until completed
                const authHeaders: Record<string, string> = { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
                try {
                    const completed = await pollQuotation(createJson.id, authHeaders);
                    result.step3_quotation = {
                        url: `${SKYDROPX_BASE}/quotations`,
                        status: createRes.status,
                        quotationId: createJson.id,
                        sentBody: body,
                        response: completed,
                    };
                } catch (pollErr: any) {
                    result.step3_quotation = {
                        url: `${SKYDROPX_BASE}/quotations`,
                        status: createRes.status,
                        quotationId: createJson.id,
                        sentBody: body,
                        initialResponse: createJson,
                        pollError: pollErr.message,
                    };
                }
            } else {
                result.step3_quotation = { url: `${SKYDROPX_BASE}/quotations`, status: createRes.status, sentBody: body, response: createJson };
            }
        } catch (e: any) {
            result.step3_quotation = { error: e.message, sentBody: body };
        }
    } else {
        result.step3_quotation = { skipped: 'No OAuth token — check steps 1 & 2' };
    }

    console.log('[SkyDropX] RawTest v5:', JSON.stringify({ version: BUILD_VERSION, s1: result.step1_credentials, s2: result.step2_oauth?.status, s3: result.step3_quotation?.status }));
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
function extractRates(json: any): any[] {
    // PRO response: rates is a direct array inside the response object
    const ratesArr: any[] = Array.isArray(json.rates)  ? json.rates
                          : Array.isArray(json.data)   ? json.data
                          : Array.isArray(json)        ? json
                          : [];

    return ratesArr
        .filter((r: any) => r && r.id && (r.total !== undefined || r.amount !== undefined))
        .map((r: any) => {
            const price = parseFloat(String(r.total ?? r.amount ?? '0'));
            return {
                rateId:       r.id,
                carrier:      r.provider_name || r.provider_display_name || '',
                serviceName:  r.provider_service_name || r.provider_service_code || '',
                price,
                currency:     r.currency_code || 'MXN',
                estimatedDays: r.days ?? null,
                status:       r.status || '',
                success:      r.success !== false,
            };
        })
        .filter((r: any) => r.price > 0 && r.success)
        .sort((a: any, b: any) => a.price - b.price);
}


// ── 2. Create Shipment + Generate Label (one step) ────────────────────────────
// Creates a shipment with the selected rate, then auto-updates Firestore order
// with trackingNumber, carrier, shippingLabelUrl, and sets status = 'shipped'.
export const skydropxCreateLabel = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { orderId, rateId } = data as { orderId: string; rateId: string };
    if (!orderId || !rateId) throw new functions.https.HttpsError('invalid-argument', 'orderId and rateId required.');

    try {
        // Step A: Create shipment with selected rate
        const shipRes = await fetch(`${SKYDROPX_BASE}/shipments`, {
            method: 'POST',
            headers: await skydropxHeaders(),
            body: JSON.stringify({ rate_id: rateId, address_from: await originAddress(), metadata: { order_id: orderId } }),
        });
        const shipJson = await shipRes.json() as any;
        if (!shipRes.ok) throw new Error(`Shipment failed: ${JSON.stringify(shipJson)}`);

        const attrs = shipJson.data?.attributes || {};
        const trackingNumber: string = attrs.tracking_number || '';
        const carrier: string = attrs.carrier || '';
        const labelUrl: string = attrs.label_url || '';

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
                updatedBy: context.auth!.uid,
            }),
        });

        console.log(`[SkyDropX] Label created — order: ${orderId}, tracking: ${trackingNumber}`);
        return { trackingNumber, carrier, labelUrl, shipmentId: shipJson.data?.id };

    } catch (err: any) {
        console.error('[SkyDropX] CreateLabel error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX label error: ${err.message}`);
    }
});

// ── 3. Get Live Tracking Status ────────────────────────────────────────────────
export const skydropxGetTracking = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { trackingNumber } = data as { trackingNumber: string };
    if (!trackingNumber) throw new functions.https.HttpsError('invalid-argument', 'trackingNumber required.');

    try {
        const res = await fetch(`${SKYDROPX_BASE}/tracking/${encodeURIComponent(trackingNumber)}`, {
            headers: await skydropxHeaders(),
        });
        const json = await res.json() as any;
        if (!res.ok) throw new Error(JSON.stringify(json));

        const attrs = json.data?.attributes || {};
        return {
            trackingNumber,
            status: attrs.status || 'unknown',
            statusDetail: attrs.status_detail || '',
            estimatedDelivery: attrs.estimated_delivery || null,
            events: (attrs.tracking_events || []).map((e: any) => ({
                status: e.status,
                description: e.description,
                location: e.location,
                occurredAt: e.occurred_at,
            })),
        };
    } catch (err: any) {
        console.error('[SkyDropX] Tracking error:', err.message);
        throw new functions.https.HttpsError('internal', `SkyDropX tracking error: ${err.message}`);
    }
});

// ─── MercadoLibre Integration (OAuth2 & Sync) ──────────────────────────────────

// Get Meli Config helper
async function getMeliConfig() {
    const doc = await db.collection('config').doc('integrations').get();
    if (!doc.exists) throw new Error('Integrations config not found');
    const config = doc.data()?.meli;
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
async function getValidMeliToken(): Promise<string> {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli;

    if (!meliConfig || !meliConfig.accessToken) {
        throw new Error('MercadoLibre not connected. No access token found.');
    }

    // Proactively refresh if: no expiresAt stored, or token expires in <30 min
    const thirtyMin = 30 * 60 * 1000;
    const needsRefresh = !meliConfig.expiresAt || (meliConfig.expiresAt - Date.now()) < thirtyMin;

    if (!needsRefresh) {
        console.log('[Meli] Token is valid, no refresh needed.');
        return meliConfig.accessToken as string;
    }

    console.log('[Meli] Token expired or expiring soon — attempting refresh...');

    if (!meliConfig.refreshToken) {
        console.warn('[Meli] No refresh token available. User must re-authenticate.');
        // Return current token anyway — let the caller fail gracefully if it's truly dead
        return meliConfig.accessToken as string;
    }

    // Get app credentials for the refresh call
    const appId = meliConfig.appId;
    const clientSecret = meliConfig.clientSecret;

    if (!appId || !clientSecret) {
        console.warn('[Meli] Missing app credentials for refresh. Using existing token.');
        return meliConfig.accessToken as string;
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

        const tokenData = await tokenRes.json() as any;

        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('[Meli] Token refresh failed:', JSON.stringify(tokenData));
            if (tokenData.error === 'invalid_grant') {
                // Refresh token itself is dead — mark as disconnected
                await db.collection('config').doc('integrations').set(
                    { meli: { connected: false } },
                    { merge: true }
                );
                throw new Error('MeLi refresh token expired. Please re-authenticate in /admin/integrations.');
            }
            // Non-fatal: use the existing token and hope it still works
            console.warn('[Meli] Falling back to existing token.');
            return meliConfig.accessToken as string;
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
        return tokenData.access_token as string;

    } catch (err: any) {
        console.error('[Meli] Token refresh error:', err.message);
        // Fall back to existing token
        return meliConfig.accessToken as string;
    }
}


// 1. Generate Auth URL (Callable)
export const meliAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    try {
        const config = await getMeliConfig();
        // Meli Mexico auth URL
        const url = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${config.appId}&redirect_uri=${encodeURIComponent(config.redirectUri)}`;
        return { url };
    } catch (err: any) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// 2. OAuth Callback (HTTP Endpoint)
// The frontend will redirect here after the user logs in to Meli.
export const meliCallback = functions.https.onRequest(async (req, res) => {
    // CORS headers just in case
    res.set('Access-Control-Allow-Origin', '*');

    const code = req.query.code as string;
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

        const tokenData = await tokenRes.json() as any;
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

    } catch (err: any) {
        console.error('[Meli] Callback error:', err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    }
});

// 3. Refresh Token (Scheduled Cron Job - Every 4 hours)
export const meliRefreshTokenScheduled = functions.pubsub.schedule('every 4 hours').onRun(async (_ctx) => {
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

        const tokenData = await tokenRes.json() as any;
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

    } catch (err: any) {
        console.error('[Meli] Scheduled refresh error:', err);
    }
});

// Helper: Parse and construct Eurollantas Order object from a Meli Order, Ship Data, and Billing Info
function parseAndSaveMeliOrder(mo: any, shipData: any, billingData?: any) {
    let internalStatus = 'pending';
    if (mo.status === 'paid') internalStatus = 'processing';
    const hasDeliveredTag = mo.tags && mo.tags.includes('delivered');
    const hasNotDeliveredTag = mo.tags && mo.tags.includes('not_delivered');
    const realShippingStatus = shipData?.status || mo.shipping?.status;

    if (hasNotDeliveredTag || realShippingStatus === 'shipped') internalStatus = 'shipped';
    if (hasDeliveredTag || realShippingStatus === 'delivered') internalStatus = 'delivered';
    if (mo.status === 'cancelled' || mo.status === 'invalid' || realShippingStatus === 'cancelled') internalStatus = 'cancelled';

    // Detect fulfillment type using 3 signals in priority order:
    // 1. shipment.logistic.type  (nested — correct path per ML /shipments API docs)
    // 2. shipment.logistic_type  (top-level fallback — field exists on items/.., sometimes null here)
    // 3. order item logistic_type (item-level fallback when shipment fetch silently failed)
    const logisticType: string | undefined =
        shipData?.logistic?.type           // ← correct nested path
     ?? shipData?.logistic_type            // ← top-level fallback
     ?? mo.order_items?.[0]?.item?.logistic_type; // ← item-level last resort

    const fType: 'platform' | 'flex' | 'merchant' =
        logisticType === 'fulfillment'  ? 'platform' :  // MELI Full — ML warehouse packs & ships
        logisticType === 'self_service' ? 'flex'     :  // MELI Flex — seller packs, same-day delivery
        'merchant';                                      // Classic   — seller packs, standard MercadoEnvíos

    // ── Extract Handling Limit (Native MeLi SLA Dispatch Deadline) ──────────
    // With x-format-new:true, the field is shipping_option.estimated_handling_limit.date
    let nativeSla: Date | null = null;
    if (shipData?.shipping_option?.estimated_handling_limit?.date) {
        nativeSla = new Date(shipData.shipping_option.estimated_handling_limit.date);
    } else if (shipData?.shipping_option?.estimated_delivery_time?.date) {
        nativeSla = new Date(shipData.shipping_option.estimated_delivery_time.date);
    }

    // ── MeLi Delay flag — most authoritative source ────────────────────────
    // The 'delay' array on shipment object (x-format-new) contains entries like
    // { type: 'shipping_delayed' } when MeLi has officially flagged a dispatch delay.
    const meliDelayTypes: string[] = (shipData?.delay || []).map((d: any) => d.type || d).filter(Boolean);
    const meliDelayed: boolean = meliDelayTypes.length > 0;

    // ── Build timeline history ─────────────────────────────────────────────
    const history = [];

    // Actual ship & delivery dates from status_history (new format) or dates object (old format)
    const rawDateShipped: string | null =
        shipData?.status_history?.date_shipped           // new format (x-format-new)
        ?? shipData?.dates?.date_shipped                 // old format fallback
        ?? null;
    const rawDateDelivered: string | null =
        shipData?.status_history?.date_delivered         // new format
        ?? shipData?.dates?.date_delivered               // old format fallback
        ?? null;

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
            note: 'Shipped via ' + (shipData?.tracking_method || 'MercadoEnvíos'),
            carrier: shipData?.tracking_method || 'MercadoEnvíos',
            trackingNumber: shipData?.tracking_number || '',
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
    } else if (!rawDateShipped && hasDeliveredTag) {
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
            const parts: string[] = [];
            if (cd.requested_by) parts.push(`By: ${cd.requested_by}`);
            if (cd.group) parts.push(`Group: ${cd.group}`);
            if (cd.code) parts.push(`Code: ${cd.code}`);
            if (cd.description) parts.push(cd.description);
            if (parts.length) cancelNote = parts.join(' · ');
        }

        history.push({
            status: 'cancelled',
            timestamp: cd?.date
                ? new Date(cd.date)
                : (mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp()),
            note: cancelNote,
            updatedBy: 'system'
        });
    }

    // ── Smart buyer name extraction ──────────────────────────────────────────────
    // MeLi anonymizes buyer names: "Juan Garcia" → "SAJU960995" or "VALENCIALIZ20220830234831"
    // Detection: ALL_UPPERCASE string with digits, no spaces → it's an anonymized code.
    const isAnonymizedMeliName = (s: string): boolean =>
        !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);

    const rawFirstName = mo.buyer?.first_name || '';
    const rawLastName  = mo.buyer?.last_name  || '';
    const rawFullName  = `${rawFirstName} ${rawLastName}`.trim();
    const nickname     = mo.buyer?.nickname || '';

    // Priority: readable full name → readable nickname → anonymized code → fallback
    let buyerDisplayName: string;
    if (rawFullName && !isAnonymizedMeliName(rawFullName)) {
        buyerDisplayName = rawFullName;   // "Juan Carlos Saucedo Chavez"
    } else if (nickname && !isAnonymizedMeliName(nickname)) {
        buyerDisplayName = nickname;      // Readable nickname (e.g. "juansaucedo99")
    } else {
        buyerDisplayName = rawFullName || nickname || 'Meli Buyer';  // Anonymized, best we have
    }
    const buyerIsAnonymized = isAnonymizedMeliName(buyerDisplayName);

    return {
        id: `meli_${mo.id}`,
        orderNumber: `ML-${mo.id}`,
        sourceChannel: 'mercadolibre',
        fulfillmentType: fType,
        shippingId: mo.shipping?.id ? String(mo.shipping.id) : '',
        externalOrderId: String(mo.id),
        // Store pack_id separately — since 2024 all MeLi orders belong to a pack.
        // pack_id is what webhooks typically reference; mo.id is the seller-visible order ID.
        meliPackId: mo.pack_id ? String(mo.pack_id) : null,
        customer: {
            id: `ml_${mo.buyer?.id}`,
            // current name — may transition from real name to anonymized code over time
            name: buyerDisplayName,
            // originalName: first readable version captured — the write logic preserves this on updates
            originalName: buyerDisplayName,
            // Extra MeLi identity fields — stored for UI display and support
            meliNickname: nickname || null,
            meliAnonymizedId: isAnonymizedMeliName(rawFullName) ? rawFullName : (isAnonymizedMeliName(nickname) ? nickname : null),
            isAnonymized: buyerIsAnonymized,
            email: mo.buyer?.email || `${mo.buyer?.id}@mercadolibre.com`,
            phone: mo.buyer?.phone?.number || mo.buyer?.phone?.area_code ? `${mo.buyer?.phone?.area_code || ''}${mo.buyer?.phone?.number || ''}` : '',
            isGuest: true
        },
        status: internalStatus,
        history: history,
        items: (mo.order_items || []).map((item: any) => ({
            productId: item.item.id,
            productName: item.item.title,
            name: item.item.title,
            price: item.unit_price,
            quantity: item.quantity,
            subtotal: item.unit_price * item.quantity,
            sku: item.item.seller_sku || ''
        })),
        total: mo.total_amount,
        subtotal: mo.total_amount,
        marketplaceFee: (mo.order_items || []).reduce((acc: number, val: any) => acc + (val.sale_fee || 0), 0),
        paymentStatus: mo.payments && mo.payments.length > 0 && mo.payments[0].status === 'approved' ? 'approved' : 'pending',
        shippingAddress: (() => {
            const recvAddr = shipData?.receiver_address;
            if (recvAddr) {
                return {
                    street: recvAddr.street_name || 'N/A',
                    exteriorNumber: recvAddr.street_number || '',
                    interiorNumber: '',
                    // 'comment' field = delivery references (NOT interior number)
                    references: recvAddr.comment || '',
                    colonia: recvAddr.neighborhood?.name || '',
                    city: recvAddr.city?.name || recvAddr.municipality?.name || '',
                    state: recvAddr.state?.name || '',
                    zipCode: recvAddr.zip_code || '',
                    country: recvAddr.country?.id || 'MX',
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
        })(),
        createdAt: mo.date_created ? new Date(mo.date_created) : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp(),
        nativeSla: nativeSla,          // MercadoLibre's exact dispatch deadline (handling limit)
        // Top-level ship/delivery timestamps for fast SLA evaluation without scanning history
        shippedAt: rawDateShipped ? new Date(rawDateShipped) : null,
        deliveredAt: rawDateDelivered ? new Date(rawDateDelivered) : null,
        // meliDelayed: true means MercadoLibre's own system flagged this as a dispatch delay
        meliDelayed: meliDelayed,
        meliDelayTypes: meliDelayTypes,

        // ── MeLi Billing / Fiscal Info (from /orders/{id}/billing_info) ──────────────
        // Contains: RFC, billing name (may differ), billing address, CFDI use code.
        // Generic RFC XAXX010101000 = buyer did NOT request a nominal invoice.
        ...(billingData && !billingData.error ? (() => {
            // MeLi returns different shapes in v1 vs v2. Normalize both.
            const bi = billingData.billing_info || billingData;
            const rfcNumber = bi?.identification?.number || null;
            return {
                meliInvoice: {
                    name: bi?.first_name
                        ? `${bi.first_name} ${bi.last_name || ''}`.trim()
                        : null,
                    rfc: rfcNumber,
                    identificationType: bi?.identification?.type || 'RFC',
                    // Billing address (often different from shipping address)
                    billingAddress: bi?.address ? {
                        street: bi.address.street_name || '',
                        exteriorNumber: bi.address.street_number || '',
                        city: bi.address.city?.name || bi.address.city || '',
                        state: bi.address.state?.name || bi.address.state || '',
                        zipCode: bi.address.zip_code || '',
                        country: bi.address.country?.id || 'MX'
                    } : null,
                    // CFDI use code: S01=Sin efectos, G01=Adquisición, G03=Gastos grles
                    cfdiUse: bi?.cfdi_use || null,
                    // Taxpayer type: 'Persona Física' | 'Persona Moral'
                    taxpayerType: bi?.taxpayer_type || null,
                    activityDescription: bi?.activity_description || null,
                    // true = generic RFC, buyer did NOT request nominal invoice
                    isGenericRfc: rfcNumber === 'XAXX010101000' || rfcNumber === 'XEXX010101000'
                }
            };
        })() : {}),
        // ── MeLi Cancellation Analytics ─────────────────────────────────────
        // Populated only for cancelled/invalid orders.
        // cancel_detail.group: 'buyer' | 'seller' | 'mediations' | 'fraud' | 'item' | 'shipment' | 'delivery' | 'fiscal' | 'internal'
        // cancel_detail.requested_by: 'buyer' | 'seller' | 'Mercado Libre'
        ...(mo.cancel_detail ? {
            meliCancellation: {
                requestedBy: mo.cancel_detail.requested_by || null,
                group: mo.cancel_detail.group || null,
                code: mo.cancel_detail.code || null,
                description: mo.cancel_detail.description || null,
                date: mo.cancel_detail.date ? new Date(mo.cancel_detail.date) : null,
                originalStatus: mo.status || null   // e.g. 'cancelled' | 'invalid'
            }
        } : {})
    };
}

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

        // Fetch shipments + shipment costs + billing_info in parallel
        const shipmentsMap: any = {};
        const shipmentCostsMap: any = {};  // senders[0].cost = real seller shipping deduction
        const billingMap: any = {};
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
                                    // Sum all discounts that MeLi covers (loyalty, mandatory subsidies)
                                    const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                                        .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                                    shipmentCostsMap[mo.shipping.id] = {
                                        seller_cost: senderCost,      // what seller pays
                                        gross_amount: grossAmount,     // full carrier rate
                                        meli_subsidy: meliSubsidy,     // what MeLi covers
                                    };
                                }
                            } catch (_) { /* non-critical — skip */ }
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
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = mo.shipping?.id ? shipmentsMap[mo.shipping.id] : null;
            const shipCosts = mo.shipping?.id ? shipmentCostsMap[mo.shipping.id] : null;

            // Construct Eurollantas Order object using helper
            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);

            // ── Shipping cost deducted from seller ──────────────────────────────────
            // For Classic/Flex + "Envío Gratis": seller absorbs shipping
            //   → senders[0].cost from /shipments/{id}/costs
            // For MeLi Full (fulfillment): cost = 0 (MeLi handles logistics)
            // For pickup / no envíos: cost = 0
            const shippingSellerCost: number = shipCosts?.seller_cost ?? 0;
            const shippingGrossAmount: number = shipCosts?.gross_amount ?? 0;
            const shippingMeliSubsidy: number = shipCosts?.meli_subsidy ?? 0;

            // net_receipt = what seller actually receives after all MeLi deductions
            // = order total − MeLi commission − seller-absorbed shipping cost
            const meliCommission: number = newOrder.marketplaceFee ?? 0;
            const totalAmount: number = newOrder.total ?? 0;
            const netReceipt: number = Math.max(0, totalAmount - meliCommission - shippingSellerCost);

            // Merge financials into the order via spread (avoids TS strict type errors)
            const orderWithFinancials = {
                ...newOrder,
                shipping_seller_cost:  shippingSellerCost,   // exact MXN deducted for shipping
                shipping_gross_amount: shippingGrossAmount,  // full carrier rate (before subsidy)
                shipping_meli_subsidy: shippingMeliSubsidy,  // what MeLi covers
                net_receipt:           netReceipt,           // = total - commission - shipping
            };



            // Preserve the first human-readable name — MeLi anonymizes buyer names on older orders
            const preserved = existingNameMap.get(String(mo.id));
            const isAnon = (s: string) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            if (preserved && !isAnon(preserved)) {
                orderWithFinancials.customer.originalName = preserved;
            } else if (preserved && isAnon(preserved) && orderWithFinancials.customer.originalName && !isAnon(orderWithFinancials.customer.originalName)) {
                // Stored was anonymized but new name is readable — upgrade!
            } else if (preserved) {
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
                        avg_shipping_cost:    avg,
                        min_shipping_cost:    Math.round(stats.min * 100) / 100,
                        max_shipping_cost:    Math.round(stats.max * 100) / 100,
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

            // Find all MeLi orders that have a shipmentId but 0 or missing shipping cost
            const ordersSnap = await db.collection('orders')
                .where('sourceChannel', '==', 'mercadolibre')
                .get();

            // Filter to those that need backfilling
            const toBackfill = ordersSnap.docs.filter(doc => {
                const d = doc.data();
                const hasCost   = d.shipping_seller_cost != null && d.shipping_seller_cost > 0;
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
                    const data = doc.data();
                    // Try all possible shipment ID fields
                    const shipmentId: string | null =
                        data.shipmentId || data.shippingId || data.meliShipmentId || null;
                    if (!shipmentId) { skippedCount++; return; }

                    try {
                        const cRes = await fetch(
                            `https://api.mercadolibre.com/shipments/${shipmentId}/costs`,
                            { headers: { 'Authorization': `Bearer ${accessToken}` } }
                        );
                        if (!cRes.ok) { skippedCount++; return; }

                        const costsJson = await cRes.json() as any;
                        const sellerCost: number = costsJson?.senders?.[0]?.cost ?? 0;
                        const grossAmount: number = costsJson?.gross_amount ?? 0;
                        const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                            .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);

                        if (sellerCost === 0) { skippedCount++; return; } // No cost available yet (pending shipment)

                        // Recompute net_receipt with real shipping cost
                        const commission: number = data.marketplaceFee ?? 0;
                        const total: number = data.total ?? 0;
                        const netReceipt: number = Math.max(0, total - commission - sellerCost);

                        await doc.ref.update({
                            shipping_seller_cost:  sellerCost,
                            shipping_gross_amount: grossAmount,
                            shipping_meli_subsidy: meliSubsidy,
                            net_receipt:           netReceipt,
                            shipping_backfilled:   true,
                        });
                        updatedCount++;
                    } catch (e) {
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
                            avg_shipping_cost:    avg,
                            min_shipping_cost:    Math.round(stats.min * 100) / 100,
                            max_shipping_cost:    Math.round(stats.max * 100) / 100,
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

        // Fetch shipments + billing_info in parallel
        const shipmentsMap: any = {};
        const billingMap: any = {};
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

        const batch = db.batch();

        // Pre-fetch existing originalNames in parallel before batch-writing
        const origNameMap = new Map<string, string>();
        await Promise.all(
            meliOrders.map(async (mo: any) => {
                try {
                    const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                    const orig = snap.data()?.customer?.originalName;
                    if (orig) origNameMap.set(String(mo.id), orig);
                } catch (_) { /* skip */ }
            })
        );

        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = mo.shipping?.id ? shipmentsMap[mo.shipping.id] : null;

            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);

            // Restore the original readable name if we already have one stored
            const isAnonH = (s: string) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            const preservedOrig = origNameMap.get(String(mo.id));
            if (preservedOrig && !isAnonH(preservedOrig)) {
                newOrder.customer.originalName = preservedOrig;
            } else if (preservedOrig && isAnonH(preservedOrig) && !isAnonH(newOrder.customer.originalName)) {
                // Upgrade: stored was anonymized, new is readable
            } else if (preservedOrig) {
                newOrder.customer.originalName = preservedOrig;
            }

            // Upsert the order
            batch.set(orderRef, newOrder, { merge: true });
        }

        await batch.commit();

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

export const meliSyncFullInventory = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to sync FBM inventory.');
    }

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre is not connected or missing tokens.');
        }

        // 1. Fetch ALL fulfillment item IDs (paginated)
        let offset = 0;
        const limit = 50;
        const allItemIds: string[] = [];

        while (true) {
            const searchUrl = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?logistic_type=fulfillment&limit=${limit}&offset=${offset}`;
            const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });

            if (!searchRes.ok) {
                console.error('[Meli FBM] Search failed:', await searchRes.text());
                throw new functions.https.HttpsError('internal', 'MercadoLibre API search failed.');
            }

            const searchJson = await searchRes.json() as any;
            if (!searchJson.results || searchJson.results.length === 0) break;

            allItemIds.push(...searchJson.results);
            if (searchJson.results.length < limit) break;
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

            const itemsJson = await itemsRes.json() as any[];

            for (const itemObj of itemsJson) {
                if (itemObj.code !== 200 || !itemObj.body) continue;
                const body = itemObj.body;

                // Extract SKU from SELLER_SKU attribute
                const skuAttr = body.attributes?.find((a: any) => a.id === 'SELLER_SKU');
                const sku = skuAttr ? skuAttr.value_name : null;

                // Extract user_product_id — may be at root or inside first variation
                const userProductId: string | null =
                    body.user_product_id ||
                    body.variations?.[0]?.user_product_id ||
                    null;

                // 3. Query REAL Full warehouse stock via /user-products/{id}/stock
                let fullStock = body.available_quantity || 0;
                let fullStockReserved = 0;

                if (userProductId) {
                    try {
                        const stockRes = await fetch(
                            `https://api.mercadolibre.com/user-products/${userProductId}/stock`,
                            { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } }
                        );
                        if (stockRes.ok) {
                            const stockJson = await stockRes.json() as any;
                            const meliFacility = (stockJson.locations || []).find((l: any) => l.type === 'meli_facility');
                            if (meliFacility) {
                                fullStock = meliFacility.available_quantity ?? fullStock;
                                fullStockReserved = meliFacility.not_available_quantity ?? 0;
                            }
                        } else {
                            console.warn(`[Meli FBM] Stock fetch failed for user_product_id=${userProductId}: ${stockRes.status}`);
                        }
                    } catch (stockErr) {
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

    } catch (e: any) {
        console.error('Error in meliSyncFullInventory:', e);
        throw new functions.https.HttpsError('internal', e.message || 'sync failed');
    }
});

// ─── MercadoLibre Listings Sync (Publications Price Analyzer) ────────────────
// Fetches ALL seller listings + calculates published price, MeLi fees, and net receipt.
// Results stored in meli_listings/{item_id} for the Publications tab in the Hub.

export const meliSyncListings = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
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
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
        }

        const authHeaders = { Authorization: `Bearer ${accessToken}` };


        // ── Step 1: Collect ALL item IDs via offset pagination (robust for any catalog size) ─
        const allItemIds: string[] = [];
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

            const searchJson = await searchRes.json() as any;
            const results: string[] = searchJson.results || [];
            totalFromApi = searchJson.paging?.total || totalFromApi;

            console.log(`[Meli Listings] Page offset=${offset}: got ${results.length} ids, total=${totalFromApi}`);

            if (results.length === 0) break;
            allItemIds.push(...results);
            offset += results.length;
            if (results.length < pageLimit || allItemIds.length >= totalFromApi) break;

            // Small rate-limit buffer between pages
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (allItemIds.length === 0) {
            console.warn('[Meli Listings] No item IDs found via offset pagination.');
            return { success: true, syncedCount: 0, message: 'No listings found in account.' };
        }

        console.log(`[Meli Listings] Collected ${allItemIds.length} item IDs. Fetching details + fees...`);

        // Listing type display name map (MLM)
        const listingTypeNames: Record<string, string> = {
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
        const feeCache = new Map<string, {
            selling_fee_amount: number;
            selling_fee_percent: number;
            fixed_fee: number;
            financing_fee: number;          // MSI installment cost absorbed by seller
        }>();

        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsRes = await fetch(
                `https://api.mercadolibre.com/items?ids=${chunk.join(',')}`,
                { headers: authHeaders }
            );

            if (!itemsRes.ok) {
                console.error(`[Meli Listings] Multiget chunk i=${i} failed:`, itemsRes.status);
                continue;
            }

            const itemsJson = await itemsRes.json() as any[];

            for (const wrapper of itemsJson) {
                if (wrapper.code !== 200 || !wrapper.body) continue;
                const item = wrapper.body;

                const price: number = item.price || 0;
                const listingTypeId: string = item.listing_type_id || 'free';
                const categoryId: string = item.category_id || '';

                // ── Step 3: Fee lookup (cached per unique price+type+category combo) ─
                const feeCacheKey = `${Math.round(price)}_${listingTypeId}_${categoryId}`;
                let feeData = feeCache.get(feeCacheKey);

                if (!feeData) {
                    try {
                        // listing_prices requires auth for seller-specific rates and returns an ARRAY
                        let feeUrl = `https://api.mercadolibre.com/sites/MLM/listing_prices?price=${price}&listing_type_id=${listingTypeId}`;
                        if (categoryId) feeUrl += `&category_id=${categoryId}`;

                        const feeRes = await fetch(feeUrl, { headers: authHeaders }); // auth for seller-specific rates
                        if (feeRes.ok) {
                            // Response is an array — find the entry for our listing_type_id
                            const feeArray = await feeRes.json() as any[];
                            const feeEntry = Array.isArray(feeArray)
                                ? feeArray.find((e: any) => e.listing_type_id === listingTypeId)
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
                                const commissionAmount: number =
                                    feeEntry.sale_fee_amount          // real API field
                                    ?? feeEntry.selling_fee_amount    // fallback alias
                                    ?? 0;

                                const rawDetails: any = feeEntry.sale_fee_details ?? {};

                                let pct        = 0;
                                let fixedFee   = 0;
                                let financing  = 0;

                                if (Array.isArray(rawDetails)) {
                                    // Older array format: [{name:'percentage_fee', value:16.5}, ...]
                                    const pctEntry  = rawDetails.find((d: any) => d.name === 'percentage_fee');
                                    const fixEntry  = rawDetails.find((d: any) => d.name === 'fixed_fee');
                                    const finEntry  = rawDetails.find((d: any) =>
                                        d.name === 'financing_add_on_fee' || d.name === 'financing_fee'
                                    );
                                    pct       = Number(pctEntry?.percentage_fee ?? pctEntry?.value ?? 0);
                                    fixedFee  = Number(fixEntry?.amount ?? fixEntry?.value ?? 0);
                                    financing = Number(finEntry?.amount ?? finEntry?.value ?? 0);
                                } else if (rawDetails && typeof rawDetails === 'object') {
                                    // Current object format: {percentage_fee: 16.5, fixed_fee: 0, ...}
                                    // Values are DIRECT NUMBERS, not nested objects
                                    pct       = Number(rawDetails['percentage_fee'] ?? 0);
                                    fixedFee  = Number(rawDetails['fixed_fee'] ?? 0);
                                    financing = Number(
                                        rawDetails['financing_add_on_fee']
                                        ?? rawDetails['financing_fee']
                                        ?? 0
                                    );
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

                            } else {
                                console.warn(`[Meli Listings] No fee entry for listing_type_id=${listingTypeId} in response for item ${item.id}`);
                                feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                            }

                            feeCache.set(feeCacheKey, feeData);
                        } else {
                            const errText = await feeRes.text();
                            console.warn(`[Meli Listings] Fee API returned ${feeRes.status} for ${item.id}:`, errText.substring(0, 200));
                            feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                        }
                    } catch (feeErr) {
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
                    + feeData.financing_fee;    // financing cost if buyers use MSI
                const netAmount = Math.max(0, price - totalSellerCost);
                const netPercent = price > 0 ? Math.round((netAmount / price) * 1000) / 10 : 0;
                const feeHasData = feeData.selling_fee_amount > 0 || feeData.selling_fee_percent > 0;

                // Shipping flags from item body
                const freeShipping: boolean = item.shipping?.free_shipping === true;
                // Local pickup only (no Mercado Envíos)
                const localPickupOnly: boolean =
                    !freeShipping && (item.shipping?.logistic_type === 'not_specified' || !item.shipping?.logistic_type);

                // Extract logistic type
                const logisticType: string = item.shipping?.logistic_type || 'not_specified';
                const isFull = logisticType === 'fulfillment';

                // ── Shipping dimensions from item (set by seller at listing creation) ──
                // Format: "LxWxH,weightGrams"  e.g. "30x20x10,5000"
                // These are the physical dimensions that determine the shipping rate.
                const rawDims: string | null = item.shipping?.dimensions ?? null;
                let shipping_weight_g: number | null = null;
                let shipping_dims_cm: { l: number; w: number; h: number } | null = null;
                if (rawDims) {
                    const parts = rawDims.split(',');
                    const weightPart = parts[1] ? parseInt(parts[1], 10) : NaN;
                    if (!isNaN(weightPart)) shipping_weight_g = weightPart;
                    const dimPart = parts[0] ? parts[0].split('x').map(Number) : [];
                    if (dimPart.length === 3 && dimPart.every(n => !isNaN(n))) {
                        shipping_dims_cm = { l: dimPart[0], w: dimPart[1], h: dimPart[2] };
                    }
                }

                // Extract user_product_id
                const userProductId: string | null =
                    item.user_product_id || item.variations?.[0]?.user_product_id || null;


                // ── Kit / Combo / Bundle detection ───────────────────────────
                // Three reliable signals from MeLi (checked in priority order):
                //
                // 1. PACK_CONTENT attribute — MeLi's own classification for packs/kits.
                //    E.g. "2 llantas" or "4 piezas" written by seller explicitly.
                // 2. bundle_items array — explicit bundle components linked by MeLi.
                // 3. item_relations with type 'pack' or 'bundle' — cross-links to
                //    component items.
                const itemAttributes: any[] = item.attributes || [];
                const packContentAttr = itemAttributes.find((a: any) =>
                    a.id === 'PACK_CONTENT' || a.id === 'ITEM_AMOUNT'
                );
                const hasPackAttribute = packContentAttr && packContentAttr.value_name
                    && packContentAttr.value_name !== '1';

                // ── Tire size attributes (for Price Intelligence cross-reference) ─
                const tireWidthAttr      = itemAttributes.find((a: any) => a.id === 'TIRE_WIDTH');
                const aspectRatioAttr   = itemAttributes.find((a: any) => a.id === 'ASPECT_RATIO');
                const rimDiameterAttr   = itemAttributes.find((a: any) => a.id === 'RIM_DIAMETER');
                const tireWidth_pi      = tireWidthAttr    ? (Number(tireWidthAttr.value_name)    || null) : null;
                const tireAspectRatio_pi = aspectRatioAttr  ? (Number(aspectRatioAttr.value_name) || null) : null;
                const tireDiameter_pi   = rimDiameterAttr  ? (Number(rimDiameterAttr.value_name)  || null) : null;

                const itemRelations: any[] = item.item_relations || [];
                const bundleItems: any[] = item.bundle_items || [];

                const hasBundleItems: boolean = bundleItems.length > 0;
                const hasRelations: boolean = itemRelations.some((r: any) =>
                    r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK'
                );

                // Explicit boolean — Firestore rejects undefined
                const isCombo: boolean = Boolean(hasBundleItems || hasRelations || hasPackAttribute);

                const bundleComponents: Array<{ item_id: string; quantity: number }> = hasBundleItems
                    ? bundleItems.map((b: any) => ({ item_id: b.item_id || b.id, quantity: b.quantity || 1 }))
                    : itemRelations
                        .filter((r: any) => r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK')
                        .map((r: any) => ({ item_id: r.id, quantity: r.quantity || 1 }));

                // item_type: 'kit' when MeLi bundle_items or PACK attribute,
                //            'combo' when item_relations pack,
                //            'single' otherwise
                const itemType: 'combo' | 'kit' | 'single' = isCombo
                    ? (hasBundleItems || Boolean(hasPackAttribute) ? 'kit' : 'combo')
                    : 'single';

                // Pack quantity from attribute (e.g. "2" for a 2-pack) — null, never undefined
                const rawPackQty = packContentAttr ? parseInt(packContentAttr.value_name, 10) : NaN;
                const packQty: number | null = isNaN(rawPackQty) ? null : rawPackQty;

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
                    health: item.health ?? null,
                    logistic_type: logisticType,
                    is_full: isFull,
                    // ── Shipping info ────────────────────────────────────────
                    // free_shipping: true = seller absorbs shipping cost (envío gratis al comprador)
                    // logistic_type: 'fulfillment' | 'me2' | 'not_specified'
                    // dimensions: physical size/weight set by seller — determines shipping rate
                    free_shipping: freeShipping,
                    local_pickup_only: localPickupOnly,
                    shipping_dims_raw: rawDims,                    // raw string e.g. "30x20x10,5000"
                    shipping_weight_g: shipping_weight_g,          // weight in grams
                    shipping_dims_cm: shipping_dims_cm,            // { l, w, h } in cm
                    // avg_shipping_cost: populated after order sync (see aggregation step)
                    user_product_id: userProductId,
                    category_id: categoryId,
                    seller_custom_field: item.seller_custom_field || null,
                    permalink: item.permalink || null,
                    thumbnail: item.thumbnail || null,
                    // ── Fee breakdown from /sites/MLM/listing_prices (with auth) ────
                    selling_fee_amount: feeData.selling_fee_amount,   // MeLi commission (MXN)
                    selling_fee_percent: feeData.selling_fee_percent,  // MeLi commission (%)
                    fixed_fee: feeData.fixed_fee,                      // Fixed per-unit charge
                    financing_fee: feeData.financing_fee,              // MSI installment cost (real!)
                    net_amount: netAmount,                             // price - commission - fixed - financing
                    net_percent: netPercent,                           // % of price kept before shipping
                    fee_has_data: feeHasData,                          // false if fee API failed
                    // ── Kit / Combo / Bundle ─────────────────────────────────
                    item_type: itemType,                               // 'single' | 'kit' | 'combo'
                    is_combo: isCombo,
                    pack_qty: packQty,                                 // e.g. 2 for a 2-pack (from PACK_CONTENT attr)
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

    } catch (e: any) {
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
export const meliPriceScan = functions.runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }

    const { width, aspectRatio, diameter, categoryId = 'MLM371', force = false } = data;

    if (!width || !aspectRatio || !diameter) {
        throw new functions.https.HttpsError('invalid-argument', 'width, aspectRatio, and diameter are required.');
    }

    const fingerprint = `${width}_${aspectRatio}_R${diameter}`;
    console.log(`[PriceIntel] Scan requested: ${fingerprint} (category: ${categoryId}, force: ${force})`);

    // ── 1. Check Firestore cache (4-hour TTL) ─────────────────────────────────
    if (!force) {
        const cacheDoc = await db.collection('price_intelligence').doc(fingerprint).get();
        if (cacheDoc.exists) {
            const lastScanned = cacheDoc.data()?.lastScanned?.toDate?.();
            const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
            if (lastScanned && lastScanned > fourHoursAgo) {
                console.log(`[PriceIntel] Cache HIT for ${fingerprint} (scanned at ${lastScanned.toISOString()})`);
                return {
                    cached: true,
                    fingerprint,
                    stats: cacheDoc.data()?.stats ?? null,
                    count: (cacheDoc.data()?.listings ?? []).length
                };
            }
        }
    }

    // ── 2. Get ML access token (reuses existing auto-refresh logic) ───────────
    const accessToken = await getValidMeliToken();
    const authHeaders: Record<string, string> = { 'Authorization': `Bearer ${accessToken}` };

    // ── 3. Search ML by tire size attributes ──────────────────────────────────
    // ML attribute-based search: returns results filtered to the exact tire size.
    // No scraping needed — the structured attribute system does the matching.
    const searchUrl = new URL('https://api.mercadolibre.com/sites/MLM/search');
    searchUrl.searchParams.set('category', categoryId);
    searchUrl.searchParams.set('TIRE_WIDTH', String(width));
    searchUrl.searchParams.set('ASPECT_RATIO', String(aspectRatio));
    searchUrl.searchParams.set('RIM_DIAMETER', String(diameter));
    searchUrl.searchParams.set('sort', 'price_asc');
    searchUrl.searchParams.set('limit', '50');

    console.log(`[PriceIntel] ML search URL: ${searchUrl.toString()}`);

    let searchData: any = { results: [] };
    try {
        const searchRes = await fetch(searchUrl.toString(), { headers: authHeaders });
        if (!searchRes.ok) {
            const errText = await searchRes.text();
            console.error(`[PriceIntel] ML search failed (${searchRes.status}): ${errText.substring(0, 300)}`);
            throw new functions.https.HttpsError('internal', `ML search failed: HTTP ${searchRes.status}`);
        }
        searchData = await searchRes.json() as any;
        console.log(`[PriceIntel] ML returned ${searchData.results?.length ?? 0} results (paging.total: ${searchData.paging?.total})`);
    } catch (fetchErr: any) {
        console.error('[PriceIntel] ML fetch error:', fetchErr.message);
        throw new functions.https.HttpsError('internal', `ML API error: ${fetchErr.message}`);
    }

    // ── 4. Identify our own listings (from synced meli_listings collection) ───
    const ourListingsSnap = await db.collection('meli_listings')
        .where('tireWidth', '==', width)
        .where('tireAspectRatio', '==', aspectRatio)
        .where('tireDiameter', '==', diameter)
        .get();
    const ourItemIds = new Set<string>(ourListingsSnap.docs.map((d: any) => d.id));
    console.log(`[PriceIntel] Our listings for ${fingerprint}: ${ourItemIds.size}`);

    // ── 5. Process search results ─────────────────────────────────────────────
    const listings = (searchData.results || []).map((item: any, idx: number) => ({
        itemId: item.id,
        title: item.title || '',
        price: item.price || 0,
        sellerId: String(item.seller?.id ?? ''),
        sellerNickname: item.seller?.nickname || null,
        sellerReputation: item.seller?.seller_reputation?.level_id || 'unknown',
        soldQuantity: item.sold_quantity || 0,
        listingType: item.listing_type_id || 'free',
        isFreeShipping: item.shipping?.free_shipping === true,
        isOurListing: ourItemIds.has(item.id),
        permalink: item.permalink || '',
        thumbnail: item.thumbnail || '',
        rank: idx + 1,
        scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));

    // ── 6. Compute market statistics ──────────────────────────────────────────
    const competitorListings = listings.filter((l: any) => !l.isOurListing);
    const ourListingsInResults = listings.filter((l: any) => l.isOurListing);

    const competitorPrices: number[] = competitorListings.map((l: any) => l.price).filter((p: number) => p > 0);
    const ourPrices: number[] = ourListingsInResults.map((l: any) => l.price).filter((p: number) => p > 0);

    const safeMin = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0;
    const safeMax = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;
    const safeMedian = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };

    const ourPrice: number | null = ourPrices.length > 0 ? ourPrices[0] : null;
    const priceToWin: number = safeMin(competitorPrices);

    // positionInMarket: 1 = cheapest overall (including our listing)
    const positionInMarket: number | null = (() => {
        if (!ourPrice) return null;
        const idx = listings.findIndex((l: any) => l.isOurListing);
        return idx >= 0 ? idx + 1 : null;
    })();

    const stats = {
        lowestPrice: safeMin(competitorPrices),
        medianPrice: safeMedian(competitorPrices),
        highestPrice: safeMax(competitorPrices),
        ourPrice,
        positionInMarket,
        totalCompetitors: competitorListings.length,
        priceToWin,
    };

    console.log(`[PriceIntel] Stats for ${fingerprint}:`, JSON.stringify(stats));

    // ── 7. Write to Firestore ─────────────────────────────────────────────────
    await db.collection('price_intelligence').doc(fingerprint).set({
        fingerprint,
        tireSize: { width, aspectRatio, diameter },
        categoryId,
        lastScanned: admin.firestore.FieldValue.serverTimestamp(),
        listings,
        stats,
    }, { merge: false }); // Full replace to clear stale listings

    // ── 8. Generate price alert if we're undercut by >5% ─────────────────────
    if (ourPrice !== null && priceToWin > 0 && priceToWin < ourPrice * 0.95) {
        const gapPct = ((priceToWin - ourPrice) / ourPrice * 100);
        await db.collection('price_alerts').add({
            tireSize: fingerprint,
            ourPrice,
            competitorPrice: priceToWin,
            gap: `${gapPct.toFixed(1)}%`,
            alertType: 'undercut',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
        });
        console.log(`[PriceIntel] 🚨 Alert created: ${fingerprint} — competitor $${priceToWin} vs our $${ourPrice} (${gapPct.toFixed(1)}%)`);
    }

    return {
        cached: false,
        fingerprint,
        stats,
        count: listings.length,
    };
});


// 12. Automated Sync: Cron Sweep (Catch-all for missed webhooks)

export const meliSyncOrdersCron = functions.pubsub.schedule('every 30 minutes').onRun(async (_ctx: unknown) => {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

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

        const json = await res.json() as any;
        const meliOrders = json.results || [];

        const shipmentsMap: any = {};
        const billingMap: any = {};
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
                                    console.warn(`[Meli Cron] Shipment ${mo.shipping.id} fetch failed: ${sRes.status} — fulfillmentType may be wrong`);
                                    shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: mo.shipping?.logistic_type ?? null };
                                }
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

        let importedCount = 0;

        // Pre-fetch existing originalNames in parallel to protect against ML name anonymization
        const cronOrigNames = new Map<string, string>();
        await Promise.all(
            meliOrders.map(async (mo: any) => {
                try {
                    const snap = await db.collection('orders').doc(`meli_${mo.id}`).get();
                    const orig = snap.data()?.customer?.originalName;
                    if (orig) cronOrigNames.set(String(mo.id), orig);
                } catch (_) { /* skip */ }
            })
        );

        for (const mo of meliOrders) {
            const orderRef = db.collection('orders').doc(`meli_${mo.id}`);
            const shipData = mo.shipping?.id ? shipmentsMap[mo.shipping.id] : null;

            const newOrder = parseAndSaveMeliOrder(mo, shipData, billingMap[mo.id]);
            const isAnonC = (s: string) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
            const preservedCron = cronOrigNames.get(String(mo.id));
            if (preservedCron && !isAnonC(preservedCron)) {
                newOrder.customer.originalName = preservedCron;
            } else if (preservedCron && isAnonC(preservedCron) && !isAnonC(newOrder.customer.originalName)) {
                // Upgrade: stored was anonymized, new is readable
            } else if (preservedCron) {
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
    } catch (err: any) {
        console.error('[Meli Cron] Failed:', err);
    }
});

// 13. Automated Sync: Webhook (Real-Time push)
export const meliWebhook = functions.https.onRequest(async (req, res) => {
    // MercadoLibre heavily monitors Webhook response times.
    // Spec requires HTTP 200/201 ACK immediately.
    res.status(200).send('OK');

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
            if (!meliConfig || !meliConfig.accessToken) return;

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
                return;
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
    } catch (err: any) {
        console.error('[Meli Webhook] Error processing payload:', err);
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

    const newOrder = parseAndSaveMeliOrder(mo, shipData, billingData);

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
            // Keep the stored readable name
            newOrder.customer.originalName = existingOrigName;
        } else if (existingOrigName && isAnonW(existingOrigName) && !isAnonW(newOrder.customer.originalName)) {
            // Upgrade: stored was anonymized, new is readable — keep new one
        } else if (existingOrigName) {
            // Both anonymized — keep stored one for stability
            newOrder.customer.originalName = existingOrigName;
        }
        // If no originalName yet → this is the first write, keep the current name as originalName
    } catch (_) { /* non-critical — proceed without preservation */ }

    await orderRef.set(newOrder, { merge: true });

    console.log(`[Meli Webhook] Saved order ML-${mo.id} (pack_id: ${mo.pack_id || 'n/a'})`);
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
    const now      = Date.now();
    const cutoff   = admin.firestore.Timestamp.fromMillis(now - ABANDON_THRESHOLD_MS);
    const batch    = db.batch();
    let cartCount  = 0;
    let guestCount = 0;

    // Helper: write a cartSnapshot event doc
    async function writeAbandonedSnapshot(data: any, collection_: string) {
        try {
            const items = data.items ?? [];
            const cartValue = Array.isArray(items)
                ? items.reduce((sum: number, i: any) => sum + (i.product?.price || 0) * (i.quantity || 1), 0)
                : 0;
            await db.collection('cartSnapshots').add({
                sessionId:  data.sessionId ?? 'unknown',
                userId:     data.userId    ?? null,
                email:      data.email     ?? null,
                event:      'abandoned_detected',
                items:      items,
                cartValue,
                attribution: data.attribution ?? null,
                createdAt:  admin.firestore.Timestamp.now(),
                source:     collection_,
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
            status:          'abandoned',
            abandonedAt:     admin.firestore.Timestamp.now(),
            lastUpdated:     admin.firestore.Timestamp.now(),
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
            status:          'abandoned',
            abandonedAt:     admin.firestore.Timestamp.now(),
            lastUpdated:     admin.firestore.Timestamp.now(),
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
export const detectAbandonedCarts = functions.pubsub
    .schedule('every 30 minutes')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        try {
            const result = await runAbandonedCartDetection();
            console.log('[AbandonDetect] Run complete:', result);
        } catch (err: any) {
            console.error('[AbandonDetect] Fatal error:', err.message);
        }
    });

// ── Manual HTTP trigger for testing (staff only — validate via token or restrict in rules) ──
export const detectAbandonedCartsHttp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const role = context.auth.token?.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Manager+ required.');
    }
    const result = await runAbandonedCartDetection();
    return { success: true, ...result };
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
export const backfillMonthlyStats = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }
        const role = context.auth.token?.role;
        if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
            throw new functions.https.HttpsError('permission-denied', 'Admin required.');
        }

        const { fromMonth, toMonth } = data as { fromMonth: string; toMonth: string };
        if (!fromMonth || !toMonth) {
            throw new functions.https.HttpsError('invalid-argument', 'fromMonth and toMonth required (format: YYYY-MM).');
        }

        // Build the list of months to process
        const months: string[] = [];
        let [year, mon] = fromMonth.split('-').map(Number);
        const [toYear, toMon] = toMonth.split('-').map(Number);
        while (year < toYear || (year === toYear && mon <= toMon)) {
            months.push(`${year}-${String(mon).padStart(2, '0')}`);
            mon++;
            if (mon > 12) { mon = 1; year++; }
        }

        const results: Array<{ month: string; orders: number; sales: number; days: number }> = [];

        for (const monthStr of months) {
            const [y, m] = monthStr.split('-').map(Number);
            const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
            const endDate   = new Date(y, m,     0, 23, 59, 59, 999); // last ms of month

            const ordersSnap = await db.collection('orders')
                .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
                .get();

            // Aggregate by day
            const dayMap: Record<string, { sales: number; orders: number; pieces: number }> = {};
            let monthSales = 0, monthOrders = 0, monthPieces = 0;

            ordersSnap.docs.forEach(docSnap => {
                const order = docSnap.data();
                // Skip cancelled/refunded/returned — they don't count toward revenue
                if (['cancelled', 'refunded', 'returned'].includes(order['status'])) return;

                const orderDate: Date = order['createdAt']?.toDate?.() ?? new Date();
                const dayKey = String(orderDate.getDate()).padStart(2, '0');

                const total  = Number(order['total'] ?? 0);
                const pieces = (order['items'] as any[] ?? [])
                    .reduce((s: number, item: any) => s + (Number(item.quantity) || 1), 0);

                if (!dayMap[dayKey]) dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
                dayMap[dayKey].sales  += total;
                dayMap[dayKey].orders += 1;
                dayMap[dayKey].pieces += pieces;

                monthSales  += total;
                monthOrders += 1;
                monthPieces += pieces;
            });

            // Write in batches (max 500 ops per batch; we only have ~31 days + 1 parent = fine)
            const monthRef = db.collection('monthly_stats').doc(monthStr);
            const batch = db.batch();

            // Parent month aggregate
            batch.set(monthRef, {
                month:     monthStr,
                sales:     monthSales,
                orders:    monthOrders,
                pieces:    monthPieces,
                backfilled: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Daily subcollection docs
            for (const [day, dayData] of Object.entries(dayMap)) {
                const dayRef = monthRef.collection('days').doc(day);
                batch.set(dayRef, {
                    day,
                    month: monthStr,
                    sales:  dayData.sales,
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
export const aggregateDailyStats = functions.pubsub
    .schedule('58 23 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        const now = new Date();
        const year  = now.getFullYear();
        const month = now.getMonth();   // 0-based
        const day   = now.getDate();    // 1-based

        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const dayStr   = String(day).padStart(2, '0');

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay   = new Date(year, month, day, 23, 59, 59, 999);

        // Read today's orders
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();

        let sales = 0, orders = 0, pieces = 0;
        ordersSnap.docs.forEach(docSnap => {
            const order = docSnap.data();
            if (['cancelled', 'refunded', 'returned'].includes(order['status'])) return;
            sales  += Number(order['total'] ?? 0);
            orders += 1;
            pieces += (order['items'] as any[] ?? [])
                .reduce((s: number, item: any) => s + (Number(item.quantity) || 1), 0);
        });

        const monthRef = db.collection('monthly_stats').doc(monthStr);
        const dayRef   = monthRef.collection('days').doc(dayStr);

        // Write today's daily doc
        await dayRef.set({
            day:    dayStr,
            month:  monthStr,
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
            mSales  += Number(d.data()['sales']  ?? 0);
            mOrders += Number(d.data()['orders'] ?? 0);
            mPieces += Number(d.data()['pieces'] ?? 0);
        });

        await monthRef.set({
            month:  monthStr,
            sales:  mSales,
            orders: mOrders,
            pieces: mPieces,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`[DailyStats] ${monthStr}/${dayStr}: orders=${orders}, sales=$${sales.toFixed(0)}, pieces=${pieces}`);
        console.log(`[DailyStats] Month aggregate → orders=${mOrders}, sales=$${mSales.toFixed(0)}, pieces=${mPieces}`);
    });

