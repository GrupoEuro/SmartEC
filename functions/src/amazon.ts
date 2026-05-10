/**
 * amazon.ts
 * Amazon Selling Partner API integration: order sync, OAuth callback.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';

const AMAZON_SP_BASE = 'https://sellingpartnerapi-na.amazon.com';
const AMAZON_LWA_URL = 'https://api.amazon.com/auth/o2/token';
const AMAZON_MX_MKT = 'A1AM78C64UM0Y8';

/** Reads Amazon SP-API config from config/integrations.amazon */
async function getAmazonConfig() {
    const doc = await db.collection('config').doc('integrations').get();
    const cfg = doc.data()?.amazon;
    if (!cfg?.clientId || !cfg?.clientSecret || !cfg?.refreshToken) {
        throw new Error('Amazon SP-API not fully configured. Check /admin/integrations.');
    }
    return cfg as {
        clientId: string; clientSecret: string; refreshToken: string;
        sellerId?: string; marketplaceId?: string; region?: string;
    };
}

/**
 * Exchanges the LWA refresh token for a short-lived access token.
 * Caches in Firestore config/amazon_token_cache with a 55-min TTL.
 */
async function getAmazonAccessToken(): Promise<string> {
    // Try cache first
    const cacheRef = db.collection('config').doc('amazon_token_cache');
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
        const c = cacheSnap.data()!;
        const exp = c.expiresAt instanceof admin.firestore.Timestamp
            ? c.expiresAt.toDate() : new Date(c.expiresAt ?? 0);
        if (c.accessToken && exp > new Date(Date.now() + 5 * 60 * 1000)) {
            return c.accessToken as string;
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

    const json = await res.json() as { access_token: string; expires_in: number };
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
function mapAmazonStatus(s: string): string {
    const MAP: Record<string, string> = {
        Pending: 'pending',
        Unshipped: 'processing',
        PartiallyShipped: 'processing',
        Shipped: 'shipped',
        Delivered: 'delivered',
        Canceled: 'cancelled',
        Unfulfillable: 'cancelled',
    };
    return MAP[s] ?? 'pending';
}

/** AFN = FBA (Amazon fulfills) → 'platform', MFN = merchant fulfills → 'merchant' */
function mapFulfillmentChannel(ch: string): string {
    return ch === 'AFN' ? 'platform' : 'merchant';
}

/**
 * Core Amazon order sync logic — shared by manual callable and nightly cron.
 * Fetches all orders from SP-API in the given window, upserts into Firestore.
 */
async function runAmazonSync(daysBack: number): Promise<{
    imported: number; updated: number; errors: number;
}> {
    const cfg = await getAmazonConfig();
    const token = await getAmazonAccessToken();
    const mktId = cfg.marketplaceId ?? AMAZON_MX_MKT;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    let imported = 0, updated = 0, errors = 0;
    let nextToken: string | undefined;

    do {
        const params = new URLSearchParams({ MarketplaceIds: mktId, CreatedAfter: since.toISOString() });
        if (nextToken) params.set('NextToken', nextToken);

        const ordersRes = await fetch(`${AMAZON_SP_BASE}/orders/v0/orders?${params}`, {
            headers: { 'x-amz-access-token': token },
        });

        if (!ordersRes.ok) {
            const errTxt = await ordersRes.text();
            throw new Error(`SP-API /orders failed (${ordersRes.status}): ${errTxt}`);
        }

        const ordersJson = await ordersRes.json() as any;
        const amzOrders: any[] = ordersJson?.payload?.Orders ?? [];
        nextToken = ordersJson?.payload?.NextToken;

        console.log(`[Amazon] Fetched ${amzOrders.length} orders (nextToken=${!!nextToken})`);

        for (const amzOrder of amzOrders) {
            try {
                // ── Fetch line items (separate SP-API call per order) ──────────
                let items: any[] = [];
                const itemsRes = await fetch(
                    `${AMAZON_SP_BASE}/orders/v0/orders/${amzOrder.AmazonOrderId}/orderItems`,
                    { headers: { 'x-amz-access-token': token } }
                );
                if (itemsRes.ok) {
                    const itemsJson = await itemsRes.json() as any;
                    items = (itemsJson?.payload?.OrderItems ?? []).map((i: any) => ({
                        sku: i.SellerSKU || i.ASIN || '',
                        name: i.Title || '',   // legacy field
                        productName: i.Title || '',   // matches OrderItem interface
                        quantity: i.QuantityOrdered ?? 1,
                        price: parseFloat(i.ItemPrice?.Amount ?? '0'),
                        asin: i.ASIN || '',
                    }));
                }

                // ── Build Firestore document ───────────────────────────────────
                const addr = amzOrder.ShippingAddress ?? {};
                const total = parseFloat(amzOrder.OrderTotal?.Amount ?? '0');

                const orderDoc = {
                    orderNumber: amzOrder.AmazonOrderId,
                    amazonOrderId: amzOrder.AmazonOrderId,
                    sourceChannel: 'amazon',
                    fulfillmentType: mapFulfillmentChannel(amzOrder.FulfillmentChannel ?? 'MFN'),
                    status: mapAmazonStatus(amzOrder.OrderStatus ?? 'Pending'),
                    total,
                    currency: amzOrder.OrderTotal?.CurrencyCode ?? 'MXN',
                    items,
                    shippingAddress: {
                        name: addr.Name ?? '',
                        city: addr.City ?? '',
                        state: addr.StateOrRegion ?? '',
                        zipCode: addr.PostalCode ?? '',
                        country: addr.CountryCode ?? 'MX',
                    },
                    buyerEmail: amzOrder.BuyerInfo?.BuyerEmail ?? '',
                    createdAt: amzOrder.PurchaseDate
                        ? new Date(amzOrder.PurchaseDate) : admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: amzOrder.LastUpdateDate
                        ? new Date(amzOrder.LastUpdateDate) : admin.firestore.FieldValue.serverTimestamp(),
                    shipByDate: amzOrder.LatestShipDate ? new Date(amzOrder.LatestShipDate) : null,
                    deliverByDate: amzOrder.LatestDeliveryDate ? new Date(amzOrder.LatestDeliveryDate) : null,
                    marketplaceId: mktId,
                    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                };

                const docRef = db.collection('orders').doc(`amz-${amzOrder.AmazonOrderId}`);
                const snap = await docRef.get();
                await docRef.set(orderDoc, { merge: true });
                if (snap.exists) updated++; else imported++;

                // SP-API rate limit: getOrderItems = 0.5 req/s burst. 250ms delay is safe.
                await new Promise(r => setTimeout(r, 250));

            } catch (orderErr: any) {
                console.error(`[Amazon] Error on ${amzOrder.AmazonOrderId}:`, orderErr?.message);
                errors++;
            }
        }

    } while (nextToken);

    return { imported, updated, errors };
}

// ─── amazonManualSync — callable (from AmazonHub UI) ─────────────────────────
export const amazonManualSync = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (data: { daysBack?: number }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const daysBack = Math.min(data?.daysBack ?? 7, 30); // cap at 30 days for manual

        console.log(`[Amazon] Manual sync started — last ${daysBack} days`);
        try {
            const result = await runAmazonSync(daysBack);

            await db.collection('amazon_sync_logs').add({
                type: 'manual', status: result.errors > 0 ? 'partial' : 'success',
                ...result, daysBack,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`[Amazon] Manual sync done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
            return { success: true, ...result };
        } catch (e: any) {
            console.error('[Amazon] Manual sync failed:', e.message);
            await db.collection('amazon_sync_logs').add({
                type: 'manual', status: 'error', imported: 0, updated: 0, errors: 1,
                errorMessage: e.message,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            throw new functions.https.HttpsError('internal', e.message);
        }
    });

// ─── amazonSyncCron — scheduled every 30 min ─────────────────────────────────
export const amazonSyncCron = functions.pubsub
    .schedule('*/30 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
        console.log('[Amazon] Cron sync started — last 2 days');
        try {
            const result = await runAmazonSync(2);

            await db.collection('amazon_sync_logs').add({
                type: 'scheduled', status: result.errors > 0 ? 'partial' : 'success',
                ...result, daysBack: 2,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`[Amazon] Cron done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
        } catch (e: any) {
            console.error('[Amazon] Cron sync failed:', e.message);
            await db.collection('amazon_sync_logs').add({
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
export const amazonOAuthCallback = functions.https.onRequest(async (req, res) => {
    const { spapi_oauth_code, state, selling_partner_id } = req.query as Record<string, string>;

    if (!spapi_oauth_code) {
        res.status(400).send('Missing spapi_oauth_code');
        return;
    }

    try {
        const doc = await db.collection('config').doc('integrations').get();
        const cfg = doc.data()?.amazon;
        if (!cfg?.clientId || !cfg?.clientSecret) {
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

        const tokenJson = await tokenRes.json() as any;

        if (!tokenJson.refresh_token) {
            console.error('[AmazonOAuth] Token exchange failed:', JSON.stringify(tokenJson));
            res.status(500).send(`Token exchange failed: ${JSON.stringify(tokenJson)}`);
            return;
        }

        // Persist the fresh refresh token + seller ID
        await db.collection('config').doc('integrations').set({
            amazon: {
                refreshToken: tokenJson.refresh_token,
                sellerId: selling_partner_id ?? cfg.sellerId ?? '',
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
              <div class="seller">Seller ID: ${selling_partner_id ?? 'N/A'}</div>
              <p>Puedes cerrar esta ventana y regresar a la app.</p>
              <a href="https://tiendapraxis.web.app/admin/settings/integrations">← Volver a Integraciones</a>
            </div></body></html>
        `);

    } catch (e: any) {
        console.error('[AmazonOAuth] Error:', e.message);
        res.status(500).send(`OAuth error: ${e.message}`);
    }
});

// ─── Facturapi PAC Integration (Placeholder) ────────────────────────────────

