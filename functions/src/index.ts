import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { MercadoPagoConfig, Payment } from 'mercadopago';

admin.initializeApp();
const db = admin.firestore();

export const processPayment = functions.https.onCall(async (data, context) => {
    // Enforce authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'You must be logged in to process a payment.'
        );
    }

    const { token, amount, email, description, orderId, installments, paymentMethodId, issuerId } = data;

    if (!token || !amount || !email) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing required payment parameters.'
        );
    }

    // Initialize MercadoPago configuration
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error("Missing MP_ACCESS_TOKEN");
        throw new functions.https.HttpsError(
            'internal',
            'Server configuration error. Missing Access Token.'
        );
    }

    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
    const payment = new Payment(client);

    try {
        const paymentData = {
            transaction_amount: Number(amount),
            token: token,
            description: description || 'Storefront Order',
            installments: Number(installments) || 1,
            payment_method_id: paymentMethodId,
            issuer_id: issuerId,
            payer: {
                email: email,
            },
            metadata: {
                order_id: orderId || ''
            }
        };

        const result = await payment.create({ body: paymentData });

        // Update Firestore order with payment status
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: result.status,
                paymentId: result.id,
                paymentMethod: result.payment_method_id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => {
                console.error("Failed to update order status in Firestore:", err);
            });
        }

        return {
            success: true,
            status: result.status,
            paymentId: result.id,
            statusDetail: result.status_detail
        };

    } catch (error: any) {
        console.error('MercadoPago Payment Create Error:', error);
        
        if (orderId) {
            await db.collection('orders').doc(orderId).update({
                paymentStatus: 'rejected',
                paymentError: error.message || 'Unknown processing error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => {
                console.error("Failed to update order rejected status in Firestore:", err);
            });
        }

        throw new functions.https.HttpsError(
            'internal',
            error.message || 'Payment processing failed.'
        );
    }
});
