import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

/** Shape returned by the Brick's onSubmit callback */
export interface MPBrickFormData {
    token: string;
    payment_method_id: string;
    issuer_id: string | number;
    installments: number;
    payer: { email: string };
}

declare const MercadoPago: any;

@Injectable({ providedIn: 'root' })
export class MercadoPagoService {
    private firestore = inject(Firestore);

    private mp: any = null;
    private brick: any = null;
    private sdkLoaded = false;

    // ── SDK Loading ────────────────────────────────────────────────────────────

    private loadScript(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.sdkLoaded || typeof MercadoPago !== 'undefined') {
                this.sdkLoaded = true;
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://sdk.mercadopago.com/js/v2';
            script.async = true;
            script.onload = () => { this.sdkLoaded = true; resolve(); };
            script.onerror = () => reject(new Error('No se pudo cargar el SDK de MercadoPago.'));
            document.head.appendChild(script);
        });
    }

    // ── Public Key Resolution ──────────────────────────────────────────────────

    /**
     * Fetches the MP Public Key from Firestore config/integrations.
     * Falls back to environment if doc not found.
     */
    async loadPublicKey(): Promise<string> {
        try {
            const ref = doc(this.firestore, 'config/integrations');
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const key = snap.data()?.['mercadopago']?.publicKey;
                if (key) return key;
            }
        } catch (e) {
            console.warn('[MP] Could not read public key from Firestore:', e);
        }
        throw new Error('MercadoPago Public Key not configured. Go to Admin → Integrations.');
    }

    /**
     * Fetches the installments config from Firestore.
     * Returns { enabled: false, max: 1 } as safe defaults.
     */
    async loadInstallmentsConfig(): Promise<{ enabled: boolean; max: number }> {
        try {
            const ref = doc(this.firestore, 'config/integrations');
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const mp = snap.data()?.['mercadopago'] ?? {};
                return {
                    enabled: mp.installmentsEnabled ?? false,
                    max: mp.maxInstallments ?? 1,
                };
            }
        } catch (e) {
            console.warn('[MP] Could not read installments config:', e);
        }
        return { enabled: false, max: 1 };
    }

    // ── Brick Lifecycle ────────────────────────────────────────────────────────

    /**
     * Initializes the MP SDK with the given public key.
     */
    async init(publicKey: string): Promise<void> {
        await this.loadScript();
        if (!this.mp) {
            this.mp = new MercadoPago(publicKey, { locale: 'es-MX' });
        }
    }

    /**
     * Mounts a CardPayment Brick into the given container.
     *
     * @param containerId  The id of the div to mount the Brick into
     * @param amount       The total amount to be charged
     * @param email        Pre-filled payer email (can be empty for guest)
     * @param installmentsConfig  Whether MSI is enabled and the max allowed
     * @param onSubmit     Called by the Brick when the user submits — receives all token data
     * @param onError      Called on Brick-level error
     * @param onReady      Called when Brick has finished mounting
     */
    async mountCardPaymentBrick(
        containerId: string,
        amount: number,
        email: string,
        installmentsConfig: { enabled: boolean; max: number },
        onSubmit: (formData: MPBrickFormData) => Promise<void>,
        onError: (error: any) => void,
        onReady?: () => void
    ): Promise<void> {
        if (!this.mp) {
            throw new Error('[MP] SDK not initialized. Call init() first.');
        }

        // Destroy any existing Brick before mounting a new one
        await this.destroyBrick();

        const bricksBuilder = this.mp.bricks();

        const installmentsSettings = installmentsConfig.enabled
            ? { minInstallments: 1, maxInstallments: installmentsConfig.max }
            : { minInstallments: 1, maxInstallments: 1 };

        this.brick = await bricksBuilder.create('cardPayment', containerId, {
            initialization: {
                amount,
                payer: { email: email || undefined },
            },
            customization: {
                visual: {
                    style: {
                        theme: 'dark',
                        customVariables: {
                            // Match the storefront's zinc dark palette
                            baseColor: '#00acd8',
                            textPrimaryColor: '#f4f4f5',
                            inputBackgroundColor: 'rgba(255,255,255,0.05)',
                            formBackgroundColor: 'transparent',
                            inputBorderColor: 'rgba(255,255,255,0.12)',
                        },
                    },
                    hideFormTitle: true,
                    hidePaymentButton: false, // Brick renders its own button
                },
                paymentMethods: {
                    creditCard: 'all',
                    debitCard: 'all',
                    maxInstallments: installmentsSettings.maxInstallments,
                    minInstallments: installmentsSettings.minInstallments,
                },
            },
            callbacks: {
                onReady: () => {
                    console.log('[MP Brick] Ready');
                    onReady?.();
                },
                onSubmit: async (formData: MPBrickFormData) => {
                    console.log('[MP Brick] Submitting payment data');
                    await onSubmit(formData);
                },
                onError: (error: any) => {
                    console.error('[MP Brick] Error:', error);
                    onError(error);
                },
            },
        });
    }

    /** Programmatically submit the Brick (if you want your own pay button) */
    async submitBrick(): Promise<void> {
        if (!this.brick) {
            throw new Error('[MP] No Brick mounted to submit.');
        }
        await this.brick.submit();
    }

    /** Unmounts and destroys the current Brick instance */
    async destroyBrick(): Promise<void> {
        if (this.brick) {
            try {
                await this.brick.unmount();
            } catch (e) {
                // Ignore unmount errors — brick may already be gone
            }
            this.brick = null;
        }
    }
}
