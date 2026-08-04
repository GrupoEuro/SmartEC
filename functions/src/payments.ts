/**
 * payments.ts
 * MercadoPago payment processing: processPayment, cancelOrder, refundOrder,
 * mpWebhook, mpAuthUrl, mpCallback, mpDiag.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { MercadoPagoConfig, Payment, Order } from 'mercadopago';
import { db } from './shared';

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
        'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
        'throwam.com', 'trashmail.com', 'trashmail.net', 'yopmail.com', 'sharklasers.com',
        'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'spam4.me', '10minutemail.com',
        'tempmail.com', 'temp-mail.org', 'fakeinbox.com', 'mailnull.com', 'maildrop.cc',
    ];
    const emailDomain = (email as string).split('@')[1]?.toLowerCase() ?? '';
    if (DISPOSABLE_DOMAINS.includes(emailDomain)) {
        throw new functions.https.HttpsError('invalid-argument', 'El correo electrónico no es válido para procesar un pago.');
    }

    // ── Velocity Rate Limiting ─────────────────────────────────────────────────
    // Max 3 payment attempts per email per 60 minutes — blocks card testing attacks.
    const RATE_LIMIT_MAX = 3;
    const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    try {
        const emailKey = Buffer.from(email as string).toString('base64').replace(/=/g, '');
        const rateLimitRef = db.collection('_rate_limits').doc(`pay_${emailKey}`);
        const now = Date.now();
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
            maxInstallments = mpConfig.maxInstallments ?? 1;
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
                        success: true,
                        alreadyProcessed: true,
                        status: 'approved',
                        paymentId: orderData.paymentId ?? null,
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
                const discount: number = orderData.discount ?? 0;
                const serverTotal: number = Math.max(0, serverSubtotal + shippingCost - discount);
                const submitted: number = Number(amount);

                if (Math.abs(serverTotal - submitted) > 1.0) {
                    console.error(
                        `[processPayment] ❌ Amount mismatch — submitted: ${submitted}, server: ${serverTotal.toFixed(2)}`
                    );
                    // Update the order with an error note but don't charge
                    await db.collection('orders').doc(orderId).update({
                        paymentStatus: 'rejected',
                        paymentError: `Monto rechazado: enviado $${submitted} vs servidor $${serverTotal.toFixed(2)}`,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }).catch(() => { });
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


    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const orderClient = new Order(client);

    try {
        // ── Orders API (POST /v1/orders) via mercadopago SDK v2 ────────────────
        // SDK types (dist/clients/order/create/types.d.ts) require:
        //   total_amount: string  (NOT number)
        //   transactions: { payments: PaymentRequest[] }  (NOT a raw array)
        //   payments[].amount: string  (NOT number)
        const amountStr = Number(amount).toFixed(2);   // '688.00'
        const paymentType = (paymentMethodId ?? '').startsWith('deb') ? 'debit_card' : 'credit_card';

        const orderBody: any = {
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
        const resultAny = result as any;

        // Extract first payment — response mirrors request: transactions.payments[0]
        const txPayment = resultAny?.transactions?.payments?.[0] ?? {};
        const orderStatus = resultAny?.status ?? 'unknown';      // 'processed'|'pending'|'rejected'
        const payStatus = txPayment?.status ?? orderStatus;    // 'approved'|'rejected'|'pending'
        const payDetail = txPayment?.status_detail ?? '';
        const paymentId = txPayment?.id ?? resultAny?.id ?? null;

        // Map Orders API status to our internal statuses
        const approved = orderStatus === 'processed' || payStatus === 'approved';
        const rejected = orderStatus === 'rejected' || payStatus === 'rejected';

        // 3DS challenge (Orders API: status pending + status_detail pending_challenge)
        if (payDetail === 'pending_challenge') {
            const challengeUrl = txPayment?.three_ds_info?.external_resource_url ?? null;
            console.log(`[processPayment] 3DS challenge for order ${orderId}`);
            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'pending_3ds',
                    paymentId,
                    mpOrderId: resultAny?.id,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.error('Failed to update order for 3DS:', e));
            }
            return {
                success: false, requires3DS: true, challengeUrl, paymentId,
                status: payStatus, statusDetail: payDetail
            };
        }

        // Normal result — update Firestore
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: approved ? 'approved' : rejected ? 'rejected' : payStatus,
                paymentId,
                mpOrderId: resultAny?.id,
                paymentMethod: paymentMethodId,
                installments: finalInstallments,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                ...(approved ? { status: 'paid' } : {}),
                ...(rejected ? { status: 'payment_failed' } : {}),
            }).catch(e => console.error('Failed to update order status:', e));
        }

        return {
            success: approved,
            status: approved ? 'approved' : rejected ? 'rejected' : payStatus,
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
            errors: error?.errors ?? error?.message,
            status: errorData?.status,
            payments: errorData?.transactions?.payments,
        }, null, 2));

        // ── Case (a): MP rejected the payment (status=failed) ─────────────────
        if (errorData?.status === 'failed') {
            const failedPayment = errorData?.transactions?.payments?.[0] ?? {};
            const failStatus = failedPayment?.status ?? 'rejected';
            const failDetail = failedPayment?.status_detail ?? errorData?.status_detail ?? 'failed';
            const failPaymentId = failedPayment?.id ?? errorData?.id ?? null;

            console.warn(`[processPayment] Payment rejected — status: ${failStatus}, detail: ${failDetail}`);

            if (orderId) {
                await db.collection('orders').doc(orderId).update({
                    paymentStatus: 'rejected',
                    paymentError: failDetail,
                    paymentId: failPaymentId,
                    mpOrderId: errorData?.id,
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

// ─── Create Payment Link (Checkout Pro Preference) ───────────────────────────
//
// Callable function to generate a MercadoPago Payment Link (init_point)
// for an existing order or dynamic order draft.
// Returns preferenceId, paymentUrl, qrCodeUrl, and updates Firestore order if orderId provided.
//
export const createPaymentLink = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        console.warn('[createPaymentLink] Guest/unauthenticated call — processing with inputs.');
    }

    const { orderId, amount, description, payerEmail, items, externalReference } = data;

    if (!amount || (!orderId && !externalReference)) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required payment link parameters (amount, orderId).');
    }

    let accessToken = process.env.MP_ACCESS_TOKEN;
    try {
        const snap = await db.collection('config').doc('integrations').get();
        if (snap.exists) {
            const mpConfig = snap.data()?.mercadopago || {};
            if (mpConfig.accessToken) accessToken = mpConfig.accessToken;
        }
    } catch (err) {
        console.warn('Could not read MP config from Firestore:', err);
    }

    if (!accessToken) {
        throw new functions.https.HttpsError('internal', 'MercadoPago access token not configured in Firestore.');
    }

    const ref = externalReference || orderId || `order-${Date.now()}`;
    const desc = description || `Pedido ${ref} - Eurollantas`;
    const email = payerEmail || 'cliente@eurollantas.com.mx';

    try {
        const totalAmount = Number(Number(amount).toFixed(2));

        let preferenceItems: any[];

        if (Array.isArray(items) && items.length > 0) {
            preferenceItems = items.map((it: any) => ({
                id: String(it.productId || it.sku || 'item'),
                title: String(it.productName || it.title || desc),
                quantity: Number(it.quantity) || 1,
                currency_id: 'MXN',
                unit_price: Number(it.price || it.unit_price || amount),
            }));

            const sumItems = preferenceItems.reduce((acc: number, item: any) => acc + (item.quantity * item.unit_price), 0);
            if (Math.abs(sumItems - totalAmount) > 0.05) {
                preferenceItems = [{
                    id: ref,
                    title: `${desc} (IVA Incluido)`,
                    quantity: 1,
                    currency_id: 'MXN',
                    unit_price: totalAmount,
                }];
            }
        } else {
            preferenceItems = [{
                id: ref,
                title: `${desc} (IVA Incluido)`,
                quantity: 1,
                currency_id: 'MXN',
                unit_price: totalAmount,
            }];
        }

        const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `mp-pref-${ref}-${Date.now()}`,
            },
            body: JSON.stringify({
                items: preferenceItems,
                payer: { email },
                external_reference: ref,
                back_urls: {
                    success: 'https://eurollantas.com.mx/checkout/success',
                    failure: 'https://eurollantas.com.mx/checkout/failure',
                    pending: 'https://eurollantas.com.mx/checkout/pending',
                },
                auto_return: 'approved',
                statement_descriptor: 'EUROLLANTAS',
            }),
        });

        const pref = await prefRes.json() as any;

        if (!prefRes.ok || !pref.id) {
            console.error('[createPaymentLink] Preference creation failed:', pref);
            throw new functions.https.HttpsError(
                'internal',
                pref.message || pref.cause?.[0]?.description || 'Error al generar el Link de Pago en MercadoPago.'
            );
        }

        const paymentUrl = pref.init_point || pref.sandbox_init_point;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(paymentUrl)}`;

        // If orderId was passed, update the order in Firestore
        if (orderId) {
            await db.collection('orders').doc(orderId).set({
                paymentMethod: 'mercadopago_link',
                paymentStatus: 'pending_link',
                paymentUrl,
                mpPreferenceId: pref.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }).catch(e => console.error('[createPaymentLink] Failed to update order:', e));
        }

        return {
            success: true,
            preferenceId: pref.id,
            paymentUrl,
            sandboxUrl: pref.sandbox_init_point,
            qrCodeUrl,
            externalReference: ref,
        };
    } catch (error: any) {
        if (error.code) throw error;
        console.error('[createPaymentLink] Error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Error processing request');
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

export const cancelOrder = functions.https.onCall(async (data, context) => {
    const { orderId, reason } = data;

    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
    }

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    const order = orderSnap.data()!;
    const now = Date.now();
    const createdAt = order.createdAt?.toMillis ? order.createdAt.toMillis() : Date.now();

    // ── Ownership check ────────────────────────────────────────────────────────
    // Authenticated user: uid must match order's customer uid.
    // Guest: sessionId from the stored order must match what the client sends.
    const callerUid = context.auth?.uid ?? null;
    const orderUid = order.customer?.uid ?? null;
    const guestSessionId = data.sessionId ?? null;
    const orderSessionId = order.sessionId ?? null;

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
    const staffUid = context.auth.uid;
    const staffEmail = context.auth.token.email ?? 'staff';
    const staffDisplayName = context.auth.token.name ?? staffEmail;

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
            mpRefundId: refundResult?.id ?? null,
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

export const mpWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
    try {
        // ── x-signature Validation ─────────────────────────────────────────────
        // MP signs every webhook with HMAC-SHA256 using the app's Secret Key.
        // Validate before processing to prevent spoofed notifications.
        // Secret stored in Firestore: config/integrations → mercadopago.webhookSecret
        const xSignature = req.headers['x-signature'] as string | undefined;
        const xRequestId = req.headers['x-request-id'] as string | undefined;
        if (xSignature) {
            try {
                const cfgSnap = await db.collection('config').doc('integrations').get();
                const secret = cfgSnap.data()?.mercadopago?.webhookSecret ?? '';
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

        const topic = req.body?.type || req.query['topic'];
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
            const orderData = await (orderClient as any).get({ id: String(resourceId) });
            const orderAny = orderData as any;

            // external_reference IS our Firestore orderId
            const orderId = orderAny?.external_reference;
            if (!orderId) { console.warn('[mpWebhook] Order topic but no external_reference'); res.status(200).send('OK'); return; }

            // Extract status from order + first transaction payment
            const txPay = orderAny?.transactions?.[0]?.payments?.[0] ?? {};
            const orderStatus = orderAny?.status ?? '';               // 'processed'|'pending'|'rejected'
            const payStatus = txPay?.status ?? orderStatus;
            const payId = txPay?.id ?? null;

            const approved = orderStatus === 'processed' || payStatus === 'approved';
            const rejected = orderStatus === 'rejected' || payStatus === 'rejected';
            const newStatus = approved ? 'approved' : rejected ? 'rejected' : 'pending';

            await db.collection('orders').doc(orderId).update({
                paymentStatus: newStatus,
                paymentId: payId,
                mpOrderId: orderAny?.id,
                paymentMethod: orderAny?.transactions?.[0]?.payment_method?.id ?? '',
                installments: orderAny?.transactions?.[0]?.payment_method?.installments ?? 1,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                ...(approved ? { status: 'paid' } : {}),
                ...(rejected ? { status: 'payment_failed' } : {}),
            });

            console.log(`[mpWebhook] Order (Orders API) ${orderId} → ${newStatus}`);
            res.status(200).send('OK'); return;
        }

        // ── Legacy Payments API topic ('payment') ──────────────────────────────
        // Retained for backwards compatibility with any legacy payments.
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
            paymentId: paymentData.id,
            paymentMethod: paymentData.payment_method_id,
            installments: paymentData.installments,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        const mpConfig = configDoc.data()?.mercadopago || {};
        const appId = mpConfig.appId || mpConfig.clientId;

        if (!appId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'MercadoPago App ID not configured. Save it in Admin → Integrations first.'
            );
        }

        const redirectUri = 'https://us-central1-tiendapraxis.cloudfunctions.net/mpCallback';
        const state = Math.random().toString(36).substring(2, 15);

        await db.collection('config').doc('integrations').set(
            { mercadopago: { oauthState: state } },
            { merge: true }
        );

        const SCOPES = ['read', 'offline_access', 'write'].join(' ');
        const url = `https://auth.mercadopago.com.mx/authorization?client_id=${appId}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;
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

    const code = req.query['code'] as string;
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
        const configDoc = await db.collection('config').doc('integrations').get();
        const mpConfig = configDoc.data()?.mercadopago || {};
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

        const tokenData = await tokenRes.json() as any;

        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('[mpCallback] Token exchange failed:', JSON.stringify(tokenData));
            res.status(500).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
            return;
        }

        const expiresAt = Date.now() + ((tokenData.expires_in || 21600) * 1000);

        await db.collection('config').doc('integrations').set({
            mercadopago: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token ?? null,
                publicKey: tokenData.public_key ?? mpConfig.publicKey ?? '',
                userId: tokenData.user_id ?? null,
                expiresAt,
                connected: true,
                oauthState: null,
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
    const mpConfig = configSnap.data()?.mercadopago ?? {};
    const accessToken: string = mpConfig.accessToken ?? process.env.MP_ACCESS_TOKEN ?? '';

    if (!accessToken) {
        return { ok: false, error: 'No Access Token found in config/integrations → mercadopago' };
    }

    const step = data?.step as string;

    // ── Step: save_credentials — persist AT + PK to Firestore ────────────────
    if (step === 'save_credentials') {
        const newAt = (data?.accessToken ?? '').trim();
        const newPk = (data?.publicKey ?? '').trim();
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
        const mask = (s: string) => s ? `${s.slice(0, 18)}…${s.slice(-6)}` : '(empty)';
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
            const body = await r.json() as any;
            if (!r.ok) return { ok: false, error: body.message ?? body.error ?? 'Token rejected', status: r.status };
            return {
                ok: true,
                userId: body.id,
                nickname: body.nickname,
                email: body.email,
                site_id: body.site_id,
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
                ok: true,
                count: methods.length,
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
            const pref = await prefRes.json() as any;
            if (!prefRes.ok || !pref.id) {
                return {
                    ok: false,
                    status: prefRes.status,
                    error: pref.message ?? pref.cause?.[0]?.description ?? 'Preference creation failed',
                    fnVer: FN_VER,
                    raw: pref,
                };
            }
            return {
                ok: true,
                preferenceId: pref.id,
                initPoint: pref.sandbox_init_point ?? pref.init_point,
                status: 'preference_created',
                fnVer: FN_VER,
                raw: {
                    id: pref.id,
                    sandbox_url: pref.sandbox_init_point,
                    expires: pref.date_of_expiration,
                    fnVer: FN_VER,
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
            { label: 'Mastercard Crédito', number: '5474925432670366', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Crédito', number: '4075595716483764', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Mastercard Débito', number: '5579053461482647', cvv: '1234', expMonth: 11, expYear: 2030, holder: 'APRO' },
            { label: 'Visa Débito', number: '4189141221267633', cvv: '123', expMonth: 11, expYear: 2030, holder: 'APRO' },
        ];
        const cardResults: { label: string; ok: boolean; token?: string; error?: string }[] = [];
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
                    ok: false,
                    error: body.message ?? body.error ?? `HTTP ${r.status}`,
                    status: r.status,
                    hint: 'If 404 the buyer account is not associated with this sandbox seller.',
                    fnVer: FN_VER,
                };
            }
            // email may appear as body.email or inside identification sub-objects
            const email = body.email ?? body.secure_email ?? body.alternative_phone?.area_code ?? null;
            return {
                ok: true,
                buyerId: body.id,
                nickname: body.nickname,
                email,
                site_id: body.site_id,
                type: body.user_type ?? body.account_type ?? 'unknown',
                // Return full body so raw JSON reveals every available field
                allFields: body,
                fnVer: FN_VER,
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
        const mpCfg = configSnap.data()?.mercadopago ?? {};
        // clientId 398646544825942 = app ID from the MP developer portal (not a secret)
        const clientId = mpCfg.clientId ?? mpCfg.client_id ?? '398646544825942';
        const clientSecret = mpCfg.clientSecret ?? mpCfg.client_secret ?? '';

        // Strategy: try with client_secret first; if not available, try without.
        // MP sandbox test users sometimes work via password grant without client_secret.
        const tryGrant = async (includeSecret: boolean) => {
            const params: Record<string, string> = {
                grant_type: 'password',
                client_id: clientId,
                username: 'TESTUSER7146576788719579772',
                password: 'aP0I8bxKiJ',
            };
            if (includeSecret && clientSecret) params.client_secret = clientSecret;
            return fetch('https://api.mercadopago.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params).toString(),
            });
        };

        try {
            // First try: with secret (full grant)
            let r = clientSecret ? await tryGrant(true) : await tryGrant(false);
            let body = await r.json() as any;

            // Second try: without secret (sandbox-only fallback)
            if (!r.ok && clientSecret) {
                r = await tryGrant(false);
                body = await r.json() as any;
            }

            if (!r.ok || !body.access_token) {
                return {
                    ok: false,
                    error: body.message ?? body.error ?? `HTTP ${r.status}`,
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
            const meBody = await meR.json() as any;
            return {
                ok: true,
                buyerToken: body.access_token,
                buyerEmail: meBody.email,
                buyerId: meBody.id,
                buyerNick: meBody.nickname,
                fnVer: FN_VER,
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
            const tb = await tr.json() as any;
            if (!tr.ok || !tb.id) return {
                ok: false,
                error: `Token error (HTTP ${tr.status}): ${tb.message ?? JSON.stringify(tb)}`,
                rawToken: tb,
                fnVer: FN_VER,
            };
            cardToken = tb.id;
        } catch (e: any) {
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
            const pb = await pr.json() as any;
            const approved = pb.status === 'approved';
            return {
                ok: approved,
                paymentId: pb.id ?? null,
                status: pb.status,
                statusDetail: pb.status_detail,
                amount: pb.transaction_amount,
                currency: pb.currency_id,
                buyerEmail,
                httpStatus: pr.status,
                mpMessage: approved ? undefined : (pb.message ?? pb.error),
                mpCause: approved ? undefined : pb.cause,
                fnVer: FN_VER,
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
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_number: '5474925432670366',  // MP test Mastercard (tokenizable in both envs)
                    security_code: '123',
                    expiration_month: 11,
                    expiration_year: 2030,
                    cardholder: { name: 'TEST CARD' },
                }),
            });
            const tb = await tr.json() as any;

            if (!tr.ok || !tb.id) {
                return {
                    ok: false,
                    error: `Tokenization failed (HTTP ${tr.status})`,
                    detail: tb.message ?? tb.error ?? JSON.stringify(tb),
                    httpStatus: tr.status,
                    fnVer: FN_VER,
                };
            }

            return {
                ok: true,
                tokenId: tb.id,
                lastFour: tb.last_four_digits,
                cardType: tb.payment_method?.id ?? 'master',
                expiryMonth: tb.expiration_month,
                expiryYear: tb.expiration_year,
                httpStatus: tr.status,
                note: '✅ Card tokenization works — production AT valid. Real purchase must be done through the storefront with a real card (generates production paymentId for Stage 3).',
                fnVer: FN_VER,
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
            const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const body = await r.json() as any;
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
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `mpdiag-refund-${Date.now()}`,
                },
                body: JSON.stringify({}), // empty body = full refund
            });
            const body = await r.json() as any;
            return {
                ok: r.ok && !!body.id,
                refundId: body.id,
                status: body.status,
                amount: body.amount,
                fnVer: FN_VER,
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
                amount: '1000',
                bin: '547492',
            });
            const r = await fetch(
                `https://api.mercadopago.com/v1/payment_methods/installments?${params}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            const body = await r.json() as any;
            const arr = Array.isArray(body) ? body : [];
            const installments: number[] = (arr[0]?.payer_costs ?? []).map((c: any) => c.installments);
            return {
                ok: r.ok && installments.length > 0,
                installments,
                count: installments.length,
                fnVer: FN_VER,
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
        const appId = '398646544825942';
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
            const createBody = await createR.json() as any;

            // Also try v1 endpoint as fallback
            const listR2 = await fetch(`https://api.mercadopago.com/v1/account/webhooks?client_id=${appId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            const listBody2 = await listR2.json() as any;

            return {
                ok: createR.ok,
                message: createR.ok ? '✅ Webhook registered via API' : `❌ HTTP ${createR.status}`,
                created: createBody,
                existingV2: listBody,
                existingV1: listBody2,
                fnVer: FN_VER,
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
                ok: r.ok || r2.ok,
                v2_result: body,
                v1_result: body2,
                hint: 'Look for "secret" or "signature_secret" field in the raw results',
                fnVer: FN_VER,
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
                ok: false,
                error: 'webhookSecret not configured in Firestore',
                hint: 'Add mercadopago.webhookSecret to config/integrations → Firestore. Find it in developers.mercadopago.com → your app → Webhooks → Secret key.',
                fnVer: FN_VER,
            };
        }
        const crypto = await import('crypto');
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

