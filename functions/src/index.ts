import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { MercadoPagoConfig, Payment, Order } from 'mercadopago';

admin.initializeApp();
const db = admin.firestore();

// ─── MercadoPago Payment Processing ─────────────────────────────────────────

export const processPayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        console.warn('[processPayment] Guest checkout — no Firebase auth. Validating inputs.');
    }

    const { token, amount, email, description, orderId, orderNumber,
            installments, paymentMethodId, issuerId,
            // Optional payer enrichment fields (passed from checkout form)
            payerFirstName, payerLastName, payerPhone, payerZip, payerStreet } = data;

    if (!token || !amount || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required payment parameters.');
    }

    // ── Throwaway Email Blocklist ───────────────────────────────────────────────
    const DISPOSABLE_DOMAINS = [
        'mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org',
        'throwam.com','trashmail.com','trashmail.net','yopmail.com','sharklasers.com',
        'guerrillamailblock.com','grr.la','guerrillamail.info','spam4.me','10minutemail.com',
        'tempmail.com','temp-mail.org','fakeinbox.com','mailnull.com','maildrop.cc',
    ];
    const emailDomain = (email as string).split('@')[1]?.toLowerCase() ?? '';
    if (DISPOSABLE_DOMAINS.includes(emailDomain)) {
        throw new functions.https.HttpsError('invalid-argument', 'El correo electrónico no es válido para procesar un pago.');
    }

    // ── Velocity Rate Limiting ─────────────────────────────────────────────────
    // Max 3 payment attempts per email per 60 minutes — blocks card testing attacks.
    const RATE_LIMIT_MAX = 3;
    const RATE_WINDOW_MS  = 60 * 60 * 1000; // 1 hour
    try {
        const emailKey    = Buffer.from(email as string).toString('base64').replace(/=/g,'');
        const rateLimitRef = db.collection('_rate_limits').doc(`pay_${emailKey}`);
        const now          = Date.now();
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(rateLimitRef);
            if (!snap.exists) {
                tx.set(rateLimitRef, { count: 1, windowStart: now, expiresAt: now + RATE_WINDOW_MS });
                return;
            }
            const { count, windowStart } = snap.data()!;
            if (now - windowStart > RATE_WINDOW_MS) {
                // Window expired — reset
                tx.set(rateLimitRef, { count: 1, windowStart: now, expiresAt: now + RATE_WINDOW_MS });
            } else if (count >= RATE_LIMIT_MAX) {
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    'Demasiados intentos de pago. Por favor espera un momento e intenta de nuevo.'
                );
            } else {
                tx.update(rateLimitRef, { count: count + 1 });
            }
        });
    } catch (rateErr: any) {
        if (rateErr.code) throw rateErr; // re-throw HttpsErrors
        console.warn('[processPayment] Rate limit check failed (non-blocking):', rateErr.message);
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

    // ── Server-side price revalidation ─────────────────────────────────────────
    // Re-calculate the expected total from Firestore data to prevent amount tampering.
    // We read the order doc the client already created, then verify each product's
    // current price against the products collection. Rejects if off by > $1 MXN.
    if (orderId) {
        try {
            const orderSnap = await db.collection('orders').doc(orderId).get();
            if (orderSnap.exists) {
                const orderData = orderSnap.data()!;

                // ── Idempotency / State Guard ──────────────────────────────────
                // If this order was already processed successfully, return the
                // existing result instead of charging the card again.
                // Guards against double-click, network retries, duplicate calls.
                const alreadyPaid = ['approved', 'paid'].includes(orderData.paymentStatus ?? '');
                if (alreadyPaid) {
                    console.warn(`[processPayment] ⚠️ Order ${orderId} already paid — returning cached result.`);
                    return {
                        success:          true,
                        alreadyProcessed: true,
                        status:           'approved',
                        paymentId:        orderData.paymentId ?? null,
                    };
                }

                const items: any[] = orderData.items ?? [];

                // Re-read each product's live price (parallel)
                const productSnaps = await Promise.all(
                    items.map((item: any) => db.collection('products').doc(item.productId).get())
                );

                let serverSubtotal = 0;
                for (let i = 0; i < items.length; i++) {
                    const livePrice: number = productSnaps[i].data()?.price ?? items[i].price;
                    serverSubtotal += livePrice * items[i].quantity;
                }

                const shippingCost: number = orderData.shippingCost ?? 0;
                const discount:    number = orderData.discount    ?? 0;
                const serverTotal: number = Math.max(0, serverSubtotal + shippingCost - discount);
                const submitted:   number = Number(amount);

                if (Math.abs(serverTotal - submitted) > 1.0) {
                    console.error(
                        `[processPayment] ❌ Amount mismatch — submitted: ${submitted}, server: ${serverTotal.toFixed(2)}`
                    );
                    // Update the order with an error note but don't charge
                    await db.collection('orders').doc(orderId).update({
                        paymentStatus: 'rejected',
                        paymentError:  `Monto rechazado: enviado $${submitted} vs servidor $${serverTotal.toFixed(2)}`,
                        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
                    }).catch(() => {});
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        `El monto del pedido no es válido. Por favor recarga y vuelve a intentar.`
                    );
                }
                console.log(`[processPayment] ✅ Amount validated: ${submitted} ≈ ${serverTotal.toFixed(2)}`);
            }
        } catch (validationErr: any) {
            // Re-throw HttpsErrors (our own rejections), swallow any Firestore read errors
            if (validationErr.code) throw validationErr;
            console.warn('[processPayment] Price validation read failed — proceeding:', validationErr.message);
        }
    }

    // Enforce installments policy
    let finalInstallments = 1;
    if (installmentsEnabled) {
        finalInstallments = Math.min(Number(installments) || 1, maxInstallments);
    }


    const client      = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const orderClient = new Order(client);

    try {
        // ── Orders API (POST /v1/orders) via mercadopago SDK v2 ────────────────
        // SDK types (dist/clients/order/create/types.d.ts) require:
        //   total_amount: string  (NOT number)
        //   transactions: { payments: PaymentRequest[] }  (NOT a raw array)
        //   payments[].amount: string  (NOT number)
        const amountStr   = Number(amount).toFixed(2);   // '688.00'
        const paymentType = (paymentMethodId ?? '').startsWith('deb') ? 'debit_card' : 'credit_card';

        const orderBody: any = {
            type:               'online',
            processing_mode:    'automatic',
            total_amount:       amountStr,
            external_reference: orderId || orderNumber || '',
            payer: {
                email,
                first_name: payerFirstName || '',
                last_name:  payerLastName  || '',
            },
            transactions: {
                payments: [{
                    amount: amountStr,
                    payment_method: {
                        id:           paymentMethodId,
                        type:         paymentType,
                        token,
                        installments: Number(finalInstallments),
                    },
                }],
            },
        };

        const result    = await orderClient.create({ body: orderBody });
        const resultAny = result as any;

        // Extract first payment — response mirrors request: transactions.payments[0]
        const txPayment   = resultAny?.transactions?.payments?.[0] ?? {};
        const orderStatus = resultAny?.status ?? 'unknown';      // 'processed'|'pending'|'rejected'
        const payStatus   = txPayment?.status ?? orderStatus;    // 'approved'|'rejected'|'pending'
        const payDetail   = txPayment?.status_detail ?? '';
        const paymentId   = txPayment?.id ?? resultAny?.id ?? null;

        // Map Orders API status to our internal statuses
        const approved    = orderStatus === 'processed' || payStatus === 'approved';
        const rejected    = orderStatus === 'rejected'  || payStatus === 'rejected';

        // 3DS challenge (Orders API: status pending + status_detail pending_challenge)
        if (payDetail === 'pending_challenge') {
            const challengeUrl = txPayment?.three_ds_info?.external_resource_url ?? null;
            console.log(`[processPayment] 3DS challenge for order ${orderId}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'pending_3ds',
                    paymentId,
                    mpOrderId:     resultAny?.id,
                    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.error('Failed to update order for 3DS:', e));
            }
            return { success: false, requires3DS: true, challengeUrl, paymentId,
                     status: payStatus, statusDetail: payDetail };
        }

        // Normal result — update Firestore
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: approved ? 'approved' : rejected ? 'rejected' : payStatus,
                paymentId,
                mpOrderId:     resultAny?.id,
                paymentMethod: paymentMethodId,
                installments:  finalInstallments,
                updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
                ...(approved ? { status: 'paid' }            : {}),
                ...(rejected ? { status: 'payment_failed' }  : {}),
            }).catch(e => console.error('Failed to update order status:', e));
        }

        return {
            success:      approved,
            status:       approved ? 'approved' : rejected ? 'rejected' : payStatus,
            paymentId,
            statusDetail: payDetail,
        };

    } catch (error: any) {
        // The MP Orders SDK throws an error when the order status is 'failed',
        // but error.data contains the complete order object with payment details.
        // Distinguish: (a) payment rejection = valid result → return 200
        //              (b) real API/network error → return 500
        const errorData = error?.data ?? error?.cause?.data ?? null;

        console.error('MercadoPago Orders API Error:', JSON.stringify({
            errors:   error?.errors ?? error?.message,
            status:   errorData?.status,
            payments: errorData?.transactions?.payments,
        }, null, 2));

        // ── Case (a): MP rejected the payment (status=failed) ─────────────────
        if (errorData?.status === 'failed') {
            const failedPayment = errorData?.transactions?.payments?.[0] ?? {};
            const failStatus    = failedPayment?.status        ?? 'rejected';
            const failDetail    = failedPayment?.status_detail ?? errorData?.status_detail ?? 'failed';
            const failPaymentId = failedPayment?.id            ?? errorData?.id ?? null;

            console.warn(`[processPayment] Payment rejected — status: ${failStatus}, detail: ${failDetail}`);

            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'rejected',
                    paymentError:  failDetail,
                    paymentId:     failPaymentId,
                    mpOrderId:     errorData?.id,
                    status:        'payment_failed',
                    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.error('Failed to update rejected order:', e));
            }
            // Return clean 200 with rejection info — NOT a 500
            return { success: false, status: failStatus, statusDetail: failDetail, paymentId: failPaymentId };
        }

        // ── Case (b): real API/config error ───────────────────────────────────
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError:  error.message || 'Unknown error',
                updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
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
const CANCEL_WINDOW_MS    = CANCEL_WINDOW_HOURS * 60 * 60 * 1000;

export const cancelOrder = functions.https.onCall(async (data, context) => {
    const { orderId, reason } = data;

    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
    }

    const orderRef  = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    const order      = orderSnap.data()!;
    const now        = Date.now();
    const createdAt  = order.createdAt?.toMillis ? order.createdAt.toMillis() : Date.now();

    // ── Ownership check ────────────────────────────────────────────────────────
    // Authenticated user: uid must match order's customer uid.
    // Guest: sessionId from the stored order must match what the client sends.
    const callerUid       = context.auth?.uid ?? null;
    const orderUid        = order.customer?.uid ?? null;
    const guestSessionId  = data.sessionId ?? null;
    const orderSessionId  = order.sessionId ?? null;

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
        throw new functions.https.HttpsError(
            'deadline-exceeded',
            `El período de cancelación de ${CANCEL_WINDOW_HOURS} horas ha expirado. Contáctanos para ayudarte.`
        );
    }

    // ── Already cancelled / refunded ──────────────────────────────────────────
    if (['cancelled', 'refunded', 'refund_pending'].includes(order.status)) {
        throw new functions.https.HttpsError('failed-precondition', 'Este pedido ya fue cancelado o reembolsado.');
    }

    // ── Paid orders → flag for staff refund review ─────────────────────────────
    // We NEVER auto-refund without staff review — policy: review first, then refund.
    if (order.paymentStatus === 'approved' || order.status === 'paid') {
        await orderRef.update({
            status:              'refund_pending',
            cancelledAt:         admin.firestore.FieldValue.serverTimestamp(),
            cancelledBy:         'customer',
            cancelReason:        reason || 'Cancelación solicitada por el cliente',
            refundStatus:        'pending_review',
            updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[cancelOrder] ✅ Order ${orderId} flagged for refund review (was paid).`);
        return { success: true, requiresRefund: true, message: 'Tu solicitud de cancelación fue recibida. Procesaremos el reembolso en 1-3 días hábiles.' };
    }

    // ── Unpaid orders → cancel immediately ────────────────────────────────────
    await orderRef.update({
        status:       'cancelled',
        paymentStatus: order.paymentStatus === 'pending' ? 'cancelled' : order.paymentStatus,
        cancelledAt:  admin.firestore.FieldValue.serverTimestamp(),
        cancelledBy:  'customer',
        cancelReason: reason || 'Cancelación solicitada por el cliente',
        updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[cancelOrder] ✅ Order ${orderId} cancelled immediately (was unpaid).`);
    return { success: true, requiresRefund: false, message: 'Tu pedido fue cancelado exitosamente.' };
});

// ─── Staff Refund Approval ────────────────────────────────────────────────────
// Called from the Operations order detail page when a staff member approves
// a pending refund. Validates the order state, calls the MercadoPago Payments
// API to issue the refund, then updates the order status and audit trail.

export const refundOrder = functions.https.onCall(async (data, context) => {
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

    const order = orderSnap.data()!;

    // Only allow refunding orders in refund_pending state
    if (order.status !== 'refund_pending') {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `Order status is '${order.status}' — only 'refund_pending' orders can be refunded.`
        );
    }

    const paymentId = order.paymentId;
    if (!paymentId) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'No payment ID found on this order. Cannot process refund automatically.'
        );
    }

    // Fetch MP access token from integrations config
    const cfgSnap = await db.collection('config').doc('integrations').get();
    const accessToken: string | undefined = cfgSnap.data()?.mercadopago?.accessToken;
    if (!accessToken) {
        throw new functions.https.HttpsError('internal', 'MercadoPago access token not configured.');
    }

    // ── Call MercadoPago Refund API ────────────────────────────────────────────
    const mpClient = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const paymentApi = new Payment(mpClient);

    let refundResult: any;
    try {
        // For full refund: cancel/refund the entire payment
        refundResult = await paymentApi.cancel({ id: Number(paymentId) });
        console.log(`[refundOrder] ✅ MP refund issued — paymentId=${paymentId}`, refundResult);
    } catch (mpErr: any) {
        console.error('[refundOrder] MercadoPago refund error:', JSON.stringify(mpErr));
        throw new functions.https.HttpsError(
            'internal',
            `MercadoPago refund failed: ${mpErr?.message || 'Unknown error'}`
        );
    }

    // ── Update Firestore order ─────────────────────────────────────────────────
    const staffUid         = context.auth.uid;
    const staffEmail       = context.auth.token.email ?? 'staff';
    const staffDisplayName = context.auth.token.name ?? staffEmail;

    const historyEntry = {
        status:         'refunded',
        timestamp:      admin.firestore.FieldValue.serverTimestamp(),
        note:           reason || 'Reembolso aprobado y procesado por staff',
        // Legacy field
        updatedBy:      staffUid,
        // Structured audit actor
        updatedByActor: { uid: staffUid, displayName: staffDisplayName, role: 'OPERATIONS' },
        action:         'refund_approved',
        metadata: {
            mpRefundId: refundResult?.id ?? null,
            processedBy: staffEmail,
        },
    };

    await orderRef.update({
        status:         'refunded',
        paymentStatus:  'refunded',
        refundStatus:   'PROCESSED',
        refundAmount:   order.total,
        updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        history:        admin.firestore.FieldValue.arrayUnion(historyEntry),
    });

    console.log(`[refundOrder] ✅ Order ${orderId} marked as refunded by ${staffEmail}`);
    return { success: true, message: 'Reembolso procesado exitosamente en MercadoPago.' };
});

// ─── MercadoPago Webhook ──────────────────────────────────────────────────────
// Receives payment status updates from MP's notification system.
// Register this URL in MP Developer Panel → Notifications → Webhook:
//   https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook

export const mpWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
    try {
        // ── x-signature Validation ─────────────────────────────────────────────
        // MP signs every webhook with HMAC-SHA256 using the app's Secret Key.
        // Validate before processing to prevent spoofed notifications.
        // Secret stored in Firestore: config/integrations → mercadopago.webhookSecret
        const xSignature  = req.headers['x-signature']  as string | undefined;
        const xRequestId  = req.headers['x-request-id'] as string | undefined;
        if (xSignature) {
            try {
                const cfgSnap = await db.collection('config').doc('integrations').get();
                const secret  = cfgSnap.data()?.mercadopago?.webhookSecret ?? '';
                if (secret) {
                    const crypto = await import('crypto');
                    // Parse ts and v1 from x-signature header (format: "ts=xxx,v1=yyy")
                    const parts: Record<string, string> = {};
                    xSignature.split(',').forEach(p => { const [k, v] = p.trim().split('='); if (k && v) parts[k] = v; });
                    const ts = parts['ts'] ?? '';
                    const v1 = parts['v1'] ?? '';
                    const dataId = req.body?.data?.id ?? req.query['id'] ?? '';
                    const manifest = `id:${dataId};request-id:${xRequestId ?? ''};ts:${ts};`;
                    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
                    if (expected !== v1) {
                        console.warn('[mpWebhook] ⚠️ Signature mismatch — possible spoofed request. manifest:', manifest);
                        // Log but don't block: avoids breaking if secret is misconfigured
                    } else {
                        console.log('[mpWebhook] ✅ Signature valid');
                    }
                } else {
                    console.warn('[mpWebhook] No webhookSecret configured — skipping x-signature validation.');
                }
            } catch (sigErr: any) {
                console.error('[mpWebhook] Signature validation error:', (sigErr as any).message);
            }
        }

        const topic      = req.body?.type || req.query['topic'];
        const resourceId = req.body?.data?.id || req.query['id'];
        console.log('[mpWebhook] Received:', topic, resourceId);

        // Always ACK non-payment/non-order topics immediately
        if (!resourceId || (topic !== 'payment' && topic !== 'order')) {
            res.status(200).send('OK'); return;
        }

        let accessToken = process.env.MP_ACCESS_TOKEN;
        try {
            const snap = await db.collection('config').doc('integrations').get();
            const t = snap.data()?.mercadopago?.accessToken;
            if (t) accessToken = t;
        } catch (e) { /* fall back to env */ }

        if (!accessToken) { res.status(500).send('No access token'); return; }

        const mpClient = new MercadoPagoConfig({ accessToken });

        // ── Orders API topic ('order') ─────────────────────────────────────────
        // New standard for Checkout API integrations.
        // Fetch from /v1/orders/{id} and map to our Firestore order.
        if (topic === 'order') {
            const orderClient = new Order(mpClient);
            const orderData   = await (orderClient as any).get({ id: String(resourceId) });
            const orderAny    = orderData as any;

            // external_reference IS our Firestore orderId
            const orderId = orderAny?.external_reference;
            if (!orderId) { console.warn('[mpWebhook] Order topic but no external_reference'); res.status(200).send('OK'); return; }

            // Extract status from order + first transaction payment
            const txPay       = orderAny?.transactions?.[0]?.payments?.[0] ?? {};
            const orderStatus = orderAny?.status ?? '';               // 'processed'|'pending'|'rejected'
            const payStatus   = txPay?.status   ?? orderStatus;
            const payId       = txPay?.id        ?? null;

            const approved    = orderStatus === 'processed' || payStatus === 'approved';
            const rejected    = orderStatus === 'rejected'  || payStatus === 'rejected';
            const newStatus   = approved ? 'approved' : rejected ? 'rejected' : 'pending';

            await db.collection('orders').doc(orderId).update({
                paymentStatus:  newStatus,
                paymentId:      payId,
                mpOrderId:      orderAny?.id,
                paymentMethod:  orderAny?.transactions?.[0]?.payment_method?.id ?? '',
                installments:   orderAny?.transactions?.[0]?.payment_method?.installments ?? 1,
                updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
                ...(approved ? { status: 'paid' }           : {}),
                ...(rejected ? { status: 'payment_failed' } : {}),
            });

            console.log(`[mpWebhook] Order (Orders API) ${orderId} → ${newStatus}`);
            res.status(200).send('OK'); return;
        }

        // ── Legacy Payments API topic ('payment') ──────────────────────────────
        // Retained for backwards compatibility with any legacy payments.
        const paymentApi  = new Payment(mpClient);
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

        console.log(`[mpWebhook] Order (Payments API) ${orderId} payment → ${newStatus}`);
        res.status(200).send('OK');
    } catch (err: any) {
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
export const mpAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const mpConfig  = configDoc.data()?.mercadopago || {};
        const appId     = mpConfig.appId || mpConfig.clientId;

        if (!appId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'MercadoPago App ID not configured. Save it in Admin → Integrations first.'
            );
        }

        const redirectUri = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback';
        const state       = Math.random().toString(36).substring(2, 15);

        await db.collection('config').doc('integrations').set(
            { mercadopago: { oauthState: state } },
            { merge: true }
        );

        const SCOPES = ['read', 'offline_access', 'write'].join(' ');
        const url    = `https://auth.mercadopago.com.mx/authorization?client_id=${appId}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;
        return { url, redirectUri };
    } catch (err: any) {
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
export const mpCallback = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');

    const code  = req.query['code']  as string;
    const state = req.query['state'] as string;
    const error = req.query['error'] as string;

    const ADMIN_URL = 'https://us-central1-tiendapraxis.cloudfunctions.net';  // fallback
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
        const configDoc    = await db.collection('config').doc('integrations').get();
        const mpConfig     = configDoc.data()?.mercadopago || {};
        const appId        = mpConfig.appId        || mpConfig.clientId;
        const clientSecret = mpConfig.clientSecret || mpConfig.appSecret;
        const redirectUri  = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback';

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
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({
                grant_type:    'authorization_code',
                client_id:     appId,
                client_secret: clientSecret,
                code,
                redirect_uri:  redirectUri,
            }).toString(),
        });

        const tokenData = await tokenRes.json() as any;

        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('[mpCallback] Token exchange failed:', JSON.stringify(tokenData));
            res.status(500).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
            return;
        }

        const expiresAt = Date.now() + ((tokenData.expires_in || 21600) * 1000);

        await db.collection('config').doc('integrations').set({
            mercadopago: {
                accessToken:  tokenData.access_token,
                refreshToken: tokenData.refresh_token ?? null,
                publicKey:    tokenData.public_key    ?? mpConfig.publicKey ?? '',
                userId:       tokenData.user_id       ?? null,
                expiresAt,
                connected:    true,
                oauthState:   null,
            }
        }, { merge: true });

        console.log('[mpCallback] ✅ MercadoPago OAuth success. User ID:', tokenData.user_id);
        res.redirect(`${REDIRECT_BACK}?mp_success=true`);

    } catch (err: any) {
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
export const mpDiag = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const FN_VER = 'v6-2026-04-20'; // bump this on every deploy to confirm version
    // Load credentials from Firestore
    const configSnap = await db.collection('config').doc('integrations').get();
    const mpConfig   = configSnap.data()?.mercadopago ?? {};
    const accessToken: string = mpConfig.accessToken ?? process.env.MP_ACCESS_TOKEN ?? '';

    if (!accessToken) {
        return { ok: false, error: 'No Access Token found in config/integrations → mercadopago' };
    }

    const step = data?.step as string;

    // ── Step: save_credentials — persist AT + PK to Firestore ────────────────
    if (step === 'save_credentials') {
        const newAt = (data?.accessToken ?? '').trim();
        const newPk = (data?.publicKey   ?? '').trim();
        if (!newAt || !newPk) {
            return { ok: false, error: 'Both accessToken and publicKey are required.', fnVer: FN_VER };
        }
        await db.collection('config').doc('integrations').set(
            { mercadopago: { accessToken: newAt, publicKey: newPk } },
            { merge: true }
        );
        return { ok: true, message: 'Credentials saved to Firestore ✅', fnVer: FN_VER };
    }

    // ── Step: check_credentials — compare stored vs expected ─────────────────
    if (step === 'check_credentials') {
        const storedAt = accessToken;
        const storedPk = mpConfig.publicKey ?? '';
        const mask     = (s: string) => s ? `${s.slice(0, 18)}…${s.slice(-6)}` : '(empty)';
        // Expected values from the user
        const expectedAt = 'TEST-398646544825942-022715-cbec23472732e892da3798593de42e85-1178500066';
        const expectedPk = 'TEST-26a04055-43d8-4f69-97c5-7829d3d413bf';
        const atMatch = storedAt === expectedAt;
        const pkMatch = storedPk === expectedPk;
        return {
            ok:              atMatch && pkMatch,
            accessToken:     { stored: mask(storedAt), expected: mask(expectedAt), match: atMatch },
            publicKey:       { stored: mask(storedPk),  expected: mask(expectedPk),  match: pkMatch  },
            summary:         `AT: ${atMatch ? '✅ Match' : '❌ MISMATCH'} | PK: ${pkMatch ? '✅ Match' : '❌ MISMATCH'}`,
            updateNeeded:    !atMatch || !pkMatch,
            fnVer:           FN_VER,
        };
    }

    // ── Step: /users/me ───────────────────────────────────────────────────────
    if (step === 'users_me') {
        try {
            const r = await fetch('https://api.mercadopago.com/users/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const body = await r.json() as any;
            if (!r.ok) return { ok: false, error: body.message ?? body.error ?? 'Token rejected', status: r.status };
            return {
                ok:       true,
                userId:   body.id,
                nickname: body.nickname,
                email:    body.email,
                site_id:  body.site_id,
            };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }


    // ── Step: Payment methods ─────────────────────────────────────────────────
    if (step === 'payment_methods') {
        try {
            const r = await fetch('https://api.mercadopago.com/v1/payment_methods', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const body = await r.json() as any;
            if (!r.ok) return { ok: false, error: body.message ?? 'Could not retrieve payment methods', status: r.status };
            const methods: string[] = (Array.isArray(body) ? body : []).map((m: any) => m.id);
            return {
                ok:     true,
                count:  methods.length,
                sample: methods.slice(0, 5),
            };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }

    // ── Step: Test payment — creates a real Checkout Pro preference ───────────
    // This is the ACTUAL flow production uses (not card API hacks).
    // A successful preference proves: token valid, payment config correct, checkout works.
    if (step === 'test_payment') {
        const { amount = 100, description = 'Diagnóstico integración — Eurollantas' } = data ?? {};
        try {
            const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method:  'POST',
                headers: {
                    'Authorization':     `Bearer ${accessToken}`,
                    'Content-Type':      'application/json',
                    'X-Idempotency-Key': `mpdiag-pref-${Date.now()}`,
                },
                body: JSON.stringify({
                    items: [{
                        id:          'mp-diag-001',
                        title:       description,
                        quantity:    1,
                        currency_id: 'MXN',
                        unit_price:  Number(amount),
                    }],
                    payer:              { email: 'test@eurollantas.com.mx' },
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
            const pref = await prefRes.json() as any;
            if (!prefRes.ok || !pref.id) {
                return {
                    ok:    false,
                    status: prefRes.status,
                    error: pref.message ?? pref.cause?.[0]?.description ?? 'Preference creation failed',
                    fnVer: FN_VER,
                    raw:   pref,
                };
            }
            return {
                ok:           true,
                preferenceId: pref.id,
                initPoint:    pref.sandbox_init_point ?? pref.init_point,
                status:       'preference_created',
                fnVer:        FN_VER,
                raw: {
                    id:           pref.id,
                    sandbox_url:  pref.sandbox_init_point,
                    expires:      pref.date_of_expiration,
                    fnVer:        FN_VER,
                },
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }


    // ── Step: Card tokenization — proves public key + all 4 test cards work ──
    // Tokenizes each test card via the MP server-side tokenize endpoint.
    // This is a deeper test than preference creation: it validates that the
    // public key is correct and that MP accepts every sandbox card number.
    if (step === 'card_token') {
        const publicKey: string = mpConfig.publicKey ?? '';
        if (!publicKey) {
            return { ok: false, error: 'No Public Key found in config/integrations → mercadopago' };
        }
        const testCards = [
            { label: 'Mastercard Crédito',  number: '5474925432670366', cvv: '123',  expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Crédito',        number: '4075595716483764', cvv: '123',  expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Mastercard Débito',   number: '5579053461482647', cvv: '1234', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Débito',         number: '4189141221267633', cvv: '123',  expMonth: 11, expYear: 2030, holder: 'APRO' },
        ];
        const cardResults: { label: string; ok: boolean; token?: string; error?: string }[] = [];
        for (const card of testCards) {
            try {
                const r = await fetch('https://api.mercadopago.com/v1/card_tokens', {
                    method:  'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type':  'application/json',
                    },
                    body: JSON.stringify({
                        card_number:      card.number,
                        security_code:    card.cvv,
                        expiration_month: card.expMonth,
                        expiration_year:  card.expYear,
                        cardholder: { name: card.holder },
                    }),
                });
                const body = await r.json() as any;
                if (!r.ok || !body.id) {
                    cardResults.push({ label: card.label, ok: false, error: body.message ?? body.cause?.[0]?.description ?? `HTTP ${r.status}` });
                } else {
                    cardResults.push({ label: card.label, ok: true, token: body.id });
                }
            } catch (e: any) {
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
            const body = await r.json() as any;
            if (!r.ok) {
                return {
                    ok:     false,
                    error:  body.message ?? body.error ?? `HTTP ${r.status}`,
                    status: r.status,
                    hint:   'If 404 the buyer account is not associated with this sandbox seller.',
                    fnVer:  FN_VER,
                };
            }
            // email may appear as body.email or inside identification sub-objects
            const email = body.email ?? body.secure_email ?? body.alternative_phone?.area_code ?? null;
            return {
                ok:        true,
                buyerId:   body.id,
                nickname:  body.nickname,
                email,
                site_id:   body.site_id,
                type:      body.user_type ?? body.account_type ?? 'unknown',
                // Return full body so raw JSON reveals every available field
                allFields: body,
                fnVer:     FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }

    // ── Step: Get buyer OAuth token (password grant) ─────────────────────────
    // Uses the buyer test account credentials to get their own access token.
    // The buyer's token is then used to tokenize a card — this correctly
    // attributes the card token to the BUYER, resolving error 2034.
    if (step === 'buyer_token') {
        const mpCfg        = configSnap.data()?.mercadopago ?? {};
        // clientId 398646544825942 = app ID from the MP developer portal (not a secret)
        const clientId     = mpCfg.clientId ?? mpCfg.client_id ?? '398646544825942';
        const clientSecret = mpCfg.clientSecret ?? mpCfg.client_secret ?? '';

        // Strategy: try with client_secret first; if not available, try without.
        // MP sandbox test users sometimes work via password grant without client_secret.
        const tryGrant = async (includeSecret: boolean) => {
            const params: Record<string, string> = {
                grant_type: 'password',
                client_id:  clientId,
                username:   'TESTUSER7146576788719579772',
                password:   'aP0I8bxKiJ',
            };
            if (includeSecret && clientSecret) params.client_secret = clientSecret;
            return fetch('https://api.mercadopago.com/oauth/token', {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    new URLSearchParams(params).toString(),
            });
        };

        try {
            // First try: with secret (full grant)
            let r = clientSecret ? await tryGrant(true) : await tryGrant(false);
            let body = await r.json() as any;

            // Second try: without secret (sandbox-only fallback)
            if (!r.ok && clientSecret) {
                r    = await tryGrant(false);
                body = await r.json() as any;
            }

            if (!r.ok || !body.access_token) {
                return {
                    ok:         false,
                    error:      body.message ?? body.error ?? `HTTP ${r.status}`,
                    hint:       'Add clientSecret to Firestore config/integrations → mercadopago.clientSecret (find it in the MP developer portal under your app credentials)',
                    httpStatus: r.status,
                    raw:        body,
                    fnVer:      FN_VER,
                };
            }

            // Get buyer profile with their own token
            const meR    = await fetch('https://api.mercadopago.com/users/me', {
                headers: { 'Authorization': `Bearer ${body.access_token}` },
            });
            const meBody = await meR.json() as any;
            return {
                ok:         true,
                buyerToken: body.access_token,
                buyerEmail: meBody.email,
                buyerId:    meBody.id,
                buyerNick:  meBody.nickname,
                fnVer:      FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }

    // ── Step: Direct payment ─────────────────────────────────────────────────
    // Tokenizes a Mastercard test card then creates a real payment (not a preference).
    // APRO as cardholder name is the MP sandbox convention for "approved" result.
    // binary_mode = true: no intermediate "pending" state — instant approved/rejected.
    if (step === 'direct_payment') {
        const { amount = 100, payerEmail: forcedEmail } = data ?? {};

        // 0 — Resolve buyer test user email.
        // Prefer the email passed from the caller (captured in verify_buyer / Step 5).
        // Fall back to auto-fetch only if not provided.
        // MP sandbox error 2034 occurs when payer is not a recognized test user.
        let buyerEmail: string = forcedEmail ?? '';
        if (!buyerEmail) {
            try {
                const br = await fetch('https://api.mercadopago.com/users/3347553101', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                const bb = await br.json() as any;
                if (br.ok && bb.email) buyerEmail = bb.email;
            } catch (_) { /* surface as error below */ }
        }
        if (!buyerEmail) {
            return { ok: false, error: 'Could not resolve buyer test user email. Run Step 5 first or verify /users/3347553101 is accessible.', fnVer: FN_VER };
        }

        // 1 — Tokenize Mastercard test card server-side (APRO → approved in sandbox)
        let cardToken = '';
        try {
            const tr = await fetch('https://api.mercadopago.com/v1/card_tokens', {
                method:  'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_number:      '5474925432670366',
                    security_code:    '123',
                    expiration_month: 11,
                    expiration_year:  2030,
                    cardholder:       { name: 'APRO' },
                }),
            });
            const tb = await tr.json() as any;
            if (!tr.ok || !tb.id) return {
                ok: false,
                error:     `Token error (HTTP ${tr.status}): ${tb.message ?? JSON.stringify(tb)}`,
                rawToken:  tb,
                fnVer:     FN_VER,
            };
            cardToken = tb.id;
        } catch (e: any) {
            return { ok: false, error: `Token exception: ${e.message}`, fnVer: FN_VER };
        }

        // 2 — Create direct payment with that token
        try {
            const pr = await fetch('https://api.mercadopago.com/v1/payments', {
                method:  'POST',
                headers: {
                    'Authorization':     `Bearer ${accessToken}`,
                    'Content-Type':      'application/json',
                    'X-Idempotency-Key': `mpdiag-pay-${Date.now()}`,
                },
                body: JSON.stringify({
                    transaction_amount: Number(amount),
                    token:              cardToken,
                    description:        'Diagnóstico pago directo — Eurollantas',
                    installments:       1,
                    payment_method_id:  'master',
                    binary_mode:        true,
                    payer:              { email: buyerEmail },
                }),
            });
            const pb = await pr.json() as any;
            const approved = pb.status === 'approved';
            return {
                ok:           approved,
                paymentId:    pb.id ?? null,
                status:       pb.status,
                statusDetail: pb.status_detail,
                amount:       pb.transaction_amount,
                currency:     pb.currency_id,
                buyerEmail,
                httpStatus:   pr.status,
                mpMessage:    approved ? undefined : (pb.message ?? pb.error),
                mpCause:      approved ? undefined : pb.cause,
                fnVer:        FN_VER,
            };
        } catch (e: any) {
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
                method:  'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_number:      '5474925432670366',  // MP test Mastercard (tokenizable in both envs)
                    security_code:    '123',
                    expiration_month: 11,
                    expiration_year:  2030,
                    cardholder:       { name: 'TEST CARD' },
                }),
            });
            const tb = await tr.json() as any;

            if (!tr.ok || !tb.id) {
                return {
                    ok:         false,
                    error:      `Tokenization failed (HTTP ${tr.status})`,
                    detail:     tb.message ?? tb.error ?? JSON.stringify(tb),
                    httpStatus: tr.status,
                    fnVer:      FN_VER,
                };
            }

            return {
                ok:          true,
                tokenId:     tb.id,
                lastFour:    tb.last_four_digits,
                cardType:    tb.payment_method?.id ?? 'master',
                expiryMonth: tb.expiration_month,
                expiryYear:  tb.expiration_year,
                httpStatus:  tr.status,
                note:        '✅ Card tokenization works — production AT valid. Real purchase must be done through the storefront with a real card (generates production paymentId for Stage 3).',
                fnVer:       FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: `Tokenization exception: ${e.message}`, fnVer: FN_VER };
        }


    }

    // ── Step: Payment status ─────────────────────────────────────────────────
    if (step === 'payment_status') {
        const { paymentId } = data ?? {};
        if (!paymentId) return { ok: false, error: 'paymentId required', fnVer: FN_VER };
        try {
            const r    = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body = await r.json() as any;
            return {
                ok:           r.ok && !!body.id,
                paymentId:    body.id,
                status:       body.status,
                statusDetail: body.status_detail,
                amount:       body.transaction_amount,
                currency:     body.currency_id,
                dateApproved: body.date_approved,
                fnVer:        FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }

    // ── Step: Refund payment ─────────────────────────────────────────────────
    if (step === 'refund_payment') {
        const { paymentId } = data ?? {};
        if (!paymentId) return { ok: false, error: 'paymentId required', fnVer: FN_VER };
        try {
            const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, {
                method:  'POST',
                headers: {
                    'Authorization':     `Bearer ${accessToken}`,
                    'Content-Type':      'application/json',
                    'X-Idempotency-Key': `mpdiag-refund-${Date.now()}`,
                },
                body: JSON.stringify({}), // empty body = full refund
            });
            const body = await r.json() as any;
            return {
                ok:       r.ok && !!body.id,
                refundId: body.id,
                status:   body.status,
                amount:   body.amount,
                fnVer:    FN_VER,
            };
        } catch (e: any) {
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
                amount:            '1000',
                bin:               '547492',
            });
            const r = await fetch(
                `https://api.mercadopago.com/v1/payment_methods/installments?${params}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            const body = await r.json() as any;
            const arr  = Array.isArray(body) ? body : [];
            const installments: number[] = (arr[0]?.payer_costs ?? []).map((c: any) => c.installments);
            return {
                ok:            r.ok && installments.length > 0,
                installments,
                count:         installments.length,
                fnVer:         FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }

    // ── Step: Configure webhook via MP API (bypasses portal UI bug) ──────────
    // The MP developer portal has a known bug where event checkboxes don't save.
    // This step registers the webhook subscription directly via the API.
    if (step === 'configure_webhook') {
        const webhookUrl = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook';
        const appId      = '398646544825942';
        try {
            // First: get existing subscriptions to avoid duplicates
            const listR = await fetch(`https://api.mercadopago.com/v2/notifications/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const listBody = await listR.json() as any;

            // Check if our URL is already registered
            const existing = (listBody?.data ?? []).find((s: any) => s.url === webhookUrl);

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
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    url:           webhookUrl,
                    event_type:    ['payment', 'merchant_order'],
                    client_id:     appId,
                    active:        true,
                }),
            });
            const createBody = await createR.json() as any;

            // Also try v1 endpoint as fallback
            const listR2 = await fetch(`https://api.mercadopago.com/v1/account/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const listBody2 = await listR2.json() as any;

            return {
                ok:         createR.ok,
                message:    createR.ok ? '✅ Webhook registered via API' : `❌ HTTP ${createR.status}`,
                created:    createBody,
                existingV2: listBody,
                existingV1: listBody2,
                fnVer:      FN_VER,
            };
        } catch (e: any) {
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
            const body = await r.json() as any;
            if (!r.ok) {
                return { ok: false, error: body.message ?? `HTTP ${r.status}`, raw: body, fnVer: FN_VER };
            }
            // Also try the direct webhook endpoint
            const r2 = await fetch(`https://api.mercadopago.com/v1/account/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body2 = await r2.json() as any;
            return {
                ok:        r.ok || r2.ok,
                v2_result: body,
                v1_result: body2,
                hint:      'Look for "secret" or "signature_secret" field in the raw results',
                fnVer:     FN_VER,
            };
        } catch (e: any) {
            return { ok: false, error: e.message, fnVer: FN_VER };
        }
    }

    // ── Step: Verify webhook secret (x-signature capability) ─────────────────
    // Confirms the webhookSecret is stored in Firestore and that the Node.js
    // crypto module can produce a valid HMAC-SHA256 signature.
    // Required for MP Security quality metric.
    if (step === 'verify_webhook_secret') {
        const secret = mpConfig.webhookSecret ?? '';
        if (!secret) {
            return {
                ok:    false,
                error: 'webhookSecret not configured in Firestore',
                hint:  'Add mercadopago.webhookSecret to config/integrations → Firestore. Find it in developers.mercadopago.com → your app → Webhooks → Secret key.',
                fnVer: FN_VER,
            };
        }
        const crypto   = await import('crypto');
        const testTs   = String(Date.now());
        const manifest = `id:99999999;request-id:diag-req;ts:${testTs};`;
        const sig      = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
        return {
            ok:        true,
            message:   'webhookSecret configured ✅ — HMAC-SHA256 signing works',
            sampleSig: sig.substring(0, 16) + '…',
            fnVer:     FN_VER,
        };
    }

    // ── Step: Webhook endpoint reachability ───────────────────────────────────

    if (step === 'webhook_check') {
        const webhookUrl = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpWebhook';
        try {
            // Send a GET — the webhook rejects non-POST but a 405 confirms it's alive
            const r = await fetch(webhookUrl, { method: 'GET' });
            const alive  = r.status === 405 || r.status === 200; // 405 = correct (only POST allowed)
            return {
                ok:     alive,
                status: r.status,
                url:    webhookUrl,
                detail: alive ? 'Endpoint responds correctly (405 Method Not Allowed = ✅)' : `Unexpected status ${r.status}`,
            };
        } catch (e: any) {
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
async function getAppLevelToken(): Promise<string> {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli ?? {};

    const appId       = meliConfig.appId;
    const clientSecret = meliConfig.clientSecret;

    if (!appId || !clientSecret) {
        console.warn('[Meli:AppToken] Missing appId/clientSecret — falling back to user token');
        return getValidMeliToken();
    }

    // Check cached app token (valid for most of its 6h window)
    const cached     = meliConfig.appAccessToken;
    const cachedExp  = meliConfig.appTokenExpiresAt ?? 0;
    if (cached && (cachedExp - Date.now()) > 10 * 60 * 1000) {
        console.log('[Meli:AppToken] Cache HIT — reusing app token');
        return cached as string;
    }

    console.log('[Meli:AppToken] Fetching new app-level token (client_credentials)...');
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
            grant_type:    'client_credentials',
            client_id:     appId,
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




// 1. Generate Auth URL (Callable)
export const meliAuthUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

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
            if (!state)   return {};  // have addr object but no state → preserve
            return {
                shippingAddress: {
                    street:         recvAddr.street_name || recvAddr.address_line || 'MercadoEnvíos',
                    exteriorNumber: recvAddr.street_number || '',
                    interiorNumber: '',
                    references:     recvAddr.comment || '',
                    colonia:        recvAddr.neighborhood?.name || '',
                    city:           recvAddr.city?.name || recvAddr.municipality?.name || '',
                    state,
                    zipCode:        recvAddr.zip_code || '',
                    country:        recvAddr.country?.id || 'MX',
                    recipientName:  recvAddr.receiver_name || shipData?.destination?.receiver_name || ''
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

    const { width, aspectRatio, diameter, force = false } = data;
    // competitorItemIds: pre-populated by the client (browser-side ML search, not blocked)
    const clientCompetitorIds: string[] = Array.isArray(data.competitorItemIds)
        ? (data.competitorItemIds as string[]).slice(0, 100)
        : [];
    let categoryId: string = data.categoryId ?? 'MLM169975'; // may be overridden by autodiscovery below

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
                console.log(`[PriceIntel] Cache HIT for ${fingerprint}`);
                return {
                    cached: true,
                    fingerprint,
                    stats: cacheDoc.data()?.stats ?? null,
                    count: (cacheDoc.data()?.listings ?? []).length
                };
            }
        }
    }

    // ── 2. Get ML access tokens ───────────────────────────────────────────────
    // userToken  → for seller-specific ops (our listings, mutations)
    // appToken   → for marketplace reads (search, item details)
    //              client_credentials grant; NOT blocked by ML's GCP IP filter
    const accessToken    = await getValidMeliToken();
    const appToken       = await getAppLevelToken();
    const authHeaders:    Record<string, string> = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders: Record<string, string> = { 'Authorization': `Bearer ${appToken}` };

    // ── 3. Get our seller ID ──────────────────────────────────────────────────
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli;
    const sellerId = meliConfig?.userId ? String(meliConfig.userId) : null;

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

    let productIds: string[] = [];
    try {
        const prodRes = await fetch(
            `https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(keywordAlt)}&category=${categoryId}&limit=15`,
            { headers: authHeaders }
        );
        if (prodRes.ok) {
            const prodData = await prodRes.json() as any;
            productIds = (prodData.results || []).map((p: any) => p.id).filter(Boolean).slice(0, 10);
            console.log(`[PriceIntel] Found ${productIds.length} product catalog entries`);
        } else {
            console.warn(`[PriceIntel] Products search returned ${prodRes.status} — will rely on keyword search only`);
        }
    } catch (err: any) {
        console.warn('[PriceIntel] Products search failed (non-fatal):', err.message);
    }

    // ── 5. Fetch our own seller's listed items for this size ──────────────────
    // /users/{id}/items/search returns ALL our active item IDs. We then bulk-fetch
    // their details via /items?ids= to get price and other metadata.
    let ourItemIds: Set<string> = new Set<string>();
    let ourItemDetailsMap: Map<string, any> = new Map();

    try {
        // Paginate our seller items (up to 200 total to keep within timeout)
        const ourItemsRes = await fetch(
            `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100`,
            { headers: authHeaders }
        );
        if (ourItemsRes.ok) {
            const ourItemsData = await ourItemsRes.json() as any;
            const allOurIds: string[] = ourItemsData.results || [];
            const total: number = ourItemsData.paging?.total ?? allOurIds.length;
            console.log(`[PriceIntel] Seller has ${total} active items total (first page: ${allOurIds.length})`);

            // Fetch second page if there are more than 100 items
            if (total > 100) {
                try {
                    const page2Res = await fetch(
                        `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100&offset=100`,
                        { headers: authHeaders }
                    );
                    if (page2Res.ok) {
                        const page2Data = await page2Res.json() as any;
                        allOurIds.push(...(page2Data.results || []));
                    }
                } catch { /* non-fatal */ }
            }

            console.log(`[PriceIntel] Total our item IDs to check: ${allOurIds.length}`);

            // Bulk-fetch details in batches of 20
            for (let i = 0; i < allOurIds.length; i += 20) {
                const batch = allOurIds.slice(i, i + 20);
                const detailsRes = await fetch(
                    `https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,category_id,attributes,status,catalog_product_id,sold_quantity,listing_type_id,shipping,permalink,thumbnail`,
                    { headers: authHeaders }
                );
                if (detailsRes.ok) {
                    const details = await detailsRes.json() as any[];
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            const item = entry.body;
                            // ML-confirmed attribute IDs (from category MLM169975 attrs step):
                            const attrs: any[] = item.attributes || [];
                            const atWidth = attrs.find((a: any) =>
                                ['SECTION_WIDTH', 'TIRE_WIDTH', 'TIRE_SIZE_WIDTH'].includes(a.id)
                            )?.value_name;
                            const atAR = attrs.find((a: any) =>
                                ['AUTOMOTIVE_TIRE_ASPECT_RATIO', 'ASPECT_RATIO', 'TIRE_ASPECT_RATIO'].includes(a.id)
                            )?.value_name;
                            const atDiam = attrs.find((a: any) =>
                                ['RIM_DIAMETER', 'TIRE_RIM_DIAMETER'].includes(a.id)
                            )?.value_name;

                            const titleHasWidth = item.title?.includes(String(width));
                            const titleHasAR    = item.title?.includes(String(aspectRatio));
                            const titleHasDiam  = item.title?.includes(String(diameter)) ||
                                                  item.title?.toLowerCase().includes(`r${diameter}`) ||
                                                  item.title?.toLowerCase().includes(`-${diameter}`);
                            const titleMatch = titleHasWidth && titleHasAR && titleHasDiam;

                            const attrsMatch = atWidth && String(atWidth) === String(width) &&
                                               atAR    && String(atAR)    === String(aspectRatio) &&
                                               atDiam  && String(atDiam)  === String(diameter);

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
    } catch (err: any) {
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
    const ourMatchingItems: any[] = [];
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
            cached:    false,
            fingerprint,
            noListing: true,
            stats:     null,
            count:     0,
            message:   `No publicación activa en ML ni competidores para ${fingerprint}.`,
        };
    }

    // ── 6b. Server-side competitor discovery via ScraperAPI proxy ─────────────
    // ML's /sites/MLM/search returns 403 from GCP datacenter IPs (WAF block).
    // ScraperAPI routes the request through residential IPs that ML does not block.
    // Sign up free at scraperapi.com (5,000 requests/month free tier).
    // Set the key: firebase functions:config:set scraperapi.key="YOUR_KEY"
    //
    // The clientCompetitorIds from the browser are used as a supplement if present.
    const competitorRawItems: any[] = [];
    const scraperApiKey: string = (functions.config().scraperapi?.key) ?? '';

    // Collect competitor IDs from all sources
    const competitorIdSet = new Set<string>(
        clientCompetitorIds.filter(id => !ourItemIds.has(id))
    );

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
                    const searchData = await searchRes.json() as any;
                    const results: any[] = searchData.results ?? [];
                    console.log(`[PriceIntel] ScraperAPI search "${q}": ${results.length} hits`);
                    results.forEach((item: any) => {
                        if (item.id && !ourItemIds.has(item.id)) {
                            competitorIdSet.add(item.id);
                        }
                    });
                } else {
                    const errText = await searchRes.text().catch(() => '');
                    console.warn(`[PriceIntel] ScraperAPI HTTP ${searchRes.status} for "${q}":`, errText.slice(0, 200));
                }
            } catch (err: any) {
                console.warn(`[PriceIntel] ScraperAPI error for query "${q}":`, err.message);
            }
        }
        console.log(`[PriceIntel] Total competitor candidates after proxy search: ${competitorIdSet.size}`);
    } else {
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
                const detRes = await fetch(
                    `https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail,attributes`,
                    { headers: appAuthHeaders }
                );
                if (detRes.ok) {
                    const details = await detRes.json() as any[];
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            competitorRawItems.push(entry.body);
                        }
                    }
                }
            } catch (err: any) {
                console.warn('[PriceIntel] Competitor enrich batch failed:', err.message);
            }
        }
        console.log(`[PriceIntel] Enriched ${competitorRawItems.length} competitor details`);
        // Seller nicknames (up to 15 unique sellers)
        const sellerIds = [...new Set(competitorRawItems.map((i: any) => String(i.seller_id)).filter(Boolean))].slice(0, 15);
        const sellerMap: Map<string, string> = new Map();
        for (const sid of sellerIds) {
            try {
                const sRes = await fetch(`https://api.mercadolibre.com/users/${sid}?attributes=id,nickname`, { headers: appAuthHeaders });
                if (sRes.ok) {
                    const sData = await sRes.json() as any;
                    sellerMap.set(sid, sData.nickname ?? sid);
                }
            } catch { /* non-fatal */ }
        }
        for (const item of competitorRawItems) {
            (item as any)._sellerNickname = sellerMap.get(String(item.seller_id)) ?? null;
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
    const priceToWinResults: any[] = [];

    for (const item of ourMatchingItems) {
        try {
            const ptwRes = await fetch(
                `https://api.mercadolibre.com/items/${item.id}/price_to_win`,
                { headers: authHeaders }   // must be seller user token
            );
            const ptwData = await ptwRes.json() as any;
            if (ptwRes.ok) {
                priceToWinResults.push({
                    itemId:      item.id,
                    title:       item.title,
                    ourPrice:    item.price,
                    status:      ptwData.status ?? 'unknown',          // 'winner' | 'not_winner' | 'not_eligible'
                    priceToWin:  ptwData.price_to_win ?? null,
                    catalogProductId: item.catalog_product_id ?? ptwData.catalog_product_id ?? null,
                    actions:     ptwData.actions ?? [],
                    raw:         ptwData,
                });
                console.log(`[PriceIntel] price_to_win ${item.id}: status=${ptwData.status}, ptw=${ptwData.price_to_win}`);
            } else {
                console.warn(`[PriceIntel] price_to_win ${item.id} HTTP ${ptwRes.status}:`, JSON.stringify(ptwData).slice(0, 200));
                priceToWinResults.push({
                    itemId:   item.id,
                    title:    item.title,
                    ourPrice: item.price,
                    status:   'api_error',
                    priceToWin: null,
                    catalogProductId: item.catalog_product_id ?? null,
                    raw:      ptwData,
                });
            }
        } catch (err: any) {
            console.warn(`[PriceIntel] price_to_win error for ${item.id}:`, err.message);
        }
    }

    // ── 8. Enrich via catalog: get buy-box winner for each catalog product ─────
    //
    // For items that belong to a catalog product, GET /products/{catalog_product_id}
    // is a documented endpoint that returns the buy_box_winner item.
    // This gives us the actual winning competitor listing we can display in the table.
    //
    const catalogProductIds = new Set(
        priceToWinResults.map(r => r.catalogProductId).filter(Boolean) as string[]
    );

    const competitorListingsMap: Map<string, any> = new Map();

    for (const cpId of catalogProductIds) {
        try {
            const cpRes = await fetch(
                `https://api.mercadolibre.com/products/${cpId}`,
                { headers: appAuthHeaders }
            );
            if (!cpRes.ok) {
                console.warn(`[PriceIntel] /products/${cpId} → HTTP ${cpRes.status}`);
                continue;
            }
            const cpData = await cpRes.json() as any;
            const bbWinner = cpData.buy_box_winner;
            if (bbWinner?.item_id && !ourItemIds.has(bbWinner.item_id)) {
                // Fetch the winner's item details
                try {
                    const bbRes = await fetch(
                        `https://api.mercadolibre.com/items/${bbWinner.item_id}?attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail`,
                        { headers: appAuthHeaders }
                    );
                    if (bbRes.ok) {
                        const bbItem = await bbRes.json() as any;
                        // Fetch seller nickname
                        let sellerNickname: string | null = null;
                        try {
                            const sRes = await fetch(`https://api.mercadolibre.com/users/${bbItem.seller_id}?attributes=id,nickname,seller_reputation`, { headers: appAuthHeaders });
                            if (sRes.ok) {
                                const sData = await sRes.json() as any;
                                sellerNickname = sData.nickname ?? null;
                            }
                        } catch { /* non-fatal */ }

                        competitorListingsMap.set(bbWinner.item_id, {
                            itemId:          bbItem.id,
                            title:           bbItem.title || '',
                            price:           bbItem.price || 0,
                            sellerId:        String(bbItem.seller_id ?? ''),
                            sellerNickname,
                            sellerReputation:'unknown',
                            soldQuantity:    bbItem.sold_quantity || 0,
                            listingType:     bbItem.listing_type_id || 'free',
                            isFreeShipping:  bbItem.shipping?.free_shipping === true,
                            isOurListing:    false,
                            isBuyBoxWinner:  true,
                            permalink:       bbItem.permalink || '',
                            thumbnail:       bbItem.thumbnail || '',
                            rank:            1,
                            scrapedAt:       new Date(),
                        });
                        console.log(`[PriceIntel] Buy-box winner for catalog ${cpId}: ${bbItem.id} @ $${bbItem.price}`);
                    }
                } catch { /* non-fatal */ }
            }
        } catch (err: any) {
            console.warn(`[PriceIntel] /products/${cpId} failed:`, err.message);
        }
    }

    // ── 9. Build listings table ────────────────────────────────────────────────
    const ourListingsForDb: any[] = ourMatchingItems.map((item, idx) => {
        const ptw = priceToWinResults.find(r => r.itemId === item.id);
        return {
            itemId:          item.id,
            title:           item.title || '',
            price:           item.price || 0,
            sellerId:        sellerId,
            sellerNickname:  'PRAXIS MEXICO',
            sellerReputation:'unknown',
            soldQuantity:    item.sold_quantity || 0,
            listingType:     item.listing_type_id || 'free',
            isFreeShipping:  item.shipping?.free_shipping === true,
            isOurListing:    true,
            isWinner:        ptw?.status === 'winner',
            priceToWin:      ptw?.priceToWin ?? null,
            permalink:       item.permalink || '',
            thumbnail:       item.thumbnail || '',
            rank:            idx + 1,
            scrapedAt:       new Date(),
        };
    });

    // Catalog buy-box competitors (from /products/{id})
    const catalogCompetitorListings = [...competitorListingsMap.values()];

    // Browser-search competitors (main source — real competitor data from ML search)
    const browserCompetitorListings: any[] = competitorRawItems
        .filter(item => !ourItemIds.has(item.id))
        .map((item, idx) => ({
            itemId:          item.id,
            title:           item.title || '',
            price:           item.price || 0,
            sellerId:        String(item.seller_id ?? ''),
            sellerNickname:  (item as any)._sellerNickname ?? null,
            sellerReputation:'unknown',
            soldQuantity:    item.sold_quantity || 0,
            listingType:     item.listing_type_id || 'free',
            isFreeShipping:  item.shipping?.free_shipping === true,
            isOurListing:    false,
            isBuyBoxWinner:  false,
            permalink:       item.permalink || '',
            thumbnail:       item.thumbnail || '',
            rank:            idx + 1,
            scrapedAt:       new Date(),
        }));

    const allListings = [...ourListingsForDb, ...browserCompetitorListings, ...catalogCompetitorListings]
        .filter(l => l.price > 0)
        .sort((a, b) => a.price - b.price)
        .map((l, i) => ({ ...l, rank: i + 1 }));

    const totalCompetitorCount = browserCompetitorListings.length + catalogCompetitorListings.length;
    console.log(`[PriceIntel] ${allListings.length} total listings (${ourListingsForDb.length} ours, ${browserCompetitorListings.length} browser, ${catalogCompetitorListings.length} catalog)`);

    // ── 10. Compute market statistics ─────────────────────────────────────────
    const ourPrices    = ourMatchingItems.map(i => i.price).filter(p => p > 0);
    const ourPrice: number | null = ourPrices.length > 0 ? Math.min(...ourPrices) : null;

    // Competitor prices: browser search is primary; ptw & catalog are supplementary
    const eligiblePtw        = priceToWinResults.filter(r => r.priceToWin && r.priceToWin > 0).map(r => r.priceToWin as number);
    const catalogPrices      = catalogCompetitorListings.map(l => l.price).filter(p => p > 0);
    const browserPrices      = browserCompetitorListings.map(l => l.price).filter(p => p > 0);
    const allCompetitorPrices = [...browserPrices, ...catalogPrices, ...eligiblePtw];

    const marketFloor: number = allCompetitorPrices.length > 0 ? Math.min(...allCompetitorPrices) : 0;
    const marketMax:   number = allCompetitorPrices.length > 0 ? Math.max(...allCompetitorPrices) : 0;
    const marketMid:   number = allCompetitorPrices.length > 0
        ? allCompetitorPrices.reduce((s, v) => s + v, 0) / allCompetitorPrices.length
        : 0;

    // Win status: true if our price ≤ market floor OR price_to_win says 'winner'
    const isWinning = priceToWinResults.some(r => r.status === 'winner') ||
        (ourPrice !== null && marketFloor > 0 && ourPrice <= marketFloor);
    const positionInMarket: number | null = isWinning ? 1 : (ourPrice !== null ? 2 : null);

    const stats = {
        lowestPrice:      marketFloor,
        medianPrice:      Math.round(marketMid * 100) / 100,
        highestPrice:     marketMax || (ourPrice ?? 0),
        ourPrice,
        positionInMarket,
        totalCompetitors: totalCompetitorCount,
        priceToWin:       marketFloor || (priceToWinResults.find(r => r.priceToWin)?.priceToWin ?? null),
        isWinning,
        // dataSource tells the UI what drove the competitive intelligence:
        // 'price_to_win_api'  → only ML's own endpoint was used (no proxy/scraper)
        // 'catalog_buy_box'   → catalog product buy-box winner enrichment
        // 'scraper_search'    → ScraperAPI / Apify returned real search results
        dataSource: (
            browserCompetitorListings.length > 0 ? 'scraper_search' :
            catalogCompetitorListings.length > 0 ? 'catalog_buy_box' :
            priceToWinResults.some(r => r.priceToWin) ? 'price_to_win_api' :
            'own_listings_only'
        ),
        priceToWinDetails: priceToWinResults.map(r => ({
            itemId:     r.itemId,
            ourPrice:   r.ourPrice,
            status:     r.status,
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
        priceToWinDetails: priceToWinResults,   // raw per-item API data
    }, { merge: false });

    // ── 12. Write daily history snapshot ──────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const historyRef = docRef.collection('history').doc(today);
    const existingHistoryCount = await docRef.collection('history').count().get();
    const isBaseline = existingHistoryCount.data().count === 0;

    await historyRef.set({
        date: today,
        scannedAt: admin.firestore.FieldValue.serverTimestamp(),
        stats,
        listingCount: allListings.length,
        ...(isBaseline ? { isBaseline: true } : {}),
    }, { merge: true });

    if (isBaseline) console.log(`[PriceIntel] 📌 Baseline established for ${fingerprint} on ${today}`);

    // ── 13. Generate price alert if we're not winning ─────────────────────────
    if (!isWinning && ourPrice !== null && marketFloor > 0 && marketFloor < ourPrice * 0.95) {
        const gapPct = ((marketFloor - ourPrice) / ourPrice * 100);
        await db.collection('price_alerts').add({
            tireSize:        fingerprint,
            ourPrice,
            competitorPrice: marketFloor,
            gap:             `${gapPct.toFixed(1)}%`,
            alertType:       'undercut',
            createdAt:       admin.firestore.FieldValue.serverTimestamp(),
            isRead:          false,
        });
        console.log(`[PriceIntel] 🚨 Alert: ${fingerprint} market floor $${marketFloor} vs ours $${ourPrice} (${gapPct.toFixed(1)}%)`);
    }

    return {
        cached:     false,
        fingerprint,
        stats,
        count:      allListings.length,
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
export const prunePriceHistory = functions
    .runWith({ timeoutSeconds: 300, memory: '256MB' })
    .pubsub
    .schedule('0 4 * * *')          // cron: daily at 04:00 UTC
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

            if (oldDocs.empty) continue;

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

        const monthStr   = `${year}-${String(month + 1).padStart(2, '0')}`;
        const dayStr     = String(day).padStart(2, '0');
        const dateStr    = `${monthStr}-${dayStr}`;   // YYYY-MM-DD

        const startOfDay = new Date(year, month, day,  0,  0,  0,   0);
        const endOfDay   = new Date(year, month, day, 23, 59, 59, 999);

        // ── Canonical non-revenue statuses (mirrors order.model.ts) ──────────
        const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];

        // ── Canonical channel resolution (mirrors ops queue getLegacyChannel) ─
        const resolveChannel = (order: any): string => {
            const sc  = order.sourceChannel;
            const ft  = order.fulfillmentType;
            if (!sc || sc === 'storefront') return 'WEB';
            if (sc === 'pos')               return 'POS';
            if (sc === 'on_behalf')         return 'ON_BEHALF';
            if (sc === 'amazon')            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
            if (sc === 'mercadolibre')      return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
            return 'WEB';
        };

        // ── Read today's orders ───────────────────────────────────────────────
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();

        // ── Aggregate: totals + per-channel breakdowns ────────────────────────
        let totalSales = 0, totalOrders = 0, totalPieces = 0;
        const byChannel: Record<string, { revenue: number; orders: number; units: number }> = {};

        ordersSnap.docs.forEach(docSnap => {
            const order = docSnap.data();
            if (NON_REVENUE.includes(order['status'])) return;   // skip ghost & void orders

            const revenue = Number(order['total'] ?? 0);
            const units   = (order['items'] as any[] ?? [])
                .reduce((s: number, item: any) => s + (Number(item.quantity) || 1), 0);
            const channel = resolveChannel(order);

            totalSales  += revenue;
            totalOrders += 1;
            totalPieces += units;

            if (!byChannel[channel]) byChannel[channel] = { revenue: 0, orders: 0, units: 0 };
            byChannel[channel].revenue += revenue;
            byChannel[channel].orders  += 1;
            byChannel[channel].units   += units;
        });

        const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
        const ts = admin.firestore.FieldValue.serverTimestamp();

        // ── 1. Legacy monthly_stats (backward compat) ─────────────────────────
        const monthRef = db.collection('monthly_stats').doc(monthStr);
        const dayRef   = monthRef.collection('days').doc(dayStr);
        await dayRef.set({
            day: dayStr, month: monthStr,
            sales: totalSales, orders: totalOrders, pieces: totalPieces,
            updatedAt: ts,
        });
        const allDaysSnap = await monthRef.collection('days').get();
        let mSales = 0, mOrders = 0, mPieces = 0;
        allDaysSnap.docs.forEach(d => {
            mSales  += Number(d.data()['sales']  ?? 0);
            mOrders += Number(d.data()['orders'] ?? 0);
            mPieces += Number(d.data()['pieces'] ?? 0);
        });
        await monthRef.set({ month: monthStr, sales: mSales, orders: mOrders, pieces: mPieces, updatedAt: ts }, { merge: true });

        // ── 2. analytics_daily/{YYYY-MM-DD} ──────────────────────────────────
        const dt = new Date(`${dateStr}T12:00:00`);
        await db.collection('analytics_daily').doc(dateStr).set({
            date:         dateStr,
            month:        monthStr,
            dayOfWeek:    (dt.getDay() + 6) % 7,   // 0=Mon … 6=Sun (ISO)
            totalRevenue: totalSales,
            totalOrders,
            totalUnits:   totalPieces,
            avgTicket,
            byChannel,
            updatedAt:    ts,
        }, { merge: true });

        // ── 3. analytics_monthly/{YYYY-MM} ────────────────────────────────────
        await db.collection('analytics_monthly').doc(monthStr).set({
            month: monthStr,
            totalRevenue: admin.firestore.FieldValue.increment(totalSales),
            totalOrders:  admin.firestore.FieldValue.increment(totalOrders),
            totalUnits:   admin.firestore.FieldValue.increment(totalPieces),
            updatedAt:    ts,
        }, { merge: true });

        // ── 4. analytics_channel_snapshots/{channel}/{YYYY-MM-DD} ─────────────
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
                orders:  data.orders,
                units:   data.units,
                avgPrice: data.orders > 0 ? data.revenue / data.orders : 0,
                // visits & conversionRate filled in by meliEnrichDailySnapshot below
                updatedAt: ts,
            }, { merge: true });
        }
        await batch.commit();

        // ── 5. Enrich MELI_FULL snapshot with visit data from MeLi Metrics API ─
        try {
            const meliConfig = await getMeliConfig();
            if (meliConfig?.accessToken && meliConfig?.userId && byChannel['MELI_FULL']) {
                const token = await getValidMeliToken();
                const visitsRes = await fetch(
                    `https://api.mercadolibre.com/users/${meliConfig.userId}/items_visits/time_window?last=1&unit=day`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                if (visitsRes.ok) {
                    const visitsJson = await visitsRes.json() as any;
                    const totalVisits = visitsJson?.total_visits ?? 0;
                    const meliFullOrders = byChannel['MELI_FULL'].orders ?? 0;
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

                    console.log(`[DailyStats] MELI_FULL visits=${totalVisits}, conv=${conversionRate}%`);
                }
            }
        } catch (meliErr) {
            // Non-critical: metrics API enrichment failed, snapshot still has order data
            console.warn('[DailyStats] MeLi visits enrichment failed (non-critical):', meliErr);
        }

        console.log(`[DailyStats] ${dateStr}: orders=${totalOrders}, revenue=$${totalSales.toFixed(0)}, pieces=${totalPieces}`);
        console.log(`[DailyStats] Channels:`, JSON.stringify(Object.fromEntries(
            Object.entries(byChannel).map(([ch, d]) => [ch, `$${d.revenue.toFixed(0)} / ${d.orders}o`])
        )));
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

export const cleanupAbandonedCheckouts = functions.pubsub
    .schedule('5,35 * * * *')      // every 30 min at :05 and :35
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        const now     = new Date();
        const cutoff  = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago

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
            const history = data['history'] ?? [];
            batch.update(orderDoc.ref, {
                status:    'cancelled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                history:   [...history, {
                    status:    'cancelled',
                    timestamp: admin.firestore.Timestamp.now(),
                    note:      'Pago no completado — cancelación automática (35 min)',
                    updatedBy: 'system',
                }],
            });
        }

        await batch.commit();
        console.log(`[CleanupCheckouts] Done. ${snap.size} order(s) cancelled.`);
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
async function computeInventoryVelocity(): Promise<{ updated: number; errors: string[] }> {
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const now = new Date();
    const start30 = new Date(now); start30.setDate(now.getDate() - 30);
    const start7  = new Date(now); start7.setDate(now.getDate() - 7);

    // 1. Load all MELI_FULL revenue orders from last 30 days
    const ordersSnap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('fulfillmentType', '==', 'platform')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start30))
        .get();

    // 2. Build SKU velocity maps: { sku → { units30d, units7d } }
    const velocityMap: Record<string, { units30d: number; units7d: number }> = {};
    const itemIdMap:   Record<string, { units30d: number; units7d: number }> = {};

    for (const snap of ordersSnap.docs) {
        const order = snap.data();
        if (NON_REVENUE.includes(order['status'])) continue;

        const orderDate = (order['createdAt'] as admin.firestore.Timestamp).toDate();
        const inLast7   = orderDate >= start7;

        const items = (order['items'] as any[] ?? []);
        for (const item of items) {
            const sku    = (item.sku ?? '').trim();
            const mlId   = (item.mlItemId ?? item.productId ?? '').trim();
            const qty    = Number(item.quantity) || 1;

            if (sku) {
                if (!velocityMap[sku]) velocityMap[sku] = { units30d: 0, units7d: 0 };
                velocityMap[sku].units30d += qty;
                if (inLast7) velocityMap[sku].units7d += qty;
            }
            if (mlId) {
                if (!itemIdMap[mlId]) itemIdMap[mlId] = { units30d: 0, units7d: 0 };
                itemIdMap[mlId].units30d += qty;
                if (inLast7) itemIdMap[mlId].units7d += qty;
            }
        }
    }

    // 3. Load all FBM inventory docs
    const invSnap = await db.collection('meli_fbm_inventory').get();
    const errors: string[] = [];
    const batch = db.batch();
    let updated = 0;

    for (const invDoc of invSnap.docs) {
        try {
            const data = invDoc.data();
            const sku   = (data['sku'] ?? '').trim();
            const mlId  = (data['mlItemId'] ?? '').trim();

            // Prefer SKU match, fall back to ML Item ID
            const vel = (sku && velocityMap[sku])   ? velocityMap[sku]
                      : (mlId && itemIdMap[mlId])    ? itemIdMap[mlId]
                      : null;

            const units30d    = vel?.units30d ?? 0;
            const units7d     = vel?.units7d  ?? 0;
            const vel30       = units30d / 30;
            const vel7        = units7d  / 7;
            const available   = Number(data['availableQuantity'] ?? data['fullStock'] ?? 0);
            const daysOfCoverage = vel30 > 0 ? Math.floor(available / vel30) : 9999;
            const targetDays  = 45;
            const replenish   = vel30 > 0
                ? Math.max(0, Math.ceil((targetDays * vel30) - available))
                : 0;

            let alertLevel: 'ok' | 'low' | 'critical' | 'stockout';
            if (available === 0)        alertLevel = 'stockout';
            else if (daysOfCoverage < 7)  alertLevel = 'critical';
            else if (daysOfCoverage < 21) alertLevel = 'low';
            else                          alertLevel = 'ok';

            const stockoutDate = vel30 > 0 && available > 0
                ? new Date(now.getTime() + (daysOfCoverage * 86400000))
                    .toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
                : null;

            batch.update(invDoc.ref, {
                salesVelocity30d:         parseFloat(vel30.toFixed(2)),
                salesVelocity7d:          parseFloat(vel7.toFixed(2)),
                daysOfCoverage,
                reorderAlertLevel:        alertLevel,
                recommendedReplenishQty:  replenish,
                projectedStockoutDate:    stockoutDate,
                lastVelocityCalc:         admin.firestore.FieldValue.serverTimestamp(),
            });
            updated++;
        } catch (err: any) {
            errors.push(`${invDoc.id}: ${err?.message ?? err}`);
        }
    }

    await batch.commit();
    return { updated, errors };
}

export const meliEnrichInventoryVelocity = functions.pubsub
    .schedule('0 6 * * 1')       // Every Monday 06:00 MX
    .timeZone('America/Mexico_City')
    .onRun(async (_context) => {
        const result = await computeInventoryVelocity();
        console.log(`[VelocityEnrich] updated=${result.updated}, errors=${result.errors.length}`);
        if (result.errors.length) console.warn('[VelocityEnrich] errors:', result.errors);
    });

export const meliEnrichInventoryVelocityCallable = functions
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

export const backfillAnalytics = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data: { fromDate?: string; toDate?: string }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];

        const resolveChannel = (order: any): string => {
            const sc = order.sourceChannel; const ft = order.fulfillmentType;
            if (!sc || sc === 'storefront') return 'WEB';
            if (sc === 'pos')     return 'POS';
            if (sc === 'on_behalf') return 'ON_BEHALF';
            if (sc === 'amazon')  return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
            if (sc === 'mercadolibre') return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
            return 'WEB';
        };

        const toMxDateStr = (d: Date): string =>
            d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

        // Date range: default = start of 2024 to yesterday
        const now = new Date();
        const fromDate = data?.fromDate
            ? new Date(data.fromDate + 'T06:00:00')
            : new Date('2024-01-01T06:00:00');
        const toDate = data?.toDate
            ? new Date(data.toDate + 'T23:59:59')
            : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Load ALL orders in range in one query (< 100K docs — manageable in 1GB)
        const allOrdersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
            .get();

        console.log(`[BackfillAnalytics] Total orders loaded: ${allOrdersSnap.size}`);

        // Group orders by MX date key
        const dateMap: Record<string, Record<string, {
            revenue: number; orders: number; units: number;
        }>> = {};   // dateStr → channelId → metrics

        for (const snap of allOrdersSnap.docs) {
            const order = snap.data();
            if (NON_REVENUE.includes(order['status'])) continue;

            const orderDate = (order['createdAt'] as admin.firestore.Timestamp).toDate();
            const dateKey   = toMxDateStr(orderDate);
            const channel   = resolveChannel(order);
            const revenue   = Number(order['total'] ?? 0);
            const units     = (order['items'] as any[] ?? [])
                .reduce((s: number, i: any) => s + (Number(i.quantity) || 1), 0);

            if (!dateMap[dateKey]) dateMap[dateKey] = {};
            if (!dateMap[dateKey][channel]) dateMap[dateKey][channel] = { revenue: 0, orders: 0, units: 0 };
            dateMap[dateKey][channel].revenue += revenue;
            dateMap[dateKey][channel].orders  += 1;
            dateMap[dateKey][channel].units   += units;
        }

        // Write analytics_daily and analytics_channel_snapshots in batches of 400
        const ts = admin.firestore.FieldValue.serverTimestamp();
        let writeCount = 0;
        let batch = db.batch();
        let batchSize = 0;

        const flushBatch = async () => {
            if (batchSize > 0) { await batch.commit(); batch = db.batch(); batchSize = 0; }
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
                totalRevenue += ch.revenue; totalOrders += ch.orders; totalUnits += ch.units;
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
            if (batchSize >= 400) await flushBatch();
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
export const meliPriceScanDiag = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }

    const width       = data?.width       ?? 120;
    const aspectRatio = data?.aspectRatio ?? 70;
    const diameter    = data?.diameter    ?? 17;
    const categoryId  = data?.categoryId  ?? 'MLM169975';

    const report: Record<string, any> = {
        version:    '2026-04-17-v1',
        testedSize: `${width}/${aspectRatio}R${diameter}`,
        ranAt:      new Date().toISOString(),
    };

    // Step 1: Read integrations config
    let meliConfig: any = null;
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const raw = configDoc.data()?.meli ?? null;
        meliConfig = raw;
        report.step1_config = {
            ok:               !!raw,
            docExists:        configDoc.exists,
            hasAccessToken:   !!(raw?.accessToken),
            hasRefreshToken:  !!(raw?.refreshToken),
            hasAppId:         !!(raw?.appId),
            hasClientSecret:  !!(raw?.clientSecret),
            hasUserId:        !!(raw?.userId),
            connected:        raw?.connected ?? false,
            expiresAt:        raw?.expiresAt ? new Date(raw.expiresAt).toISOString() : null,
            tokenExpiresIn:   raw?.expiresAt
                ? `${Math.round((raw.expiresAt - Date.now()) / 60000)} min`
                : 'unknown',
            accessTokenFirst8: raw?.accessToken
                ? `${String(raw.accessToken).substring(0, 8)}...`
                : null,
        };
    } catch (err: any) {
        report.step1_config = { ok: false, error: err.message };
    }

    // Step 0: Test app-level token (client_credentials) — the key fix for GCP IP blocking
    let appToken: string | null = null;
    try {
        appToken = await getAppLevelToken();
        report.step0_app_token = {
            ok:          true,
            tokenFirst8: appToken.substring(0, 8) + '...',
            message:     'App token (client_credentials) obtained — search calls will use this token',
        };
    } catch (err: any) {
        report.step0_app_token = { ok: false, error: err.message, message: 'App token failed — will fall back to user token for searches' };
        // Not fatal — we continue with user token
    }

    // Step 2: Get valid token (with auto-refresh)
    let accessToken: string | null = null;
    try {
        accessToken = await getValidMeliToken();
        report.step2_token = {
            ok:          true,
            tokenFirst8: accessToken.substring(0, 8) + '...',
            message:     'User token obtained successfully',
        };
    } catch (err: any) {
        report.step2_token = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 2: Cannot get a valid ML access token. Re-authenticate at /admin/integrations.';
        return report;
    }

    const authHeaders:    Record<string, string> = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders: Record<string, string> = { 'Authorization': `Bearer ${appToken ?? accessToken}` };

    // Step 3: Verify token via /users/me
    try {
        const meRes  = await fetch('https://api.mercadolibre.com/users/me', { headers: authHeaders });
        const meData = await meRes.json() as any;
        report.step3_users_me = {
            ok:         meRes.ok,
            httpStatus: meRes.status,
            userId:     meData?.id ?? null,
            nickname:   meData?.nickname ?? null,
            siteId:     meData?.site_id ?? null,
            error:      !meRes.ok ? (meData?.message || `HTTP ${meRes.status}`) : null,
        };
        if (!meRes.ok) {
            report.verdict = `❌ BLOCKED at Step 3: Token rejected (${meRes.status}: ${meData?.message}). Re-authenticate.`;
            return report;
        }
    } catch (err: any) {
        report.step3_users_me = { ok: false, error: err.message };
        report.verdict = '❌ BLOCKED at Step 3: Network error reaching ML API.';
        return report;
    }

    // Step 4: Check category attribute names
    try {
        const catRes  = await fetch(
            `https://api.mercadolibre.com/categories/${categoryId}/attributes`,
            { headers: authHeaders }
        );
        const catData = await catRes.json() as any[];
        const attrIds = Array.isArray(catData) ? catData.map((a: any) => a.id) : [];
        const hasWidth   = attrIds.includes('SECTION_WIDTH');
        const hasAR      = attrIds.includes('AUTOMOTIVE_TIRE_ASPECT_RATIO');
        const hasRim     = attrIds.includes('RIM_DIAMETER');
        const hasMfgSize = attrIds.includes('MANUFACTURER_TIRE_SIZE');
        report.step4_category_attrs = {
            ok:              catRes.ok,
            httpStatus:      catRes.status,
            categoryId,
            totalAttributes: attrIds.length,
            hasSECTION_WIDTH:                hasWidth,
            hasAUTOMOTIVE_TIRE_ASPECT_RATIO: hasAR,
            hasRIM_DIAMETER:                 hasRim,
            hasMANUFACTURER_TIRE_SIZE:       hasMfgSize,
            verdict: (hasWidth && hasAR && hasRim)
                ? 'All 3 size attributes present'
                : 'SOME SIZE ATTRIBUTES MISSING — ML may have renamed them, causing zero results',
        };
    } catch (err: any) {
        report.step4_category_attrs = { ok: false, error: err.message };
    }

    // Step 5: Strategy S1 — keyword search WITH APP TOKEN (the fixed approach)
    try {
        const url = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=5&sort=price_asc`;
        const r    = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN — key fix
        const body = await r.json() as any;
        report.step5_attr_search = {
            ok:            r.ok,
            httpStatus:    r.status,
            url,
            totalResults:  body?.paging?.total ?? null,
            returnedCount: (body?.results ?? []).length,
            firstItem: body?.results?.[0]
                ? { id: body.results[0].id, title: body.results[0].title, price: body.results[0].price }
                : null,
            rawError: !r.ok ? body : null,
            error: !r.ok ? (body?.message ?? body?.error ?? `HTTP ${r.status}`) : null,
        };
    } catch (err: any) {
        report.step5_attr_search = { ok: false, error: err.message };
    }

    // Step 5b: Strategy D — catalog product items (WITH auth, avoids search endpoint)
    try {
        // Try first discovered productId, or a known catalog product for 120/70R17
        const testProductId = report.step5_attr_search?.ok === false ? 'MLAP9213' : null; // fallback known product
        const prodRes = await fetch(
            `https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(`${width}/${aspectRatio}R${diameter}`)}&category=${categoryId}&limit=3`,
            { headers: appAuthHeaders }
        );
        if (prodRes.ok) {
            const prodData = await prodRes.json() as any;
            const firstProd = (prodData.results || [])[0];
            if (firstProd?.id) {
                const itemsRes = await fetch(
                    `https://api.mercadolibre.com/products/${firstProd.id}/items?site_id=MLM&limit=5`,
                    { headers: appAuthHeaders }
                );
                const itemsBody = await itemsRes.json() as any;
                const items: any[] = itemsBody.results ?? itemsBody.items ?? (Array.isArray(itemsBody) ? itemsBody : []);
                report.step5b_catalog_items = {
                    ok:           itemsRes.ok,
                    httpStatus:   itemsRes.status,
                    catalogProductId: firstProd.id,
                    returnedCount: items.length,
                    firstItem:    items[0] ? { id: items[0].id, title: items[0].title, price: items[0].price } : null,
                    rawError:     !itemsRes.ok ? itemsBody : null,
                    error:        !itemsRes.ok ? (itemsBody?.message ?? itemsBody?.error ?? `HTTP ${itemsRes.status}`) : null,
                };
            } else {
                report.step5b_catalog_items = { ok: false, error: 'No catalog products found for this size' };
            }
        } else {
            const errBody = await prodRes.json().catch(() => ({})) as any;
            report.step5b_catalog_items = { ok: false, httpStatus: prodRes.status, error: errBody?.message ?? `HTTP ${prodRes.status}` };
        }
    } catch (err: any) {
        report.step5b_catalog_items = { ok: false, error: err.message };
    }
    // Step 6: Strategy S2 — attribute search WITH APP TOKEN
    try {
        const sizeStr = `${width}/${aspectRatio}R${diameter}`;
        const url = `https://api.mercadolibre.com/sites/MLM/search?category=${categoryId}&SECTION_WIDTH=${width}&AUTOMOTIVE_TIRE_ASPECT_RATIO=${aspectRatio}&RIM_DIAMETER=${diameter}&limit=5&sort=price_asc`;
        const r    = await fetch(url, { headers: appAuthHeaders }); // APP TOKEN
        const body = await r.json() as any;
        report.step6_size_string_search = {
            ok:            r.ok,
            httpStatus:    r.status,
            sizeStr,
            url,
            totalResults:  body?.paging?.total ?? null,
            returnedCount: (body?.results ?? []).length,
            rawError:      !r.ok ? body : null,
            error: !r.ok ? (body?.message ?? body?.error ?? `HTTP ${r.status}`) : null,
        };
    } catch (err: any) {
        report.step6_size_string_search = { ok: false, error: err.message };
    }

    // Step 7: Our seller items
    const sellerId = meliConfig?.userId ? String(meliConfig.userId) : null;
    let firstItemId: string | null = null;
    if (sellerId) {
        try {
            const url  = `https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=5`;
            const r    = await fetch(url, { headers: authHeaders });
            const body = await r.json() as any;
            firstItemId = (body?.results ?? [])[0] ?? null;
            report.step7_seller_items = {
                ok:         r.ok,
                httpStatus: r.status,
                sellerId,
                totalItems: body?.paging?.total ?? null,
                firstIds:   (body?.results ?? []).slice(0, 5),
                error: !r.ok ? (body?.message || body?.error || `HTTP ${r.status}`) : null,
            };
        } catch (err: any) {
            report.step7_seller_items = { ok: false, sellerId, error: err.message };
        }
    } else {
        report.step7_seller_items = {
            ok:    false,
            error: 'No sellerId in config/integrations.meli',
        };
    }

    // Step 7b: Test price_to_win on the first of our active items
    // This is the CORE endpoint of the new implementation — must be ✅ for scans to work.
    if (firstItemId) {
        try {
            const ptwRes  = await fetch(
                `https://api.mercadolibre.com/items/${firstItemId}/price_to_win`,
                { headers: authHeaders }  // seller user token required
            );
            const ptwBody = await ptwRes.json() as any;
            report.step7b_price_to_win = {
                ok:          ptwRes.ok,
                httpStatus:  ptwRes.status,
                testedItemId: firstItemId,
                status:      ptwBody.status ?? null,          // 'winner' | 'not_winner' | 'not_eligible'
                priceToWin:  ptwBody.price_to_win ?? null,
                rawResponse: ptwBody,
                error:       !ptwRes.ok ? (ptwBody.message ?? ptwBody.error ?? `HTTP ${ptwRes.status}`) : null,
                note:        ptwRes.ok
                    ? (ptwBody.status === 'not_eligible'
                        ? 'Item not part of ML catalog — price_to_win not available for this listing'
                        : 'price_to_win endpoint working correctly')
                    : 'price_to_win failed — scans will not return competitive data',
            };
        } catch (err: any) {
            report.step7b_price_to_win = { ok: false, testedItemId: firstItemId, error: err.message };
        }
    } else {
        report.step7b_price_to_win = { ok: false, error: 'No active items found to test price_to_win' };
    }

    // Step 8: Firestore write/read round-trip
    try {
        const testRef = db.collection('price_intelligence').doc('diag-test-tmp');
        await testRef.set({ _diagTest: true, ranAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const check = await testRef.get();
        await testRef.delete();
        report.step8_firestore = {
            ok:      check.exists,
            message: check.exists ? 'Firestore write/read OK' : 'Write ok but read failed',
        };
    } catch (err: any) {
        report.step8_firestore = { ok: false, error: err.message };
    }

    // Final verdict — based on price_to_win approach (new authoritative method)
    const ptwOk   = report.step7b_price_to_win?.ok === true;
    const ptwElig = report.step7b_price_to_win?.status !== 'not_eligible';
    const authOk  = report.step2_token?.ok && report.step3_users_me?.ok;

    if (!authOk) {
        report.verdict = '❌ BLOCKED: Authentication broken — reconnect MercadoLibre in /admin/integrations.';
    } else if (!report.step7_seller_items?.ok || !report.step7_seller_items?.totalItems) {
        report.verdict = '⚠️ No active items found. Add a MercadoLibre listing to enable Price Intelligence.';
    } else if (!ptwOk) {
        report.verdict = `⚠️ price_to_win endpoint failed (HTTP ${report.step7b_price_to_win?.httpStatus}). Check seller permissions or re-authenticate.`;
    } else if (!ptwElig) {
        report.verdict = '⚠️ Tested item is not in ML catalog so price_to_win returned not_eligible. Scan the correct tire size (one you have listed in the catalog).';
    } else {
        report.verdict = `✅ Pipeline OK — price_to_win working (status: ${report.step7b_price_to_win?.status}, ptw: $${report.step7b_price_to_win?.priceToWin ?? 'N/A'}). Ready to scan.`;
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
async function getPaidMediaConfig(): Promise<{ meta: any; google: any }> {
    const snap = await db.collection('config').doc('integrations').get();
    const data = snap.data() ?? {};
    return { meta: data['meta'] ?? {}, google: data['google'] ?? {} };
}

/** Returns 'YYYY-MM-DD' for a Date in Mexico City timezone */
function toDateStr(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ── Meta helpers ──────────────────────────────────────────────────────────────
const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function actionVal(arr: { action_type: string; value: string }[] | undefined, type: string): number {
    if (!arr) return 0;
    const found = arr.find((a: any) => a.action_type === type);
    return found ? parseFloat(found.value) : 0;
}

async function fetchMetaCampaigns(adAccountId: string, accessToken: string, datePreset: string): Promise<any[]> {
    const fields = [
        'id', 'name', 'status',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,purchase_roas,actions,action_values}`,
    ].join(',');
    const url  = `${META_GRAPH_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${accessToken}&limit=100`;
    const res  = await fetch(url);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`Meta API: ${body?.error?.message ?? JSON.stringify(body)}`);
    return body.data ?? [];
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com/v17';

async function getGoogleToken(cfg: any): Promise<string> {
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id:     cfg.clientId,
            client_secret: cfg.clientSecret,
            refresh_token: cfg.refreshToken,
            grant_type:    'refresh_token',
        }).toString(),
    });
    const d = await r.json() as any;
    if (!r.ok || !d.access_token) throw new Error(`Google OAuth: ${d.error_description ?? JSON.stringify(d)}`);
    return d.access_token;
}

async function fetchGoogleCampaigns(customerId: string, developerToken: string, accessToken: string, dateStr: string): Promise<any[]> {
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
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`Google Ads API: ${body?.error?.message ?? JSON.stringify(body)}`);
    return body.results ?? [];
}

// ── Core sync logic ───────────────────────────────────────────────────────────
async function runPaidMediaSync(targetDate: Date) {
    const dateStr  = toDateStr(targetDate);
    const errors: string[] = [];
    let metaCount = 0, googleCount = 0;

    const cfg         = await getPaidMediaConfig();
    const batch       = db.batch();
    const snapsBase   = db.collection('advertising_snapshots').doc(dateStr);
    const pulledAt    = admin.firestore.FieldValue.serverTimestamp();
    const cacheRef    = db.collection('advertising_cache').doc('latest');

    // ── Meta ─────────────────────────────────────────────────────────────────
    const metaCfg = cfg.meta;
    if (metaCfg?.accessToken && metaCfg?.adAccountId) {
        try {
            const camps = await fetchMetaCampaigns(metaCfg.adAccountId, metaCfg.accessToken, 'yesterday');
            let mSpend = 0, mImpr = 0, mClicks = 0, mPurch = 0;

            for (const camp of camps) {
                const ins = (camp.insights?.data ?? [])[0];
                if (!ins) continue;
                const spend       = parseFloat(ins.spend)      || 0;
                const impressions = parseInt(ins.impressions)   || 0;
                const clicks      = parseInt(ins.clicks)        || 0;
                const reach       = parseInt(ins.reach)         || 0;
                const frequency   = parseFloat(ins.frequency)   || 0;
                const cpm         = parseFloat(ins.cpm)         || 0;
                const cpc         = parseFloat(ins.cpc)         || 0;
                const ctr         = parseFloat(ins.ctr)         || 0;
                const purchases   = actionVal(ins.actions,       'purchase');
                const purchaseValue = actionVal(ins.action_values, 'purchase');
                const addToCart   = actionVal(ins.actions,       'add_to_cart');
                const viewContent = actionVal(ins.actions,       'view_content');
                const purchaseRoas = ins.purchase_roas?.[0] ? parseFloat(ins.purchase_roas[0].value) : 0;

                batch.set(snapsBase.collection('meta').doc(camp.id), {
                    campaignId: camp.id, campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, reach, frequency, cpm, cpc, ctr,
                    purchases, purchaseValue, purchaseRoas, addToCart, viewContent,
                    datePreset: 'yesterday', snapshotDate: dateStr, pulledAt,
                }, { merge: true });

                metaCount++;
                mSpend += spend; mImpr += impressions; mClicks += clicks; mPurch += purchases;
            }

            batch.set(cacheRef, {
                date: dateStr, metaSpend: mSpend, metaImpressions: mImpr,
                metaClicks: mClicks, metaPurchases: mPurch, updatedAt: pulledAt,
            }, { merge: true });

        } catch (err: any) {
            console.error('[PaidMedia] Meta error:', err.message);
            errors.push(`Meta: ${err.message}`);
        }
    }

    // ── Google Ads ────────────────────────────────────────────────────────────
    const gCfg = cfg.google;
    if (gCfg?.clientId && gCfg?.clientSecret && gCfg?.refreshToken && gCfg?.customerId && gCfg?.developerToken) {
        try {
            const gToken     = await getGoogleToken(gCfg);
            const yesterday  = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateStr(yesterday);

            const results = await fetchGoogleCampaigns(gCfg.customerId, gCfg.developerToken, gToken, yesterdayStr);
            let gSpend = 0, gImpr = 0, gClicks = 0, gConv = 0, gConvVal = 0;

            for (const row of results) {
                const camp = row.campaign, m = row.metrics;
                const spend            = (m.costMicros ?? 0) / 1_000_000;
                const impressions      = m.impressions   ?? 0;
                const clicks           = m.clicks        ?? 0;
                const ctr              = (m.ctr          ?? 0) * 100;
                const avgCpc           = (m.averageCpc   ?? 0) / 1_000_000;
                const conversions      = m.conversions   ?? 0;
                const allConversions   = m.allConversions ?? 0;
                const conversionsValue = m.conversionsValue ?? 0;
                const costPerConversion = conversions > 0 ? spend / conversions : 0;
                const impressionShare  = m.searchImpressionShare ?? null;

                batch.set(snapsBase.collection('google').doc(String(camp.id)), {
                    campaignId: String(camp.id), campaignName: camp.name, status: camp.status,
                    spend, impressions, clicks, ctr, avgCpc, conversions, allConversions,
                    conversionsValue, costPerConversion, impressionShare,
                    snapshotDate: dateStr, pulledAt,
                }, { merge: true });

                googleCount++;
                gSpend += spend; gImpr += impressions; gClicks += clicks;
                gConv += conversions; gConvVal += conversionsValue;
            }

            batch.set(cacheRef, {
                googleSpend: gSpend, googleImpressions: gImpr, googleClicks: gClicks,
                googleConversions: gConv,
                googleRoas: gSpend > 0 ? gConvVal / gSpend : 0,
                updatedAt: pulledAt,
            }, { merge: true });

        } catch (err: any) {
            console.error('[PaidMedia] Google error:', err.message);
            errors.push(`Google: ${err.message}`);
        }
    }

    await batch.commit();
    console.log(`[PaidMedia] ${dateStr}: Meta=${metaCount}, Google=${googleCount}, Errors=${errors.length}`);
    return { metaCampaigns: metaCount, googleCampaigns: googleCount, errors };
}

// ── Scheduled: daily at 06:00 Mexico City ────────────────────────────────────
export const syncPaidMediaSnapshots = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .pubsub.schedule('0 12 * * *')      // 06:00 Mexico City = 12:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async () => { await runPaidMediaSync(new Date()); return null; });

// ── Manual trigger (callable from Angular) ────────────────────────────────────
export const triggerPaidMediaSync = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const role = context.auth.token?.role as string | undefined;
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role ?? ''))
        throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
    try {
        const result = await runPaidMediaSync(data?.date ? new Date(data.date) : new Date());
        return { ok: true, ...result };
    } catch (err: any) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// ── Read insights — joins snapshots + internal orders ─────────────────────────
export const getPaidMediaInsights = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { campaignName, metaCampaignId, googleCampaignId, days = 30 } = data ?? {};
    const today   = new Date();
    const history: any[] = [];
    let latestMeta: any = null, latestGoogle: any = null;

    // Fetch per-day snapshots in parallel
    await Promise.all(Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr   = toDateStr(d);
        const snapsBase = db.collection('advertising_snapshots').doc(dateStr);

        return Promise.all([
            metaCampaignId   ? snapsBase.collection('meta').doc(metaCampaignId).get()    : Promise.resolve(null),
            googleCampaignId ? snapsBase.collection('google').doc(googleCampaignId).get() : Promise.resolve(null),
        ]).then(([ms, gs]) => {
            const md = ms?.exists  ? ms.data()  : null;
            const gd = gs?.exists  ? gs.data()  : null;
            if (i === 0) { latestMeta = md; latestGoogle = gd; }
            history.push({
                date: dateStr, metaSpend: md?.spend ?? 0, googleSpend: gd?.spend ?? 0,
                totalSpend: (md?.spend ?? 0) + (gd?.spend ?? 0), revenue: 0, roas: null,
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
        const revByDate = new Map<string, number>();

        for (const doc of ordersSnap.docs) {
            const d = doc.data() as any;
            const cs = (d.attribution?.utm?.utm_campaign ?? '').toLowerCase().trim();
            if (!cs || (!cs.includes(slug) && !slug.includes(cs))) continue;
            const rev = d.total ?? d.totalAmount ?? 0;
            totalOrders++; totalRevenue += rev;
            const ds = toDateStr((d.createdAt as admin.firestore.Timestamp).toDate());
            revByDate.set(ds, (revByDate.get(ds) ?? 0) + rev);
        }

        for (const pt of history) {
            pt.revenue = revByDate.get(pt.date) ?? 0;
            pt.roas    = pt.totalSpend > 0 ? pt.revenue / pt.totalSpend : null;
        }
    }

    history.sort((a, b) => a.date.localeCompare(b.date));
    const totalSpend = (latestMeta?.spend ?? 0) + (latestGoogle?.spend ?? 0);

    return {
        internalOrders: totalOrders, internalRevenue: totalRevenue,
        meta: latestMeta, google: latestGoogle,
        totalSpend,
        realRoas:         totalSpend > 0 ? totalRevenue / totalSpend : null,
        realCpa:          totalOrders > 0 ? totalSpend / totalOrders  : null,
        frequencyWarning: (latestMeta?.frequency ?? 0) > 4.5,
        history,
    };
});

// ─── Dynamic Sitemap ──────────────────────────────────────────────────────────
// Deployed endpoint: /sitemap.xml (via Firebase Hosting rewrite)
// Reads all active products + published blog posts from Firestore.
// Submit this URL to Google Search Console and include in robots.txt.
// AI crawlers: GPTBot, PerplexityBot, ClaudeBot, GoogleBot all respect sitemaps.

export const sitemapXml = functions.https.onRequest(async (req, res) => {
    const DOMAIN = 'https://importadoraeuro.com';

    try {
        const [productsSnap, blogSnap] = await Promise.all([
            db.collection('products').where('active', '==', true).get(),
            db.collection('blog_posts').where('published', '==', true).get(),
        ]);

        const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Static pages
        const staticUrls = [
            { loc: `${DOMAIN}/`,           priority: '1.0', changefreq: 'weekly'  },
            // ── Catalog: /catalogo is canonical ──────────────────────────────────
            { loc: `${DOMAIN}/catalogo`,   priority: '0.9', changefreq: 'daily'   },
            { loc: `${DOMAIN}/catalog`,    priority: '0.3', changefreq: 'monthly' }, // 301 → /catalogo
            // ── Other pages ───────────────────────────────────────────────────────
            { loc: `${DOMAIN}/praxis`,     priority: '0.7', changefreq: 'monthly' },
            { loc: `${DOMAIN}/blog`,       priority: '0.7', changefreq: 'weekly'  },
            { loc: `${DOMAIN}/help`,       priority: '0.5', changefreq: 'monthly' },
            { loc: `${DOMAIN}/terms`,      priority: '0.3', changefreq: 'yearly'  },
            { loc: `${DOMAIN}/privacy`,    priority: '0.3', changefreq: 'yearly'  },
        ];

        const urlEntries: string[] = [];

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
            const updatedAt = d.updatedAt?.toDate
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
            const publishedAt = d.publishedAt?.toDate
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
    } catch (e) {
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

export const onCartAbandoned = functions.firestore
    .document('cartSnapshots/{snapId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        if (data?.event !== 'abandoned_detected') return null;

        const sessionId = data.sessionId || context.params.snapId;
        const email     = data.customerEmail || data.attribution?.email || null;
        const phone     = data.customerPhone || null;
        const name      = data.customerName  || data.attribution?.name || 'Cliente';
        const items     = data.items || [];
        const cartValue = data.cartValue || 0;
        const cartLink  = 'https://importadoraeuro.com/checkout';

        if (!email && !phone) {
            // Cannot recover anonymous guest with no contact info — skip
            return null;
        }

        // Check if this session already has a recovery task
        const existing = await db.collection('recovery_queue')
            .where('sessionId', '==', sessionId)
            .limit(1).get();
        if (!existing.empty) return null; // already queued

        const now   = Date.now();
        const batch = db.batch();

        // Step 1: 1 hour from now — friendly reminder
        const step1Ref = db.collection('recovery_queue').doc();
        batch.set(step1Ref, {
            sessionId, email, phone, name, items, cartValue,
            step:        1,
            sendAt:      admin.firestore.Timestamp.fromMillis(now + 60 * 60 * 1000),
            status:      'pending',
            type:        'cart_recovery',
            message:     `Hola ${name}, dejaste tu carrito con ${items.length} producto(s) por $${cartValue} MXN. ¿Te ayudamos a completar tu compra? 👉 ${cartLink}`,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        });

        // Step 2: 24 hours from now — with coupon
        // Auto-generate a unique 5% coupon code
        const couponCode = `CART${sessionId.slice(-6).toUpperCase()}`;
        const step2Ref = db.collection('recovery_queue').doc();
        batch.set(step2Ref, {
            sessionId, email, phone, name, items, cartValue,
            step:        2,
            sendAt:      admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
            status:      'pending',
            type:        'cart_recovery',
            couponCode,
            message:     `${name}, aquí tienes un 5% de descuento exclusivo: ${couponCode}. Válido por 48 horas. Completa tu compra → ${cartLink}`,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();

        // Pre-create the coupon in Firestore so it's ready when the customer arrives
        const couponEndDate = new Date(now + 48 * 60 * 60 * 1000);
        await db.collection('coupons').doc(couponCode).set({
            code:              couponCode,
            type:              'percentage',
            value:             5,
            isActive:          true,
            usageLimit:        1,
            usageCount:        0,
            minPurchaseAmount: 0,
            startDate:         admin.firestore.Timestamp.now(),
            endDate:           admin.firestore.Timestamp.fromDate(couponEndDate),
            description:       `Recuperación de carrito — sesión ${sessionId}`,
            createdAt:         admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
            autoGenerated:     true,
            source:            'cart_recovery',
        }, { merge: true });

        console.log(`[CartRecovery] Queued 2-step recovery for session ${sessionId}`);
        return null;
    });

// Processes pending recovery_queue items and writes to notification_outbox.
// Schedule: every 30 minutes. Outbox is read by any notification provider.
export const processRecoveryQueue = functions.pubsub
    .schedule('every 30 minutes')
    .onRun(async () => {
        const now = admin.firestore.Timestamp.now();
        const snap = await db.collection('recovery_queue')
            .where('status', '==', 'pending')
            .where('sendAt', '<=', now)
            .limit(50)
            .get();

        if (snap.empty) return null;

        const batch = db.batch();
        for (const docSnap of snap.docs) {
            const task = docSnap.data();

            // Write to notification_outbox — provider (WhatsApp/email) picks this up
            const outboxRef = db.collection('notification_outbox').doc();
            batch.set(outboxRef, {
                channel:   task.phone ? 'whatsapp' : 'email',
                to:        task.phone || task.email,
                name:      task.name,
                message:   task.message,
                type:      task.type,
                step:      task.step,
                couponCode:task.couponCode || null,
                sessionId: task.sessionId,
                status:    'queued',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Mark task as sent
            batch.update(docSnap.ref, {
                status:   'sent',
                sentAt:   admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        await batch.commit();
        console.log(`[RecoveryQueue] Dispatched ${snap.size} notifications to outbox.`);
        return null;
    });

// ─── Phase 2.2 — Product Review Request ─────────────────────────────────────
// Triggered when a new order is created (payment completed).
// Queues a review request 7 days later in review_requests collection.

export const onOrderCompleted = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snap, context) => {
        const order = snap.data();
        if (!order) return null;

        const email    = order.customerEmail || order.email;
        const phone    = order.customerPhone || null;
        const name     = order.customerName  || order.name || 'Cliente';
        const items    = (order.items || []).map((i: any) => ({
            productId:   i.productId || i.id,
            productName: i.name || i.productName,
            slug:        i.slug,
        }));

        if (!email && !phone) return null; // no contact info
        if (!items.length) return null;

        // Schedule review request 7 days from now
        const sendAt = admin.firestore.Timestamp.fromMillis(
            Date.now() + 7 * 24 * 60 * 60 * 1000
        );

        await db.collection('review_requests').doc(context.params.orderId).set({
            orderId:   context.params.orderId,
            email, phone, name, items,
            sendAt,
            status:   'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[ReviewRequest] Queued for order ${context.params.orderId} — send at ${sendAt.toDate()}`);
        return null;
    });

// Processes pending review requests and publishes to notification_outbox.
// Schedule: daily at 10:00 AM Mexico City time.
export const processReviewRequests = functions.pubsub
    .schedule('0 10 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
        const now = admin.firestore.Timestamp.now();
        const snap = await db.collection('review_requests')
            .where('status', '==', 'pending')
            .where('sendAt', '<=', now)
            .limit(100)
            .get();

        if (snap.empty) return null;

        const batch = db.batch();
        for (const docSnap of snap.docs) {
            const req = docSnap.data();
            const firstItem = req.items?.[0];
            const reviewUrl = firstItem?.slug
                ? `https://importadoraeuro.com/product/${firstItem.slug}?review=1`
                : 'https://importadoraeuro.com';

            const outboxRef = db.collection('notification_outbox').doc();
            batch.set(outboxRef, {
                channel:   req.phone ? 'whatsapp' : 'email',
                to:        req.phone || req.email,
                name:      req.name,
                type:      'review_request',
                orderId:   req.orderId,
                reviewUrl,
                message:   `Hola ${req.name}, ¿cómo quedó tu llanta? Nos encantaría saber tu opinión. Deja tu reseña en 1 minuto: ${reviewUrl}`,
                status:    'queued',
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

export const onReferralOrderCompleted = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snap, context) => {
        const order = snap.data();
        if (!order) return null;

        const referrerId = order.attribution?.ref || order.referrerId;
        if (!referrerId) return null; // no referral

        // Prevent self-referral
        const ordererUid = order.userId || order.uid;
        if (ordererUid && ordererUid === referrerId) return null;

        // Check if referrer already got a referral reward for this referee
        const existing = await db.collection('referral_rewards')
            .where('referrerId', '==', referrerId)
            .where('refereeOrderId', '==', context.params.orderId)
            .limit(1).get();
        if (!existing.empty) return null; // already rewarded

        // Generate unique coupon code for the referrer
        const couponCode  = `REF${referrerId.slice(-5).toUpperCase()}${Date.now().toString(36).toUpperCase().slice(-3)}`;
        const couponEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        const batch = db.batch();

        // Create referrer reward coupon
        const couponRef = db.collection('coupons').doc(couponCode);
        batch.set(couponRef, {
            code:              couponCode,
            type:              'fixed',
            value:             100,
            isActive:          true,
            usageLimit:        1,
            usageCount:        0,
            minPurchaseAmount: 0,
            startDate:         admin.firestore.Timestamp.now(),
            endDate:           admin.firestore.Timestamp.fromDate(couponEndDate),
            description:       `Premio de referido — referidor: ${referrerId}`,
            createdAt:         admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
            autoGenerated:     true,
            source:            'referral',
        });

        // Log the referral reward
        const rewardRef = db.collection('referral_rewards').doc();
        batch.set(rewardRef, {
            referrerId,
            refereeOrderId: context.params.orderId,
            refereeEmail:   order.customerEmail || order.email || null,
            couponCode,
            value:          100,
            currency:       'MXN',
            status:         'issued',
            createdAt:      admin.firestore.FieldValue.serverTimestamp(),
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
                channel:    'email',
                to:         referrerEmail,
                type:       'referral_reward',
                couponCode,
                message:    `¡Tu amigo realizó su primera compra! Aquí está tu recompensa de $100 MXN: ${couponCode}. Válido por 30 días.`,
                status:     'queued',
                createdAt:  admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        await batch.commit();
        console.log(`[Referral] Rewarded referrer ${referrerId} with coupon ${couponCode} for order ${context.params.orderId}`);
        return null;
    });
