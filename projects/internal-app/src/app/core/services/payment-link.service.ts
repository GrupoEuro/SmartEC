import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, doc, docData, getDoc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';

export interface CreatePaymentLinkRequest {
    orderId?: string;
    amount: number;
    description?: string;
    payerEmail?: string;
    items?: any[];
    externalReference?: string;
}

export interface CreatePaymentLinkResponse {
    success: boolean;
    preferenceId: string;
    paymentUrl: string;
    sandboxUrl?: string;
    qrCodeUrl: string;
    externalReference: string;
}

@Injectable({
    providedIn: 'root'
})
export class PaymentLinkService {
    private functions = inject(Functions);
    private firestore = inject(Firestore);

    /**
     * Generates a MercadoPago Payment Link (Checkout Pro Preference).
     * Attempts to call the Cloud Function first. If un-deployed or blocked,
     * falls back to creating the preference directly via MercadoPago REST API
     * using the credentials configured in Firestore config/integrations.
     */
    generatePaymentLink(request: CreatePaymentLinkRequest): Observable<CreatePaymentLinkResponse> {
        return from(this.createPaymentLinkWithFallback(request));
    }

    private async createPaymentLinkWithFallback(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResponse> {
        // 1. Try Firebase Cloud Function first
        try {
            const callable = httpsCallable<CreatePaymentLinkRequest, CreatePaymentLinkResponse>(
                this.functions,
                'createPaymentLink'
            );
            const res = await callable(request);
            if (res.data && res.data.paymentUrl) {
                return res.data;
            }
        } catch (fnErr: any) {
            console.warn('[PaymentLinkService] Cloud Function failed or un-deployed. Falling back to direct MP API:', fnErr.message || fnErr);
        }

        // 2. Fallback: Direct MercadoPago Preferences API call using stored Access Token
        const configSnap = await getDoc(doc(this.firestore, 'config', 'integrations'));
        const mpConfig = configSnap.exists() ? configSnap.data()?.['mercadopago'] || {} : {};
        const accessToken = mpConfig.accessToken;

        if (!accessToken) {
            throw new Error('MercadoPago Access Token not configured in Admin → Integrations.');
        }

        const ref = request.externalReference || request.orderId || `order-${Date.now()}`;
        const desc = request.description || `Pedido ${ref} - Eurollantas`;
        const email = request.payerEmail || 'cliente@eurollantas.com.mx';
        const totalAmount = Number(Number(request.amount).toFixed(2));

        let preferenceItems: any[];

        if (Array.isArray(request.items) && request.items.length > 0) {
            // Product prices in catalog already include 16% IVA
            preferenceItems = request.items.map((it: any) => ({
                id: String(it.productId || it.sku || 'item'),
                title: String(it.productName || it.title || desc),
                quantity: Number(it.quantity) || 1,
                currency_id: 'MXN',
                unit_price: Number(it.price || it.unit_price || request.amount),
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
            console.error('[PaymentLinkService] Direct preference creation error:', pref);
            throw new Error(pref.message || pref.cause?.[0]?.description || 'Error al generar enlace en MercadoPago.');
        }

        const paymentUrl = pref.init_point || pref.sandbox_init_point;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(paymentUrl)}`;

        if (request.orderId) {
            await updateDoc(doc(this.firestore, 'orders', request.orderId), {
                paymentMethod: 'mercadopago_link',
                paymentStatus: 'pending_link',
                paymentUrl,
                mpPreferenceId: pref.id,
                updatedAt: serverTimestamp(),
            }).catch(e => console.error('[PaymentLinkService] Failed to update order doc:', e));
        }

        return {
            success: true,
            preferenceId: pref.id,
            paymentUrl,
            sandboxUrl: pref.sandbox_init_point,
            qrCodeUrl,
            externalReference: ref,
        };
    }

    /**
     * Listens to real-time updates on an order in Firestore to detect when paymentStatus changes.
     */
    watchOrderPaymentStatus(orderId: string): Observable<any> {
        const orderDocRef = doc(this.firestore, 'orders', orderId);
        return docData(orderDocRef, { idField: 'id' });
    }
}
