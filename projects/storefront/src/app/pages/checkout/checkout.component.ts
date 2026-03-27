import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { trigger, transition, style, animate, state } from '@angular/animations';
import { CartService } from '@lib/core';
import { AuthService } from '@lib/core';
import { MercadoPagoService } from '../../core/services/mercadopago.service';
import { ShippingConfigService } from '../../core/services/shipping-config.service';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, addDoc, serverTimestamp } from '@angular/fire/firestore';

interface ShippingRate {
    rateId: string;
    carrier: string;
    serviceName: string;
    price: number;
    currency: string;
    estimatedDays: number | null;
}

@Component({
    selector: 'app-checkout',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule],
    templateUrl: './checkout.component.html',
    styleUrls: ['./checkout.component.css'],
    animations: [
        trigger('expandCollapse', [
            state('collapsed', style({ height: '0px', padding: '0 24px', opacity: 0, visibility: 'hidden' })),
            state('expanded', style({ height: '*', padding: '0 24px 24px 24px', opacity: 1, visibility: 'visible' })),
            transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
        ])
    ]
})
export class CheckoutComponent implements OnInit {
    fb              = inject(FormBuilder);
    cartService     = inject(CartService);
    authService     = inject(AuthService);
    mpService       = inject(MercadoPagoService);
    shippingConfig  = inject(ShippingConfigService);
    translate       = inject(TranslateService);
    router          = inject(Router);
    functions       = inject(Functions);
    firestore       = inject(Firestore);

    // Steps: 1=Identity, 2=Address, 3=Shipping, 4=Payment
    currentStep = signal(1);

    // Shipping
    shippingRates  = signal<ShippingRate[]>([]);
    selectedRate   = signal<ShippingRate | null>(null);
    loadingRates   = signal(false);
    ratesError     = signal<string | null>(null);

    // Payment
    paymentProcessing = signal(false);
    paymentError      = signal<string | null>(null);

    emailControl = this.fb.control('', [Validators.required, Validators.email]);

    shippingForm = this.fb.group({
        firstName: ['', Validators.required],
        lastName:  ['', Validators.required],
        street:    ['', Validators.required],
        extNum:    ['', Validators.required],
        intNum:    [''],
        colonia:   ['', Validators.required],
        city:      ['', Validators.required],
        state:     ['', Validators.required],
        zip:       ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
        phone:     ['', Validators.required],
    });

    paymentForm = this.fb.group({
        cardHolder:           ['', Validators.required],
        identificationNumber: ['', Validators.required],
    });

    constructor() {
        const user = this.authService.currentUser();
        if (user) this.emailControl.setValue(user.email || '');
    }

    async ngOnInit() {
        // Load shipping rules once — instant for preset mode, no Skydropx call needed
        await this.shippingConfig.load();
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    goToStep(step: number) {
        if (step === 4 && this.currentStep() < 4) {
            setTimeout(() => {
                this.mpService.mountSecureFields({
                    cardNumber:     'form-checkout__cardNumber',
                    expirationDate: 'form-checkout__expirationDate',
                    securityCode:   'form-checkout__securityCode',
                });
            }, 200);
        }
        this.currentStep.set(step);
    }

    async continueFromAddress() {
        if (this.shippingForm.invalid) { this.shippingForm.markAllAsTouched(); return; }
        this.goToStep(3);
        await this.loadShippingRates();
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    async loginWithGoogle() {
        await this.authService.loginWithGoogle();
        const user = this.authService.currentUser();
        if (user) { this.emailControl.setValue(user.email || ''); this.goToStep(2); }
    }

    // ── Shipping Rates ────────────────────────────────────────────────────────

    async loadShippingRates() {
        this.loadingRates.set(true);
        this.ratesError.set(null);
        this.selectedRate.set(null);
        this.shippingRates.set([]);

        try {
            const mode = this.shippingConfig.mode;

            if (mode === 'preset') {
                // Instant — no network call. Rates come from admin config.
                const subtotal = this.cartService.cartSubtotal();
                const lang     = this.translate.currentLang || this.translate.defaultLang || 'es';
                const rates    = this.shippingConfig.buildPresetRates(subtotal, lang);
                this.shippingRates.set(rates as any);
                if (rates.length === 1) {
                    // Auto-select single option (e.g. free shipping)
                    this.selectedRate.set(rates[0] as any);
                }
                if (rates.length === 0) {
                    this.ratesError.set('No hay opciones de envío configuradas.');
                }
            } else {
                // Live mode: query Skydropx via Cloud Function
                const zip     = this.shippingForm.value.zip || '';
                const parcels = this.buildParcel();
                const fn      = httpsCallable<any, { rates: ShippingRate[] }>(this.functions, 'skydropxGetRates');
                const res     = await fn({ zipTo: zip, parcel: parcels });
                const rates   = res.data?.rates ?? [];
                this.shippingRates.set(rates);
                if (rates.length === 0) this.ratesError.set('No hay opciones de envío disponibles para este código postal.');
            }
        } catch (e: any) {
            this.ratesError.set('No se pudieron cargar las opciones de envío. Verifica el código postal.');
            console.error('[Checkout] Rates error:', e);
        } finally {
            this.loadingRates.set(false);
        }
    }

    selectRate(rate: ShippingRate) {
        this.selectedRate.set(rate);
    }

    get orderTotal(): number {
        return this.cartService.cartSubtotal() + (this.selectedRate()?.price ?? 0);
    }

    carrierColor(carrier: string): string {
        const map: Record<string, string> = {
            fedex: '#4d148c', dhl: '#ffcc00', ups: '#582619', estafeta: '#0057a8',
            redpack: '#c00', paquetexpress: '#ff6600', ampm: '#e6007e',
        };
        return map[carrier?.toLowerCase()] ?? '#334155';
    }

    // ── Payment ───────────────────────────────────────────────────────────────

    async processPayment() {
        if (this.paymentForm.invalid) { this.paymentForm.markAllAsTouched(); return; }
        this.paymentProcessing.set(true);
        this.paymentError.set(null);

        const { cardHolder, identificationNumber } = this.paymentForm.value;
        const email    = this.emailControl.value || 'guest@importadoraeuro.com';
        const shipping = this.shippingForm.value;
        const rate     = this.selectedRate();

        try {
            // 1. Create Firestore order FIRST (status: pending_payment)
            const ordersRef = collection(this.firestore, 'orders');
            const orderDoc  = await addDoc(ordersRef, {
                channel:    'web',
                status:     'pending_payment',
                createdAt:  serverTimestamp(),
                updatedAt:  serverTimestamp(),
                customer: {
                    email,
                    firstName: shipping.firstName,
                    lastName:  shipping.lastName,
                    phone:     shipping.phone,
                },
                shippingAddress: {
                    street:  `${shipping.street} ${shipping.extNum}${shipping.intNum ? ' Int ' + shipping.intNum : ''}`,
                    colonia: shipping.colonia,
                    city:    shipping.city,
                    state:   shipping.state,
                    zip:     shipping.zip,
                    country: 'MX',
                },
                items: this.cartService.cartItems().map(i => ({
                    productId:   i.product.id,
                    name:        i.product.name.es || i.product.name.en,
                    price:       i.product.price,
                    quantity:    i.quantity,
                    subtotal:    i.product.price * i.quantity,
                })),
                subtotal:      this.cartService.cartSubtotal(),
                shippingCost:  rate?.price ?? 0,
                total:         this.orderTotal,
                shipping: rate ? {
                    carrier:      rate.carrier,
                    serviceName:  rate.serviceName,
                    rateId:       rate.rateId,
                    estimatedDays: rate.estimatedDays,
                    currency:     rate.currency,
                } : null,
                history: [{
                    status:    'pending_payment',
                    timestamp: new Date(),
                    note:      'Orden creada en storefront web',
                }],
            });

            const orderId = orderDoc.id;

            // 2. Tokenize card via MercadoPago
            const token = await this.mpService.createToken(cardHolder!, email, 'INE', identificationNumber!);

            // 3. Call backend to charge
            const processPaymentFn = httpsCallable(this.functions, 'processPayment');
            await processPaymentFn({
                token,
                amount:       this.orderTotal,
                email,
                description:  `Orden #${orderId}`,
                orderId,
                installments: 1,
            });

            // 4. Navigate to confirmation
            this.router.navigate(['/order-confirmation'], { state: { orderId, email } });

        } catch (err: any) {
            console.error('[Checkout] Payment error:', err);
            this.paymentError.set(err?.message ?? 'No se pudo procesar el pago. Intenta de nuevo.');
        } finally {
            this.paymentProcessing.set(false);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private buildParcel() {
        // Estimate based on cart: heaviest item × total qty, bounded to reasonable size
        const items     = this.cartService.cartItems();
        const totalQty  = items.reduce((s, i) => s + i.quantity, 0);
        return {
            weight: Math.max(1, totalQty * 5),   // ~5kg per tire
            height: 30,
            width:  65,
            length: 65,
        };
    }
}
