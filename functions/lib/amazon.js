"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.amazonOAuthCallback = exports.amazonSyncCron = exports.amazonManualSync = void 0;
/**
 * amazon.ts
 * Amazon Selling Partner API integration: order sync, OAuth callback.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const AMAZON_SP_BASE = 'https://sellingpartnerapi-na.amazon.com';
const AMAZON_LWA_URL = 'https://api.amazon.com/auth/o2/token';
const AMAZON_MX_MKT = 'A1AM78C64UM0Y8';
/** Reads Amazon SP-API config from config/integrations.amazon */
async function getAmazonConfig() {
    var _a;
    const doc = await shared_1.db.collection('config').doc('integrations').get();
    const cfg = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.amazon;
    if (!(cfg === null || cfg === void 0 ? void 0 : cfg.clientId) || !(cfg === null || cfg === void 0 ? void 0 : cfg.clientSecret) || !(cfg === null || cfg === void 0 ? void 0 : cfg.refreshToken)) {
        throw new Error('Amazon SP-API not fully configured. Check /admin/integrations.');
    }
    return cfg;
}
/**
 * Exchanges the LWA refresh token for a short-lived access token.
 * Caches in Firestore config/amazon_token_cache with a 55-min TTL.
 */
async function getAmazonAccessToken() {
    var _a;
    // Try cache first
    const cacheRef = shared_1.db.collection('config').doc('amazon_token_cache');
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
        const c = cacheSnap.data();
        const exp = c.expiresAt instanceof admin.firestore.Timestamp
            ? c.expiresAt.toDate() : new Date((_a = c.expiresAt) !== null && _a !== void 0 ? _a : 0);
        if (c.accessToken && exp > new Date(Date.now() + 5 * 60 * 1000)) {
            return c.accessToken;
        }
    }
    const cfg = await getAmazonConfig();
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cfg.refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
    });
    const res = await fetch(AMAZON_LWA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Amazon LWA token exchange failed (${res.status}): ${err}`);
    }
    const json = await res.json();
    const expiresAt = new Date(Date.now() + json.expires_in * 1000);
    await cacheRef.set({
        accessToken: json.access_token,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('[Amazon] Access token refreshed, expires at', expiresAt.toISOString());
    return json.access_token;
}
/** Maps Amazon OrderStatus → our internal status */
function mapAmazonStatus(s) {
    var _a;
    const MAP = {
        Pending: 'pending',
        Unshipped: 'processing',
        PartiallyShipped: 'processing',
        Shipped: 'shipped',
        Delivered: 'delivered',
        Canceled: 'cancelled',
        Unfulfillable: 'cancelled',
    };
    return (_a = MAP[s]) !== null && _a !== void 0 ? _a : 'pending';
}
/** AFN = FBA (Amazon fulfills) → 'platform', MFN = merchant fulfills → 'merchant' */
function mapFulfillmentChannel(ch) {
    return ch === 'AFN' ? 'platform' : 'merchant';
}
/**
 * Core Amazon order sync logic — shared by manual callable and nightly cron.
 * Fetches all orders from SP-API in the given window, upserts into Firestore.
 */
async function runAmazonSync(daysBack) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    const cfg = await getAmazonConfig();
    const token = await getAmazonAccessToken();
    const mktId = (_a = cfg.marketplaceId) !== null && _a !== void 0 ? _a : AMAZON_MX_MKT;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    let imported = 0, updated = 0, errors = 0;
    let nextToken;
    do {
        const params = new URLSearchParams({ MarketplaceIds: mktId, CreatedAfter: since.toISOString() });
        if (nextToken)
            params.set('NextToken', nextToken);
        const ordersRes = await fetch(`${AMAZON_SP_BASE}/orders/v0/orders?${params}`, {
            headers: { 'x-amz-access-token': token },
        });
        if (!ordersRes.ok) {
            const errTxt = await ordersRes.text();
            throw new Error(`SP-API /orders failed (${ordersRes.status}): ${errTxt}`);
        }
        const ordersJson = await ordersRes.json();
        const amzOrders = (_c = (_b = ordersJson === null || ordersJson === void 0 ? void 0 : ordersJson.payload) === null || _b === void 0 ? void 0 : _b.Orders) !== null && _c !== void 0 ? _c : [];
        nextToken = (_d = ordersJson === null || ordersJson === void 0 ? void 0 : ordersJson.payload) === null || _d === void 0 ? void 0 : _d.NextToken;
        console.log(`[Amazon] Fetched ${amzOrders.length} orders (nextToken=${!!nextToken})`);
        for (const amzOrder of amzOrders) {
            try {
                // ── Fetch line items (separate SP-API call per order) ──────────
                let items = [];
                const itemsRes = await fetch(`${AMAZON_SP_BASE}/orders/v0/orders/${amzOrder.AmazonOrderId}/orderItems`, { headers: { 'x-amz-access-token': token } });
                if (itemsRes.ok) {
                    const itemsJson = await itemsRes.json();
                    items = ((_f = (_e = itemsJson === null || itemsJson === void 0 ? void 0 : itemsJson.payload) === null || _e === void 0 ? void 0 : _e.OrderItems) !== null && _f !== void 0 ? _f : []).map((i) => {
                        var _a, _b, _c;
                        return ({
                            sku: i.SellerSKU || i.ASIN || '',
                            name: i.Title || '',
                            productName: i.Title || '',
                            quantity: (_a = i.QuantityOrdered) !== null && _a !== void 0 ? _a : 1,
                            price: parseFloat((_c = (_b = i.ItemPrice) === null || _b === void 0 ? void 0 : _b.Amount) !== null && _c !== void 0 ? _c : '0'),
                            asin: i.ASIN || '',
                        });
                    });
                }
                // ── Build Firestore document ───────────────────────────────────
                const addr = (_g = amzOrder.ShippingAddress) !== null && _g !== void 0 ? _g : {};
                const total = parseFloat((_j = (_h = amzOrder.OrderTotal) === null || _h === void 0 ? void 0 : _h.Amount) !== null && _j !== void 0 ? _j : '0');
                const orderDoc = {
                    orderNumber: amzOrder.AmazonOrderId,
                    amazonOrderId: amzOrder.AmazonOrderId,
                    sourceChannel: 'amazon',
                    fulfillmentType: mapFulfillmentChannel((_k = amzOrder.FulfillmentChannel) !== null && _k !== void 0 ? _k : 'MFN'),
                    status: mapAmazonStatus((_l = amzOrder.OrderStatus) !== null && _l !== void 0 ? _l : 'Pending'),
                    total,
                    currency: (_o = (_m = amzOrder.OrderTotal) === null || _m === void 0 ? void 0 : _m.CurrencyCode) !== null && _o !== void 0 ? _o : 'MXN',
                    items,
                    shippingAddress: {
                        name: (_p = addr.Name) !== null && _p !== void 0 ? _p : '',
                        city: (_q = addr.City) !== null && _q !== void 0 ? _q : '',
                        state: (_r = addr.StateOrRegion) !== null && _r !== void 0 ? _r : '',
                        zipCode: (_s = addr.PostalCode) !== null && _s !== void 0 ? _s : '',
                        country: (_t = addr.CountryCode) !== null && _t !== void 0 ? _t : 'MX',
                    },
                    buyerEmail: (_v = (_u = amzOrder.BuyerInfo) === null || _u === void 0 ? void 0 : _u.BuyerEmail) !== null && _v !== void 0 ? _v : '',
                    createdAt: amzOrder.PurchaseDate
                        ? new Date(amzOrder.PurchaseDate) : admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: amzOrder.LastUpdateDate
                        ? new Date(amzOrder.LastUpdateDate) : admin.firestore.FieldValue.serverTimestamp(),
                    shipByDate: amzOrder.LatestShipDate ? new Date(amzOrder.LatestShipDate) : null,
                    deliverByDate: amzOrder.LatestDeliveryDate ? new Date(amzOrder.LatestDeliveryDate) : null,
                    marketplaceId: mktId,
                    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                const docRef = shared_1.db.collection('orders').doc(`amz-${amzOrder.AmazonOrderId}`);
                const snap = await docRef.get();
                await docRef.set(orderDoc, { merge: true });
                if (snap.exists)
                    updated++;
                else
                    imported++;
                // SP-API rate limit: getOrderItems = 0.5 req/s burst. 250ms delay is safe.
                await new Promise(r => setTimeout(r, 250));
            }
            catch (orderErr) {
                console.error(`[Amazon] Error on ${amzOrder.AmazonOrderId}:`, orderErr === null || orderErr === void 0 ? void 0 : orderErr.message);
                errors++;
            }
        }
    } while (nextToken);
    return { imported, updated, errors };
}
// ─── amazonManualSync — callable (from AmazonHub UI) ─────────────────────────
exports.amazonManualSync = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const daysBack = Math.min((_a = data === null || data === void 0 ? void 0 : data.daysBack) !== null && _a !== void 0 ? _a : 7, 30); // cap at 30 days for manual
    console.log(`[Amazon] Manual sync started — last ${daysBack} days`);
    try {
        const result = await runAmazonSync(daysBack);
        await shared_1.db.collection('amazon_sync_logs').add(Object.assign(Object.assign({ type: 'manual', status: result.errors > 0 ? 'partial' : 'success' }, result), { daysBack, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`[Amazon] Manual sync done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
        return Object.assign({ success: true }, result);
    }
    catch (e) {
        console.error('[Amazon] Manual sync failed:', e.message);
        await shared_1.db.collection('amazon_sync_logs').add({
            type: 'manual', status: 'error', imported: 0, updated: 0, errors: 1,
            errorMessage: e.message,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new functions.https.HttpsError('internal', e.message);
    }
});
// ─── amazonSyncCron — scheduled every 30 min ─────────────────────────────────
exports.amazonSyncCron = functions.pubsub
    .schedule('*/30 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
    console.log('[Amazon] Cron sync started — last 2 days');
    try {
        const result = await runAmazonSync(2);
        await shared_1.db.collection('amazon_sync_logs').add(Object.assign(Object.assign({ type: 'scheduled', status: result.errors > 0 ? 'partial' : 'success' }, result), { daysBack: 2, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`[Amazon] Cron done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
    }
    catch (e) {
        console.error('[Amazon] Cron sync failed:', e.message);
        await shared_1.db.collection('amazon_sync_logs').add({
            type: 'scheduled', status: 'error', imported: 0, updated: 0, errors: 1,
            errorMessage: e.message,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
});
// ─── amazonOAuthCallback — HTTP function ──────────────────────────────────────
// Amazon redirects here after seller authorizes the app.
// URL: https://us-central1-tiendapraxis.cloudfunctions.net/amazonOAuthCallback
// Register this URL as "OAuth Login URI" in Amazon Developer Console.
// ─────────────────────────────────────────────────────────────────────────────
exports.amazonOAuthCallback = functions.https.onRequest(async (req, res) => {
    var _a, _b;
    const { spapi_oauth_code, state, selling_partner_id } = req.query;
    if (!spapi_oauth_code) {
        res.status(400).send('Missing spapi_oauth_code');
        return;
    }
    try {
        const doc = await shared_1.db.collection('config').doc('integrations').get();
        const cfg = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.amazon;
        if (!(cfg === null || cfg === void 0 ? void 0 : cfg.clientId) || !(cfg === null || cfg === void 0 ? void 0 : cfg.clientSecret)) {
            res.status(500).send('Amazon not configured — missing clientId or clientSecret.');
            return;
        }
        const CALLBACK_URL = 'https://us-central1-tiendapraxis.cloudfunctions.net/amazonOAuthCallback';
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: spapi_oauth_code,
            redirect_uri: CALLBACK_URL,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
        });
        const tokenRes = await fetch(AMAZON_LWA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const tokenJson = await tokenRes.json();
        if (!tokenJson.refresh_token) {
            console.error('[AmazonOAuth] Token exchange failed:', JSON.stringify(tokenJson));
            res.status(500).send(`Token exchange failed: ${JSON.stringify(tokenJson)}`);
            return;
        }
        // Persist the fresh refresh token + seller ID
        await shared_1.db.collection('config').doc('integrations').set({
            amazon: {
                refreshToken: tokenJson.refresh_token,
                sellerId: (_b = selling_partner_id !== null && selling_partner_id !== void 0 ? selling_partner_id : cfg.sellerId) !== null && _b !== void 0 ? _b : '',
                connected: true,
                connectedAt: admin.firestore.FieldValue.serverTimestamp(),
            }
        }, { merge: true });
        console.log('[AmazonOAuth] Connected seller:', selling_partner_id, '— refresh token saved.');
        // Return a clean success page
        res.status(200).send(`
            <!DOCTYPE html><html><head><meta charset="utf-8"><title>Amazon Conectado</title>
            <style>
              body { font-family: system-ui, sans-serif; background: #09090b; color: #f4f4f5;
                     display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
              .card { background: #18181b; border: 1px solid #27272a; border-radius: 1rem;
                      padding: 2rem 2.5rem; text-align: center; max-width: 420px; }
              .icon { font-size: 3rem; margin-bottom: 1rem; }
              h1 { color: #10b981; margin: 0 0 .5rem; font-size: 1.5rem; }
              p { color: #71717a; margin: 0 0 1.5rem; }
              .seller { background: #1e2a22; color: #34d399; border-radius: .5rem;
                        padding: .4rem 1rem; font-family: monospace; display: inline-block; margin-bottom: 1.5rem; }
              a { color: #6366f1; text-decoration: none; font-weight: 600; }
            </style></head>
            <body><div class="card">
              <div class="icon">✅</div>
              <h1>¡Amazon conectado!</h1>
              <p>Tu cuenta de Amazon ha sido autorizada correctamente.</p>
              <div class="seller">Seller ID: ${selling_partner_id !== null && selling_partner_id !== void 0 ? selling_partner_id : 'N/A'}</div>
              <p>Puedes cerrar esta ventana y regresar a la app.</p>
              <a href="https://tiendapraxis.web.app/admin/settings/integrations">← Volver a Integraciones</a>
            </div></body></html>
        `);
    }
    catch (e) {
        console.error('[AmazonOAuth] Error:', e.message);
        res.status(500).send(`OAuth error: ${e.message}`);
    }
});
// ─── Facturapi PAC Integration (Placeholder) ────────────────────────────────
//# sourceMappingURL=amazon.js.map