"use strict";
/**
 * meli-shared.ts
 * Shared MercadoLibre helpers used by meli-orders.ts, meli-auth.ts,
 * meli-inventory.ts, meli-enrichment.ts, and meli-webhook.ts.
 *
 * These functions are NOT exported as Cloud Functions — they are internal utilities.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAndSaveMeliOrderFromData = exports.parseAndSaveMeliOrder = exports.stripNullsAndUndefined = exports.getAppLevelToken = exports.getValidMeliToken = exports.getMeliConfig = void 0;
const admin = require("firebase-admin");
const shared_1 = require("./shared");
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
exports.getMeliConfig = getMeliConfig;
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
exports.getValidMeliToken = getValidMeliToken;
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
exports.getAppLevelToken = getAppLevelToken;
function stripNullsAndUndefined(obj) {
    if (obj === null || obj === undefined)
        return undefined;
    if (obj instanceof Date)
        return obj;
    if (Array.isArray(obj)) {
        return obj.map(stripNullsAndUndefined).filter((x) => x !== undefined);
    }
    if (typeof obj !== 'object')
        return obj;
    const result = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val === null || val === undefined)
            continue;
        if (typeof val === 'object' && !(val instanceof Date)) {
            const cleaned = stripNullsAndUndefined(val);
            if (cleaned !== undefined) {
                result[key] = cleaned;
            }
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
exports.stripNullsAndUndefined = stripNullsAndUndefined;
// Helper: Parse and construct Eurollantas Order object from a Meli Order, Ship Data, and Billing Info
function parseAndSaveMeliOrder(mo, shipData, billingData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11;
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
    return stripNullsAndUndefined(Object.assign(Object.assign(Object.assign(Object.assign({ id: `meli_${mo.id}`, orderNumber: `ML-${mo.id}`, sourceChannel: 'mercadolibre', fulfillmentType: fType, shippingId: ((_y = mo.shipping) === null || _y === void 0 ? void 0 : _y.id) ? String(mo.shipping.id) : '', externalOrderId: String(mo.id), 
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
        })), total: mo.total_amount, subtotal: mo.total_amount, marketplaceFee: (mo.order_items || []).reduce((acc, val) => acc + (val.sale_fee || 0), 0), paymentStatus: mo.payments && mo.payments.length > 0 && mo.payments[0].status === 'approved' ? 'approved' : 'pending', 
        // ── Financial accuracy fields ────────────────────────────────────────────
        // refundedAmount: sum of all payment-level refunds (cancellations, chargebacks)
        // This reduces net_receipt — captured from payments[].refunded_amount
        refundedAmount: (() => {
            const total = (mo.payments || []).reduce((sum, p) => {
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
            if (mo.coupon && typeof mo.coupon.amount === 'number')
                bonus += mo.coupon.amount;
            // order.coupons[] — multiple coupon array (newer API shape)
            if (Array.isArray(mo.coupons)) {
                mo.coupons.forEach((c) => { bonus += typeof c.amount === 'number' ? c.amount : 0; });
            }
            return Math.round(bonus * 100) / 100;
        })(), 
        // isAdDriven: true when this order was attributed to a Mercado Ads campaign
        isAdDriven: !!(((_10 = mo.context) === null || _10 === void 0 ? void 0 : _10.channel) === 'mp-advertising' ||
            ((_11 = mo.context) === null || _11 === void 0 ? void 0 : _11.source) === 'ADVERTISING' ||
            (mo.tags && mo.tags.includes('paid_advertising'))), 
        // orderShippingCost: order-level shipping_cost field (may carry Full CFF
        // when /shipments/{id}/costs returns 0 for fulfillment orders)
        orderShippingCost: typeof mo.shipping_cost === 'number' ? Math.abs(mo.shipping_cost) : 0 }, (() => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const recvAddr = (_e = (_c = (_a = shipData === null || shipData === void 0 ? void 0 : shipData.receiver_address) !== null && _a !== void 0 ? _a : (_b = shipData === null || shipData === void 0 ? void 0 : shipData.destination) === null || _b === void 0 ? void 0 : _b.shipping_address) !== null && _c !== void 0 ? _c : (_d = mo === null || mo === void 0 ? void 0 : mo.shipping) === null || _d === void 0 ? void 0 : _d.receiver_address) !== null && _e !== void 0 ? _e : null;
        if (!recvAddr)
            return {}; // no data → preserve existing Firestore value
        const state = ((_f = recvAddr.state) === null || _f === void 0 ? void 0 : _f.name) || recvAddr.state || '';
        if (!state)
            return {}; // have addr object but no state → preserve
        return {
            shippingAddress: {
                street: recvAddr.street_name || recvAddr.address_line || 'MercadoEnvíos',
                exteriorNumber: recvAddr.street_number || '',
                interiorNumber: '',
                references: recvAddr.comment || '',
                colonia: ((_g = recvAddr.neighborhood) === null || _g === void 0 ? void 0 : _g.name) || '',
                city: ((_h = recvAddr.city) === null || _h === void 0 ? void 0 : _h.name) || ((_j = recvAddr.municipality) === null || _j === void 0 ? void 0 : _j.name) || '',
                state,
                zipCode: recvAddr.zip_code || '',
                country: ((_k = recvAddr.country) === null || _k === void 0 ? void 0 : _k.id) || 'MX',
                recipientName: recvAddr.receiver_name || ((_l = shipData === null || shipData === void 0 ? void 0 : shipData.destination) === null || _l === void 0 ? void 0 : _l.receiver_name) || ''
            }
        };
    })()), { createdAt: mo.date_created ? new Date(mo.date_created) : admin.firestore.FieldValue.serverTimestamp(), updatedAt: mo.date_last_updated ? new Date(mo.date_last_updated) : admin.firestore.FieldValue.serverTimestamp(), nativeSla: nativeSla, 
        // Top-level ship/delivery timestamps for fast SLA evaluation without scanning history
        shippedAt: rawDateShipped ? new Date(rawDateShipped) : null, deliveredAt: rawDateDelivered ? new Date(rawDateDelivered) : null, 
        // meliDelayed: true means MercadoLibre's own system flagged this as a dispatch delay
        meliDelayed: meliDelayed, meliDelayTypes: meliDelayTypes }), (billingData && !billingData.error ? (() => {
        var _a, _b, _c, _d, _e;
        // MeLi returns different shapes in v1 vs v2. Normalize both.
        const bi = billingData.billing_info || billingData;
        // In Mexico, the RFC is usually under doc_number
        const rfcNumber = (bi === null || bi === void 0 ? void 0 : bi.doc_number) || ((_a = bi === null || bi === void 0 ? void 0 : bi.identification) === null || _a === void 0 ? void 0 : _a.number) || null;
        // MeLi often places fiscal data in the additional_info array
        const addInfo = (bi === null || bi === void 0 ? void 0 : bi.additional_info) || [];
        const getAddInfo = (typeKey) => { var _a; return ((_a = addInfo.find((a) => a.type === typeKey)) === null || _a === void 0 ? void 0 : _a.value) || null; };
        return {
            meliInvoice: {
                name: (bi === null || bi === void 0 ? void 0 : bi.name) || (bi === null || bi === void 0 ? void 0 : bi.first_name)
                    ? `${bi.name || bi.first_name || ''} ${bi.last_name || ''}`.trim()
                    : null,
                rfc: rfcNumber,
                identificationType: (bi === null || bi === void 0 ? void 0 : bi.doc_type) || ((_b = bi === null || bi === void 0 ? void 0 : bi.identification) === null || _b === void 0 ? void 0 : _b.type) || 'RFC',
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
                cfdiUse: (bi === null || bi === void 0 ? void 0 : bi.cfdi_use) || getAddInfo('CFDI_USE') || null,
                // Taxpayer type: 'Persona Física' | 'Persona Moral' | '612' | '601'
                taxpayerType: (bi === null || bi === void 0 ? void 0 : bi.taxpayer_type) || getAddInfo('TAXPAYER_TYPE') || null,
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
    } : {})));
}
exports.parseAndSaveMeliOrder = parseAndSaveMeliOrder;
/**
 * Centrally processes raw MercadoLibre order data, fetches related details (shipments,
 * costs, billing info, MercadoPago collections), and writes the fully calculated
 * order object to Firestore under meli_${orderId} using { merge: true } merge logic.
 */
async function processAndSaveMeliOrderFromData(mo, accessToken, preFetched) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    // Fetch shipment if not pre-fetched and shipping.id is present
    let shipData = preFetched === null || preFetched === void 0 ? void 0 : preFetched.shipData;
    if (shipData === undefined && ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id)) {
        try {
            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                headers: Object.assign(Object.assign({}, headers), { 'x-format-new': 'true' })
            });
            if (sRes.ok)
                shipData = await sRes.json();
            else {
                console.warn(`[Meli Shared] Shipment ${mo.shipping.id} fetch failed: ${sRes.status}`);
                shipData = { _fetchFailed: true, logistic_type: (_c = (_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.logistic_type) !== null && _c !== void 0 ? _c : null };
            }
        }
        catch (e) {
            console.warn(`[Meli Shared] Shipment fetch error:`, e);
        }
    }
    // Fetch billing info if not pre-fetched
    let billingData = preFetched === null || preFetched === void 0 ? void 0 : preFetched.billingData;
    if (billingData === undefined) {
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
    }
    // Fetch shipment costs if not pre-fetched and shipping.id is present
    let shipCosts = preFetched === null || preFetched === void 0 ? void 0 : preFetched.shipCosts;
    if (shipCosts === undefined && ((_d = mo.shipping) === null || _d === void 0 ? void 0 : _d.id)) {
        try {
            const cRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}/costs`, { headers });
            if (cRes.ok) {
                const costsJson = await cRes.json();
                const senderCost = (_g = (_f = (_e = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.cost) !== null && _g !== void 0 ? _g : 0;
                const grossAmount = (_h = costsJson === null || costsJson === void 0 ? void 0 : costsJson.gross_amount) !== null && _h !== void 0 ? _h : 0;
                const buyerCost = (_m = (_j = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyer_cost) !== null && _j !== void 0 ? _j : (_l = (_k = costsJson === null || costsJson === void 0 ? void 0 : costsJson.buyers) === null || _k === void 0 ? void 0 : _k[0]) === null || _l === void 0 ? void 0 : _l.cost) !== null && _m !== void 0 ? _m : 0;
                const meliSubsidy = (((_p = (_o = costsJson === null || costsJson === void 0 ? void 0 : costsJson.senders) === null || _o === void 0 ? void 0 : _o[0]) === null || _p === void 0 ? void 0 : _p.discounts) || [])
                    .reduce((sum, d) => sum + (d.promoted_amount || 0), 0);
                shipCosts = { seller_cost: senderCost, gross_amount: grossAmount, buyer_cost: buyerCost, meli_subsidy: meliSubsidy };
            }
        }
        catch (_) { /* non-critical */ }
    }
    // Fetch MercadoPago payment info if not pre-fetched and payments[0].id is present
    let mpPayment = preFetched === null || preFetched === void 0 ? void 0 : preFetched.mpPayment;
    const paymentId = (_r = (_q = mo.payments) === null || _q === void 0 ? void 0 : _q[0]) === null || _r === void 0 ? void 0 : _r.id;
    if (mpPayment === undefined && paymentId) {
        try {
            const mpRes = await fetch(`https://api.mercadolibre.com/collections/${paymentId}`, { headers });
            if (mpRes.ok) {
                const mpData = await mpRes.json();
                const col = (_s = mpData === null || mpData === void 0 ? void 0 : mpData.collection) !== null && _s !== void 0 ? _s : mpData;
                mpPayment = {
                    shipping_amount: (_t = col === null || col === void 0 ? void 0 : col.shipping_amount) !== null && _t !== void 0 ? _t : 0,
                    mp_fee: ((col === null || col === void 0 ? void 0 : col.fee_details) || [])
                        .filter((f) => f.type === 'mercadopago_fee' && f.fee_payer === 'collector')
                        .reduce((s, f) => s + (f.amount || 0), 0),
                    net_received_amount: (_v = (_u = col === null || col === void 0 ? void 0 : col.net_received_amount) !== null && _u !== void 0 ? _u : col === null || col === void 0 ? void 0 : col.net_amount) !== null && _v !== void 0 ? _v : 0,
                };
            }
        }
        catch (_) { /* non-critical */ }
    }
    const newOrder = parseAndSaveMeliOrder(mo, shipData, billingData);
    // ── Resolve shipping seller cost ─────────────────────────────────────────
    const mpShipAmount = (_w = mpPayment === null || mpPayment === void 0 ? void 0 : mpPayment.shipping_amount) !== null && _w !== void 0 ? _w : 0;
    const buyerShipCost = (_x = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.buyer_cost) !== null && _x !== void 0 ? _x : 0;
    const shippingSellerCost = (() => {
        var _a, _b;
        const fromCosts = (_a = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.seller_cost) !== null && _a !== void 0 ? _a : 0;
        if (fromCosts > 0)
            return fromCosts;
        if (mpShipAmount > 0) {
            if (newOrder.fulfillmentType === 'platform')
                return mpShipAmount;
            if (mpShipAmount > buyerShipCost)
                return Math.round((mpShipAmount - buyerShipCost) * 100) / 100;
        }
        const fromOrder = (_b = newOrder.orderShippingCost) !== null && _b !== void 0 ? _b : 0;
        if (fromOrder > 0)
            return fromOrder;
        return 0;
    })();
    const shippingGrossAmount = (_y = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.gross_amount) !== null && _y !== void 0 ? _y : mpShipAmount;
    const shippingMeliSubsidy = (_z = shipCosts === null || shipCosts === void 0 ? void 0 : shipCosts.meli_subsidy) !== null && _z !== void 0 ? _z : 0;
    const cffPending = newOrder.fulfillmentType === 'platform' && shippingSellerCost === 0 && mpShipAmount === 0;
    // ── SAT tax retentions ───────────────────────────────────────────────────
    const IVA_INCLUSIVE_DIVISOR = 1.16;
    const totalAmount = (_0 = newOrder.total) !== null && _0 !== void 0 ? _0 : 0;
    const preIvaAmount = totalAmount / IVA_INCLUSIVE_DIVISOR;
    const retencionIVA = Math.round(preIvaAmount * 0.08 * 100) / 100;
    const retencionISR = Math.round(preIvaAmount * 0.025 * 100) / 100;
    const meliCommission = (_1 = newOrder.marketplaceFee) !== null && _1 !== void 0 ? _1 : 0;
    const refundedAmount = (_2 = newOrder.refundedAmount) !== null && _2 !== void 0 ? _2 : 0;
    const mlBonus = (_3 = newOrder.mlBonus) !== null && _3 !== void 0 ? _3 : 0;
    const netReceipt = Math.round(Math.max(0, totalAmount - meliCommission - retencionIVA - retencionISR
        - shippingSellerCost - refundedAmount + mlBonus) * 100) / 100;
    // Merge financial fields into the order before saving
    const orderWithFinancials = Object.assign(Object.assign({}, newOrder), { shipping_seller_cost: shippingSellerCost, shipping_gross_amount: shippingGrossAmount, shipping_meli_subsidy: shippingMeliSubsidy, mp_shipping_amount: mpShipAmount, buyer_shipping_cost: buyerShipCost, cff_pending: cffPending, retencion_iva: retencionIVA, retencion_isr: retencionISR, total_impuestos: retencionIVA + retencionISR, refunded_amount: refundedAmount, ml_bonus: mlBonus, net_receipt: netReceipt });
    // Use the REAL individual order id as the doc key
    const orderRef = shared_1.db.collection('orders').doc(`meli_${mo.id}`);
    // Preserve the original human-readable buyer name on webhook updates.
    try {
        const existingSnap = await orderRef.get();
        const existingOrigName = (_5 = (_4 = existingSnap.data()) === null || _4 === void 0 ? void 0 : _4.customer) === null || _5 === void 0 ? void 0 : _5.originalName;
        const isAnonW = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
        if (existingOrigName && !isAnonW(existingOrigName)) {
            orderWithFinancials.customer.originalName = existingOrigName;
        }
        else if (existingOrigName && isAnonW(existingOrigName) && !isAnonW(orderWithFinancials.customer.originalName)) {
            // Upgrade: stored was anonymized, new is readable — keep new one
        }
        else if (existingOrigName) {
            orderWithFinancials.customer.originalName = existingOrigName;
        }
    }
    catch (_) { /* non-critical — proceed without preservation */ }
    await orderRef.set(orderWithFinancials, { merge: true });
    console.log(`[Meli Shared] Saved order ML-${mo.id} with shipping_cost=${shippingSellerCost} net=${netReceipt} (pack_id: ${mo.pack_id || 'n/a'})`);
}
exports.processAndSaveMeliOrderFromData = processAndSaveMeliOrderFromData;
//# sourceMappingURL=meli-shared.js.map