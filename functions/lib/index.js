"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCartAbandoned = exports.sitemapXml = exports.getPaidMediaInsights = exports.triggerPaidMediaSync = exports.syncPaidMediaSnapshots = exports.meliPriceScanDiag = exports.backfillAnalytics = exports.meliEnrichInventoryVelocityCallable = exports.meliEnrichInventoryVelocity = exports.cleanupAbandonedCheckouts = exports.aggregateDailyStats = exports.backfillMonthlyStats = exports.detectAbandonedCartsHttp = exports.detectAbandonedCarts = exports.getMeliRawOrderDebug = exports.meliWebhook = exports.meliSyncOrdersCron = exports.prunePriceHistory = exports.meliPriceScan = exports.meliSyncListings = exports.meliSyncFullInventory = exports.meliGetShippingLabel = exports.testMeliApi = exports.meliSyncHistorical = exports.meliAnalyzeHistoricalSync = exports.meliBackfillShippingCosts = exports.meliSyncOrders = exports.meliRefreshTokenScheduled = exports.meliCallback = exports.meliAuthUrl = exports.skydropxGetTracking = exports.skydropxCreateLabel = exports.skydropxRawTest = exports.skydropxGetRates = exports.skydropxTestConnection = exports.backfillUserClaims = exports.syncUserClaims = exports.mpDiag = exports.mpCallback = exports.mpAuthUrl = exports.mpWebhook = exports.refundOrder = exports.cancelOrder = exports.processPayment = exports.snapshotProjections = exports.testAnalyzeMeliInsights = exports.analyzeMeliInsights = exports.agentHandoff = exports.agentOrchestrator = exports.inboxMessageRouter = void 0;
exports.backfillMeliToInbox = exports.syncMeliToInbox = exports.onProductWriteIndexNow = exports.notifyIndexNow = exports.googleShoppingFeed = exports.querySearchAnalytics = exports.backfillSearchEventsToBigQuery = exports.onSearchEventCreated = exports.appendOrdersToBQForDate = exports.sendInboxReply = exports.applyInboxChannelConfig = exports.emailInboxWebhook = exports.telegramInboxWebhook = exports.metaInboxWebhook = exports.queryMetrics = exports.backfillOrdersToBigQuery = exports.testMeliBilling = exports.generateInvoice = exports.amazonOAuthCallback = exports.amazonSyncCron = exports.amazonManualSync = exports.onReferralOrderCompleted = exports.processReviewRequests = exports.onOrderCompleted = exports.processRecoveryQueue = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mercadopago_1 = require("mercadopago");
const bigquery_1 = require("@google-cloud/bigquery");
admin.initializeApp();
const db = admin.firestore();
const bigquery = new bigquery_1.BigQuery();
// ── IA Agents (EuroMind) ──────────────────────────────────────────────────────
var ai_agents_1 = require("./ai-agents");
Object.defineProperty(exports, "inboxMessageRouter", { enumerable: true, get: function () { return ai_agents_1.inboxMessageRouter; } });
Object.defineProperty(exports, "agentOrchestrator", { enumerable: true, get: function () { return ai_agents_1.agentOrchestrator; } });
Object.defineProperty(exports, "agentHandoff", { enumerable: true, get: function () { return ai_agents_1.agentHandoff; } });
Object.defineProperty(exports, "analyzeMeliInsights", { enumerable: true, get: function () { return ai_agents_1.analyzeMeliInsights; } });
Object.defineProperty(exports, "testAnalyzeMeliInsights", { enumerable: true, get: function () { return ai_agents_1.testAnalyzeMeliInsights; } });
// ── Analytics & Projections ───────────────────────────────────────────────────
var analytics_1 = require("./analytics");
Object.defineProperty(exports, "snapshotProjections", { enumerable: true, get: function () { return analytics_1.snapshotProjections; } });
// ─── MercadoPago Payment Processing ─────────────────────────────────────────
exports.processPayment = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
    if (!context.auth) {
        console.warn('[processPayment] Guest checkout — no Firebase auth. Validating inputs.');
    }
    const { token, amount, email, description, orderId, orderNumber, installments, paymentMethodId, issuerId, 
    // Optional payer enrichment fields (passed from checkout form)
    payerFirstName, payerLastName, payerPhone, payerZip, payerStreet } = data;
    if (!token || !amount || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required payment parameters.');
    }
    // ── Throwaway Email Blocklist ───────────────────────────────────────────────
    const DISPOSABLE_DOMAINS = [
        'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
        'throwam.com', 'trashmail.com', 'trashmail.net', 'yopmail.com', 'sharklasers.com',
        'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'spam4.me', '10minutemail.com',
        'tempmail.com', 'temp-mail.org', 'fakeinbox.com', 'mailnull.com', 'maildrop.cc',
    ];
    const emailDomain = (_b = (_a = email.split('@')[1]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : '';
    if (DISPOSABLE_DOMAINS.includes(emailDomain)) {
        throw new functions.https.HttpsError('invalid-argument', 'El correo electrónico no es válido para procesar un pago.');
    }
    // ── Velocity Rate Limiting ─────────────────────────────────────────────────
    // Max 3 payment attempts per email per 60 minutes — blocks card testing attacks.
    const RATE_LIMIT_MAX = 3;
    const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    try {
        const emailKey = Buffer.from(email).toString('base64').replace(/=/g, '');
        const rateLimitRef = db.collection('_rate_limits').doc(`pay_${emailKey}`);
        const now = Date.now();
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(rateLimitRef);
            if (!snap.exists) {
                tx.set(rateLimitRef, { count: 1, windowStart: now, expiresAt: now + RATE_WINDOW_MS });
                return;
            }
            const { count, windowStart } = snap.data();
            if (now - windowStart > RATE_WINDOW_MS) {
                // Window expired — reset
                tx.set(rateLimitRef, { count: 1, windowStart: now, expiresAt: now + RATE_WINDOW_MS });
            }
            else if (count >= RATE_LIMIT_MAX) {
                throw new functions.https.HttpsError('resource-exhausted', 'Demasiados intentos de pago. Por favor espera un momento e intenta de nuevo.');
            }
            else {
                tx.update(rateLimitRef, { count: count + 1 });
            }
        });
    }
    catch (rateErr) {
        if (rateErr.code)
            throw rateErr; // re-throw HttpsErrors
        console.warn('[processPayment] Rate limit check failed (non-blocking):', rateErr.message);
    }
    // Load MP credentials + installments policy from Firestore
    let accessToken = process.env.MP_ACCESS_TOKEN;
    let installmentsEnabled = false;
    let maxInstallments = 1;
    try {
        const integrationsDoc = await db.collection('config').doc('integrations').get();
        if (integrationsDoc.exists) {
            const mpConfig = ((_c = integrationsDoc.data()) === null || _c === void 0 ? void 0 : _c.mercadopago) || {};
            if (mpConfig.accessToken)
                accessToken = mpConfig.accessToken;
            installmentsEnabled = (_d = mpConfig.installmentsEnabled) !== null && _d !== void 0 ? _d : false;
            maxInstallments = (_e = mpConfig.maxInstallments) !== null && _e !== void 0 ? _e : 1;
        }
    }
    catch (err) {
        console.warn('Could not read MP config from Firestore:', err);
    }
    if (!accessToken) {
        throw new functions.https.HttpsError('internal', 'Server configuration error. Missing Access Token.');
    }
    // ── Server-side price revalidation ─────────────────────────────────────────
    // Re-calculate the expected total from Firestore data to prevent amount tampering.
    // We read the order doc the client already created, then verify each product's
    // current price against the products collection. Rejects if off by > $1 MXN.
    if (orderId) {
        try {
            const orderSnap = await db.collection('orders').doc(orderId).get();
            if (orderSnap.exists) {
                const orderData = orderSnap.data();
                // ── Idempotency / State Guard ──────────────────────────────────
                // If this order was already processed successfully, return the
                // existing result instead of charging the card again.
                // Guards against double-click, network retries, duplicate calls.
                const alreadyPaid = ['approved', 'paid'].includes((_f = orderData.paymentStatus) !== null && _f !== void 0 ? _f : '');
                if (alreadyPaid) {
                    console.warn(`[processPayment] ⚠️ Order ${orderId} already paid — returning cached result.`);
                    return {
                        success: true,
                        alreadyProcessed: true,
                        status: 'approved',
                        paymentId: (_g = orderData.paymentId) !== null && _g !== void 0 ? _g : null,
                    };
                }
                const items = (_h = orderData.items) !== null && _h !== void 0 ? _h : [];
                // Re-read each product's live price (parallel)
                const productSnaps = await Promise.all(items.map((item) => db.collection('products').doc(item.productId).get()));
                let serverSubtotal = 0;
                for (let i = 0; i < items.length; i++) {
                    const livePrice = (_k = (_j = productSnaps[i].data()) === null || _j === void 0 ? void 0 : _j.price) !== null && _k !== void 0 ? _k : items[i].price;
                    serverSubtotal += livePrice * items[i].quantity;
                }
                const shippingCost = (_l = orderData.shippingCost) !== null && _l !== void 0 ? _l : 0;
                const discount = (_m = orderData.discount) !== null && _m !== void 0 ? _m : 0;
                const serverTotal = Math.max(0, serverSubtotal + shippingCost - discount);
                const submitted = Number(amount);
                if (Math.abs(serverTotal - submitted) > 1.0) {
                    console.error(`[processPayment] ❌ Amount mismatch — submitted: ${submitted}, server: ${serverTotal.toFixed(2)}`);
                    // Update the order with an error note but don't charge
                    await db.collection('orders').doc(orderId).update({
                        paymentStatus: 'rejected',
                        paymentError: `Monto rechazado: enviado $${submitted} vs servidor $${serverTotal.toFixed(2)}`,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }).catch(() => { });
                    throw new functions.https.HttpsError('invalid-argument', `El monto del pedido no es válido. Por favor recarga y vuelve a intentar.`);
                }
                console.log(`[processPayment] ✅ Amount validated: ${submitted} ≈ ${serverTotal.toFixed(2)}`);
            }
        }
        catch (validationErr) {
            // Re-throw HttpsErrors (our own rejections), swallow any Firestore read errors
            if (validationErr.code)
                throw validationErr;
            console.warn('[processPayment] Price validation read failed — proceeding:', validationErr.message);
        }
    }
    // Enforce installments policy
    let finalInstallments = 1;
    if (installmentsEnabled) {
        finalInstallments = Math.min(Number(installments) || 1, maxInstallments);
    }
    const client = new mercadopago_1.MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const orderClient = new mercadopago_1.Order(client);
    try {
        // ── Orders API (POST /v1/orders) via mercadopago SDK v2 ────────────────
        // SDK types (dist/clients/order/create/types.d.ts) require:
        //   total_amount: string  (NOT number)
        //   transactions: { payments: PaymentRequest[] }  (NOT a raw array)
        //   payments[].amount: string  (NOT number)
        const amountStr = Number(amount).toFixed(2); // '688.00'
        const paymentType = (paymentMethodId !== null && paymentMethodId !== void 0 ? paymentMethodId : '').startsWith('deb') ? 'debit_card' : 'credit_card';
        const orderBody = {
            type: 'online',
            processing_mode: 'automatic',
            total_amount: amountStr,
            external_reference: orderId || orderNumber || '',
            payer: {
                email,
                first_name: payerFirstName || '',
                last_name: payerLastName || '',
            },
            transactions: {
                payments: [{
                        amount: amountStr,
                        payment_method: {
                            id: paymentMethodId,
                            type: paymentType,
                            token,
                            installments: Number(finalInstallments),
                        },
                    }],
            },
        };
        const result = await orderClient.create({ body: orderBody });
        const resultAny = result;
        // Extract first payment — response mirrors request: transactions.payments[0]
        const txPayment = (_q = (_p = (_o = resultAny === null || resultAny === void 0 ? void 0 : resultAny.transactions) === null || _o === void 0 ? void 0 : _o.payments) === null || _p === void 0 ? void 0 : _p[0]) !== null && _q !== void 0 ? _q : {};
        const orderStatus = (_r = resultAny === null || resultAny === void 0 ? void 0 : resultAny.status) !== null && _r !== void 0 ? _r : 'unknown'; // 'processed'|'pending'|'rejected'
        const payStatus = (_s = txPayment === null || txPayment === void 0 ? void 0 : txPayment.status) !== null && _s !== void 0 ? _s : orderStatus; // 'approved'|'rejected'|'pending'
        const payDetail = (_t = txPayment === null || txPayment === void 0 ? void 0 : txPayment.status_detail) !== null && _t !== void 0 ? _t : '';
        const paymentId = (_v = (_u = txPayment === null || txPayment === void 0 ? void 0 : txPayment.id) !== null && _u !== void 0 ? _u : resultAny === null || resultAny === void 0 ? void 0 : resultAny.id) !== null && _v !== void 0 ? _v : null;
        // Map Orders API status to our internal statuses
        const approved = orderStatus === 'processed' || payStatus === 'approved';
        const rejected = orderStatus === 'rejected' || payStatus === 'rejected';
        // 3DS challenge (Orders API: status pending + status_detail pending_challenge)
        if (payDetail === 'pending_challenge') {
            const challengeUrl = (_x = (_w = txPayment === null || txPayment === void 0 ? void 0 : txPayment.three_ds_info) === null || _w === void 0 ? void 0 : _w.external_resource_url) !== null && _x !== void 0 ? _x : null;
            console.log(`[processPayment] 3DS challenge for order ${orderId}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'pending_3ds',
                    paymentId,
                    mpOrderId: resultAny === null || resultAny === void 0 ? void 0 : resultAny.id,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.error('Failed to update order for 3DS:', e));
            }
            return { success: false, requires3DS: true, challengeUrl, paymentId,
                status: payStatus, statusDetail: payDetail };
        }
        // Normal result — update Firestore
        if (orderId) {
            await db.collection('orders').doc(orderId).update(Object.assign(Object.assign({ paymentStatus: approved ? 'approved' : rejected ? 'rejected' : payStatus, paymentId, mpOrderId: resultAny === null || resultAny === void 0 ? void 0 : resultAny.id, paymentMethod: paymentMethodId, installments: finalInstallments, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, (approved ? { status: 'paid' } : {})), (rejected ? { status: 'payment_failed' } : {}))).catch(e => console.error('Failed to update order status:', e));
        }
        return {
            success: approved,
            status: approved ? 'approved' : rejected ? 'rejected' : payStatus,
            paymentId,
            statusDetail: payDetail,
        };
    }
    catch (error) {
        // The MP Orders SDK throws an error when the order status is 'failed',
        // but error.data contains the complete order object with payment details.
        // Distinguish: (a) payment rejection = valid result → return 200
        //              (b) real API/network error → return 500
        const errorData = (_0 = (_y = error === null || error === void 0 ? void 0 : error.data) !== null && _y !== void 0 ? _y : (_z = error === null || error === void 0 ? void 0 : error.cause) === null || _z === void 0 ? void 0 : _z.data) !== null && _0 !== void 0 ? _0 : null;
        console.error('MercadoPago Orders API Error:', JSON.stringify({
            errors: (_1 = error === null || error === void 0 ? void 0 : error.errors) !== null && _1 !== void 0 ? _1 : error === null || error === void 0 ? void 0 : error.message,
            status: errorData === null || errorData === void 0 ? void 0 : errorData.status,
            payments: (_2 = errorData === null || errorData === void 0 ? void 0 : errorData.transactions) === null || _2 === void 0 ? void 0 : _2.payments,
        }, null, 2));
        // ── Case (a): MP rejected the payment (status=failed) ─────────────────
        if ((errorData === null || errorData === void 0 ? void 0 : errorData.status) === 'failed') {
            const failedPayment = (_5 = (_4 = (_3 = errorData === null || errorData === void 0 ? void 0 : errorData.transactions) === null || _3 === void 0 ? void 0 : _3.payments) === null || _4 === void 0 ? void 0 : _4[0]) !== null && _5 !== void 0 ? _5 : {};
            const failStatus = (_6 = failedPayment === null || failedPayment === void 0 ? void 0 : failedPayment.status) !== null && _6 !== void 0 ? _6 : 'rejected';
            const failDetail = (_8 = (_7 = failedPayment === null || failedPayment === void 0 ? void 0 : failedPayment.status_detail) !== null && _7 !== void 0 ? _7 : errorData === null || errorData === void 0 ? void 0 : errorData.status_detail) !== null && _8 !== void 0 ? _8 : 'failed';
            const failPaymentId = (_10 = (_9 = failedPayment === null || failedPayment === void 0 ? void 0 : failedPayment.id) !== null && _9 !== void 0 ? _9 : errorData === null || errorData === void 0 ? void 0 : errorData.id) !== null && _10 !== void 0 ? _10 : null;
            console.warn(`[processPayment] Payment rejected — status: ${failStatus}, detail: ${failDetail}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'rejected',
                    paymentError: failDetail,
                    paymentId: failPaymentId,
                    mpOrderId: errorData === null || errorData === void 0 ? void 0 : errorData.id,
                    status: 'payment_failed',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.error('Failed to update rejected order:', e));
            }
            // Return clean 200 with rejection info — NOT a 500
            return { success: false, status: failStatus, statusDetail: failDetail, paymentId: failPaymentId };
        }
        // ── Case (b): real API/config error ───────────────────────────────────
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError: error.message || 'Unknown error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(e => console.error('Failed to update rejected status:', e));
        }
        throw new functions.https.HttpsError('internal', error.message || 'Payment processing failed.');
    }
});
// ─── Cancel Order ─────────────────────────────────────────────────────────────
// Customer-facing: cancels a web order within 24 hours of creation.
// - Paid orders (paymentStatus=approved) cannot be self-cancelled — they need
//   staff to approve a refund first (staff sets refund_pending, MP refund runs).
// - Unpaid orders (pending/pending_payment) are cancelled immediately.
// - Staff path: caller passes role='staff' header via Firebase Admin context (future).
const CANCEL_WINDOW_HOURS = 24;
const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000;
exports.cancelOrder = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const { orderId, reason } = data;
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
    }
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found.');
    }
    const order = orderSnap.data();
    const now = Date.now();
    const createdAt = ((_a = order.createdAt) === null || _a === void 0 ? void 0 : _a.toMillis) ? order.createdAt.toMillis() : Date.now();
    // ── Ownership check ────────────────────────────────────────────────────────
    // Authenticated user: uid must match order's customer uid.
    // Guest: sessionId from the stored order must match what the client sends.
    const callerUid = (_c = (_b = context.auth) === null || _b === void 0 ? void 0 : _b.uid) !== null && _c !== void 0 ? _c : null;
    const orderUid = (_e = (_d = order.customer) === null || _d === void 0 ? void 0 : _d.uid) !== null && _e !== void 0 ? _e : null;
    const guestSessionId = (_f = data.sessionId) !== null && _f !== void 0 ? _f : null;
    const orderSessionId = (_g = order.sessionId) !== null && _g !== void 0 ? _g : null;
    const isOwner = (callerUid && orderUid && callerUid === orderUid)
        || (guestSessionId && orderSessionId && guestSessionId === orderSessionId);
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para cancelar este pedido.');
    }
    // ── Only web/storefront orders can be self-cancelled ──────────────────────
    if (order.sourceChannel !== 'storefront' && order.sourceChannel !== 'web') {
        throw new functions.https.HttpsError('failed-precondition', 'Solo los pedidos de la tienda en línea pueden cancelarse aquí.');
    }
    // ── Cancellation window ────────────────────────────────────────────────────
    if (now - createdAt > CANCEL_WINDOW_MS) {
        throw new functions.https.HttpsError('deadline-exceeded', `El período de cancelación de ${CANCEL_WINDOW_HOURS} horas ha expirado. Contáctanos para ayudarte.`);
    }
    // ── Already cancelled / refunded ──────────────────────────────────────────
    if (['cancelled', 'refunded', 'refund_pending'].includes(order.status)) {
        throw new functions.https.HttpsError('failed-precondition', 'Este pedido ya fue cancelado o reembolsado.');
    }
    // ── Paid orders → flag for staff refund review ─────────────────────────────
    // We NEVER auto-refund without staff review — policy: review first, then refund.
    if (order.paymentStatus === 'approved' || order.status === 'paid') {
        await orderRef.update({
            status: 'refund_pending',
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            cancelledBy: 'customer',
            cancelReason: reason || 'Cancelación solicitada por el cliente',
            refundStatus: 'pending_review',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[cancelOrder] ✅ Order ${orderId} flagged for refund review (was paid).`);
        return { success: true, requiresRefund: true, message: 'Tu solicitud de cancelación fue recibida. Procesaremos el reembolso en 1-3 días hábiles.' };
    }
    // ── Unpaid orders → cancel immediately ────────────────────────────────────
    await orderRef.update({
        status: 'cancelled',
        paymentStatus: order.paymentStatus === 'pending' ? 'cancelled' : order.paymentStatus,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledBy: 'customer',
        cancelReason: reason || 'Cancelación solicitada por el cliente',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[cancelOrder] ✅ Order ${orderId} cancelled immediately (was unpaid).`);
    return { success: true, requiresRefund: false, message: 'Tu pedido fue cancelado exitosamente.' };
});
// ─── Staff Refund Approval ────────────────────────────────────────────────────
// Called from the Operations order detail page when a staff member approves
// a pending refund. Validates the order state, calls the MercadoPago Payments
// API to issue the refund, then updates the order status and audit trail.
exports.refundOrder = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado para procesar reembolsos.');
    }
    const { orderId, reason } = data;
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
    }
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const order = orderSnap.data();
    // Only allow refunding orders in refund_pending state
    if (order.status !== 'refund_pending') {
        throw new functions.https.HttpsError('failed-precondition', `Order status is '${order.status}' — only 'refund_pending' orders can be refunded.`);
    }
    const paymentId = order.paymentId;
    if (!paymentId) {
        throw new functions.https.HttpsError('failed-precondition', 'No payment ID found on this order. Cannot process refund automatically.');
    }
    // Fetch MP access token from integrations config
    const cfgSnap = await db.collection('config').doc('integrations').get();
    const accessToken = (_b = (_a = cfgSnap.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) === null || _b === void 0 ? void 0 : _b.accessToken;
    if (!accessToken) {
        throw new functions.https.HttpsError('internal', 'MercadoPago access token not configured.');
    }
    // ── Call MercadoPago Refund API ────────────────────────────────────────────
    const mpClient = new mercadopago_1.MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const paymentApi = new mercadopago_1.Payment(mpClient);
    let refundResult;
    try {
        // For full refund: cancel/refund the entire payment
        refundResult = await paymentApi.cancel({ id: Number(paymentId) });
        console.log(`[refundOrder] ✅ MP refund issued — paymentId=${paymentId}`, refundResult);
    }
    catch (mpErr) {
        console.error('[refundOrder] MercadoPago refund error:', JSON.stringify(mpErr));
        throw new functions.https.HttpsError('internal', `MercadoPago refund failed: ${(mpErr === null || mpErr === void 0 ? void 0 : mpErr.message) || 'Unknown error'}`);
    }
    // ── Update Firestore order ─────────────────────────────────────────────────
    const staffUid = context.auth.uid;
    const staffEmail = (_c = context.auth.token.email) !== null && _c !== void 0 ? _c : 'staff';
    const staffDisplayName = (_d = context.auth.token.name) !== null && _d !== void 0 ? _d : staffEmail;
    const historyEntry = {
        status: 'refunded',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        note: reason || 'Reembolso aprobado y procesado por staff',
        // Legacy field
        updatedBy: staffUid,
        // Structured audit actor
        updatedByActor: { uid: staffUid, displayName: staffDisplayName, role: 'OPERATIONS' },
        action: 'refund_approved',
        metadata: {
            mpRefundId: (_e = refundResult === null || refundResult === void 0 ? void 0 : refundResult.id) !== null && _e !== void 0 ? _e : null,
            processedBy: staffEmail,
        },
    };
    await orderRef.update({
        status: 'refunded',
        paymentStatus: 'refunded',
        refundStatus: 'PROCESSED',
        refundAmount: order.total,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: admin.firestore.FieldValue.arrayUnion(historyEntry),
    });
    console.log(`[refundOrder] ✅ Order ${orderId} marked as refunded by ${staffEmail}`);
    return { success: true, message: 'Reembolso procesado exitosamente en MercadoPago.' };
});
// ─── MercadoPago Webhook ──────────────────────────────────────────────────────
// Receives payment status updates from MP's notification system.
// Register this URL in MP Developer Panel → Notifications → Webhook:
//   https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook
exports.mpWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    try {
        // ── x-signature Validation ─────────────────────────────────────────────
        // MP signs every webhook with HMAC-SHA256 using the app's Secret Key.
        // Validate before processing to prevent spoofed notifications.
        // Secret stored in Firestore: config/integrations → mercadopago.webhookSecret
        const xSignature = req.headers['x-signature'];
        const xRequestId = req.headers['x-request-id'];
        if (xSignature) {
            try {
                const cfgSnap = await db.collection('config').doc('integrations').get();
                const secret = (_c = (_b = (_a = cfgSnap.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) === null || _b === void 0 ? void 0 : _b.webhookSecret) !== null && _c !== void 0 ? _c : '';
                if (secret) {
                    const crypto = await Promise.resolve().then(() => require('crypto'));
                    // Parse ts and v1 from x-signature header (format: "ts=xxx,v1=yyy")
                    const parts = {};
                    xSignature.split(',').forEach(p => { const [k, v] = p.trim().split('='); if (k && v)
                        parts[k] = v; });
                    const ts = (_d = parts['ts']) !== null && _d !== void 0 ? _d : '';
                    const v1 = (_e = parts['v1']) !== null && _e !== void 0 ? _e : '';
                    const dataId = (_j = (_h = (_g = (_f = req.body) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.id) !== null && _h !== void 0 ? _h : req.query['id']) !== null && _j !== void 0 ? _j : '';
                    const manifest = `id:${dataId};request-id:${xRequestId !== null && xRequestId !== void 0 ? xRequestId : ''};ts:${ts};`;
                    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
                    if (expected !== v1) {
                        console.warn('[mpWebhook] ⚠️ Signature mismatch — possible spoofed request. manifest:', manifest);
                        // Log but don't block: avoids breaking if secret is misconfigured
                    }
                    else {
                        console.log('[mpWebhook] ✅ Signature valid');
                    }
                }
                else {
                    console.warn('[mpWebhook] No webhookSecret configured — skipping x-signature validation.');
                }
            }
            catch (sigErr) {
                console.error('[mpWebhook] Signature validation error:', sigErr.message);
            }
        }
        const topic = ((_k = req.body) === null || _k === void 0 ? void 0 : _k.type) || req.query['topic'];
        const resourceId = ((_m = (_l = req.body) === null || _l === void 0 ? void 0 : _l.data) === null || _m === void 0 ? void 0 : _m.id) || req.query['id'];
        console.log('[mpWebhook] Received:', topic, resourceId);
        // Always ACK non-payment/non-order topics immediately
        if (!resourceId || (topic !== 'payment' && topic !== 'order')) {
            res.status(200).send('OK');
            return;
        }
        let accessToken = process.env.MP_ACCESS_TOKEN;
        try {
            const snap = await db.collection('config').doc('integrations').get();
            const t = (_p = (_o = snap.data()) === null || _o === void 0 ? void 0 : _o.mercadopago) === null || _p === void 0 ? void 0 : _p.accessToken;
            if (t)
                accessToken = t;
        }
        catch (e) { /* fall back to env */ }
        if (!accessToken) {
            res.status(500).send('No access token');
            return;
        }
        const mpClient = new mercadopago_1.MercadoPagoConfig({ accessToken });
        // ── Orders API topic ('order') ─────────────────────────────────────────
        // New standard for Checkout API integrations.
        // Fetch from /v1/orders/{id} and map to our Firestore order.
        if (topic === 'order') {
            const orderClient = new mercadopago_1.Order(mpClient);
            const orderData = await orderClient.get({ id: String(resourceId) });
            const orderAny = orderData;
            // external_reference IS our Firestore orderId
            const orderId = orderAny === null || orderAny === void 0 ? void 0 : orderAny.external_reference;
            if (!orderId) {
                console.warn('[mpWebhook] Order topic but no external_reference');
                res.status(200).send('OK');
                return;
            }
            // Extract status from order + first transaction payment
            const txPay = (_t = (_s = (_r = (_q = orderAny === null || orderAny === void 0 ? void 0 : orderAny.transactions) === null || _q === void 0 ? void 0 : _q[0]) === null || _r === void 0 ? void 0 : _r.payments) === null || _s === void 0 ? void 0 : _s[0]) !== null && _t !== void 0 ? _t : {};
            const orderStatus = (_u = orderAny === null || orderAny === void 0 ? void 0 : orderAny.status) !== null && _u !== void 0 ? _u : ''; // 'processed'|'pending'|'rejected'
            const payStatus = (_v = txPay === null || txPay === void 0 ? void 0 : txPay.status) !== null && _v !== void 0 ? _v : orderStatus;
            const payId = (_w = txPay === null || txPay === void 0 ? void 0 : txPay.id) !== null && _w !== void 0 ? _w : null;
            const approved = orderStatus === 'processed' || payStatus === 'approved';
            const rejected = orderStatus === 'rejected' || payStatus === 'rejected';
            const newStatus = approved ? 'approved' : rejected ? 'rejected' : 'pending';
            await db.collection('orders').doc(orderId).update(Object.assign(Object.assign({ paymentStatus: newStatus, paymentId: payId, mpOrderId: orderAny === null || orderAny === void 0 ? void 0 : orderAny.id, paymentMethod: (_0 = (_z = (_y = (_x = orderAny === null || orderAny === void 0 ? void 0 : orderAny.transactions) === null || _x === void 0 ? void 0 : _x[0]) === null || _y === void 0 ? void 0 : _y.payment_method) === null || _z === void 0 ? void 0 : _z.id) !== null && _0 !== void 0 ? _0 : '', installments: (_4 = (_3 = (_2 = (_1 = orderAny === null || orderAny === void 0 ? void 0 : orderAny.transactions) === null || _1 === void 0 ? void 0 : _1[0]) === null || _2 === void 0 ? void 0 : _2.payment_method) === null || _3 === void 0 ? void 0 : _3.installments) !== null && _4 !== void 0 ? _4 : 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, (approved ? { status: 'paid' } : {})), (rejected ? { status: 'payment_failed' } : {})));
            console.log(`[mpWebhook] Order (Orders API) ${orderId} → ${newStatus}`);
            res.status(200).send('OK');
            return;
        }
        // ── Legacy Payments API topic ('payment') ──────────────────────────────
        // Retained for backwards compatibility with any legacy payments.
        const paymentApi = new mercadopago_1.Payment(mpClient);
        const paymentData = await paymentApi.get({ id: String(resourceId) });
        const orderId = (_5 = paymentData.metadata) === null || _5 === void 0 ? void 0 : _5.order_id;
        if (!orderId) {
            res.status(200).send('No order_id in metadata');
            return;
        }
        const statusMap = {
            approved: 'approved', rejected: 'rejected', cancelled: 'cancelled',
            refunded: 'refunded', pending: 'pending', in_process: 'pending', authorized: 'pending'
        };
        const newStatus = (_6 = statusMap[paymentData.status || '']) !== null && _6 !== void 0 ? _6 : 'unknown';
        await db.collection('orders').doc(orderId).update(Object.assign(Object.assign({ paymentStatus: newStatus, paymentId: paymentData.id, paymentMethod: paymentData.payment_method_id, installments: paymentData.installments, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, (newStatus === 'approved' ? { status: 'paid' } : {})), (newStatus === 'rejected' ? { status: 'payment_failed' } : {})));
        console.log(`[mpWebhook] Order (Payments API) ${orderId} payment → ${newStatus}`);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const FN_VER = 'v6-2026-04-20'; // bump this on every deploy to confirm version
    // Load credentials from Firestore
    const configSnap = await db.collection('config').doc('integrations').get();
    const mpConfig = (_b = (_a = configSnap.data()) === null || _a === void 0 ? void 0 : _a.mercadopago) !== null && _b !== void 0 ? _b : {};
    const accessToken = (_d = (_c = mpConfig.accessToken) !== null && _c !== void 0 ? _c : process.env.MP_ACCESS_TOKEN) !== null && _d !== void 0 ? _d : '';
    if (!accessToken) {
        return { ok: false, error: 'No Access Token found in config/integrations → mercadopago' };
    }
    const step = data === null || data === void 0 ? void 0 : data.step;
    // ── Step: save_credentials — persist AT + PK to Firestore ────────────────
    if (step === 'save_credentials') {
        const newAt = ((_e = data === null || data === void 0 ? void 0 : data.accessToken) !== null && _e !== void 0 ? _e : '').trim();
        const newPk = ((_f = data === null || data === void 0 ? void 0 : data.publicKey) !== null && _f !== void 0 ? _f : '').trim();
        if (!newAt || !newPk) {
            return { ok: false, error: 'Both accessToken and publicKey are required.', fnVer: FN_VER };
        }
        await db.collection('config').doc('integrations').set({ mercadopago: { accessToken: newAt, publicKey: newPk } }, { merge: true });
        return { ok: true, message: 'Credentials saved to Firestore ✅', fnVer: FN_VER };
    }
    // ── Step: check_credentials — compare stored vs expected ─────────────────
    if (step === 'check_credentials') {
        const storedAt = accessToken;
        const storedPk = (_g = mpConfig.publicKey) !== null && _g !== void 0 ? _g : '';
        const mask = (s) => s ? `${s.slice(0, 18)}…${s.slice(-6)}` : '(empty)';
        // Expected values from the user
        const expectedAt = 'TEST-398646544825942-022715-cbec23472732e892da3798593de42e85-1178500066';
        const expectedPk = 'TEST-26a04055-43d8-4f69-97c5-7829d3d413bf';
        const atMatch = storedAt === expectedAt;
        const pkMatch = storedPk === expectedPk;
        return {
            ok: atMatch && pkMatch,
            accessToken: { stored: mask(storedAt), expected: mask(expectedAt), match: atMatch },
            publicKey: { stored: mask(storedPk), expected: mask(expectedPk), match: pkMatch },
            summary: `AT: ${atMatch ? '✅ Match' : '❌ MISMATCH'} | PK: ${pkMatch ? '✅ Match' : '❌ MISMATCH'}`,
            updateNeeded: !atMatch || !pkMatch,
            fnVer: FN_VER,
        };
    }
    // ── Step: /users/me ───────────────────────────────────────────────────────
    if (step === 'users_me') {
        try {
            const r = await fetch('https://api.mercadopago.com/users/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const body = await r.json();
            if (!r.ok)
                return { ok: false, error: (_j = (_h = body.message) !== null && _h !== void 0 ? _h : body.error) !== null && _j !== void 0 ? _j : 'Token rejected', status: r.status };
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
                return { ok: false, error: (_k = body.message) !== null && _k !== void 0 ? _k : 'Could not retrieve payment methods', status: r.status };
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
                    error: (_p = (_l = pref.message) !== null && _l !== void 0 ? _l : (_o = (_m = pref.cause) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.description) !== null && _p !== void 0 ? _p : 'Preference creation failed',
                    fnVer: FN_VER,
                    raw: pref,
                };
            }
            return {
                ok: true,
                preferenceId: pref.id,
                initPoint: (_q = pref.sandbox_init_point) !== null && _q !== void 0 ? _q : pref.init_point,
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
    // ── Step: Card tokenization — proves public key + all 4 test cards work ──
    // Tokenizes each test card via the MP server-side tokenize endpoint.
    // This is a deeper test than preference creation: it validates that the
    // public key is correct and that MP accepts every sandbox card number.
    if (step === 'card_token') {
        const publicKey = (_r = mpConfig.publicKey) !== null && _r !== void 0 ? _r : '';
        if (!publicKey) {
            return { ok: false, error: 'No Public Key found in config/integrations → mercadopago' };
        }
        const testCards = [
            { label: 'Mastercard Crédito', number: '5474925432670366', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Crédito', number: '4075595716483764', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Mastercard Débito', number: '5579053461482647', cvv: '1234', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Débito', number: '4189141221267633', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
        ];
        const cardResults = [];
        for (const card of testCards) {
            try {
                const r = await fetch('https://api.mercadopago.com/v1/card_tokens', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        card_number: card.number,
                        security_code: card.cvv,
                        expiration_month: card.expMonth,
                        expiration_year: card.expYear,
                        cardholder: { name: card.holder },
                    }),
                });
                const body = await r.json();
                if (!r.ok || !body.id) {
                    cardResults.push({ label: card.label, ok: false, error: (_v = (_s = body.message) !== null && _s !== void 0 ? _s : (_u = (_t = body.cause) === null || _t === void 0 ? void 0 : _t[0]) === null || _u === void 0 ? void 0 : _u.description) !== null && _v !== void 0 ? _v : `HTTP ${r.status}` });
                }
                else {
                    cardResults.push({ label: card.label, ok: true, token: body.id });
                }
            }
            catch (e) {
                cardResults.push({ label: card.label, ok: false, error: e.message });
            }
        }
        const allOk = cardResults.every(c => c.ok);
        const summary = cardResults.map(c => `${c.ok ? '✅' : '❌'} ${c.label}${c.ok ? '' : ': ' + c.error}`).join(' | ');
        return { ok: allOk, cards: cardResults, summary, fnVer: FN_VER };
    }
    // ── Step: Verify buyer test account ──────────────────────────────────────
    // Calls GET /users/{buyerId} with the seller's access token.
    // In sandbox, sellers can look up their associated test users this way.
    // Proves the buyer account (ID 3347553101) belongs to this sandbox.
    if (step === 'verify_buyer') {
        const BUYER_ID = '3347553101';
        try {
            const r = await fetch(`https://api.mercadopago.com/users/${BUYER_ID}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body = await r.json();
            if (!r.ok) {
                return {
                    ok: false,
                    error: (_x = (_w = body.message) !== null && _w !== void 0 ? _w : body.error) !== null && _x !== void 0 ? _x : `HTTP ${r.status}`,
                    status: r.status,
                    hint: 'If 404 the buyer account is not associated with this sandbox seller.',
                    fnVer: FN_VER,
                };
            }
            // email may appear as body.email or inside identification sub-objects
            const email = (_1 = (_z = (_y = body.email) !== null && _y !== void 0 ? _y : body.secure_email) !== null && _z !== void 0 ? _z : (_0 = body.alternative_phone) === null || _0 === void 0 ? void 0 : _0.area_code) !== null && _1 !== void 0 ? _1 : null;
            return {
                ok: true,
                buyerId: body.id,
                nickname: body.nickname,
                email,
                site_id: body.site_id,
                type: (_3 = (_2 = body.user_type) !== null && _2 !== void 0 ? _2 : body.account_type) !== null && _3 !== void 0 ? _3 : 'unknown',
                // Return full body so raw JSON reveals every available field
                allFields: body,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Get buyer OAuth token (password grant) ─────────────────────────
    // Uses the buyer test account credentials to get their own access token.
    // The buyer's token is then used to tokenize a card — this correctly
    // attributes the card token to the BUYER, resolving error 2034.
    if (step === 'buyer_token') {
        const mpCfg = (_5 = (_4 = configSnap.data()) === null || _4 === void 0 ? void 0 : _4.mercadopago) !== null && _5 !== void 0 ? _5 : {};
        // clientId 398646544825942 = app ID from the MP developer portal (not a secret)
        const clientId = (_7 = (_6 = mpCfg.clientId) !== null && _6 !== void 0 ? _6 : mpCfg.client_id) !== null && _7 !== void 0 ? _7 : '398646544825942';
        const clientSecret = (_9 = (_8 = mpCfg.clientSecret) !== null && _8 !== void 0 ? _8 : mpCfg.client_secret) !== null && _9 !== void 0 ? _9 : '';
        // Strategy: try with client_secret first; if not available, try without.
        // MP sandbox test users sometimes work via password grant without client_secret.
        const tryGrant = async (includeSecret) => {
            const params = {
                grant_type: 'password',
                client_id: clientId,
                username: 'TESTUSER7146576788719579772',
                password: 'aP0I8bxKiJ',
            };
            if (includeSecret && clientSecret)
                params.client_secret = clientSecret;
            return fetch('https://api.mercadopago.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params).toString(),
            });
        };
        try {
            // First try: with secret (full grant)
            let r = clientSecret ? await tryGrant(true) : await tryGrant(false);
            let body = await r.json();
            // Second try: without secret (sandbox-only fallback)
            if (!r.ok && clientSecret) {
                r = await tryGrant(false);
                body = await r.json();
            }
            if (!r.ok || !body.access_token) {
                return {
                    ok: false,
                    error: (_11 = (_10 = body.message) !== null && _10 !== void 0 ? _10 : body.error) !== null && _11 !== void 0 ? _11 : `HTTP ${r.status}`,
                    hint: 'Add clientSecret to Firestore config/integrations → mercadopago.clientSecret (find it in the MP developer portal under your app credentials)',
                    httpStatus: r.status,
                    raw: body,
                    fnVer: FN_VER,
                };
            }
            // Get buyer profile with their own token
            const meR = await fetch('https://api.mercadopago.com/users/me', {
                headers: { 'Authorization': `Bearer ${body.access_token}` },
            });
            const meBody = await meR.json();
            return {
                ok: true,
                buyerToken: body.access_token,
                buyerEmail: meBody.email,
                buyerId: meBody.id,
                buyerNick: meBody.nickname,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Direct payment ─────────────────────────────────────────────────
    // Tokenizes a Mastercard test card then creates a real payment (not a preference).
    // APRO as cardholder name is the MP sandbox convention for "approved" result.
    // binary_mode = true: no intermediate "pending" state — instant approved/rejected.
    if (step === 'direct_payment') {
        const { amount = 100, payerEmail: forcedEmail } = data !== null && data !== void 0 ? data : {};
        // 0 — Resolve buyer test user email.
        // Prefer the email passed from the caller (captured in verify_buyer / Step 5).
        // Fall back to auto-fetch only if not provided.
        // MP sandbox error 2034 occurs when payer is not a recognized test user.
        let buyerEmail = forcedEmail !== null && forcedEmail !== void 0 ? forcedEmail : '';
        if (!buyerEmail) {
            try {
                const br = await fetch('https://api.mercadopago.com/users/3347553101', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                const bb = await br.json();
                if (br.ok && bb.email)
                    buyerEmail = bb.email;
            }
            catch (_) { /* surface as error below */ }
        }
        if (!buyerEmail) {
            return { ok: false, error: 'Could not resolve buyer test user email. Run Step 5 first or verify /users/3347553101 is accessible.', fnVer: FN_VER };
        }
        // 1 — Tokenize Mastercard test card server-side (APRO → approved in sandbox)
        let cardToken = '';
        try {
            const tr = await fetch('https://api.mercadopago.com/v1/card_tokens', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_number: '5474925432670366',
                    security_code: '123',
                    expiration_month: 11,
                    expiration_year: 2030,
                    cardholder: { name: 'APRO' },
                }),
            });
            const tb = await tr.json();
            if (!tr.ok || !tb.id)
                return {
                    ok: false,
                    error: `Token error (HTTP ${tr.status}): ${(_12 = tb.message) !== null && _12 !== void 0 ? _12 : JSON.stringify(tb)}`,
                    rawToken: tb,
                    fnVer: FN_VER,
                };
            cardToken = tb.id;
        }
        catch (e) {
            return { ok: false, error: `Token exception: ${e.message}`, fnVer: FN_VER };
        }
        // 2 — Create direct payment with that token
        try {
            const pr = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `mpdiag-pay-${Date.now()}`,
                },
                body: JSON.stringify({
                    transaction_amount: Number(amount),
                    token: cardToken,
                    description: 'Diagnóstico pago directo — Eurollantas',
                    installments: 1,
                    payment_method_id: 'master',
                    binary_mode: true,
                    payer: { email: buyerEmail },
                }),
            });
            const pb = await pr.json();
            const approved = pb.status === 'approved';
            return {
                ok: approved,
                paymentId: (_13 = pb.id) !== null && _13 !== void 0 ? _13 : null,
                status: pb.status,
                statusDetail: pb.status_detail,
                amount: pb.transaction_amount,
                currency: pb.currency_id,
                buyerEmail,
                httpStatus: pr.status,
                mpMessage: approved ? undefined : ((_14 = pb.message) !== null && _14 !== void 0 ? _14 : pb.error),
                mpCause: approved ? undefined : pb.cause,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: `Payment exception: ${e.message}`, fnVer: FN_VER };
        }
    }
    if (step === 'pay_with_token') {
        // ── Step 6: Token Creation Verification ───────────────────────────────
        // With production credentials, test card numbers cannot be used to create
        // real orders (MP rejects them). Instead we verify:
        //   1. Production AT is accepted by /v1/card_tokens (same endpoint the Brick uses)
        //   2. A valid card token is returned — proving the storefront Brick will work
        //
        // Real end-to-end payment testing must be done through the storefront
        // with an actual card, which also generates the paymentId needed for Stage 3.
        try {
            const tr = await fetch('https://api.mercadopago.com/v1/card_tokens', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_number: '5474925432670366',
                    security_code: '123',
                    expiration_month: 11,
                    expiration_year: 2030,
                    cardholder: { name: 'TEST CARD' },
                }),
            });
            const tb = await tr.json();
            if (!tr.ok || !tb.id) {
                return {
                    ok: false,
                    error: `Tokenization failed (HTTP ${tr.status})`,
                    detail: (_16 = (_15 = tb.message) !== null && _15 !== void 0 ? _15 : tb.error) !== null && _16 !== void 0 ? _16 : JSON.stringify(tb),
                    httpStatus: tr.status,
                    fnVer: FN_VER,
                };
            }
            return {
                ok: true,
                tokenId: tb.id,
                lastFour: tb.last_four_digits,
                cardType: (_18 = (_17 = tb.payment_method) === null || _17 === void 0 ? void 0 : _17.id) !== null && _18 !== void 0 ? _18 : 'master',
                expiryMonth: tb.expiration_month,
                expiryYear: tb.expiration_year,
                httpStatus: tr.status,
                note: '✅ Card tokenization works — production AT valid. Real purchase must be done through the storefront with a real card (generates production paymentId for Stage 3).',
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: `Tokenization exception: ${e.message}`, fnVer: FN_VER };
        }
    }
    // ── Step: Payment status ─────────────────────────────────────────────────
    if (step === 'payment_status') {
        const { paymentId } = data !== null && data !== void 0 ? data : {};
        if (!paymentId)
            return { ok: false, error: 'paymentId required', fnVer: FN_VER };
        try {
            const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body = await r.json();
            return {
                ok: r.ok && !!body.id,
                paymentId: body.id,
                status: body.status,
                statusDetail: body.status_detail,
                amount: body.transaction_amount,
                currency: body.currency_id,
                dateApproved: body.date_approved,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Refund payment ─────────────────────────────────────────────────
    if (step === 'refund_payment') {
        const { paymentId } = data !== null && data !== void 0 ? data : {};
        if (!paymentId)
            return { ok: false, error: 'paymentId required', fnVer: FN_VER };
        try {
            const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `mpdiag-refund-${Date.now()}`,
                },
                body: JSON.stringify({}), // empty body = full refund
            });
            const body = await r.json();
            return {
                ok: r.ok && !!body.id,
                refundId: body.id,
                status: body.status,
                amount: body.amount,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Installments (meses sin intereses) ─────────────────────────────
    // Checks that MP returns installment options for Mastercard in MLM (Mexico).
    // BIN 547492 = first 6 digits of test Mastercard card.
    if (step === 'check_installments') {
        try {
            const params = new URLSearchParams({
                payment_method_id: 'master',
                amount: '1000',
                bin: '547492',
            });
            const r = await fetch(`https://api.mercadopago.com/v1/payment_methods/installments?${params}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const body = await r.json();
            const arr = Array.isArray(body) ? body : [];
            const installments = ((_20 = (_19 = arr[0]) === null || _19 === void 0 ? void 0 : _19.payer_costs) !== null && _20 !== void 0 ? _20 : []).map((c) => c.installments);
            return {
                ok: r.ok && installments.length > 0,
                installments,
                count: installments.length,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Configure webhook via MP API (bypasses portal UI bug) ──────────
    // The MP developer portal has a known bug where event checkboxes don't save.
    // This step registers the webhook subscription directly via the API.
    if (step === 'configure_webhook') {
        const webhookUrl = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook';
        const appId = '398646544825942';
        try {
            // First: get existing subscriptions to avoid duplicates
            const listR = await fetch(`https://api.mercadopago.com/v2/notifications/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const listBody = await listR.json();
            // Check if our URL is already registered
            const existing = ((_21 = listBody === null || listBody === void 0 ? void 0 : listBody.data) !== null && _21 !== void 0 ? _21 : []).find((s) => s.url === webhookUrl);
            if (existing) {
                return {
                    ok: true,
                    message: 'Webhook already registered',
                    subscription: existing,
                    fnVer: FN_VER,
                };
            }
            // Register new subscription
            const createR = await fetch('https://api.mercadopago.com/v2/notifications/webhooks', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: webhookUrl,
                    event_type: ['payment', 'merchant_order'],
                    client_id: appId,
                    active: true,
                }),
            });
            const createBody = await createR.json();
            // Also try v1 endpoint as fallback
            const listR2 = await fetch(`https://api.mercadopago.com/v1/account/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const listBody2 = await listR2.json();
            return {
                ok: createR.ok,
                message: createR.ok ? '✅ Webhook registered via API' : `❌ HTTP ${createR.status}`,
                created: createBody,
                existingV2: listBody,
                existingV1: listBody2,
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Fetch webhook subscription from MP API ─────────────────────────
    // MP's developer portal has a known bug where the secret doesn't display.
    // We can retrieve it through the REST API instead.
    if (step === 'fetch_webhook_secret') {
        try {
            // Get all webhook subscriptions for this app
            const appId = '398646544825942';
            const r = await fetch(`https://api.mercadopago.com/v2/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body = await r.json();
            if (!r.ok) {
                return { ok: false, error: (_22 = body.message) !== null && _22 !== void 0 ? _22 : `HTTP ${r.status}`, raw: body, fnVer: FN_VER };
            }
            // Also try the direct webhook endpoint
            const r2 = await fetch(`https://api.mercadopago.com/v1/account/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body2 = await r2.json();
            return {
                ok: r.ok || r2.ok,
                v2_result: body,
                v1_result: body2,
                hint: 'Look for "secret" or "signature_secret" field in the raw results',
                fnVer: FN_VER,
            };
        }
        catch (e) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }
    // ── Step: Verify webhook secret (x-signature capability) ─────────────────
    // Confirms the webhookSecret is stored in Firestore and that the Node.js
    // crypto module can produce a valid HMAC-SHA256 signature.
    // Required for MP Security quality metric.
    if (step === 'verify_webhook_secret') {
        const secret = (_23 = mpConfig.webhookSecret) !== null && _23 !== void 0 ? _23 : '';
        if (!secret) {
            return {
                ok: false,
                error: 'webhookSecret not configured in Firestore',
                hint: 'Add mercadopago.webhookSecret to config/integrations → Firestore. Find it in developers.mercadopago.com → your app → Webhooks → Secret key.',
                fnVer: FN_VER,
            };
        }
        const crypto = await Promise.resolve().then(() => require('crypto'));
        const testTs = String(Date.now());
        const manifest = `id:99999999;request-id:diag-req;ts:${testTs};`;
        const sig = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
        return {
            ok: true,
            message: 'webhookSecret configured ✅ — HMAC-SHA256 signing works',
            sampleSig: sig.substring(0, 16) + '…',
            fnVer: FN_VER,
        };
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
// Deeply removes null and undefined properties so { merge: true } operations
// don't overwrite manually corrected fields (like RFCs or names) with nulls.
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
        })), total: mo.total_amount, subtotal: mo.total_amount, marketplaceFee: (mo.order_items || []).reduce((acc, val) => acc + (val.sale_fee || 0), 0), paymentStatus: mo.payments && mo.payments.length > 0 && mo.payments[0].status === 'approved' ? 'approved' : 'pending' }, (() => {
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
    var _a, _b, _c, _d, _e;
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
                throw new Error('No access token');
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
        // --- 3) Process Messages (Post-sale) & Questions (Pre-sale) ---
        if (payload && (payload.topic === 'messages' || payload.topic === 'questions') && payload.resource) {
            console.log(`[Meli Webhook] Processing ${payload.topic} for resource: ${payload.resource}`);
            const configDoc = await db.collection('config').doc('integrations').get();
            const meliConfig = (_b = configDoc.data()) === null || _b === void 0 ? void 0 : _b.meli;
            if (!meliConfig || !meliConfig.accessToken)
                throw new Error('No access token');
            const headers = { 'Authorization': `Bearer ${meliConfig.accessToken}` };
            const resourceUrl = `https://api.mercadolibre.com${payload.resource}`;
            try {
                const resourceRes = await fetch(resourceUrl, { headers });
                if (resourceRes.ok) {
                    const messageData = await resourceRes.json();
                    // Generate a safe document ID from the resource path (e.g., /messages/123 -> _messages_123)
                    const docId = payload.resource.replace(/[^a-zA-Z0-9]/g, '_');
                    await db.collection('meli_communications').doc(docId).set({
                        topic: payload.topic,
                        resource: payload.resource,
                        data: messageData,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        // Easily indexable metadata for future analytics
                        senderId: ((_c = messageData.from) === null || _c === void 0 ? void 0 : _c.user_id) || messageData.sender_id || null,
                        orderId: ((_d = messageData.message_attachments) === null || _d === void 0 ? void 0 : _d.pack_id) || ((_e = messageData.message_attachments) === null || _e === void 0 ? void 0 : _e.order_id) || null,
                        itemId: messageData.item_id || null,
                        status: messageData.status || null
                    }, { merge: true }); // merge: true guarantees we never erase data if ML pings twice
                    console.log(`[Meli Webhook] Successfully stored ${payload.topic} data for ${payload.resource}`);
                }
                else {
                    console.error(`[Meli Webhook] Failed to fetch ${payload.topic}: ${resourceRes.status}`);
                }
            }
            catch (err) {
                console.error(`[Meli Webhook] Error fetching ${payload.topic}:`, err);
            }
        }
    }
    catch (err) {
        console.error('[Meli Webhook] Error processing payload:', err);
    }
    finally {
        res.status(200).send('OK');
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
 * aggregateDailyStats — scheduled every hour.
 * Writes today's order totals to monthly_stats/{YYYY-MM}/days/{DD}
 * and updates the parent month aggregate by re-summing all day docs.
 * Also synchronizes today's orders into BigQuery.
 */
exports.aggregateDailyStats = functions.pubsub
    .schedule('0 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    var _a, _b, _c;
    // Force evaluation in Mexico City Timezone
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const today = new Date(nowStr);
    const DAYS_TO_SYNC = 5;
    // ── Canonical non-revenue statuses (mirrors order.model.ts) ──────────
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    // ── Canonical channel resolution (mirrors ops queue getLegacyChannel) ─
    const resolveChannel = (order) => {
        const sc = order.sourceChannel;
        const ft = order.fulfillmentType;
        if (!sc || sc === 'storefront')
            return 'WEB';
        if (sc === 'pos')
            return 'POS';
        if (sc === 'on_behalf')
            return 'ON_BEHALF';
        if (sc === 'amazon')
            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (sc === 'mercadolibre')
            return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
    };
    let totalBqOrdersAppended = 0;
    let lastSyncDateStr = '';
    for (let i = DAYS_TO_SYNC - 1; i >= 0; i--) {
        const now = new Date(today);
        now.setDate(now.getDate() - i);
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-based
        const day = now.getDate(); // 1-based
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${monthStr}-${dayStr}`; // YYYY-MM-DD
        lastSyncDateStr = dateStr;
        // Construct boundaries explicitly using UTC-6 (Mexico City Standard Time)
        const startOfDay = new Date(`${dateStr}T00:00:00-06:00`);
        const endOfDay = new Date(`${dateStr}T23:59:59.999-06:00`);
        // ── Read target day's orders ───────────────────────────────────────────────
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();
        // ── Aggregate: totals + per-channel breakdowns ────────────────────────
        let totalSales = 0, totalOrders = 0, totalPieces = 0;
        const byChannel = {};
        ordersSnap.docs.forEach(docSnap => {
            var _a, _b;
            const order = docSnap.data();
            if (NON_REVENUE.includes(order['status']))
                return; // skip ghost & void orders
            const revenue = Number((_a = order['total']) !== null && _a !== void 0 ? _a : 0);
            const units = ((_b = order['items']) !== null && _b !== void 0 ? _b : [])
                .reduce((s, item) => s + (Number(item.quantity) || 1), 0);
            const channel = resolveChannel(order);
            totalSales += revenue;
            totalOrders += 1;
            totalPieces += units;
            if (!byChannel[channel])
                byChannel[channel] = { revenue: 0, orders: 0, units: 0 };
            byChannel[channel].revenue += revenue;
            byChannel[channel].orders += 1;
            byChannel[channel].units += units;
        });
        const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
        const ts = admin.firestore.FieldValue.serverTimestamp();
        // ── 1. Legacy monthly_stats (backward compat) ─────────────────────────
        const monthRef = db.collection('monthly_stats').doc(monthStr);
        const dayRef = monthRef.collection('days').doc(dayStr);
        await dayRef.set({
            day: dayStr, month: monthStr,
            sales: totalSales, orders: totalOrders, pieces: totalPieces,
            updatedAt: ts,
        });
        // ── 2. analytics_daily/{YYYY-MM-DD} ──────────────────────────────────
        const dt = new Date(`${dateStr}T12:00:00`);
        await db.collection('analytics_daily').doc(dateStr).set({
            date: dateStr,
            month: monthStr,
            dayOfWeek: (dt.getDay() + 6) % 7,
            totalRevenue: totalSales,
            totalOrders,
            totalUnits: totalPieces,
            avgTicket,
            byChannel,
            updatedAt: ts,
        }, { merge: true });
        // ── 3. analytics_channel_snapshots/{channel}/{YYYY-MM-DD} ─────────────
        const batch = db.batch();
        for (const [channel, data] of Object.entries(byChannel)) {
            const snapRef = db
                .collection('analytics_channel_snapshots')
                .doc(channel)
                .collection('days')
                .doc(dateStr);
            batch.set(snapRef, {
                channel, date: dateStr, month: monthStr,
                revenue: data.revenue,
                orders: data.orders,
                units: data.units,
                avgPrice: data.orders > 0 ? data.revenue / data.orders : 0,
                updatedAt: ts,
            }, { merge: true });
        }
        await batch.commit();
        // ── 4. Enrich MELI_FULL snapshot with visit data from MeLi Metrics API ─
        try {
            const meliConfig = await getMeliConfig();
            if ((meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.accessToken) && (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) && byChannel['MELI_FULL']) {
                const token = await getValidMeliToken();
                const visitsRes = await fetch(`https://api.mercadolibre.com/users/${meliConfig.userId}/items_visits/time_window?last=1&unit=day`, { headers: { Authorization: `Bearer ${token}` } });
                if (visitsRes.ok) {
                    const visitsJson = await visitsRes.json();
                    const totalVisits = (_a = visitsJson === null || visitsJson === void 0 ? void 0 : visitsJson.total_visits) !== null && _a !== void 0 ? _a : 0;
                    const meliFullOrders = (_b = byChannel['MELI_FULL'].orders) !== null && _b !== void 0 ? _b : 0;
                    const conversionRate = totalVisits > 0
                        ? parseFloat(((meliFullOrders / totalVisits) * 100).toFixed(2))
                        : 0;
                    const meliSnapRef = db
                        .collection('analytics_channel_snapshots')
                        .doc('MELI_FULL')
                        .collection('days')
                        .doc(dateStr);
                    await meliSnapRef.set({
                        visits: totalVisits,
                        conversionRate,
                        updatedAt: ts,
                    }, { merge: true });
                }
            }
        }
        catch (meliErr) {
            console.warn(`[DailyStats] MeLi visits enrichment failed for ${dateStr}:`, meliErr);
        }
        console.log(`[DailyStats] ${dateStr}: orders=${totalOrders}, revenue=$${totalSales.toFixed(0)}, pieces=${totalPieces}`);
        // ── 5. Append this day's orders into BigQuery (Rolling Buffer) ─────────
        try {
            const bqPayload = ordersSnap.docs
                .filter(docSnap => !NON_REVENUE.includes(docSnap.data()['status']))
                .map(docSnap => ({
                orderId: docSnap.id,
                order: docSnap.data(),
                channel: resolveChannel(docSnap.data()),
            }));
            await appendOrdersToBQForDate(dateStr, bqPayload);
            totalBqOrdersAppended += bqPayload.length;
        }
        catch (bqErr) {
            console.warn(`[DailyStats] BigQuery append failed for ${dateStr} (non-critical):`, bqErr);
        }
    }
    // ── 6. Re-sum current month aggregate ──────────────────────────────────
    // Instead of incrementing, we recalculate the whole month to ensure it perfectly
    // matches the days we just overwrote, maintaining absolute consistency.
    try {
        const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const ts = admin.firestore.FieldValue.serverTimestamp();
        const monthRef = db.collection('monthly_stats').doc(currentMonthStr);
        const allDaysSnap = await monthRef.collection('days').get();
        let mSales = 0, mOrders = 0, mPieces = 0;
        allDaysSnap.docs.forEach(d => {
            var _a, _b, _c;
            mSales += Number((_a = d.data()['sales']) !== null && _a !== void 0 ? _a : 0);
            mOrders += Number((_b = d.data()['orders']) !== null && _b !== void 0 ? _b : 0);
            mPieces += Number((_c = d.data()['pieces']) !== null && _c !== void 0 ? _c : 0);
        });
        await monthRef.set({ month: currentMonthStr, sales: mSales, orders: mOrders, pieces: mPieces, updatedAt: ts }, { merge: true });
        await db.collection('analytics_monthly').doc(currentMonthStr).set({
            month: currentMonthStr,
            totalRevenue: mSales,
            totalOrders: mOrders,
            totalUnits: mPieces,
            updatedAt: ts,
        }, { merge: true });
        // ── 7. Write BQ sync status ───────────────────────────────────────────────
        await db.collection('system_logs').doc('bq_sync_status').set({
            lastSyncDate: lastSyncDateStr,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            ordersAppended: totalBqOrdersAppended,
            status: 'success',
            errorMessage: null,
        }, { merge: true });
    }
    catch (err) {
        console.warn('[DailyStats] Aggregate monthly/status write failed:', err);
        await db.collection('system_logs').doc('bq_sync_status').set({
            lastSyncDate: lastSyncDateStr,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            ordersAppended: 0,
            status: 'error',
            errorMessage: (_c = err === null || err === void 0 ? void 0 : err.message) !== null && _c !== void 0 ? _c : 'unknown',
        }, { merge: true });
    }
});
// ─── cleanupAbandonedCheckouts — scheduled every 30 min ──────────────────────
//
// Auto-cancels orders stuck in `pending_payment` for more than 35 minutes.
// These are customers who started checkout but never completed payment.
// Runs at :05 and :35 of every hour to avoid overlap with any other nightly jobs.
//
// Adds a history entry for audit trail: { status: 'cancelled', note: 'Pago no completado' }
//
// ─────────────────────────────────────────────────────────────────────────────
exports.cleanupAbandonedCheckouts = functions.pubsub
    .schedule('5,35 * * * *') // every 30 min at :05 and :35
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    var _a;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago
    const snap = await db.collection('orders')
        .where('status', '==', 'pending_payment')
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(cutoff))
        .limit(100)
        .get();
    if (snap.empty) {
        console.log('[CleanupCheckouts] No abandoned checkouts found.');
        return;
    }
    console.log(`[CleanupCheckouts] Cancelling ${snap.size} abandoned checkout(s).`);
    const batch = db.batch();
    for (const orderDoc of snap.docs) {
        const data = orderDoc.data();
        const history = (_a = data['history']) !== null && _a !== void 0 ? _a : [];
        batch.update(orderDoc.ref, {
            status: 'cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            history: [...history, {
                    status: 'cancelled',
                    timestamp: admin.firestore.Timestamp.now(),
                    note: 'Pago no completado — cancelación automática (35 min)',
                    updatedBy: 'system',
                }],
        });
    }
    await batch.commit();
    console.log(`[CleanupCheckouts] Done. ${snap.size} order(s) cancelled.`);
    // ── Log daily abandon count for the Metrics Hub ────────────────────────
    // Writes to system_logs/abandon_stats as a map: { daily: { "2026_04_28": 5, ... } }
    // Using underscores in the key so Firestore field paths don't require quoting.
    try {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
            .replace(/-/g, '_'); // → "2026_04_28"
        await db.collection('system_logs').doc('abandon_stats').set({
            [`daily.${today}`]: admin.firestore.FieldValue.increment(snap.size),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (logErr) {
        console.warn('[CleanupCheckouts] Failed to write abandon stats (non-critical):', logErr);
    }
});
// ─── meliEnrichInventoryVelocity ─────────────────────────────────────────────
//
// Scheduled weekly (Mon 06:00 MX) + callable on-demand.
// For every SKU in meli_fbm_inventory, computes:
//   - salesVelocity30d  (units/day average over last 30 days)
//   - salesVelocity7d   (units/day average over last 7 days — shows trend)
//   - daysOfCoverage    (availableQty / velocity30d)
//   - reorderAlertLevel ('ok' | 'low' | 'critical' | 'stockout')
//   - recommendedReplenishQty  (target 45 days of stock)
//   - projectedStockoutDate
//
// ─────────────────────────────────────────────────────────────────────────────
// Helper shared by scheduled + callable
async function computeInventoryVelocity() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const now = new Date();
    const start30 = new Date(now);
    start30.setDate(now.getDate() - 30);
    const start7 = new Date(now);
    start7.setDate(now.getDate() - 7);
    // 1. Load all MELI_FULL revenue orders from last 30 days
    const ordersSnap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('fulfillmentType', '==', 'platform')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start30))
        .get();
    // 2. Build SKU velocity maps: { sku → { units30d, units7d } }
    const velocityMap = {};
    const itemIdMap = {};
    for (const snap of ordersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status']))
            continue;
        const orderDate = order['createdAt'].toDate();
        const inLast7 = orderDate >= start7;
        const items = ((_a = order['items']) !== null && _a !== void 0 ? _a : []);
        for (const item of items) {
            const sku = ((_b = item.sku) !== null && _b !== void 0 ? _b : '').trim();
            const mlId = ((_d = (_c = item.mlItemId) !== null && _c !== void 0 ? _c : item.productId) !== null && _d !== void 0 ? _d : '').trim();
            const qty = Number(item.quantity) || 1;
            if (sku) {
                if (!velocityMap[sku])
                    velocityMap[sku] = { units30d: 0, units7d: 0 };
                velocityMap[sku].units30d += qty;
                if (inLast7)
                    velocityMap[sku].units7d += qty;
            }
            if (mlId) {
                if (!itemIdMap[mlId])
                    itemIdMap[mlId] = { units30d: 0, units7d: 0 };
                itemIdMap[mlId].units30d += qty;
                if (inLast7)
                    itemIdMap[mlId].units7d += qty;
            }
        }
    }
    // 3. Load all FBM inventory docs
    const invSnap = await db.collection('meli_fbm_inventory').get();
    const errors = [];
    const batch = db.batch();
    let updated = 0;
    for (const invDoc of invSnap.docs) {
        try {
            const data = invDoc.data();
            const sku = ((_e = data['sku']) !== null && _e !== void 0 ? _e : '').trim();
            const mlId = ((_f = data['mlItemId']) !== null && _f !== void 0 ? _f : '').trim();
            // Prefer SKU match, fall back to ML Item ID
            const vel = (sku && velocityMap[sku]) ? velocityMap[sku]
                : (mlId && itemIdMap[mlId]) ? itemIdMap[mlId]
                    : null;
            const units30d = (_g = vel === null || vel === void 0 ? void 0 : vel.units30d) !== null && _g !== void 0 ? _g : 0;
            const units7d = (_h = vel === null || vel === void 0 ? void 0 : vel.units7d) !== null && _h !== void 0 ? _h : 0;
            const vel30 = units30d / 30;
            const vel7 = units7d / 7;
            const available = Number((_k = (_j = data['availableQuantity']) !== null && _j !== void 0 ? _j : data['fullStock']) !== null && _k !== void 0 ? _k : 0);
            const daysOfCoverage = vel30 > 0 ? Math.floor(available / vel30) : 9999;
            const targetDays = 45;
            const replenish = vel30 > 0
                ? Math.max(0, Math.ceil((targetDays * vel30) - available))
                : 0;
            let alertLevel;
            if (available === 0)
                alertLevel = 'stockout';
            else if (daysOfCoverage < 7)
                alertLevel = 'critical';
            else if (daysOfCoverage < 21)
                alertLevel = 'low';
            else
                alertLevel = 'ok';
            const stockoutDate = vel30 > 0 && available > 0
                ? new Date(now.getTime() + (daysOfCoverage * 86400000))
                    .toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
                : null;
            batch.update(invDoc.ref, {
                salesVelocity30d: parseFloat(vel30.toFixed(2)),
                salesVelocity7d: parseFloat(vel7.toFixed(2)),
                daysOfCoverage,
                reorderAlertLevel: alertLevel,
                recommendedReplenishQty: replenish,
                projectedStockoutDate: stockoutDate,
                lastVelocityCalc: admin.firestore.FieldValue.serverTimestamp(),
            });
            updated++;
        }
        catch (err) {
            errors.push(`${invDoc.id}: ${(_l = err === null || err === void 0 ? void 0 : err.message) !== null && _l !== void 0 ? _l : err}`);
        }
    }
    await batch.commit();
    return { updated, errors };
}
exports.meliEnrichInventoryVelocity = functions.pubsub
    .schedule('0 6 * * 1') // Every Monday 06:00 MX
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
    const result = await computeInventoryVelocity();
    console.log(`[VelocityEnrich] updated=${result.updated}, errors=${result.errors.length}`);
    if (result.errors.length)
        console.warn('[VelocityEnrich] errors:', result.errors);
});
exports.meliEnrichInventoryVelocityCallable = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const result = await computeInventoryVelocity();
    return result;
});
// ─── backfillAnalytics — callable ────────────────────────────────────────────
//
// One-time callable to populate analytics_daily and analytics_channel_snapshots
// from all historical orders. Processes in 30-day chunks to avoid timeouts.
// Call after deploying the new analytics collections.
//
// Returns: { daysProcessed, daysSkipped, writeCount }
//
// ─────────────────────────────────────────────────────────────────────────────
exports.backfillAnalytics = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const resolveChannel = (order) => {
        const sc = order.sourceChannel;
        const ft = order.fulfillmentType;
        if (!sc || sc === 'storefront')
            return 'WEB';
        if (sc === 'pos')
            return 'POS';
        if (sc === 'on_behalf')
            return 'ON_BEHALF';
        if (sc === 'amazon')
            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (sc === 'mercadolibre')
            return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
    };
    const toMxDateStr = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    // Date range: default = start of 2024 to yesterday
    const now = new Date();
    const fromDate = (data === null || data === void 0 ? void 0 : data.fromDate)
        ? new Date(data.fromDate + 'T06:00:00')
        : new Date('2024-01-01T06:00:00');
    const toDate = (data === null || data === void 0 ? void 0 : data.toDate)
        ? new Date(data.toDate + 'T23:59:59')
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    // Load ALL orders in range in one query (< 100K docs — manageable in 1GB)
    const allOrdersSnap = await db.collection('orders')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
        .get();
    console.log(`[BackfillAnalytics] Total orders loaded: ${allOrdersSnap.size}`);
    // Group orders by MX date key
    const dateMap = {}; // dateStr → channelId → metrics
    for (const snap of allOrdersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status']))
            continue;
        const orderDate = order['createdAt'].toDate();
        const dateKey = toMxDateStr(orderDate);
        const channel = resolveChannel(order);
        const revenue = Number((_a = order['total']) !== null && _a !== void 0 ? _a : 0);
        const units = ((_b = order['items']) !== null && _b !== void 0 ? _b : [])
            .reduce((s, i) => s + (Number(i.quantity) || 1), 0);
        if (!dateMap[dateKey])
            dateMap[dateKey] = {};
        if (!dateMap[dateKey][channel])
            dateMap[dateKey][channel] = { revenue: 0, orders: 0, units: 0 };
        dateMap[dateKey][channel].revenue += revenue;
        dateMap[dateKey][channel].orders += 1;
        dateMap[dateKey][channel].units += units;
    }
    // Write analytics_daily and analytics_channel_snapshots in batches of 400
    const ts = admin.firestore.FieldValue.serverTimestamp();
    let writeCount = 0;
    let batch = db.batch();
    let batchSize = 0;
    const flushBatch = async () => {
        if (batchSize > 0) {
            await batch.commit();
            batch = db.batch();
            batchSize = 0;
        }
    };
    const dates = Object.keys(dateMap).sort();
    for (const dateStr of dates) {
        const channelData = dateMap[dateStr];
        const [y, m, d] = dateStr.split('-').map(Number);
        const monthStr = `${y}-${String(m).padStart(2, '0')}`;
        const dt = new Date(dateStr + 'T12:00:00');
        // Aggregate all channels for this day → analytics_daily
        let totalRevenue = 0, totalOrders = 0, totalUnits = 0;
        for (const ch of Object.values(channelData)) {
            totalRevenue += ch.revenue;
            totalOrders += ch.orders;
            totalUnits += ch.units;
        }
        const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const dailyRef = db.collection('analytics_daily').doc(dateStr);
        batch.set(dailyRef, {
            date: dateStr, month: monthStr,
            dayOfWeek: (dt.getDay() + 6) % 7,
            totalRevenue, totalOrders, totalUnits, avgTicket,
            byChannel: channelData,
            updatedAt: ts,
        }, { merge: true });
        batchSize++;
        // Per-channel snapshots
        for (const [channel, data2] of Object.entries(channelData)) {
            const snapRef = db
                .collection('analytics_channel_snapshots')
                .doc(channel)
                .collection('days')
                .doc(dateStr);
            batch.set(snapRef, {
                channel, date: dateStr, month: monthStr,
                revenue: data2.revenue, orders: data2.orders, units: data2.units,
                avgPrice: data2.orders > 0 ? data2.revenue / data2.orders : 0,
                updatedAt: ts,
            }, { merge: true });
            batchSize++;
        }
        writeCount += 1 + Object.keys(channelData).length;
        // Flush every 400 writes
        if (batchSize >= 400)
            await flushBatch();
    }
    await flushBatch();
    console.log(`[BackfillAnalytics] Done. dates=${dates.length}, writes=${writeCount}`);
    return { daysProcessed: dates.length, writeCount };
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
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Paid Media Intelligence ──────────────────────────────────────────────────
// Pulls Meta Ads + Google Ads snapshots daily → stores in Firestore.
// Tokens/credentials stay server-side (config/integrations → meta / google).
//
// Firestore paths written:
//   advertising_snapshots/{YYYY-MM-DD}/meta/{campaignId}   → MetaInsights
//   advertising_snapshots/{YYYY-MM-DD}/google/{campaignId} → GoogleInsights
//   advertising_cache/latest                                → PaidMediaDailySummary
// ═══════════════════════════════════════════════════════════════════════════════
/** Reads paid media credentials from config/integrations */
async function getPaidMediaConfig() {
    var _a, _b, _c;
    const snap = await db.collection('config').doc('integrations').get();
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    return { meta: (_b = data['meta']) !== null && _b !== void 0 ? _b : {}, google: (_c = data['google']) !== null && _c !== void 0 ? _c : {} };
}
/** Returns 'YYYY-MM-DD' for a Date in Mexico City timezone */
function toDateStr(d) {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
// ── Meta helpers ──────────────────────────────────────────────────────────────
const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';
function actionVal(arr, type) {
    if (!arr)
        return 0;
    const found = arr.find((a) => a.action_type === type);
    return found ? parseFloat(found.value) : 0;
}
async function fetchMetaCampaigns(adAccountId, accessToken, datePreset) {
    var _a, _b, _c;
    const fields = [
        'id', 'name', 'status',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,purchase_roas,actions,action_values}`,
    ].join(',');
    const url = `${META_GRAPH_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${accessToken}&limit=100`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok)
        throw new Error(`Meta API: ${(_b = (_a = body === null || body === void 0 ? void 0 : body.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : JSON.stringify(body)}`);
    return (_c = body.data) !== null && _c !== void 0 ? _c : [];
}
// ── Google Ads helpers ────────────────────────────────────────────────────────
const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com/v17';
async function getGoogleToken(cfg) {
    var _a;
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            refresh_token: cfg.refreshToken,
            grant_type: 'refresh_token',
        }).toString(),
    });
    const d = await r.json();
    if (!r.ok || !d.access_token)
        throw new Error(`Google OAuth: ${(_a = d.error_description) !== null && _a !== void 0 ? _a : JSON.stringify(d)}`);
    return d.access_token;
}
async function fetchGoogleCampaigns(customerId, developerToken, accessToken, dateStr) {
    var _a, _b, _c;
    const query = `
        SELECT campaign.id, campaign.name, campaign.status,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.ctr, metrics.average_cpc, metrics.conversions,
               metrics.all_conversions, metrics.conversions_value,
               metrics.cost_per_conversion, metrics.search_impression_share
        FROM campaign
        WHERE segments.date = '${dateStr}' AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC LIMIT 50
    `.trim();
    const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (!res.ok)
        throw new Error(`Google Ads API: ${(_b = (_a = body === null || body === void 0 ? void 0 : body.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : JSON.stringify(body)}`);
    return (_c = body.results) !== null && _c !== void 0 ? _c : [];
}
// ── Core sync logic ───────────────────────────────────────────────────────────
async function runPaidMediaSync(targetDate) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const dateStr = toDateStr(targetDate);
    const errors = [];
    let metaCount = 0, googleCount = 0;
    const cfg = await getPaidMediaConfig();
    const batch = db.batch();
    const snapsBase = db.collection('advertising_snapshots').doc(dateStr);
    const pulledAt = admin.firestore.FieldValue.serverTimestamp();
    const cacheRef = db.collection('advertising_cache').doc('latest');
    // ── Meta ─────────────────────────────────────────────────────────────────
    const metaCfg = cfg.meta;
    if ((metaCfg === null || metaCfg === void 0 ? void 0 : metaCfg.accessToken) && (metaCfg === null || metaCfg === void 0 ? void 0 : metaCfg.adAccountId)) {
        try {
            const camps = await fetchMetaCampaigns(metaCfg.adAccountId, metaCfg.accessToken, 'yesterday');
            let mSpend = 0, mImpr = 0, mClicks = 0, mPurch = 0;
            for (const camp of camps) {
                const ins = ((_b = (_a = camp.insights) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : [])[0];
                if (!ins)
                    continue;
                const spend = parseFloat(ins.spend) || 0;
                const impressions = parseInt(ins.impressions) || 0;
                const clicks = parseInt(ins.clicks) || 0;
                const reach = parseInt(ins.reach) || 0;
                const frequency = parseFloat(ins.frequency) || 0;
                const cpm = parseFloat(ins.cpm) || 0;
                const cpc = parseFloat(ins.cpc) || 0;
                const ctr = parseFloat(ins.ctr) || 0;
                const purchases = actionVal(ins.actions, 'purchase');
                const purchaseValue = actionVal(ins.action_values, 'purchase');
                const addToCart = actionVal(ins.actions, 'add_to_cart');
                const viewContent = actionVal(ins.actions, 'view_content');
                const purchaseRoas = ((_c = ins.purchase_roas) === null || _c === void 0 ? void 0 : _c[0]) ? parseFloat(ins.purchase_roas[0].value) : 0;
                batch.set(snapsBase.collection('meta').doc(camp.id), {
                    campaignId: camp.id, campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, reach, frequency, cpm, cpc, ctr,
                    purchases, purchaseValue, purchaseRoas, addToCart, viewContent,
                    datePreset: 'yesterday', snapshotDate: dateStr, pulledAt,
                }, { merge: true });
                metaCount++;
                mSpend += spend;
                mImpr += impressions;
                mClicks += clicks;
                mPurch += purchases;
            }
            batch.set(cacheRef, {
                date: dateStr, metaSpend: mSpend, metaImpressions: mImpr,
                metaClicks: mClicks, metaPurchases: mPurch, updatedAt: pulledAt,
            }, { merge: true });
        }
        catch (err) {
            console.error('[PaidMedia] Meta error:', err.message);
            errors.push(`Meta: ${err.message}`);
        }
    }
    // ── Google Ads ────────────────────────────────────────────────────────────
    const gCfg = cfg.google;
    if ((gCfg === null || gCfg === void 0 ? void 0 : gCfg.clientId) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.clientSecret) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.refreshToken) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.customerId) && (gCfg === null || gCfg === void 0 ? void 0 : gCfg.developerToken)) {
        try {
            const gToken = await getGoogleToken(gCfg);
            const yesterday = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateStr(yesterday);
            const results = await fetchGoogleCampaigns(gCfg.customerId, gCfg.developerToken, gToken, yesterdayStr);
            let gSpend = 0, gImpr = 0, gClicks = 0, gConv = 0, gConvVal = 0;
            for (const row of results) {
                const camp = row.campaign, m = row.metrics;
                const spend = ((_d = m.costMicros) !== null && _d !== void 0 ? _d : 0) / 1000000;
                const impressions = (_e = m.impressions) !== null && _e !== void 0 ? _e : 0;
                const clicks = (_f = m.clicks) !== null && _f !== void 0 ? _f : 0;
                const ctr = ((_g = m.ctr) !== null && _g !== void 0 ? _g : 0) * 100;
                const avgCpc = ((_h = m.averageCpc) !== null && _h !== void 0 ? _h : 0) / 1000000;
                const conversions = (_j = m.conversions) !== null && _j !== void 0 ? _j : 0;
                const allConversions = (_k = m.allConversions) !== null && _k !== void 0 ? _k : 0;
                const conversionsValue = (_l = m.conversionsValue) !== null && _l !== void 0 ? _l : 0;
                const costPerConversion = conversions > 0 ? spend / conversions : 0;
                const impressionShare = (_m = m.searchImpressionShare) !== null && _m !== void 0 ? _m : null;
                batch.set(snapsBase.collection('google').doc(String(camp.id)), {
                    campaignId: String(camp.id), campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, ctr, avgCpc, conversions, allConversions,
                    conversionsValue, costPerConversion, impressionShare,
                    snapshotDate: dateStr, pulledAt,
                }, { merge: true });
                googleCount++;
                gSpend += spend;
                gImpr += impressions;
                gClicks += clicks;
                gConv += conversions;
                gConvVal += conversionsValue;
            }
            batch.set(cacheRef, {
                googleSpend: gSpend, googleImpressions: gImpr, googleClicks: gClicks,
                googleConversions: gConv,
                googleRoas: gSpend > 0 ? gConvVal / gSpend : 0,
                updatedAt: pulledAt,
            }, { merge: true });
        }
        catch (err) {
            console.error('[PaidMedia] Google error:', err.message);
            errors.push(`Google: ${err.message}`);
        }
    }
    await batch.commit();
    console.log(`[PaidMedia] ${dateStr}: Meta=${metaCount}, Google=${googleCount}, Errors=${errors.length}`);
    return { metaCampaigns: metaCount, googleCampaigns: googleCount, errors };
}
// ── Scheduled: daily at 06:00 Mexico City ────────────────────────────────────
exports.syncPaidMediaSnapshots = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .pubsub.schedule('0 12 * * *') // 06:00 Mexico City = 12:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async () => { await runPaidMediaSync(new Date()); return null; });
// ── Manual trigger (callable from Angular) ────────────────────────────────────
exports.triggerPaidMediaSync = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const role = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.role;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role !== null && role !== void 0 ? role : ''))
        throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
    try {
        const result = await runPaidMediaSync((data === null || data === void 0 ? void 0 : data.date) ? new Date(data.date) : new Date());
        return Object.assign({ ok: true }, result);
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ── Read insights — joins snapshots + internal orders ─────────────────────────
exports.getPaidMediaInsights = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const { campaignName, metaCampaignId, googleCampaignId, days = 30 } = data !== null && data !== void 0 ? data : {};
    const today = new Date();
    const history = [];
    let latestMeta = null, latestGoogle = null;
    // Fetch per-day snapshots in parallel
    await Promise.all(Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = toDateStr(d);
        const snapsBase = db.collection('advertising_snapshots').doc(dateStr);
        return Promise.all([
            metaCampaignId ? snapsBase.collection('meta').doc(metaCampaignId).get() : Promise.resolve(null),
            googleCampaignId ? snapsBase.collection('google').doc(googleCampaignId).get() : Promise.resolve(null),
        ]).then(([ms, gs]) => {
            var _a, _b, _c, _d;
            const md = (ms === null || ms === void 0 ? void 0 : ms.exists) ? ms.data() : null;
            const gd = (gs === null || gs === void 0 ? void 0 : gs.exists) ? gs.data() : null;
            if (i === 0) {
                latestMeta = md;
                latestGoogle = gd;
            }
            history.push({
                date: dateStr, metaSpend: (_a = md === null || md === void 0 ? void 0 : md.spend) !== null && _a !== void 0 ? _a : 0, googleSpend: (_b = gd === null || gd === void 0 ? void 0 : gd.spend) !== null && _b !== void 0 ? _b : 0,
                totalSpend: ((_c = md === null || md === void 0 ? void 0 : md.spend) !== null && _c !== void 0 ? _c : 0) + ((_d = gd === null || gd === void 0 ? void 0 : gd.spend) !== null && _d !== void 0 ? _d : 0), revenue: 0, roas: null,
            });
        });
    }));
    // Join with internal orders for revenue data
    let totalOrders = 0, totalRevenue = 0;
    if (campaignName) {
        const from = new Date(today);
        from.setDate(from.getDate() - days);
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(from))
            .orderBy('createdAt', 'desc').get();
        const slug = campaignName.toLowerCase().trim();
        const revByDate = new Map();
        for (const doc of ordersSnap.docs) {
            const d = doc.data();
            const cs = ((_c = (_b = (_a = d.attribution) === null || _a === void 0 ? void 0 : _a.utm) === null || _b === void 0 ? void 0 : _b.utm_campaign) !== null && _c !== void 0 ? _c : '').toLowerCase().trim();
            if (!cs || (!cs.includes(slug) && !slug.includes(cs)))
                continue;
            const rev = (_e = (_d = d.total) !== null && _d !== void 0 ? _d : d.totalAmount) !== null && _e !== void 0 ? _e : 0;
            totalOrders++;
            totalRevenue += rev;
            const ds = toDateStr(d.createdAt.toDate());
            revByDate.set(ds, ((_f = revByDate.get(ds)) !== null && _f !== void 0 ? _f : 0) + rev);
        }
        for (const pt of history) {
            pt.revenue = (_g = revByDate.get(pt.date)) !== null && _g !== void 0 ? _g : 0;
            pt.roas = pt.totalSpend > 0 ? pt.revenue / pt.totalSpend : null;
        }
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    const totalSpend = ((_h = latestMeta === null || latestMeta === void 0 ? void 0 : latestMeta.spend) !== null && _h !== void 0 ? _h : 0) + ((_j = latestGoogle === null || latestGoogle === void 0 ? void 0 : latestGoogle.spend) !== null && _j !== void 0 ? _j : 0);
    return {
        internalOrders: totalOrders, internalRevenue: totalRevenue,
        meta: latestMeta, google: latestGoogle,
        totalSpend,
        realRoas: totalSpend > 0 ? totalRevenue / totalSpend : null,
        realCpa: totalOrders > 0 ? totalSpend / totalOrders : null,
        frequencyWarning: ((_k = latestMeta === null || latestMeta === void 0 ? void 0 : latestMeta.frequency) !== null && _k !== void 0 ? _k : 0) > 4.5,
        history,
    };
});
// ─── Dynamic Sitemap ──────────────────────────────────────────────────────────
// Deployed endpoint: /sitemap.xml (via Firebase Hosting rewrite)
// Reads all active products + published blog posts from Firestore.
// Submit this URL to Google Search Console and include in robots.txt.
// AI crawlers: GPTBot, PerplexityBot, ClaudeBot, GoogleBot all respect sitemaps.
exports.sitemapXml = functions.https.onRequest(async (req, res) => {
    var _a, _b;
    const DOMAIN = 'https://importadoraeuro.com';
    try {
        const [productsSnap, blogSnap] = await Promise.all([
            db.collection('products').where('active', '==', true).get(),
            db.collection('blog_posts').where('published', '==', true).get(),
        ]);
        const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        // Static pages
        const staticUrls = [
            { loc: `${DOMAIN}/`, priority: '1.0', changefreq: 'weekly' },
            // ── Catalog: /catalogo is canonical ──────────────────────────────────
            { loc: `${DOMAIN}/catalogo`, priority: '0.9', changefreq: 'daily' },
            { loc: `${DOMAIN}/catalog`, priority: '0.3', changefreq: 'monthly' },
            // ── Other pages ───────────────────────────────────────────────────────
            { loc: `${DOMAIN}/praxis`, priority: '0.7', changefreq: 'monthly' },
            { loc: `${DOMAIN}/blog`, priority: '0.7', changefreq: 'weekly' },
            { loc: `${DOMAIN}/help`, priority: '0.5', changefreq: 'monthly' },
            { loc: `${DOMAIN}/terms`, priority: '0.3', changefreq: 'yearly' },
            { loc: `${DOMAIN}/privacy`, priority: '0.3', changefreq: 'yearly' },
        ];
        const urlEntries = [];
        // Static pages
        for (const page of staticUrls) {
            urlEntries.push(`
  <url>
    <loc>${page.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`);
        }
        // Product pages
        for (const doc of productsSnap.docs) {
            const d = doc.data();
            const slug = d.slug || doc.id;
            const updatedAt = ((_a = d.updatedAt) === null || _a === void 0 ? void 0 : _a.toDate)
                ? d.updatedAt.toDate().toISOString().split('T')[0]
                : now;
            urlEntries.push(`
  <url>
    <loc>${DOMAIN}/product/${slug}</loc>
    <lastmod>${updatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
        }
        // Blog post pages
        for (const doc of blogSnap.docs) {
            const d = doc.data();
            const slug = d.slug || doc.id;
            const publishedAt = ((_b = d.publishedAt) === null || _b === void 0 ? void 0 : _b.toDate)
                ? d.publishedAt.toDate().toISOString().split('T')[0]
                : now;
            urlEntries.push(`
  <url>
    <loc>${DOMAIN}/blog/${slug}</loc>
    <lastmod>${publishedAt}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`);
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries.join('')}
</urlset>`;
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600'); // 1-hour cache
        res.status(200).send(xml);
    }
    catch (e) {
        console.error('[sitemapXml] Error:', e);
        res.status(500).send('Sitemap generation failed.');
    }
});
// ─── Phase 2.1 — Abandoned Cart Recovery Automation ─────────────────────────
// Triggered when cartSnapshots receives an abandoned_detected event.
// Queues a multi-step recovery sequence in recovery_queue.
// Step 1 (1 hour): WhatsApp message + cart link
// Step 2 (24 hours): WhatsApp + auto-generated 5% coupon code
// Uses provider-agnostic notification_outbox — plug in Twilio / WABA / any provider.
exports.onCartAbandoned = functions.firestore
    .document('cartSnapshots/{snapId}')
    .onCreate(async (snap, context) => {
    var _a, _b;
    const data = snap.data();
    if ((data === null || data === void 0 ? void 0 : data.event) !== 'abandoned_detected')
        return null;
    const sessionId = data.sessionId || context.params.snapId;
    const email = data.customerEmail || ((_a = data.attribution) === null || _a === void 0 ? void 0 : _a.email) || null;
    const phone = data.customerPhone || null;
    const name = data.customerName || ((_b = data.attribution) === null || _b === void 0 ? void 0 : _b.name) || 'Cliente';
    const items = data.items || [];
    const cartValue = data.cartValue || 0;
    const cartLink = 'https://importadoraeuro.com/checkout';
    if (!email && !phone) {
        // Cannot recover anonymous guest with no contact info — skip
        return null;
    }
    // Check if this session already has a recovery task
    const existing = await db.collection('recovery_queue')
        .where('sessionId', '==', sessionId)
        .limit(1).get();
    if (!existing.empty)
        return null; // already queued
    const now = Date.now();
    const batch = db.batch();
    // Step 1: 1 hour from now — friendly reminder
    const step1Ref = db.collection('recovery_queue').doc();
    batch.set(step1Ref, {
        sessionId, email, phone, name, items, cartValue,
        step: 1,
        sendAt: admin.firestore.Timestamp.fromMillis(now + 60 * 60 * 1000),
        status: 'pending',
        type: 'cart_recovery',
        message: `Hola ${name}, dejaste tu carrito con ${items.length} producto(s) por $${cartValue} MXN. ¿Te ayudamos a completar tu compra? 👉 ${cartLink}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Step 2: 24 hours from now — with coupon
    // Auto-generate a unique 5% coupon code
    const couponCode = `CART${sessionId.slice(-6).toUpperCase()}`;
    const step2Ref = db.collection('recovery_queue').doc();
    batch.set(step2Ref, {
        sessionId, email, phone, name, items, cartValue,
        step: 2,
        sendAt: admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
        status: 'pending',
        type: 'cart_recovery',
        couponCode,
        message: `${name}, aquí tienes un 5% de descuento exclusivo: ${couponCode}. Válido por 48 horas. Completa tu compra → ${cartLink}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    // Pre-create the coupon in Firestore so it's ready when the customer arrives
    const couponEndDate = new Date(now + 48 * 60 * 60 * 1000);
    await db.collection('coupons').doc(couponCode).set({
        code: couponCode,
        type: 'percentage',
        value: 5,
        isActive: true,
        usageLimit: 1,
        usageCount: 0,
        minPurchaseAmount: 0,
        startDate: admin.firestore.Timestamp.now(),
        endDate: admin.firestore.Timestamp.fromDate(couponEndDate),
        description: `Recuperación de carrito — sesión ${sessionId}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        autoGenerated: true,
        source: 'cart_recovery',
    }, { merge: true });
    console.log(`[CartRecovery] Queued 2-step recovery for session ${sessionId}`);
    return null;
});
// Processes pending recovery_queue items and writes to notification_outbox.
// Schedule: every 30 minutes. Outbox is read by any notification provider.
exports.processRecoveryQueue = functions.pubsub
    .schedule('every 30 minutes')
    .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection('recovery_queue')
        .where('status', '==', 'pending')
        .where('sendAt', '<=', now)
        .limit(50)
        .get();
    if (snap.empty)
        return null;
    const batch = db.batch();
    for (const docSnap of snap.docs) {
        const task = docSnap.data();
        // Write to notification_outbox — provider (WhatsApp/email) picks this up
        const outboxRef = db.collection('notification_outbox').doc();
        batch.set(outboxRef, {
            channel: task.phone ? 'whatsapp' : 'email',
            to: task.phone || task.email,
            name: task.name,
            message: task.message,
            type: task.type,
            step: task.step,
            couponCode: task.couponCode || null,
            sessionId: task.sessionId,
            status: 'queued',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Mark task as sent
        batch.update(docSnap.ref, {
            status: 'sent',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    console.log(`[RecoveryQueue] Dispatched ${snap.size} notifications to outbox.`);
    return null;
});
// ─── Phase 2.2 — Product Review Request ─────────────────────────────────────
// Triggered when a new order is created (payment completed).
// Queues a review request 7 days later in review_requests collection.
exports.onOrderCompleted = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snap, context) => {
    const order = snap.data();
    if (!order)
        return null;
    const email = order.customerEmail || order.email;
    const phone = order.customerPhone || null;
    const name = order.customerName || order.name || 'Cliente';
    const items = (order.items || []).map((i) => ({
        productId: i.productId || i.id,
        productName: i.name || i.productName,
        slug: i.slug,
    }));
    if (!email && !phone)
        return null; // no contact info
    if (!items.length)
        return null;
    // Schedule review request 7 days from now
    const sendAt = admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection('review_requests').doc(context.params.orderId).set({
        orderId: context.params.orderId,
        email, phone, name, items,
        sendAt,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[ReviewRequest] Queued for order ${context.params.orderId} — send at ${sendAt.toDate()}`);
    return null;
});
// Processes pending review requests and publishes to notification_outbox.
// Schedule: daily at 10:00 AM Mexico City time.
exports.processReviewRequests = functions.pubsub
    .schedule('0 10 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
    var _a;
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection('review_requests')
        .where('status', '==', 'pending')
        .where('sendAt', '<=', now)
        .limit(100)
        .get();
    if (snap.empty)
        return null;
    const batch = db.batch();
    for (const docSnap of snap.docs) {
        const req = docSnap.data();
        const firstItem = (_a = req.items) === null || _a === void 0 ? void 0 : _a[0];
        const reviewUrl = (firstItem === null || firstItem === void 0 ? void 0 : firstItem.slug)
            ? `https://importadoraeuro.com/product/${firstItem.slug}?review=1`
            : 'https://importadoraeuro.com';
        const outboxRef = db.collection('notification_outbox').doc();
        batch.set(outboxRef, {
            channel: req.phone ? 'whatsapp' : 'email',
            to: req.phone || req.email,
            name: req.name,
            type: 'review_request',
            orderId: req.orderId,
            reviewUrl,
            message: `Hola ${req.name}, ¿cómo quedó tu llanta? Nos encantaría saber tu opinión. Deja tu reseña en 1 minuto: ${reviewUrl}`,
            status: 'queued',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.update(docSnap.ref, {
            status: 'sent',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    console.log(`[ReviewRequests] Dispatched ${snap.size} review requests.`);
    return null;
});
// ─── Phase 2.4 — Referral Program ────────────────────────────────────────────
// When an order is placed with a valid ?ref=CUSTOMERID attribution param,
// reward the referrer with a $100 MXN coupon after the order is confirmed.
exports.onReferralOrderCompleted = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snap, context) => {
    var _a;
    const order = snap.data();
    if (!order)
        return null;
    const referrerId = ((_a = order.attribution) === null || _a === void 0 ? void 0 : _a.ref) || order.referrerId;
    if (!referrerId)
        return null; // no referral
    // Prevent self-referral
    const ordererUid = order.userId || order.uid;
    if (ordererUid && ordererUid === referrerId)
        return null;
    // Check if referrer already got a referral reward for this referee
    const existing = await db.collection('referral_rewards')
        .where('referrerId', '==', referrerId)
        .where('refereeOrderId', '==', context.params.orderId)
        .limit(1).get();
    if (!existing.empty)
        return null; // already rewarded
    // Generate unique coupon code for the referrer
    const couponCode = `REF${referrerId.slice(-5).toUpperCase()}${Date.now().toString(36).toUpperCase().slice(-3)}`;
    const couponEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const batch = db.batch();
    // Create referrer reward coupon
    const couponRef = db.collection('coupons').doc(couponCode);
    batch.set(couponRef, {
        code: couponCode,
        type: 'fixed',
        value: 100,
        isActive: true,
        usageLimit: 1,
        usageCount: 0,
        minPurchaseAmount: 0,
        startDate: admin.firestore.Timestamp.now(),
        endDate: admin.firestore.Timestamp.fromDate(couponEndDate),
        description: `Premio de referido — referidor: ${referrerId}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        autoGenerated: true,
        source: 'referral',
    });
    // Log the referral reward
    const rewardRef = db.collection('referral_rewards').doc();
    batch.set(rewardRef, {
        referrerId,
        refereeOrderId: context.params.orderId,
        refereeEmail: order.customerEmail || order.email || null,
        couponCode,
        value: 100,
        currency: 'MXN',
        status: 'issued',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Queue notification to referrer
    // Look up referrer email from customers/orders
    const referrerOrders = await db.collection('orders')
        .where('userId', '==', referrerId).limit(1).get();
    const referrerEmail = referrerOrders.empty
        ? null
        : referrerOrders.docs[0].data().customerEmail || referrerOrders.docs[0].data().email;
    if (referrerEmail) {
        const outboxRef = db.collection('notification_outbox').doc();
        batch.set(outboxRef, {
            channel: 'email',
            to: referrerEmail,
            type: 'referral_reward',
            couponCode,
            message: `¡Tu amigo realizó su primera compra! Aquí está tu recompensa de $100 MXN: ${couponCode}. Válido por 30 días.`,
            status: 'queued',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    console.log(`[Referral] Rewarded referrer ${referrerId} with coupon ${couponCode} for order ${context.params.orderId}`);
    return null;
});
// ═══════════════════════════════════════════════════════════════════════════════
// AMAZON SP-API INTEGRATION
// Auth: LWA-only (no SigV4 required since Oct 2, 2023)
// Marketplace: Mexico (A1AM78C64UM0Y8)  |  Region endpoint: sellingpartnerapi-na
// ═══════════════════════════════════════════════════════════════════════════════
const AMAZON_SP_BASE = 'https://sellingpartnerapi-na.amazon.com';
const AMAZON_LWA_URL = 'https://api.amazon.com/auth/o2/token';
const AMAZON_MX_MKT = 'A1AM78C64UM0Y8';
/** Reads Amazon SP-API config from config/integrations.amazon */
async function getAmazonConfig() {
    var _a;
    const doc = await db.collection('config').doc('integrations').get();
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
    const cacheRef = db.collection('config').doc('amazon_token_cache');
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
                const docRef = db.collection('orders').doc(`amz-${amzOrder.AmazonOrderId}`);
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
        await db.collection('amazon_sync_logs').add(Object.assign(Object.assign({ type: 'manual', status: result.errors > 0 ? 'partial' : 'success' }, result), { daysBack, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`[Amazon] Manual sync done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
        return Object.assign({ success: true }, result);
    }
    catch (e) {
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
exports.amazonSyncCron = functions.pubsub
    .schedule('*/30 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
    console.log('[Amazon] Cron sync started — last 2 days');
    try {
        const result = await runAmazonSync(2);
        await db.collection('amazon_sync_logs').add(Object.assign(Object.assign({ type: 'scheduled', status: result.errors > 0 ? 'partial' : 'success' }, result), { daysBack: 2, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`[Amazon] Cron done — imported:${result.imported} updated:${result.updated} errors:${result.errors}`);
    }
    catch (e) {
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
exports.amazonOAuthCallback = functions.https.onRequest(async (req, res) => {
    var _a, _b;
    const { spapi_oauth_code, state, selling_partner_id } = req.query;
    if (!spapi_oauth_code) {
        res.status(400).send('Missing spapi_oauth_code');
        return;
    }
    try {
        const doc = await db.collection('config').doc('integrations').get();
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
        await db.collection('config').doc('integrations').set({
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
exports.generateInvoice = functions
    .runWith({ timeoutSeconds: 90 })
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    return { success: false, message: 'Facturapi module temporarily disabled for MeLi data debugging.' };
});
// ─── Debug: Test MercadoLibre Billing Info ────────────────────────────────
exports.testMeliBilling = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).json({ error: 'MercadoLibre is not connected.' });
            return;
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=5`;
        const apiRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await apiRes.json();
        const meliOrders = json.results || [];
        const results = [];
        for (const mo of meliOrders) {
            let bDataV2 = null;
            let bDataV1 = null;
            // Try v2
            const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' }
            });
            if (bRes.ok) {
                bDataV2 = await bRes.json();
            }
            else {
                bDataV2 = { error: bRes.status, text: await bRes.text() };
            }
            // Try v1
            const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
            });
            if (bRes1.ok) {
                bDataV1 = await bRes1.json();
            }
            else {
                bDataV1 = { error: bRes1.status, text: await bRes1.text() };
            }
            results.push({
                orderId: mo.id,
                buyerName: ((_b = mo.buyer) === null || _b === void 0 ? void 0 : _b.nickname) || ((_c = mo.buyer) === null || _c === void 0 ? void 0 : _c.first_name),
                requestedInvoice: !!((_d = bDataV2 === null || bDataV2 === void 0 ? void 0 : bDataV2.billing_info) === null || _d === void 0 ? void 0 : _d.doc_number) && bDataV2.billing_info.doc_number.toUpperCase() !== 'XAXX010101000',
                rawBillingInfoV2: bDataV2,
                rawBillingInfoV1: bDataV1
            });
        }
        res.json({ success: true, disclaimer: "Raw MercadoLibre API Response", data: results });
    }
    catch (err) {
        console.error('Debug endpoint error:', err);
        res.status(500).json({ error: err.message });
    }
});
// ─── backfillOrdersToBigQuery — callable ──────────────────────────────────────
//
// Loads ALL historical orders + order_items into BigQuery tables.
// Tables: euro_analytics.orders  /  euro_analytics.order_items
// Both are DATE-partitioned (order_date) and clustered by source_channel.
//
// BigQuery is created on the fly if it doesn't exist.
// Run once after deploy; the dailyStats cron keeps it up to date thereafter.
//
// Returns: { ordersWritten, itemsWritten, dataset }
// ─────────────────────────────────────────────────────────────────────────────
const BQ_DATASET = 'euro_analytics';
const BQ_LOCATION = 'us-central1';
const BQ_ORDERS_SCHEMA = [
    { name: 'order_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'order_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'source_channel', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'total', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'state', type: 'STRING', mode: 'NULLABLE' },
    { name: 'city', type: 'STRING', mode: 'NULLABLE' },
    { name: 'customer_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'customer_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'item_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'fulfillment_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'payment_method', type: 'STRING', mode: 'NULLABLE' },
    { name: 'external_order_id', type: 'STRING', mode: 'NULLABLE' },
];
const BQ_ITEMS_SCHEMA = [
    { name: 'order_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'order_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'source_channel', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'sku', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'quantity', type: 'INT64', mode: 'NULLABLE' },
    { name: 'unit_price', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'subtotal', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'brand', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'asin', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ml_item_id', type: 'STRING', mode: 'NULLABLE' },
];
/** Resolves sourceChannel+fulfillmentType into the canonical BQ channel key. */
function resolveChannelBQ(order) {
    const sc = order.sourceChannel;
    const ft = order.fulfillmentType;
    if (!sc || sc === 'storefront')
        return 'WEB';
    if (sc === 'pos')
        return 'POS';
    if (sc === 'on_behalf')
        return 'ON_BEHALF';
    if (sc === 'amazon')
        return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
    if (sc === 'mercadolibre')
        return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
    return 'WEB';
}
/** Ensures the euro_analytics dataset and both tables exist (idempotent). */
async function ensureBQSchema() {
    const dataset = bigquery.dataset(BQ_DATASET, { location: BQ_LOCATION });
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
        await dataset.create({ location: BQ_LOCATION });
        console.log(`[BQ] Created dataset ${BQ_DATASET}`);
    }
    const ordersTable = dataset.table('orders');
    const [ordExists] = await ordersTable.exists();
    if (!ordExists) {
        await ordersTable.create({
            schema: BQ_ORDERS_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'order_date' },
            clustering: { fields: ['source_channel', 'status'] },
        });
        console.log('[BQ] Created table orders');
    }
    const itemsTable = dataset.table('order_items');
    const [itmExists] = await itemsTable.exists();
    if (!itmExists) {
        await itemsTable.create({
            schema: BQ_ITEMS_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'order_date' },
            clustering: { fields: ['source_channel', 'sku'] },
        });
        console.log('[BQ] Created table order_items');
    }
}
exports.backfillOrdersToBigQuery = functions
    .runWith({ timeoutSeconds: 540, memory: '2GB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const NON_REVENUE = ['pending_payment', 'payment_failed'];
    const toMxDate = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    const fromDate = (data === null || data === void 0 ? void 0 : data.fromDate)
        ? new Date(data.fromDate + 'T06:00:00')
        : new Date('2023-01-01T06:00:00'); // default: start of 2023
    const toDate = new Date();
    // Ensure BQ dataset + tables exist
    await ensureBQSchema();
    // Optionally clear existing data for a clean backfill
    if (data === null || data === void 0 ? void 0 : data.deleteFirst) {
        const dataset = bigquery.dataset(BQ_DATASET);
        const fromStr = fromDate.toLocaleDateString('sv-SE');
        const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
        await bigquery.query({
            query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.orders\` WHERE order_date >= CAST(@fromDate AS DATE)`,
            params: { fromDate: fromStr }, location: BQ_LOCATION,
        });
        await bigquery.query({
            query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.order_items\` WHERE order_date >= CAST(@fromDate AS DATE)`,
            params: { fromDate: fromStr }, location: BQ_LOCATION,
        });
        console.log(`[BQ Backfill] Cleared existing data from ${fromStr}`);
    }
    // Load all orders in range
    const snap = await db.collection('orders')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
        .get();
    console.log(`[BQ Backfill] Loaded ${snap.size} orders from Firestore`);
    const orderRows = [];
    const itemRows = [];
    for (const docSnap of snap.docs) {
        const o = docSnap.data();
        const orderId = docSnap.id;
        // Skip truly ghost orders — but keep cancelled/refunded so analytics
        // can answer "what % of orders were cancelled?"
        if (NON_REVENUE.includes(o['status']))
            continue;
        const createdAt = (_a = o['createdAt']) === null || _a === void 0 ? void 0 : _a.toDate();
        const orderDate = toMxDate(createdAt !== null && createdAt !== void 0 ? createdAt : new Date());
        const channel = resolveChannelBQ(o);
        const items = (_b = o['items']) !== null && _b !== void 0 ? _b : [];
        orderRows.push({
            order_id: orderId,
            order_date: orderDate,
            created_at: (_c = createdAt === null || createdAt === void 0 ? void 0 : createdAt.toISOString()) !== null && _c !== void 0 ? _c : null,
            source_channel: channel,
            status: (_d = o['status']) !== null && _d !== void 0 ? _d : null,
            total: Number((_e = o['total']) !== null && _e !== void 0 ? _e : 0),
            state: (_g = (_f = o['shippingAddress']) === null || _f === void 0 ? void 0 : _f.state) !== null && _g !== void 0 ? _g : null,
            city: (_j = (_h = o['shippingAddress']) === null || _h === void 0 ? void 0 : _h.city) !== null && _j !== void 0 ? _j : null,
            customer_id: (_l = (_k = o['customer']) === null || _k === void 0 ? void 0 : _k.id) !== null && _l !== void 0 ? _l : null,
            customer_name: (_o = (_m = o['customer']) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : null,
            item_count: items.length,
            fulfillment_type: (_p = o['fulfillmentType']) !== null && _p !== void 0 ? _p : null,
            payment_method: (_q = o['paymentMethod']) !== null && _q !== void 0 ? _q : null,
            external_order_id: (_r = o['externalOrderId']) !== null && _r !== void 0 ? _r : null,
        });
        for (const item of items) {
            const unitPrice = Number((_t = (_s = item.price) !== null && _s !== void 0 ? _s : item.unitPrice) !== null && _t !== void 0 ? _t : 0);
            const qty = Number((_u = item.quantity) !== null && _u !== void 0 ? _u : 1);
            itemRows.push({
                order_id: orderId,
                order_date: orderDate,
                source_channel: channel,
                status: (_v = o['status']) !== null && _v !== void 0 ? _v : null,
                sku: (_w = item.sku) !== null && _w !== void 0 ? _w : null,
                product_name: (_y = (_x = item.productName) !== null && _x !== void 0 ? _x : item.name) !== null && _y !== void 0 ? _y : null,
                quantity: qty,
                unit_price: unitPrice,
                subtotal: Number((_z = item.subtotal) !== null && _z !== void 0 ? _z : (unitPrice * qty)),
                brand: (_0 = item.brand) !== null && _0 !== void 0 ? _0 : null,
                product_id: (_1 = item.productId) !== null && _1 !== void 0 ? _1 : null,
                asin: (_2 = item.asin) !== null && _2 !== void 0 ? _2 : null,
                ml_item_id: (_3 = item.mlItemId) !== null && _3 !== void 0 ? _3 : null,
            });
        }
    }
    // Insert in batches of 500 (BQ streaming insert limit)
    const BATCH = 500;
    const ordersTable = bigquery.dataset(BQ_DATASET).table('orders');
    const itemsTable = bigquery.dataset(BQ_DATASET).table('order_items');
    for (let i = 0; i < orderRows.length; i += BATCH) {
        await ordersTable.insert(orderRows.slice(i, i + BATCH), { skipInvalidRows: true });
    }
    for (let i = 0; i < itemRows.length; i += BATCH) {
        await itemsTable.insert(itemRows.slice(i, i + BATCH), { skipInvalidRows: true });
    }
    console.log(`[BQ Backfill] Done. orders=${orderRows.length}, items=${itemRows.length}`);
    return { ordersWritten: orderRows.length, itemsWritten: itemRows.length, dataset: BQ_DATASET };
});
// ─── queryMetrics — callable ──────────────────────────────────────────────────
//
// General-purpose BigQuery analytics callable.
// Accepts { queryType, params } and returns typed result rows.
//
// Query types:
//   'productRevenue'  → top SKUs ranked by revenue
//   'geoBreakdown'    → revenue + orders grouped by state
//   'channelSku'      → SKU velocity per channel
//   'customerCohorts' → monthly cohort revenue (placeholder)
//
// All queries use date partitioning — only scans relevant slices.
// ─────────────────────────────────────────────────────────────────────────────
exports.queryMetrics = functions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { queryType, fromDate, toDate, channel, limit = 50 } = data;
    const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
    const DS = BQ_DATASET;
    // Revenue-positive statuses only — 'paid' = web/MP orders confirmed by webhook
    const REVENUE_STATUSES = `('pending','processing','shipped','delivered','completed','in_transit','picked_up','paid','refund_pending')`;
    let sql = '';
    let params = { fromDate, toDate, limit };
    switch (queryType) {
        // ── Top products by revenue in the period ─────────────────────────────
        case 'productRevenue':
            sql = `
                    SELECT
                        i.sku,
                        MAX(i.product_id) AS product_id,
                        i.product_name,
                        i.brand,
                        SUM(i.quantity)  AS total_units,
                        SUM(i.subtotal)  AS total_revenue,
                        COUNT(DISTINCT i.order_id) AS total_orders,
                        SUM(i.subtotal) / NULLIF(SUM(i.quantity), 0) AS avg_unit_price
                    FROM \`${PROJECT}.${DS}.order_items\` i
                    JOIN \`${PROJECT}.${DS}.orders\` o ON i.order_id = o.order_id
                    WHERE i.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND i.source_channel = @channel' : ''}
                    GROUP BY i.sku, i.product_name, i.brand
                    HAVING i.sku IS NOT NULL
                    ORDER BY total_revenue DESC
                    LIMIT @limit
                `;
            if (channel)
                params.channel = channel;
            break;
        // ── Revenue + orders grouped by shipping state ────────────────────────
        case 'geoBreakdown':
            sql = `
                    SELECT
                        COALESCE(o.state, '(Sin estado)') AS state,
                        COUNT(*)                                                       AS total_orders,
                        SUM(o.total)                                                   AS total_revenue,
                        AVG(o.total)                                                   AS avg_ticket,
                        SUM(o.item_count)                                              AS total_units,
                        COUNT(DISTINCT IF(o.customer_id IS NOT NULL, o.customer_id, NULL)) AS unique_customers
                    FROM \`${PROJECT}.${DS}.orders\` o
                    WHERE o.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND o.source_channel = @channel' : ''}
                    GROUP BY state
                    ORDER BY total_revenue DESC
                    LIMIT @limit
                `;
            if (channel)
                params.channel = channel;
            break;
        // ── SKU revenue broken down by channel ────────────────────────────────
        case 'channelSku':
            sql = `
                    SELECT
                        i.source_channel,
                        i.sku,
                        i.product_name,
                        SUM(i.quantity)  AS total_units,
                        SUM(i.subtotal)  AS total_revenue
                    FROM \`${PROJECT}.${DS}.order_items\` i
                    JOIN \`${PROJECT}.${DS}.orders\` o ON i.order_id = o.order_id
                    WHERE i.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND i.source_channel = @channel' : ''}
                    GROUP BY i.source_channel, i.sku, i.product_name
                    HAVING i.sku IS NOT NULL
                    ORDER BY i.source_channel, total_revenue DESC
                    LIMIT @limit
                `;
            if (channel)
                params.channel = channel;
            break;
        // ── Monthly revenue by first-purchase cohort month ────────────────────
        case 'customerCohorts':
            sql = `
                    WITH first_orders AS (
                        SELECT
                            customer_id,
                            MIN(order_date) AS first_order_date,
                            FORMAT_DATE('%Y-%m', MIN(order_date)) AS cohort_month
                        FROM \`${PROJECT}.${DS}.orders\`
                        WHERE customer_id IS NOT NULL
                          AND order_date BETWEEN @fromDate AND @toDate
                          AND status IN ${REVENUE_STATUSES}
                        GROUP BY customer_id
                    )
                    SELECT
                        fo.cohort_month,
                        FORMAT_DATE('%Y-%m', o.order_date) AS activity_month,
                        COUNT(DISTINCT o.customer_id)  AS customers,
                        SUM(o.total)                   AS revenue,
                        COUNT(DISTINCT o.order_id)     AS orders
                    FROM \`${PROJECT}.${DS}.orders\` o
                    JOIN first_orders fo ON o.customer_id = fo.customer_id
                    WHERE o.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                    GROUP BY fo.cohort_month, activity_month
                    ORDER BY fo.cohort_month, activity_month
                    LIMIT @limit
                `;
            break;
        // ── KPI summary by channel — replaces MetricsHub Firestore reads ────────
        case 'summaryKpis':
            sql = `
                    SELECT
                        source_channel,
                        SUM(total)                    AS revenue,
                        COUNT(DISTINCT order_id)      AS orders,
                        SUM(item_count)               AS units,
                        SAFE_DIVIDE(SUM(total), COUNT(DISTINCT order_id)) AS avg_ticket
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                      AND status IN ${REVENUE_STATUSES}
                    GROUP BY source_channel
                    ORDER BY revenue DESC
                `;
            break;
        // ── Cancellation + return rate by channel ─────────────────────────────
        case 'cancellationRate':
            sql = `
                    SELECT
                        source_channel,
                        COUNT(DISTINCT order_id)                                                          AS total_orders,
                        COUNT(DISTINCT CASE WHEN status IN ${REVENUE_STATUSES} THEN order_id END)         AS completed_orders,
                        COUNT(DISTINCT CASE WHEN status IN ('cancelled','refunded','returned') THEN order_id END) AS cancelled_orders,
                        SAFE_DIVIDE(
                            COUNT(DISTINCT CASE WHEN status IN ('cancelled','refunded','returned') THEN order_id END),
                            NULLIF(COUNT(DISTINCT order_id), 0)
                        ) AS cancellation_rate
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                    GROUP BY source_channel
                    ORDER BY completed_orders DESC
                `;
            break;
        case 'dailyTrend':
            sql = `
                    SELECT
                        order_date,
                        source_channel,
                        SUM(total)               AS revenue,
                        COUNT(DISTINCT order_id) AS orders,
                        SUM(item_count)          AS units
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                      AND status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND source_channel = @channel' : ''}
                    GROUP BY order_date, source_channel
                    ORDER BY order_date
                `;
            if (channel)
                params['channel'] = channel;
            break;
        default:
            throw new functions.https.HttpsError('invalid-argument', `Unknown queryType: ${queryType}`);
    }
    const [rows] = await bigquery.query({
        query: sql,
        params,
        location: BQ_LOCATION,
    });
    // Serialize BigQuery row values to plain JSON-safe JS primitives.
    // BigQuery INT64/FLOAT64 → { value: '123' }  → parse as number
    // BigQuery DATE/STRING   → { value: '2024-01-15' } → keep as string
    // NaN / Infinity are not JSON-serializable — replace with null.
    const serialize = (v) => {
        var _a;
        if (v == null)
            return null;
        if (typeof v === 'object' && 'value' in v) {
            // Try numeric; if NaN it's a DATE/STRING — return raw string
            const n = Number(v.value);
            return isFinite(n) ? n : ((_a = v.value) !== null && _a !== void 0 ? _a : null);
        }
        if (typeof v === 'number')
            return isFinite(v) ? v : null;
        return v;
    };
    const result = rows.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row))
            out[k] = serialize(v);
        return out;
    });
    return { queryType, fromDate, toDate, rowCount: result.length, rows: result };
});
/**
 * Upsert a conversation keyed by (channel + channelConversationId).
 * Returns the Firestore document ID.
 */
async function upsertConversation(data) {
    const snap = await db.collection('customer_conversations')
        .where('channel', '==', data.channel)
        .where('channelConversationId', '==', data.channelConversationId)
        .limit(1)
        .get();
    if (!snap.empty) {
        const ref = snap.docs[0].ref;
        // Refresh name/avatar in case they changed
        await ref.update({
            customerName: data.customerName,
            customerHandle: data.customerHandle,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return ref.id;
    }
    const ref = await db.collection('customer_conversations').add(Object.assign(Object.assign({}, data), { status: 'open', priority: 'normal', tags: [], unreadCount: 0, lastMessage: { text: '', direction: 'inbound', timestamp: admin.firestore.Timestamp.now() }, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    return ref.id;
}
/** Add a message to a conversation's subcollection and update the parent's lastMessage preview. */
async function addMessage(conversationId, msg) {
    var _a;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const msgRef = db.collection(`customer_conversations/${conversationId}/messages`).doc();
    await msgRef.set(Object.assign(Object.assign({}, msg), { timestamp: now }));
    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
    await db.collection('customer_conversations').doc(conversationId).update({
        lastMessage: {
            text: preview || (msg.type !== 'text' ? `[${msg.type}]` : ''),
            direction: msg.direction,
            timestamp: admin.firestore.Timestamp.now(),
            agentName: (_a = msg.sentByName) !== null && _a !== void 0 ? _a : null,
        },
        unreadCount: msg.direction === 'inbound'
            ? admin.firestore.FieldValue.increment(1)
            : 0,
        updatedAt: now,
    });
}
/** Resolve a Meta media URL to a public download link. */
async function resolveMetaMedia(mediaId, accessToken) {
    try {
        const r = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await r.json();
        return data === null || data === void 0 ? void 0 : data.url;
    }
    catch (_a) {
        return undefined;
    }
}
// ── Meta Webhook (WhatsApp + Instagram + Facebook Messenger) ─────────────────
// Single endpoint for all Meta platforms. Meta distinguishes them via `object` field.
// Webhook URL: https://us-central1-tiendapraxis.cloudfunctions.net/metaInboxWebhook
// Verify token: set in firebase functions:config:set meta.verify_token="..."
exports.metaInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26;
    // ── Verification handshake (GET) ──────────────────────────────────────────
    if (req.method === 'GET') {
        const verifyToken = (_b = (_a = functions.config().meta) === null || _a === void 0 ? void 0 : _a.verify_token) !== null && _b !== void 0 ? _b : process.env.META_VERIFY_TOKEN;
        if (req.query['hub.verify_token'] === verifyToken) {
            res.send(req.query['hub.challenge']);
        }
        else {
            res.sendStatus(403);
        }
        return;
    }
    // ── ACK immediately — Meta requires response < 5 s ───────────────────────
    res.sendStatus(200);
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.object))
        return;
    const waToken = (_e = (_d = (_c = functions.config().meta) === null || _c === void 0 ? void 0 : _c.wa_token) !== null && _d !== void 0 ? _d : process.env.WA_TOKEN) !== null && _e !== void 0 ? _e : '';
    try {
        if (body.object === 'whatsapp_business_account') {
            for (const entry of (_f = body.entry) !== null && _f !== void 0 ? _f : []) {
                for (const change of (_g = entry.changes) !== null && _g !== void 0 ? _g : []) {
                    const value = change.value;
                    for (const msg of (_h = value === null || value === void 0 ? void 0 : value.messages) !== null && _h !== void 0 ? _h : []) {
                        const phone = msg.from;
                        const contactName = (_m = (_l = (_k = (_j = value.contacts) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.profile) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : phone;
                        const convId = await upsertConversation({
                            channel: 'whatsapp',
                            channelConversationId: phone,
                            customerHandle: phone,
                            customerName: contactName,
                        });
                        let mediaUrl;
                        if ((_o = msg.image) === null || _o === void 0 ? void 0 : _o.id)
                            mediaUrl = await resolveMetaMedia(msg.image.id, waToken);
                        if ((_p = msg.document) === null || _p === void 0 ? void 0 : _p.id)
                            mediaUrl = await resolveMetaMedia(msg.document.id, waToken);
                        if ((_q = msg.audio) === null || _q === void 0 ? void 0 : _q.id)
                            mediaUrl = await resolveMetaMedia(msg.audio.id, waToken);
                        if ((_r = msg.video) === null || _r === void 0 ? void 0 : _r.id)
                            mediaUrl = await resolveMetaMedia(msg.video.id, waToken);
                        await addMessage(convId, {
                            direction: 'inbound',
                            type: msg.image ? 'image' : msg.document ? 'document' : msg.audio ? 'audio' : msg.video ? 'video' : 'text',
                            content: (_u = (_t = (_s = msg.text) === null || _s === void 0 ? void 0 : _s.body) !== null && _t !== void 0 ? _t : msg.caption) !== null && _u !== void 0 ? _u : '',
                            mediaUrl,
                            platformMessageId: msg.id,
                            status: 'received',
                        });
                    }
                }
            }
        }
        else if (body.object === 'instagram') {
            for (const entry of (_v = body.entry) !== null && _v !== void 0 ? _v : []) {
                for (const msgEvent of (_w = entry.messaging) !== null && _w !== void 0 ? _w : []) {
                    const senderId = String((_y = (_x = msgEvent.sender) === null || _x === void 0 ? void 0 : _x.id) !== null && _y !== void 0 ? _y : '');
                    const senderName = (_0 = (_z = msgEvent.sender) === null || _z === void 0 ? void 0 : _z.name) !== null && _0 !== void 0 ? _0 : `IG ${senderId}`;
                    if (!senderId)
                        continue;
                    const convId = await upsertConversation({
                        channel: 'instagram',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: senderName,
                    });
                    await addMessage(convId, {
                        direction: 'inbound',
                        type: ((_3 = (_2 = (_1 = msgEvent.message) === null || _1 === void 0 ? void 0 : _1.attachments) === null || _2 === void 0 ? void 0 : _2[0]) === null || _3 === void 0 ? void 0 : _3.type) === 'image' ? 'image' : 'text',
                        content: (_5 = (_4 = msgEvent.message) === null || _4 === void 0 ? void 0 : _4.text) !== null && _5 !== void 0 ? _5 : '',
                        mediaUrl: (_9 = (_8 = (_7 = (_6 = msgEvent.message) === null || _6 === void 0 ? void 0 : _6.attachments) === null || _7 === void 0 ? void 0 : _7[0]) === null || _8 === void 0 ? void 0 : _8.payload) === null || _9 === void 0 ? void 0 : _9.url,
                        platformMessageId: (_11 = (_10 = msgEvent.message) === null || _10 === void 0 ? void 0 : _10.mid) !== null && _11 !== void 0 ? _11 : `ig_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        }
        else if (body.object === 'page') {
            for (const entry of (_12 = body.entry) !== null && _12 !== void 0 ? _12 : []) {
                for (const msgEvent of (_13 = entry.messaging) !== null && _13 !== void 0 ? _13 : []) {
                    const senderId = String((_15 = (_14 = msgEvent.sender) === null || _14 === void 0 ? void 0 : _14.id) !== null && _15 !== void 0 ? _15 : '');
                    if (!senderId)
                        continue;
                    const convId = await upsertConversation({
                        channel: 'facebook',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: `FB ${senderId}`,
                    });
                    await addMessage(convId, {
                        direction: 'inbound',
                        type: ((_18 = (_17 = (_16 = msgEvent.message) === null || _16 === void 0 ? void 0 : _16.attachments) === null || _17 === void 0 ? void 0 : _17[0]) === null || _18 === void 0 ? void 0 : _18.type) === 'image' ? 'image' : 'text',
                        content: (_20 = (_19 = msgEvent.message) === null || _19 === void 0 ? void 0 : _19.text) !== null && _20 !== void 0 ? _20 : '',
                        mediaUrl: (_24 = (_23 = (_22 = (_21 = msgEvent.message) === null || _21 === void 0 ? void 0 : _21.attachments) === null || _22 === void 0 ? void 0 : _22[0]) === null || _23 === void 0 ? void 0 : _23.payload) === null || _24 === void 0 ? void 0 : _24.url,
                        platformMessageId: (_26 = (_25 = msgEvent.message) === null || _25 === void 0 ? void 0 : _25.mid) !== null && _26 !== void 0 ? _26 : `fb_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        }
    }
    catch (err) {
        console.error('[metaInboxWebhook] Error processing payload:', err);
    }
});
// ── Telegram Webhook ─────────────────────────────────────────────────────────
// Telegram Bot API — set webhook via:
// curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook"
// No approval needed — create bot instantly with @BotFather.
exports.telegramInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    res.sendStatus(200);
    const update = req.body;
    const msg = update.message || update.channel_post;
    if (!msg)
        return;
    const chatId = String(msg.chat.id);
    const firstName = (_b = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.first_name) !== null && _b !== void 0 ? _b : '';
    const lastName = (_d = (_c = msg.from) === null || _c === void 0 ? void 0 : _c.last_name) !== null && _d !== void 0 ? _d : '';
    const senderName = `${firstName} ${lastName}`.trim() || `Telegram ${chatId}`;
    const username = ((_e = msg.from) === null || _e === void 0 ? void 0 : _e.username) ? `@${msg.from.username}` : chatId;
    try {
        const convId = await upsertConversation({
            channel: 'telegram',
            channelConversationId: chatId,
            customerHandle: username,
            customerName: senderName,
        });
        await addMessage(convId, {
            direction: 'inbound',
            type: msg.photo ? 'image' : msg.document ? 'document' : msg.voice ? 'audio' : 'text',
            content: (_g = (_f = msg.text) !== null && _f !== void 0 ? _f : msg.caption) !== null && _g !== void 0 ? _g : '',
            platformMessageId: String(msg.message_id),
            status: 'received',
        });
    }
    catch (err) {
        console.error('[telegramInboxWebhook] Error:', err);
    }
});
// ── SendGrid Inbound Parse Webhook (Email) ────────────────────────────────────
// Configure SendGrid: Settings → Inbound Parse → Add Host & URL
// URL: https://us-central1-tiendapraxis.cloudfunctions.net/emailInboxWebhook
// Threads emails by sender address.
exports.emailInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    res.sendStatus(200);
    try {
        const from = String((_a = req.body.from) !== null && _a !== void 0 ? _a : '');
        const subject = String((_b = req.body.subject) !== null && _b !== void 0 ? _b : '(Sin asunto)');
        const text = String((_d = (_c = req.body.text) !== null && _c !== void 0 ? _c : req.body.html) !== null && _d !== void 0 ? _d : '');
        const envelope = JSON.parse(req.body.envelope || '{}');
        const fromEmail = String((_e = envelope.from) !== null && _e !== void 0 ? _e : from);
        // Extract display name: "Juan García <juan@example.com>" → "Juan García"
        const nameMatch = from.match(/^([^<]+)</);
        const displayName = nameMatch ? nameMatch[1].trim() : fromEmail;
        const convId = await upsertConversation({
            channel: 'email',
            channelConversationId: fromEmail,
            customerHandle: fromEmail,
            customerName: displayName || fromEmail,
        });
        await addMessage(convId, {
            direction: 'inbound',
            type: 'text',
            content: `**${subject}**\n\n${text.slice(0, 2000)}`,
            platformMessageId: String((_f = req.body['message-id']) !== null && _f !== void 0 ? _f : `email_${Date.now()}`),
            status: 'received',
        });
    }
    catch (err) {
        console.error('[emailInboxWebhook] Error:', err);
    }
});
// ── Apply Inbox Channel Config ────────────────────────────────────────────────
// Callable: receives channel credentials from the admin UI and stores them
// securely in Firestore (admin-only collection) so the webhook functions can
// read them at runtime. This removes the need for CLI-based config:set.
exports.applyInboxChannelConfig = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    // Only SUPER_ADMIN / ADMIN can apply channel configs
    const profileSnap = await db.collection('users').doc(context.auth.uid).get();
    const role = (_b = (_a = profileSnap.data()) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : '';
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }
    const { channel, creds } = data !== null && data !== void 0 ? data : {};
    if (!channel || typeof creds !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'channel and creds required.');
    }
    // Store credentials in a secure admin-only Firestore document
    // (protected by Firestore rules — only service account can read)
    await db.collection('config').doc('inbox_credentials').set({ [channel]: creds, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    // For Telegram: auto-register the webhook immediately using the provided bot token
    if (channel === 'telegram' && creds.botToken) {
        const webhookUrl = `https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook`;
        try {
            const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
            const json = await res.json();
            if (!json.ok) {
                console.warn('[applyInboxChannelConfig] Telegram setWebhook warning:', json.description);
            }
            else {
                console.log('[applyInboxChannelConfig] Telegram webhook registered successfully.');
            }
        }
        catch (err) {
            console.error('[applyInboxChannelConfig] Telegram setWebhook error:', err);
            // Don't throw — creds are saved even if webhook registration fails
        }
    }
    return { success: true, channel };
});
// ── Send Inbox Reply ─────────────────────────────────────────────────────────
// Callable from internal app. Routes the reply to the correct platform API.
exports.sendInboxReply = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const { conversationId, message } = data !== null && data !== void 0 ? data : {};
    if (!conversationId || !(message === null || message === void 0 ? void 0 : message.trim()))
        throw new functions.https.HttpsError('invalid-argument', 'conversationId and message required.');
    const convSnap = await db.collection('customer_conversations').doc(conversationId).get();
    if (!convSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Conversation not found.');
    const conv = convSnap.data();
    const channel = conv.channel;
    const handle = conv.customerHandle;
    const agentName = (_b = (_a = context.auth.token.name) !== null && _a !== void 0 ? _a : context.auth.token.email) !== null && _b !== void 0 ? _b : 'Soporte';
    const agentUid = context.auth.uid;
    // ── Send via platform ──────────────────────────────────────────────────────
    let sent = false;
    // ── Website channel: direct Firestore write ──────────────────────────────
    // The storefront chat widget listens in real time — no external API needed.
    if (channel === 'website') {
        await addMessage(conversationId, {
            direction: 'outbound',
            type: 'text',
            content: message,
            sentBy: agentUid,
            sentByName: agentName,
            platformMessageId: `web_reply_${Date.now()}`,
            status: 'sent',
        });
        // Keep conversation open (visitor may reply further)
        await db.collection('customer_conversations').doc(conversationId).update({
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
    }
    // ── Load credentials from Firestore (saved via applyInboxChannelConfig) ──────
    let firestoreCreds = {};
    try {
        const credsSnap = await db.collection('config').doc('inbox_credentials').get();
        if (credsSnap.exists)
            firestoreCreds = ((_c = credsSnap.data()) !== null && _c !== void 0 ? _c : {});
    }
    catch ( /* continue with functions.config() fallback */_d) { /* continue with functions.config() fallback */ }
    const getCred = (channel, key, envFallback) => { var _a, _b, _c, _d, _e; return (_e = (_d = (_b = (_a = firestoreCreds[channel]) === null || _a === void 0 ? void 0 : _a[key]) !== null && _b !== void 0 ? _b : (_c = functions.config()[channel]) === null || _c === void 0 ? void 0 : _c[key]) !== null && _d !== void 0 ? _d : process.env[envFallback]) !== null && _e !== void 0 ? _e : ''; };
    if (channel === 'whatsapp') {
        const waToken = getCred('whatsapp', 'waToken', 'WA_TOKEN') || getCred('meta', 'wa_token', 'WA_TOKEN');
        const waPhoneId = getCred('whatsapp', 'waPhoneId', 'WA_PHONE_ID') || getCred('meta', 'wa_phone_id', 'WA_PHONE_ID');
        const r = await fetch(`https://graph.facebook.com/v19.0/${waPhoneId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: handle,
                type: 'text',
                text: { body: message }
            })
        });
        sent = r.ok;
    }
    else if (channel === 'telegram') {
        const botToken = getCred('telegram', 'botToken', 'TELEGRAM_BOT_TOKEN') || getCred('telegram', 'bot_token', 'TELEGRAM_BOT_TOKEN');
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: handle, text: message })
        });
        sent = r.ok;
    }
    else if (channel === 'email') {
        const sgKey = getCred('email', 'sendgridKey', 'SENDGRID_API_KEY') || getCred('sendgrid', 'api_key', 'SENDGRID_API_KEY');
        const replyFrom = getCred('email', 'replyFrom', 'SENDGRID_REPLY_FROM') || getCred('sendgrid', 'reply_from', 'SENDGRID_REPLY_FROM') || 'soporte@importadoraeuro.com';
        const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sgKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: handle }] }],
                from: { email: replyFrom, name: 'Importadora Euro' },
                subject: 'Re: Tu consulta',
                content: [{ type: 'text/plain', value: message }]
            })
        });
        sent = r.ok;
    }
    else if (channel === 'instagram' || channel === 'facebook') {
        const pageToken = channel === 'instagram'
            ? (getCred('instagram', 'igToken', 'IG_TOKEN') || getCred('meta', 'ig_token', 'IG_TOKEN'))
            : (getCred('facebook', 'fbPageToken', 'FB_PAGE_TOKEN') || getCred('meta', 'fb_page_token', 'FB_PAGE_TOKEN'));
        const r = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: handle },
                message: { text: message }
            })
        });
        sent = r.ok;
    }
    // ── Log outbound message ───────────────────────────────────────────────────
    await addMessage(conversationId, {
        direction: 'outbound',
        type: 'text',
        content: message,
        sentBy: agentUid,
        sentByName: agentName,
        platformMessageId: `out_${Date.now()}`,
        status: sent ? 'sent' : 'failed',
        errorReason: sent ? undefined : 'Platform API error',
    });
    // Move conversation to pending (awaiting customer reply)
    await db.collection('customer_conversations').doc(conversationId).update({
        status: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: sent };
});
// ─── appendOrderToBigQuery — internal helper ──────────────────────────────────
//
// Called from the dailyStats cron after its Firestore writes.
// Streams today's newly created orders into BigQuery.
// This keeps BQ current without requiring manual backfills.
// ─────────────────────────────────────────────────────────────────────────────
async function appendOrdersToBQForDate(dateStr, ordersData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    try {
        await ensureBQSchema();
        // DELETION FIRST TO ENSURE IDEMPOTENCY (ROLLING WINDOW SYNC)
        try {
            const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.orders\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.order_items\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
        }
        catch (delErr) {
            // If the deletion fails because of the BigQuery Streaming Buffer restriction 
            // ("UPDATE or DELETE statement over table ... would modify rows in the streaming buffer")
            // we MUST return early and skip insertion to avoid duplicating data. 
            // The buffer clears after ~90 minutes, and the next cron run will succeed.
            console.warn(`[BQ Append] Deletion skipped for ${dateStr} (Likely streaming buffer or schema mismatch):`, delErr.message);
            return;
        }
        if (ordersData.length === 0) {
            console.log(`[BQ Append] ${dateStr}: orders=0, items=0 (Cleared previous data)`);
            return;
        }
        const orderRows = [];
        const itemRows = [];
        for (const { orderId, order, channel } of ordersData) {
            const createdAt = (_a = order['createdAt']) === null || _a === void 0 ? void 0 : _a.toDate();
            const items = (_b = order['items']) !== null && _b !== void 0 ? _b : [];
            orderRows.push({
                order_id: orderId,
                order_date: dateStr,
                created_at: (_c = createdAt === null || createdAt === void 0 ? void 0 : createdAt.toISOString()) !== null && _c !== void 0 ? _c : null,
                source_channel: channel,
                status: (_d = order['status']) !== null && _d !== void 0 ? _d : null,
                total: Number((_e = order['total']) !== null && _e !== void 0 ? _e : 0),
                state: (_g = (_f = order['shippingAddress']) === null || _f === void 0 ? void 0 : _f.state) !== null && _g !== void 0 ? _g : null,
                city: (_j = (_h = order['shippingAddress']) === null || _h === void 0 ? void 0 : _h.city) !== null && _j !== void 0 ? _j : null,
                customer_id: (_l = (_k = order['customer']) === null || _k === void 0 ? void 0 : _k.id) !== null && _l !== void 0 ? _l : null,
                customer_name: (_o = (_m = order['customer']) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : null,
                item_count: items.length,
                fulfillment_type: (_p = order['fulfillmentType']) !== null && _p !== void 0 ? _p : null,
                payment_method: (_q = order['paymentMethod']) !== null && _q !== void 0 ? _q : null,
                external_order_id: (_r = order['externalOrderId']) !== null && _r !== void 0 ? _r : null,
            });
            for (const item of items) {
                const unitPrice = Number((_t = (_s = item.price) !== null && _s !== void 0 ? _s : item.unitPrice) !== null && _t !== void 0 ? _t : 0);
                const qty = Number((_u = item.quantity) !== null && _u !== void 0 ? _u : 1);
                itemRows.push({
                    order_id: orderId,
                    order_date: dateStr,
                    source_channel: channel,
                    status: (_v = order['status']) !== null && _v !== void 0 ? _v : null,
                    sku: (_w = item.sku) !== null && _w !== void 0 ? _w : null,
                    product_name: (_y = (_x = item.productName) !== null && _x !== void 0 ? _x : item.name) !== null && _y !== void 0 ? _y : null,
                    quantity: qty,
                    unit_price: unitPrice,
                    subtotal: Number((_z = item.subtotal) !== null && _z !== void 0 ? _z : (unitPrice * qty)),
                    brand: (_0 = item.brand) !== null && _0 !== void 0 ? _0 : null,
                    product_id: (_1 = item.productId) !== null && _1 !== void 0 ? _1 : null,
                    asin: (_2 = item.asin) !== null && _2 !== void 0 ? _2 : null,
                    ml_item_id: (_3 = item.mlItemId) !== null && _3 !== void 0 ? _3 : null,
                });
            }
        }
        if (orderRows.length === 0)
            return;
        const BATCH = 500;
        const ordTable = bigquery.dataset(BQ_DATASET).table('orders');
        const itmTable = bigquery.dataset(BQ_DATASET).table('order_items');
        for (let i = 0; i < orderRows.length; i += BATCH) {
            await ordTable.insert(orderRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        for (let i = 0; i < itemRows.length; i += BATCH) {
            await itmTable.insert(itemRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        console.log(`[BQ Append] ${dateStr}: orders=${orderRows.length}, items=${itemRows.length}`);
    }
    catch (bqErr) {
        // Non-critical: BQ is analytics layer — don't let it fail the Firestore cron
        console.error('[BQ Append] Failed (non-critical):', bqErr);
    }
}
exports.appendOrdersToBQForDate = appendOrdersToBQForDate;
// ═══════════════════════════════════════════════════════════════════════════════
// ─── SEARCH ANALYTICS — BigQuery Infrastructure ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Table: euro_analytics.search_events
// Partitioned by event_date (DATE), clustered by event_type then normalized_term.
//
// Real-time ingestion: onSearchEventCreated (Firestore trigger) → BQ insert
// Backfill:           backfillSearchEventsToBigQuery (callable, one-time)
// Reporting:          querySearchAnalytics (callable, 6 query types)
// ─────────────────────────────────────────────────────────────────────────────
const BQ_SEARCH_TABLE = 'search_events';
const BQ_SEARCH_SCHEMA = [
    { name: 'event_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'event_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'event_timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'event_type', type: 'STRING', mode: 'REQUIRED' },
    { name: 'term', type: 'STRING', mode: 'NULLABLE' },
    { name: 'normalized_term', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'source', type: 'STRING', mode: 'NULLABLE' },
    { name: 'channel', type: 'STRING', mode: 'NULLABLE' },
    // query fields
    { name: 'result_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'has_results', type: 'BOOL', mode: 'NULLABLE' },
    // click fields
    { name: 'product_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'click_position', type: 'INT64', mode: 'NULLABLE' },
    // exit fields
    { name: 'exit_reason', type: 'STRING', mode: 'NULLABLE' },
    { name: 'dwell_ms', type: 'INT64', mode: 'NULLABLE' },
    // add_to_cart fields
    { name: 'cart_value', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'quantity', type: 'INT64', mode: 'NULLABLE' },
    // purchase fields
    { name: 'order_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'revenue', type: 'FLOAT64', mode: 'NULLABLE' },
];
/** Ensures the euro_analytics.search_events table exists with the full schema (idempotent). */
async function ensureSearchBQSchema() {
    const dataset = bigquery.dataset(BQ_DATASET, { location: BQ_LOCATION });
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
        await dataset.create({ location: BQ_LOCATION });
        console.log(`[SearchBQ] Created dataset ${BQ_DATASET}`);
    }
    const table = dataset.table(BQ_SEARCH_TABLE);
    const [tblExists] = await table.exists();
    if (!tblExists) {
        await table.create({
            schema: BQ_SEARCH_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'event_date' },
            clustering: { fields: ['event_type', 'normalized_term'] },
            location: BQ_LOCATION,
        });
        console.log(`[SearchBQ] Created table ${BQ_DATASET}.${BQ_SEARCH_TABLE}`);
    }
}
/** Converts a Firestore search_events document into a flat BQ row. */
function searchEventToBQRow(docId, data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    // Resolve event_date from Firestore Timestamp
    const ts = (_a = data.timestamp) !== null && _a !== void 0 ? _a : null;
    const date = ts ? ts.toDate() : new Date();
    const eventDate = date.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    return {
        event_id: docId,
        event_date: eventDate,
        event_timestamp: date.toISOString(),
        event_type: (_b = data.type) !== null && _b !== void 0 ? _b : null,
        term: (_c = data.term) !== null && _c !== void 0 ? _c : null,
        normalized_term: (_d = data.normalizedTerm) !== null && _d !== void 0 ? _d : null,
        session_id: (_e = data.sessionId) !== null && _e !== void 0 ? _e : null,
        user_id: (_f = data.userId) !== null && _f !== void 0 ? _f : null,
        source: (_g = data.source) !== null && _g !== void 0 ? _g : null,
        channel: (_h = data.channel) !== null && _h !== void 0 ? _h : null,
        // query
        result_count: data.resultCount != null ? Number(data.resultCount) : null,
        has_results: data.hasResults != null ? Boolean(data.hasResults) : null,
        // click
        product_id: (_j = data.productId) !== null && _j !== void 0 ? _j : null,
        product_name: (_k = data.productName) !== null && _k !== void 0 ? _k : null,
        click_position: data.position != null ? Number(data.position) : null,
        // exit
        exit_reason: (_l = data.exitReason) !== null && _l !== void 0 ? _l : null,
        dwell_ms: data.dwellMs != null ? Number(data.dwellMs) : null,
        // add_to_cart
        cart_value: data.cartValue != null ? Number(data.cartValue) : null,
        quantity: data.quantity != null ? Number(data.quantity) : null,
        // purchase
        order_id: (_m = data.orderId) !== null && _m !== void 0 ? _m : null,
        revenue: data.revenue != null ? Number(data.revenue) : null,
    };
}
// ─── onSearchEventCreated — Firestore trigger (real-time BQ streaming) ─────────
//
// Fires on every new doc in search_events and inserts it into BQ.
// This keeps the analytics table current without any manual steps.
// ─────────────────────────────────────────────────────────────────────────────
exports.onSearchEventCreated = functions
    .runWith({ timeoutSeconds: 30 })
    .firestore
    .document('search_events/{eventId}')
    .onCreate(async (snap, context) => {
    const data = snap.data();
    const docId = context.params.eventId;
    try {
        await ensureSearchBQSchema();
        const row = searchEventToBQRow(docId, data);
        await bigquery.dataset(BQ_DATASET).table(BQ_SEARCH_TABLE).insert([row], { skipInvalidRows: true });
        console.log(`[SearchBQ] Streamed event ${docId} (type=${data.type})`);
    }
    catch (err) {
        // Non-critical — BQ is analytics layer; don't block the write
        console.error('[SearchBQ] Failed to stream event to BQ:', err);
    }
});
// ─── backfillSearchEventsToBigQuery — callable ────────────────────────────────
//
// One-time (or re-runnable) callable to seed ALL historical search_events
// into BigQuery. Uses pagination to handle large collections.
//
// Returns: { inserted, skipped, errors }
// ─────────────────────────────────────────────────────────────────────────────
exports.backfillSearchEventsToBigQuery = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (_data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    console.log('[SearchBQ Backfill] Starting...');
    await ensureSearchBQSchema();
    const table = bigquery.dataset(BQ_DATASET).table(BQ_SEARCH_TABLE);
    const BATCH_SIZE = 500;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    // Paginate through all search_events docs
    let query = db.collection('search_events').orderBy('timestamp').limit(BATCH_SIZE);
    let lastDoc = null;
    while (true) {
        const snap = lastDoc
            ? await query.startAfter(lastDoc).get()
            : await query.get();
        if (snap.empty)
            break;
        const rows = snap.docs.map((d) => searchEventToBQRow(d.id, d.data()));
        try {
            await table.insert(rows, { skipInvalidRows: true, raw: false });
            inserted += rows.length;
        }
        catch (err) {
            // BigQuery insert errors are per-row — count them but continue
            const rowErrors = (_b = (_a = err === null || err === void 0 ? void 0 : err.errors) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : rows.length;
            errors += rowErrors;
            inserted += rows.length - rowErrors;
            console.error(`[SearchBQ Backfill] Batch error:`, err === null || err === void 0 ? void 0 : err.message);
        }
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < BATCH_SIZE)
            break;
    }
    console.log(`[SearchBQ Backfill] Done — inserted=${inserted}, skipped=${skipped}, errors=${errors}`);
    return { inserted, skipped, errors };
});
// ─── querySearchAnalytics — callable ─────────────────────────────────────────
//
// General-purpose search analytics callable. Accepts { queryType, params }
// and returns typed result rows from BigQuery.
//
// Query types:
//   'funnel'            → 5-step conversion funnel (query→click→exit→cart→purchase)
//   'topTerms'          → top search terms ranked by volume + CTR + null-result %
//   'zeroResults'       → terms that returned 0 results (catalog gap analysis)
//   'heatmap'           → search volume by hour-of-day × day-of-week
//   'trendingTerms'     → rising terms: 7-day vs 30-day baseline velocity
//   'revenueAttribution'→ search-attributed revenue by term (via sessionId joins)
// ─────────────────────────────────────────────────────────────────────────────
exports.querySearchAnalytics = functions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { queryType, fromDate, toDate, limit = 50 } = data;
    const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
    const DS = BQ_DATASET;
    const TBL = `\`${PROJECT}.${DS}.${BQ_SEARCH_TABLE}\``;
    let sql = '';
    const params = { fromDate, toDate, limit };
    switch (queryType) {
        // ── 1. Conversion Funnel ─────────────────────────────────────────────────
        // Shows total events per step + conversion rates between consecutive steps.
        case 'funnel':
            sql = `
                    SELECT
                        event_type,
                        COUNT(*)                          AS event_count,
                        COUNT(DISTINCT session_id)        AS unique_sessions,
                        COUNT(DISTINCT user_id)           AS unique_users
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                    GROUP BY event_type
                    ORDER BY
                        CASE event_type
                            WHEN 'query'       THEN 1
                            WHEN 'click'       THEN 2
                            WHEN 'exit'        THEN 3
                            WHEN 'add_to_cart' THEN 4
                            WHEN 'purchase'    THEN 5
                            ELSE 6
                        END
                `;
            break;
        // ── 2. Top Search Terms ──────────────────────────────────────────────────
        // Ranked by search volume. Includes CTR, zero-result %, avg position.
        case 'topTerms':
            sql = `
                    WITH
                    -- Apply same normalization as the storefront normalizeTerm():
                    -- strip trailing special chars, collapse spaces.
                    -- This merges historical variants like '130/90\' and '130/90?' into '130/90'.
                    cleaned AS (
                        SELECT
                            *,
                            TRIM(REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(LOWER(TRIM(normalized_term)), r'[\\\\?!.,;:*+]+$', ''),
                                r"['\'\`]+$", ''),
                            r'\\s+', ' ')) AS clean_term
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND normalized_term IS NOT NULL
                    ),
                    queries AS (
                        SELECT
                            clean_term                                                        AS normalized_term,
                            COUNT(*)                                                          AS searches,
                            COUNT(DISTINCT session_id)                                        AS unique_sessions,
                            COUNTIF(has_results = FALSE)                                      AS zero_result_searches,
                            SAFE_DIVIDE(COUNTIF(has_results = FALSE), COUNT(*))               AS zero_result_rate,
                            AVG(CAST(result_count AS FLOAT64))                                AS avg_result_count,
                            COUNT(DISTINCT normalized_term)                                   AS variants
                        FROM cleaned
                        WHERE event_type = 'query'
                        GROUP BY clean_term
                    ),
                    clicks AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS clicks, AVG(click_position) AS avg_position
                        FROM cleaned
                        WHERE event_type = 'click'
                        GROUP BY clean_term
                    ),
                    carts AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS cart_adds
                        FROM cleaned
                        WHERE event_type = 'add_to_cart'
                        GROUP BY clean_term
                    ),
                    purchases AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS conversions, SUM(revenue) AS attributed_revenue
                        FROM cleaned
                        WHERE event_type = 'purchase'
                        GROUP BY clean_term
                    )
                    SELECT
                        q.normalized_term                                          AS term,
                        q.searches,
                        q.unique_sessions,
                        COALESCE(c.clicks, 0)                                      AS clicks,
                        SAFE_DIVIDE(COALESCE(c.clicks, 0), q.searches)            AS ctr,
                        q.zero_result_searches,
                        q.zero_result_rate,
                        q.avg_result_count,
                        COALESCE(ca.cart_adds, 0)                                 AS cart_adds,
                        COALESCE(p.conversions, 0)                                AS conversions,
                        COALESCE(p.attributed_revenue, 0)                         AS attributed_revenue,
                        COALESCE(c.avg_position, 0)                               AS avg_click_position,
                        q.variants
                    FROM queries q
                    LEFT JOIN clicks    c  ON q.normalized_term = c.normalized_term
                    LEFT JOIN carts     ca ON q.normalized_term = ca.normalized_term
                    LEFT JOIN purchases p  ON q.normalized_term = p.normalized_term
                    -- Suppress 1-count terms: mostly partial mid-type queries (user was still typing)
                    HAVING q.searches >= 2
                    ORDER BY q.searches DESC
                    LIMIT @limit
                `;
            break;
        // ── 3. Zero-Result Terms (Catalog Gap Analysis) ──────────────────────────
        // Pure list of terms where has_results = false. Sorted by frequency.
        case 'zeroResults':
            sql = `
                    WITH cleaned AS (
                        SELECT
                            *,
                            TRIM(REGEXP_REPLACE(
                            TRIM(REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(LOWER(TRIM(normalized_term)), r'[\\\\?!.,;:*+]+$', ''),
                                r"['\'\`]+$", ''),
                            r'\\s+', ' ')) AS clean_term
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND normalized_term IS NOT NULL
                    )
                    SELECT
                        clean_term                       AS term,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions,
                        COUNT(DISTINCT user_id)          AS unique_users,
                        MIN(event_date)                  AS first_seen,
                        MAX(event_date)                  AS last_seen
                    FROM cleaned
                    WHERE event_type = 'query'
                      AND has_results = FALSE
                    GROUP BY clean_term
                    HAVING searches >= 2
                    ORDER BY searches DESC
                    LIMIT @limit
                `;
            break;
        // ── 4. Search Heatmap (hour-of-day × day-of-week) ───────────────────────
        // Returns 7×24 = 168 cells, each with search count. Used for a heatmap widget.
        // Mexico City time (UTC-6).
        case 'heatmap':
            sql = `
                    SELECT
                        EXTRACT(DAYOFWEEK FROM DATETIME(event_timestamp, 'America/Mexico_City')) AS day_of_week,
                        EXTRACT(HOUR     FROM DATETIME(event_timestamp, 'America/Mexico_City')) AS hour_of_day,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                      AND event_type = 'query'
                    GROUP BY day_of_week, hour_of_day
                    ORDER BY day_of_week, hour_of_day
                `;
            break;
        // ── 4b. Daily Volume (calendar heatmap for 30d / MTD) ────────────────────
        // Returns one row per calendar date with total search volume.
        // Used to render a month-calendar heatmap on 30d/MTD ranges.
        case 'dailyVolume':
            sql = `
                    SELECT
                        event_date                       AS event_date,
                        EXTRACT(DAYOFWEEK FROM PARSE_DATE('%Y-%m-%d', CAST(event_date AS STRING))) AS day_of_week,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                      AND event_type = 'query'
                    GROUP BY event_date
                    ORDER BY event_date
                `;
            break;
        // ── 5. Trending Terms (7-day vs 30-day baseline velocity) ────────────────
        // Identifies terms whose recent volume is significantly above their baseline.
        // velocity_ratio > 1.5 = trending up; < 0.5 = declining.
        case 'trendingTerms':
            sql = `
                    WITH baseline AS (
                        SELECT
                            normalized_term,
                            COUNT(*) / 30.0   AS daily_avg_30d
                        FROM ${TBL}
                        WHERE event_date BETWEEN
                                DATE_SUB(CURRENT_DATE('America/Mexico_City'), INTERVAL 30 DAY)
                              AND CURRENT_DATE('America/Mexico_City')
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    ),
                    recent AS (
                        SELECT
                            normalized_term,
                            COUNT(*) / 7.0   AS daily_avg_7d
                        FROM ${TBL}
                        WHERE event_date BETWEEN
                                DATE_SUB(CURRENT_DATE('America/Mexico_City'), INTERVAL 7 DAY)
                              AND CURRENT_DATE('America/Mexico_City')
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    )
                    SELECT
                        r.normalized_term                                        AS term,
                        r.daily_avg_7d,
                        b.daily_avg_30d,
                        SAFE_DIVIDE(r.daily_avg_7d, NULLIF(b.daily_avg_30d, 0)) AS velocity_ratio,
                        ROUND(r.daily_avg_7d * 7)                               AS searches_7d,
                        ROUND(b.daily_avg_30d * 30)                             AS searches_30d
                    FROM recent r
                    JOIN baseline b ON r.normalized_term = b.normalized_term
                    WHERE r.daily_avg_7d >= 1.0  -- filter noise (at least 1/day recently)
                    ORDER BY velocity_ratio DESC
                    LIMIT @limit
                `;
            break;
        // ── 6. Search-Attributed Revenue ─────────────────────────────────────────
        // Revenue attributed to searches via the purchase event's session.
        // This is the most direct "search drove this sale" metric.
        case 'revenueAttribution':
            sql = `
                    WITH purchase_events AS (
                        SELECT
                            normalized_term,
                            session_id,
                            order_id,
                            revenue,
                            event_date
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND event_type = 'purchase'
                          AND normalized_term IS NOT NULL
                    ),
                    term_stats AS (
                        SELECT
                            normalized_term                  AS term,
                            COUNT(DISTINCT order_id)         AS attributed_orders,
                            SUM(revenue)                     AS attributed_revenue,
                            AVG(revenue)                     AS avg_order_value,
                            COUNT(DISTINCT session_id)       AS converting_sessions
                        FROM purchase_events
                        GROUP BY normalized_term
                    ),
                    search_volume AS (
                        SELECT normalized_term, COUNT(*) AS searches
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    )
                    SELECT
                        t.term,
                        t.attributed_orders,
                        t.attributed_revenue,
                        t.avg_order_value,
                        t.converting_sessions,
                        sv.searches,
                        SAFE_DIVIDE(t.attributed_orders, sv.searches) AS purchase_rate
                    FROM term_stats t
                    LEFT JOIN search_volume sv ON t.term = sv.normalized_term
                    ORDER BY t.attributed_revenue DESC
                    LIMIT @limit
                `;
            break;
        default:
            throw new functions.https.HttpsError('invalid-argument', `Unknown queryType: ${queryType}`);
    }
    const [rows] = await bigquery.query({
        query: sql,
        params,
        location: BQ_LOCATION,
    });
    // Serialize BigQuery row values — same pattern as queryMetrics
    const serialize = (v) => {
        var _a;
        if (v == null)
            return null;
        if (typeof v === 'object' && 'value' in v) {
            const n = Number(v.value);
            return isFinite(n) ? n : ((_a = v.value) !== null && _a !== void 0 ? _a : null);
        }
        if (typeof v === 'number')
            return isFinite(v) ? v : null;
        if (typeof v === 'boolean')
            return v;
        return v;
    };
    const result = rows.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row))
            out[k] = serialize(v);
        return out;
    });
    return { queryType, fromDate, toDate, rowCount: result.length, rows: result };
});
// ═══════════════════════════════════════════════════════════════════════════════
// ─── GOOGLE SHOPPING FEED ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates a live Google Merchant Center RSS/XML product feed from Firestore.
//
// Host at: https://importadoraeuro.com/google-shopping-feed.xml
// (add rewrite in firebase.json: "/google-shopping-feed.xml" → this function)
//
// Google Merchant Center Setup:
//  1. merchants.google.com → Add site → Verify via GA4 (already verified)
//  2. Products → Feeds → Add feed → Scheduled fetch → paste the URL above
//  3. Enable "Free Listings" for the Shopping tab (no cost)
//  4. Enable "Surfaces across Google" for Image Search & Maps
//
// Google Shopping Category 5613 = Vehicles & Parts > Motor Vehicle Parts
// ─────────────────────────────────────────────────────────────────────────────
exports.googleShoppingFeed = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onRequest(async (req, res) => {
    try {
        // Fetch all active, published products
        const snap = await db.collection('products')
            .where('active', '==', true)
            .where('inStock', '==', true)
            .limit(500)
            .get();
        const items = snap.docs.map(doc => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const p = doc.data();
            const id = doc.id;
            const sku = (_a = p['sku']) !== null && _a !== void 0 ? _a : id;
            const brand = (_b = p['brand']) !== null && _b !== void 0 ? _b : 'Importadora Euro';
            const price = Number((_c = p['price']) !== null && _c !== void 0 ? _c : 0);
            const slug = (_d = p['slug']) !== null && _d !== void 0 ? _d : id;
            // Build human-readable title with size specs
            const namePart = ((_g = (_f = (_e = p['name']) === null || _e === void 0 ? void 0 : _e.es) !== null && _f !== void 0 ? _f : p['name']) !== null && _g !== void 0 ? _g : 'Llanta Motocicleta');
            const specs = (_h = p['specifications']) !== null && _h !== void 0 ? _h : {};
            const sizePart = specs['width'] && specs['aspectRatio'] && specs['diameter']
                ? ` ${specs['width']}/${specs['aspectRatio']}${specs['construction'] === 'radial' ? 'R' : '-'}${specs['diameter']}`
                : '';
            const title = `${namePart}${sizePart}`.slice(0, 150);
            const description = ((_l = (_k = (_j = p['description']) === null || _j === void 0 ? void 0 : _j.es) !== null && _k !== void 0 ? _k : p['description']) !== null && _l !== void 0 ? _l : '')
                .replace(/[<>&"']/g, ' ')
                .slice(0, 5000);
            const imageLink = (_p = (_o = (_m = p['images']) === null || _m === void 0 ? void 0 : _m.main) !== null && _o !== void 0 ? _o : p['imageUrl']) !== null && _p !== void 0 ? _p : '';
            const productUrl = `https://importadoraeuro.com/product/${slug}`;
            // Additional product type breadcrumb
            const productTypeBreadcrumb = brand === 'Michelin'
                ? 'Llantas para Motocicleta > Michelin'
                : brand === 'Praxis'
                    ? 'Llantas para Motocicleta > Praxis'
                    : 'Llantas para Motocicleta';
            if (price <= 0 || !imageLink)
                return null; // skip incomplete products
            return `
    <item>
      <g:id>${escapeXml(sku)}</g:id>
      <g:title>${escapeXml(title)}</g:title>
      <g:description>${escapeXml(description || title)}</g:description>
      <g:link>${escapeXml(productUrl)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>in_stock</g:availability>
      <g:price>${price.toFixed(2)} MXN</g:price>
      <g:sale_price>${specs['compareAtPrice'] ? Number(specs['compareAtPrice']).toFixed(2) + ' MXN' : ''}</g:sale_price>
      <g:brand>${escapeXml(brand)}</g:brand>
      <g:mpn>${escapeXml(sku)}</g:mpn>
      <g:product_type>${escapeXml(productTypeBreadcrumb)}</g:product_type>
      <g:google_product_category>5613</g:google_product_category>
      <g:identifier_exists>no</g:identifier_exists>
      <g:shipping>
        <g:country>MX</g:country>
        <g:service>Estándar (DHL/FedEx)</g:service>
        <g:price>0 MXN</g:price>
        <g:min_handling_time>0</g:min_handling_time>
        <g:max_handling_time>1</g:max_handling_time>
        <g:min_transit_time>1</g:min_transit_time>
        <g:max_transit_time>3</g:max_transit_time>
      </g:shipping>
      <g:return_policy_label>return_policy</g:return_policy_label>
    </item>`;
        }).filter(Boolean);
        const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Importadora Eurollantas — Llantas para Motocicleta</title>
    <link>https://importadoraeuro.com</link>
    <description>Distribuidor autorizado Michelin y Praxis. Llantas de motocicleta con envío a toda la República Mexicana desde San Luis Potosí.</description>
    <language>es-MX</language>
    ${items.join('\n')}
  </channel>
</rss>`;
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600'); // 1hr cache
        res.set('Access-Control-Allow-Origin', '*');
        res.status(200).send(feedXml);
        console.log(`[ShoppingFeed] Served ${items.length} products`);
    }
    catch (err) {
        console.error('[ShoppingFeed] Error:', err);
        res.status(500).send('Feed generation failed');
    }
});
/** Escapes XML special characters for safe embedding in XML attributes/content. */
function escapeXml(str) {
    return String(str !== null && str !== void 0 ? str : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
// ═══════════════════════════════════════════════════════════════════════════════
// ─── INDEXNOW — Instant Bing/Copilot Reindexing ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pings IndexNow API when products or catalog pages are updated.
// Bing shares IndexNow data with Yandex, Seznam, Naver — one call covers all.
// Bing → feeds Microsoft Copilot citations directly.
//
// Key: stored in Firestore config/seo.indexNowKey
// Register key: bing.com/webmasters → Settings → IndexNow
//              Then serve the key at: https://importadoraeuro.com/{key}.txt
//              (add to firebase.json rewrites or just create public/{key}.txt)
// ─────────────────────────────────────────────────────────────────────────────
exports.notifyIndexNow = functions
    .runWith({ timeoutSeconds: 10 })
    .https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    }
    // Load IndexNow key from Firestore config
    const configSnap = await db.collection('config').doc('seo').get();
    const indexNowKey = (_b = (_a = configSnap.data()) === null || _a === void 0 ? void 0 : _a.indexNowKey) !== null && _b !== void 0 ? _b : '';
    if (!indexNowKey) {
        console.warn('[IndexNow] No key configured in config/seo.indexNowKey');
        return { ok: false, reason: 'No IndexNow key configured' };
    }
    // Default URLs to notify: homepage, catalog, Praxis page, Michelin page, llms.txt
    const urlsToNotify = ((_c = data === null || data === void 0 ? void 0 : data.urls) === null || _c === void 0 ? void 0 : _c.length)
        ? data.urls
        : [
            'https://importadoraeuro.com/',
            'https://importadoraeuro.com/catalogo',
            'https://importadoraeuro.com/praxis',
            'https://importadoraeuro.com/michelin',
            'https://importadoraeuro.com/llms.txt',
            'https://importadoraeuro.com/llms-full.txt',
            'https://importadoraeuro.com/sitemap.xml',
        ];
    const payload = {
        host: 'importadoraeuro.com',
        key: indexNowKey,
        keyLocation: `https://importadoraeuro.com/${indexNowKey}.txt`,
        urlList: urlsToNotify,
    };
    try {
        const r = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload),
        });
        console.log(`[IndexNow] Response: ${r.status} for ${urlsToNotify.length} URLs`);
        return { ok: r.ok, status: r.status, urls: urlsToNotify.length };
    }
    catch (err) {
        console.error('[IndexNow] Fetch failed:', err.message);
        return { ok: false, reason: err.message };
    }
});
// ─── Auto-notify IndexNow when a product is updated ──────────────────────────
// Firestore trigger: fires when any product document is written.
// Submits the specific product URL + catalog page to IndexNow.
exports.onProductWriteIndexNow = functions
    .runWith({ timeoutSeconds: 15 })
    .firestore
    .document('products/{productId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c;
    // Only notify on creates and updates, not deletes
    if (!change.after.exists)
        return;
    const product = change.after.data();
    const slug = (_a = product['slug']) !== null && _a !== void 0 ? _a : context.params.productId;
    const configSnap = await db.collection('config').doc('seo').get();
    const indexNowKey = (_c = (_b = configSnap.data()) === null || _b === void 0 ? void 0 : _b.indexNowKey) !== null && _c !== void 0 ? _c : '';
    if (!indexNowKey)
        return; // Key not configured yet — skip silently
    const urlsToNotify = [
        `https://importadoraeuro.com/product/${slug}`,
        'https://importadoraeuro.com/catalogo',
        'https://importadoraeuro.com/google-shopping-feed.xml',
    ];
    try {
        await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host: 'importadoraeuro.com',
                key: indexNowKey,
                keyLocation: `https://importadoraeuro.com/${indexNowKey}.txt`,
                urlList: urlsToNotify,
            }),
        });
        console.log(`[IndexNow] Product ${slug} notified to Bing`);
    }
    catch (err) {
        console.warn('[IndexNow] Auto-notify failed (non-critical):', err.message);
    }
});
// ── MercadoLibre Universal Inbox Sync ───────────────────────────────────────
exports.syncMeliToInbox = functions
    .runWith({ timeoutSeconds: 60 })
    .firestore
    .document('meli_communications/{docId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!change.after.exists)
        return; // Ignore deletes
    const commData = change.after.data();
    const topic = commData.topic; // 'messages' or 'questions'
    const rawData = commData.data;
    if (!rawData)
        return;
    let conversationId = '';
    let channelConversationId = '';
    let customerName = 'Cliente ML';
    let customerHandle = '';
    let messageText = '';
    let platformMessageId = '';
    let msgTimestamp = admin.firestore.FieldValue.serverTimestamp();
    let tag = '';
    if (topic === 'messages') {
        // Post-sale message
        const packId = ((_a = rawData.message_attachments) === null || _a === void 0 ? void 0 : _a.pack_id) || ((_b = rawData.message_attachments) === null || _b === void 0 ? void 0 : _b.order_id) || rawData.resource_id;
        const senderId = ((_c = rawData.from) === null || _c === void 0 ? void 0 : _c.user_id) || ((_d = rawData.from) === null || _d === void 0 ? void 0 : _d.id) || rawData.sender_id;
        // To prevent errors if payload is missing key IDs
        if (!packId || !senderId)
            return;
        conversationId = `meli_msg_${packId}`;
        channelConversationId = String(packId);
        customerHandle = String(senderId);
        customerName = ((_e = rawData.from) === null || _e === void 0 ? void 0 : _e.name) || 'Cliente ML';
        messageText = ((_f = rawData.text) === null || _f === void 0 ? void 0 : _f.plain) || rawData.text || '';
        platformMessageId = rawData.id || `msg_${Date.now()}`;
        if ((_g = rawData.message_date) === null || _g === void 0 ? void 0 : _g.created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.message_date.created));
        }
        else if (rawData.date_created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
        }
        tag = 'Post-Venta';
    }
    else if (topic === 'questions') {
        // Pre-sale question
        const itemId = rawData.item_id;
        const senderId = (_h = rawData.from) === null || _h === void 0 ? void 0 : _h.id;
        if (!itemId || !senderId)
            return;
        conversationId = `meli_q_${itemId}_${senderId}`;
        channelConversationId = `${itemId}_${senderId}`;
        customerHandle = String(senderId);
        messageText = rawData.text || '';
        platformMessageId = rawData.id || `q_${Date.now()}`;
        if (rawData.date_created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
        }
        tag = 'Pre-Venta';
    }
    else {
        return; // Not a message or question
    }
    if (!messageText)
        return;
    const convRef = db.collection('customer_conversations').doc(conversationId);
    // Upsert conversation
    await convRef.set({
        id: conversationId,
        channel: 'mercadolibre',
        channelConversationId,
        customerName,
        customerHandle,
        status: 'open',
        priority: 'normal',
        unreadCount: admin.firestore.FieldValue.increment(1),
        tags: admin.firestore.FieldValue.arrayUnion(tag),
        lastMessage: {
            text: messageText,
            direction: 'inbound',
            timestamp: msgTimestamp
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    // Check if createdAt is missing
    const convSnap = await convRef.get();
    if (convSnap.exists && !((_j = convSnap.data()) === null || _j === void 0 ? void 0 : _j.createdAt)) {
        await convRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    // Insert message
    const msgRef = convRef.collection('messages').doc(String(platformMessageId));
    await msgRef.set({
        id: String(platformMessageId),
        direction: 'inbound',
        type: 'text',
        content: messageText,
        platformMessageId: String(platformMessageId),
        status: 'delivered',
        timestamp: msgTimestamp
    });
    console.log(`[syncMeliToInbox] Synced ${topic} into Universal Inbox: ${conversationId}`);
});
// ── Temporary MercadoLibre Backfill ─────────────────────────────────────────
exports.backfillMeliToInbox = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const snapshot = await db.collection('meli_communications').get();
        let count = 0;
        for (const doc of snapshot.docs) {
            const commData = doc.data();
            const topic = commData.topic;
            const rawData = commData.data;
            if (!rawData)
                continue;
            let conversationId = '';
            let channelConversationId = '';
            let customerName = 'Cliente ML';
            let customerHandle = '';
            let messageText = '';
            let platformMessageId = '';
            let msgTimestamp = admin.firestore.FieldValue.serverTimestamp();
            let tag = '';
            if (topic === 'messages') {
                const packId = ((_a = rawData.message_attachments) === null || _a === void 0 ? void 0 : _a.pack_id) || ((_b = rawData.message_attachments) === null || _b === void 0 ? void 0 : _b.order_id) || rawData.resource_id;
                const senderId = ((_c = rawData.from) === null || _c === void 0 ? void 0 : _c.user_id) || ((_d = rawData.from) === null || _d === void 0 ? void 0 : _d.id) || rawData.sender_id;
                if (!packId || !senderId)
                    continue;
                conversationId = `meli_msg_${packId}`;
                channelConversationId = String(packId);
                customerHandle = String(senderId);
                customerName = ((_e = rawData.from) === null || _e === void 0 ? void 0 : _e.name) || 'Cliente ML';
                messageText = ((_f = rawData.text) === null || _f === void 0 ? void 0 : _f.plain) || rawData.text || '';
                platformMessageId = rawData.id || `msg_${Date.now()}`;
                if ((_g = rawData.message_date) === null || _g === void 0 ? void 0 : _g.created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.message_date.created));
                }
                else if (rawData.date_created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
                }
                tag = 'Post-Venta';
            }
            else if (topic === 'questions') {
                const itemId = rawData.item_id;
                const senderId = (_h = rawData.from) === null || _h === void 0 ? void 0 : _h.id;
                if (!itemId || !senderId)
                    continue;
                conversationId = `meli_q_${itemId}_${senderId}`;
                channelConversationId = `${itemId}_${senderId}`;
                customerHandle = String(senderId);
                messageText = rawData.text || '';
                platformMessageId = rawData.id || `q_${Date.now()}`;
                if (rawData.date_created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
                }
                tag = 'Pre-Venta';
            }
            else {
                continue;
            }
            if (!messageText)
                continue;
            const convRef = db.collection('customer_conversations').doc(conversationId);
            await convRef.set({
                id: conversationId,
                channel: 'mercadolibre',
                channelConversationId,
                customerName,
                customerHandle,
                status: 'open',
                priority: 'normal',
                unreadCount: admin.firestore.FieldValue.increment(1),
                tags: admin.firestore.FieldValue.arrayUnion(tag),
                lastMessage: {
                    text: messageText,
                    direction: 'inbound',
                    timestamp: msgTimestamp
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            const convSnap = await convRef.get();
            if (convSnap.exists && !((_j = convSnap.data()) === null || _j === void 0 ? void 0 : _j.createdAt)) {
                await convRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            }
            const msgRef = convRef.collection('messages').doc(String(platformMessageId));
            await msgRef.set({
                id: String(platformMessageId),
                direction: 'inbound',
                type: 'text',
                content: messageText,
                platformMessageId: String(platformMessageId),
                status: 'delivered',
                timestamp: msgTimestamp
            });
            count++;
        }
        res.status(200).send(`Successfully backfilled ${count} communications!`);
    }
    catch (error) {
        console.error(error);
        res.status(500).send(error.message);
    }
});
//# sourceMappingURL=index.js.map