"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skydropxGetTracking = exports.skydropxCreateLabel = exports.skydropxRawTest = exports.skydropxGetRates = exports.skydropxTestConnection = void 0;
/**
 * skydropx.ts
 * Skydropx shipping integration: connection test, rates, label creation, tracking.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
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
        const integrationsDoc = await shared_1.db.collection('config').doc('integrations').get();
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
        const integrationsDoc = await shared_1.db.collection('config').doc('integrations').get();
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
        const websiteDoc = await shared_1.db.collection('config').doc('website').get();
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
        const shippingDoc = await shared_1.db.collection('config').doc('shipping').get();
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
        const orderDoc = await shared_1.db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists)
            throw new functions.https.HttpsError('not-found', 'Order not found.');
        destinationZip = (_b = (_a = orderDoc.data()) === null || _a === void 0 ? void 0 : _a.shippingAddress) === null || _b === void 0 ? void 0 : _b.zipCode;
    }
    if (!destinationZip || destinationZip.length < 4) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid destination zip code (zipTo) is required.');
    }
    let originZip = process.env.SKYDROPX_ORIGIN_ZIPCODE || '78140';
    try {
        const shippingDoc = await shared_1.db.collection('config').doc('shipping').get();
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
        const fsDoc = await shared_1.db.collection('config').doc('integrations').get();
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
        await shared_1.db.collection('orders').doc(orderId).update({
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
    const doc = await shared_1.db.collection('config').doc('integrations').get();
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
    const configDoc = await shared_1.db.collection('config').doc('integrations').get();
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
                await shared_1.db.collection('config').doc('integrations').set({ meli: { connected: false } }, { merge: true });
                throw new Error('MeLi refresh token expired. Please re-authenticate in /admin/integrations.');
            }
            console.warn('[Meli] Falling back to existing token.');
            return meliConfig.accessToken;
        }
        const newExpiresAt = Date.now() + (tokenData.expires_in * 1000);
        await shared_1.db.collection('config').doc('integrations').set({
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
    const configDoc = await shared_1.db.collection('config').doc('integrations').get();
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
    await shared_1.db.collection('config').doc('integrations').set({
        meli: { appAccessToken: data.access_token, appTokenExpiresAt: expiresAt }
    }, { merge: true });
    console.log('[Meli:AppToken] New app token cached, expires:', new Date(expiresAt).toISOString());
    return data.access_token;
}
// 1. Generate Auth URL (Callable)
//# sourceMappingURL=skydropx.js.map