"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meliRefreshTokenScheduled = exports.meliCallback = exports.meliAuthUrl = void 0;
/**
 * meli-auth.ts
 * MercadoLibre OAuth flow: Auth URL, callback, scheduled token refresh.
 */
const functions = require("firebase-functions");
const shared_1 = require("./shared");
const meli_shared_1 = require("./meli-shared");
exports.meliAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    try {
        const config = await (0, meli_shared_1.getMeliConfig)();
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
        const config = await (0, meli_shared_1.getMeliConfig)();
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
        await shared_1.db.collection('config').doc('integrations').set({
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
        const config = await (0, meli_shared_1.getMeliConfig)();
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
                await shared_1.db.collection('config').doc('integrations').set({
                    meli: { connected: false }
                }, { merge: true });
            }
            return;
        }
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);
        await shared_1.db.collection('config').doc('integrations').set({
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
//# sourceMappingURL=meli-auth.js.map