/**
 * meli-shared.ts
 * Shared MercadoLibre helpers used by meli-orders.ts, meli-auth.ts,
 * meli-inventory.ts, meli-enrichment.ts, and meli-webhook.ts.
 *
 * These functions are NOT exported as Cloud Functions — they are internal utilities.
 */

import * as admin from 'firebase-admin';
import { db } from './shared';

export async function getMeliConfig() {
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
export async function getValidMeliToken(): Promise<string> {
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
        return meliConfig.accessToken as string;
    }

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
                await db.collection('config').doc('integrations').set(
                    { meli: { connected: false } },
                    { merge: true }
                );
                throw new Error('MeLi refresh token expired. Please re-authenticate in /admin/integrations.');
            }
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
        return meliConfig.accessToken as string;
    }
}

/**
 * App-level token using client_credentials grant.
 * This is the CORRECT token type for reading public ML marketplace data from a server.
 * Unlike the user OAuth token, ML does NOT block client_credentials requests from GCP IPs.
 * Cached in Firestore with a 6-hour TTL to minimise token API calls.
 */
export async function getAppLevelToken(): Promise<string> {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli ?? {};

    const appId = meliConfig.appId;
    const clientSecret = meliConfig.clientSecret;

    if (!appId || !clientSecret) {
        console.warn('[Meli:AppToken] Missing appId/clientSecret — falling back to user token');
        return getValidMeliToken();
    }

    // Check cached app token (valid for most of its 6h window)
    const cached = meliConfig.appAccessToken;
    const cachedExp = meliConfig.appTokenExpiresAt ?? 0;
    if (cached && (cachedExp - Date.now()) > 10 * 60 * 1000) {
        console.log('[Meli:AppToken] Cache HIT — reusing app token');
        return cached as string;
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
    const data = await res.json() as any;

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
    return data.access_token as string;
}




export function stripNullsAndUndefined(obj: any): any {
    if (obj === null || obj === undefined) return undefined;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) {
        return obj.map(stripNullsAndUndefined).filter((x: any) => x !== undefined);
    }
    if (typeof obj !== 'object') return obj;

    const result: any = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val === null || val === undefined) continue;

        if (typeof val === 'object' && !(val instanceof Date)) {
            const cleaned = stripNullsAndUndefined(val);
            if (cleaned !== undefined) {
                result[key] = cleaned;
            }
        } else {
            result[key] = val;
        }
    }
    return result;
}

// Helper: Parse and construct Eurollantas Order object from a Meli Order, Ship Data, and Billing Info
export function parseAndSaveMeliOrder(mo: any, shipData: any, billingData?: any) {
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
        logisticType === 'fulfillment' ? 'platform' :  // MELI Full — ML warehouse packs & ships
            logisticType === 'self_service' ? 'flex' :  // MELI Flex — seller packs, same-day delivery
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
    const rawLastName = mo.buyer?.last_name || '';
    const rawFullName = `${rawFirstName} ${rawLastName}`.trim();
    const nickname = mo.buyer?.nickname || '';

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

    return stripNullsAndUndefined({
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
        // ── Financial accuracy fields ────────────────────────────────────────────
        // refundedAmount: sum of all payment-level refunds (cancellations, chargebacks)
        // This reduces net_receipt — captured from payments[].refunded_amount
        refundedAmount: (() => {
            const total = (mo.payments || []).reduce((sum: number, p: any) => {
                // refunded_amount is the authoritative refund field in ML API
                const refund = p.refunded_amount || p.amount_refunded || 0;
                return sum + (typeof refund === 'number' ? refund : 0);
            }, 0);
            return Math.round(total * 100) / 100;
        })(),
        // mlBonus: any ML-funded credits added to the order (Flex reimbursements,
        // seller-protection credits, ML-funded coupon subsidies)
        // These INCREASE net_receipt — captured from order.coupon + order.coupons[]
        mlBonus: (() => {
            let bonus = 0;
            // order.coupon.amount = ML-funded discount subsidy
            if (mo.coupon && typeof mo.coupon.amount === 'number') bonus += mo.coupon.amount;
            // order.coupons[] — multiple coupon array (newer API shape)
            if (Array.isArray(mo.coupons)) {
                mo.coupons.forEach((c: any) => { bonus += typeof c.amount === 'number' ? c.amount : 0; });
            }
            return Math.round(bonus * 100) / 100;
        })(),
        // isAdDriven: true when this order was attributed to a Mercado Ads campaign
        isAdDriven: !!(mo.context?.channel === 'mp-advertising' ||
                       mo.context?.source === 'ADVERTISING' ||
                       (mo.tags && mo.tags.includes('paid_advertising'))),
        // orderShippingCost: order-level shipping_cost field (may carry Full CFF
        // when /shipments/{id}/costs returns 0 for fulfillment orders)
        orderShippingCost: typeof mo.shipping_cost === 'number' ? Math.abs(mo.shipping_cost) : 0,
        // ── shippingAddress: protective conditional spread ─────────────────────
        // When MeLi API returns no address, we return {} (empty spread) so the key
        // is ABSENT from the payload. Firestore merge:true then preserves whatever
        // was previously written — future syncs can NEVER blank out a valid state.
        ...(() => {
            const recvAddr = shipData?.receiver_address
                // Full/FBM orders: receiver_address=null, use destination.shipping_address
                // CONFIRMED by 2026-04-24 local diagnostic (10/10 orders verified).
                ?? shipData?.destination?.shipping_address
                ?? mo?.shipping?.receiver_address
                ?? null;
            if (!recvAddr) return {};  // no data → preserve existing Firestore value
            const state = recvAddr.state?.name || recvAddr.state || '';
            if (!state) return {};  // have addr object but no state → preserve
            return {
                shippingAddress: {
                    street: recvAddr.street_name || recvAddr.address_line || 'MercadoEnvíos',
                    exteriorNumber: recvAddr.street_number || '',
                    interiorNumber: '',
                    references: recvAddr.comment || '',
                    colonia: recvAddr.neighborhood?.name || '',
                    city: recvAddr.city?.name || recvAddr.municipality?.name || '',
                    state,
                    zipCode: recvAddr.zip_code || '',
                    country: recvAddr.country?.id || 'MX',
                    recipientName: recvAddr.receiver_name || shipData?.destination?.receiver_name || ''
                }
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
            // In Mexico, the RFC is usually under doc_number
            const rfcNumber = bi?.doc_number || bi?.identification?.number || null;

            // MeLi often places fiscal data in the additional_info array
            const addInfo = bi?.additional_info || [];
            const getAddInfo = (typeKey: string) => addInfo.find((a: any) => a.type === typeKey)?.value || null;

            return {
                meliInvoice: {
                    name: bi?.name || bi?.first_name
                        ? `${bi.name || bi.first_name || ''} ${bi.last_name || ''}`.trim()
                        : null,
                    rfc: rfcNumber,
                    identificationType: bi?.doc_type || bi?.identification?.type || 'RFC',
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
                    cfdiUse: bi?.cfdi_use || getAddInfo('CFDI_USE') || null,
                    // Taxpayer type: 'Persona Física' | 'Persona Moral' | '612' | '601'
                    taxpayerType: bi?.taxpayer_type || getAddInfo('TAXPAYER_TYPE') || null,
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
    });
}

/**
 * Centrally processes raw MercadoLibre order data, fetches related details (shipments,
 * costs, billing info, MercadoPago collections), and writes the fully calculated
 * order object to Firestore under meli_${orderId} using { merge: true } merge logic.
 */
export async function processAndSaveMeliOrderFromData(
    mo: any,
    accessToken: string,
    preFetched?: {
        shipData?: any;
        billingData?: any;
        shipCosts?: any;
        mpPayment?: any;
    }
) {
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    // Fetch shipment if not pre-fetched and shipping.id is present
    let shipData = preFetched?.shipData;
    if (shipData === undefined && mo.shipping?.id) {
        try {
            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                headers: { ...headers, 'x-format-new': 'true' }
            });
            if (sRes.ok) shipData = await sRes.json();
            else {
                console.warn(`[Meli Shared] Shipment ${mo.shipping.id} fetch failed: ${sRes.status}`);
                shipData = { _fetchFailed: true, logistic_type: mo.shipping?.logistic_type ?? null };
            }
        } catch (e) {
            console.warn(`[Meli Shared] Shipment fetch error:`, e);
        }
    }

    // Fetch billing info if not pre-fetched
    let billingData = preFetched?.billingData;
    if (billingData === undefined) {
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
    }

    // Fetch shipment costs if not pre-fetched and shipping.id is present
    let shipCosts = preFetched?.shipCosts;
    if (shipCosts === undefined && mo.shipping?.id) {
        try {
            const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, { headers });
            if (cRes.ok) {
                const costsJson = await cRes.json() as any;
                const senderCost: number  = costsJson?.senders?.[0]?.cost ?? 0;
                const grossAmount: number = costsJson?.gross_amount ?? 0;
                const buyerCost: number   = costsJson?.buyer_cost ?? costsJson?.buyers?.[0]?.cost ?? 0;
                const meliSubsidy: number = (costsJson?.senders?.[0]?.discounts || [])
                    .reduce((sum: number, d: any) => sum + (d.promoted_amount || 0), 0);
                shipCosts = { seller_cost: senderCost, gross_amount: grossAmount, buyer_cost: buyerCost, meli_subsidy: meliSubsidy };
            }
        } catch (_) { /* non-critical */ }
    }

    // Fetch MercadoPago payment info if not pre-fetched and payments[0].id is present
    let mpPayment = preFetched?.mpPayment;
    const paymentId = mo.payments?.[0]?.id;
    if (mpPayment === undefined && paymentId) {
        try {
            const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers });
            if (mpRes.ok) {
                const mpData = await mpRes.json() as any;
                const col = mpData?.collection ?? mpData;
                mpPayment = {
                    shipping_amount: col?.shipping_amount ?? 0,
                    mp_fee: (col?.fee_details || [])
                        .filter((f: any) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                        .reduce((s: number, f: any) => s + (f.amount || 0), 0),
                    net_received_amount: col?.net_received_amount ?? col?.net_amount ?? 0,
                };
            }
        } catch (_) { /* non-critical */ }
    }

    const newOrder = parseAndSaveMeliOrder(mo, shipData, billingData);

    // ── Resolve shipping seller cost ─────────────────────────────────────────
    const mpShipAmount:  number = mpPayment?.shipping_amount  ?? 0;
    const buyerShipCost: number = shipCosts?.buyer_cost        ?? 0;
    const shippingSellerCost: number = (() => {
        const fromCosts = shipCosts?.seller_cost ?? 0;
        if (fromCosts > 0) return fromCosts;
        if (mpShipAmount > 0) {
            if (newOrder.fulfillmentType === 'platform') return mpShipAmount;
            if (mpShipAmount > buyerShipCost) return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
        }
        const fromOrder = (newOrder as any).orderShippingCost ?? 0;
        if (fromOrder > 0) return fromOrder;
        return 0;
    })();
    const shippingGrossAmount: number = shipCosts?.gross_amount ?? mpShipAmount;
    const shippingMeliSubsidy: number = shipCosts?.meli_subsidy ?? 0;
    const cffPending: boolean = newOrder.fulfillmentType === 'platform' && shippingSellerCost === 0 && mpShipAmount === 0;

    // ── SAT tax retentions ───────────────────────────────────────────────────
    const IVA_INCLUSIVE_DIVISOR = 1.16;
    const totalAmount:   number = newOrder.total ?? 0;
    const preIvaAmount:  number = totalAmount / IVA_INCLUSIVE_DIVISOR;
    const retencionIVA:  number = Math.round(preIvaAmount * 0.08  * 100) / 100;
    const retencionISR:  number = Math.round(preIvaAmount * 0.025 * 100) / 100;
    const meliCommission: number = (newOrder as any).marketplaceFee ?? 0;
    const refundedAmount: number = (newOrder as any).refundedAmount ?? 0;
    const mlBonus: number        = (newOrder as any).mlBonus ?? 0;
    const netReceipt: number = Math.round(Math.max(0,
        totalAmount - meliCommission - retencionIVA - retencionISR
        - shippingSellerCost - refundedAmount + mlBonus
    ) * 100) / 100;

    // Merge financial fields into the order before saving
    const orderWithFinancials = {
        ...newOrder,
        shipping_seller_cost:  shippingSellerCost,
        shipping_gross_amount: shippingGrossAmount,
        shipping_meli_subsidy: shippingMeliSubsidy,
        mp_shipping_amount:    mpShipAmount,
        buyer_shipping_cost:   buyerShipCost,
        cff_pending:           cffPending,
        retencion_iva:         retencionIVA,
        retencion_isr:         retencionISR,
        total_impuestos:       retencionIVA + retencionISR,
        refunded_amount:       refundedAmount,
        ml_bonus:              mlBonus,
        net_receipt:           netReceipt,
    };

    // Use the REAL individual order id as the doc key
    const orderRef = db.collection('orders').doc(`meli_${mo.id}`);

    // Preserve the original human-readable buyer name on webhook updates.
    try {
        const existingSnap = await orderRef.get();
        const existingOrigName = existingSnap.data()?.customer?.originalName;
        const isAnonW = (s: string) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
        if (existingOrigName && !isAnonW(existingOrigName)) {
            orderWithFinancials.customer.originalName = existingOrigName;
        } else if (existingOrigName && isAnonW(existingOrigName) && !isAnonW(orderWithFinancials.customer.originalName)) {
            // Upgrade: stored was anonymized, new is readable — keep new one
        } else if (existingOrigName) {
            orderWithFinancials.customer.originalName = existingOrigName;
        }
    } catch (_) { /* non-critical — proceed without preservation */ }

    await orderRef.set(orderWithFinancials, { merge: true });

    console.log(`[Meli Shared] Saved order ML-${mo.id} with shipping_cost=${shippingSellerCost} net=${netReceipt} (pack_id: ${mo.pack_id || 'n/a'})`);
}


