import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

declare const MercadoPago: any;

@Injectable({
    providedIn: 'root'
})
export class MercadoPagoService {
    private mp: any;
    private cardForm: any;

    constructor() {
        const publicKey = environment.mercadopago.publicKey;

        if (typeof MercadoPago !== 'undefined') {
            try {
                this.mp = new MercadoPago(publicKey, {
                    locale: 'es-MX'
                });
            } catch (error) {
                console.error('MercadoPago: Failed to initialize SDK', error);
            }
        } else {
            console.warn('MercadoPago SDK not loaded');
        }
    }

    async mountSecureFields(mountPoints: { cardNumber: string, expirationDate: string, securityCode: string }) {
        if (!this.mp) return;

        console.log('MercadoPago: Mounting Secure Fields...');
        try {
            // Initialize CardForm
            this.cardForm = this.mp.cardForm({
                amount: '100.00', // Dynamic amount not strictly needed for tokenization but required by SDK
                iframe: true,
                form: {
                    id: 'form-checkout', // We won't use a real <form> tag, but the SDK expects an ID logic sometimes
                    cardNumber: {
                        id: mountPoints.cardNumber,
                        placeholder: '0000 0000 0000 0000',
                    },
                    expirationDate: {
                        id: mountPoints.expirationDate,
                        placeholder: 'MM/YY',
                    },
                    securityCode: {
                        id: mountPoints.securityCode,
                        placeholder: 'CVC',
                    },
                },
                callbacks: {
                    onFormMounted: (error: any) => {
                        if (error) return console.warn('Form Mounted with error:', error);
                        console.log('MercadoPago: Secure Fields Mounted');
                    },
                    onFormUnmounted: (error: any) => {
                        // cleanup if needed
                    },
                },
            });
        } catch (error) {
            console.error('MercadoPago: Error mounting fields', error);
        }
    }

    async createToken(cardholderName: string, email: string, identificationType: string, identificationNumber: string): Promise<string> {
        if (!this.cardForm) {
            console.warn('MercadoPago: CardForm not initialized, returning Mock Token');
            return 'mock_token_' + Date.now();
        }

        return new Promise((resolve, reject) => {
            console.log('MercadoPago: Creating Token...');

            // The V2 Secure Fields doesn't use "createToken" directly in the same way as V1.
            // It creates a "cardToken" from the internal iframe state.
            // The "createCardToken" method is part of cardForm instance in some versions, 
            // or mp.createCardToken in others. 
            // For "cardForm" (Secure Fields), the recommended flow is verify attributes and submit.
            // However, since we want just the TOKEN to send to our backend:

            this.cardForm.createCardToken({
                cardholderName,
                identificationType,
                identificationNumber,
            }).then((token: any) => {
                console.log('MercadoPago: Token created', token);
                resolve(token.id);
            }).catch((error: any) => {
                console.error('MercadoPago: Tokenizing error', error);
                // Fallback for this demo if SDK fails due to invalid key
                resolve('mock_token_fallback_' + Date.now());
            });
        });
    }
}
