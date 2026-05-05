import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { trigger, transition, style, animate, state } from '@angular/animations';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '@lib/core';
import { MercadoPagoService } from '../../core/services/mercadopago.service';
import { ShippingConfigService } from '../../core/services/shipping-config.service';
import { CouponService } from '../../core/services/coupon.service';
import { LocationService } from '../../core/services/location.service';
import { AccountService, Address } from '@lib/core';
import { AttributionService } from '../../core/services/attribution.service';
import { Coupon } from '../../core/models/coupon.model';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, addDoc, serverTimestamp, doc, runTransaction, increment, getDoc, getDocs } from '@angular/fire/firestore';


interface ShippingRate {
    rateId: string;
    carrier: string;
    serviceName: string;
    price: number;
    currency: string;
    estimatedDays: number | null;
    isFree?: boolean;
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
export class CheckoutComponent implements OnInit, OnDestroy {
    fb              = inject(FormBuilder);
    cartService     = inject(CartService);
    authService     = inject(AuthService);
    mpService       = inject(MercadoPagoService);
    shippingConfig  = inject(ShippingConfigService);
    translate       = inject(TranslateService);
    router          = inject(Router);
    functions       = inject(Functions);
    firestore       = inject(Firestore);
    couponService   = inject(CouponService);
    locationService = inject(LocationService);
    accountService  = inject(AccountService);
    attributionSvc  = inject(AttributionService);

    private destroy$ = new Subject<void>();

    // Steps: 1=Identity, 2=Address, 3=Shipping, 4=Payment
    currentStep = signal(1);

    // Shipping
    shippingRates    = signal<ShippingRate[]>([]);
    selectedRate     = signal<ShippingRate | null>(null);
    loadingRates     = signal(false);
    ratesError       = signal<string | null>(null);

    // Payment
    paymentProcessing = signal(false);
    paymentError      = signal<string | null>(null);

    // Coupon
    couponCode        = signal('');
    appliedCoupon     = signal<Coupon | null>(null);
    couponError       = signal<string | null>(null);
    couponLoading     = signal(false);

    // ZIP auto-fill
    colonias       = signal<string[]>([]);
    zipLoading     = signal(false);

    // Saved Addresses
    savedAddresses     = signal<Address[]>([]);
    loadingAddresses   = signal(false);
    selectedAddressId  = signal<string | null>(null);

    // Brick state
    brickLoading      = signal(true);
    brickMounted      = signal(false);
    awaitingChallenge = signal(false);
    challengeUrl      = signal<string | null>(null);

    // ── Phase A — Step 1 inline sign-in ─────────────────────────────────────
    showInlineLogin    = signal(false);
    inlineLoginLoading = signal(false);
    inlineLoginError   = signal<string | null>(null);
    inlineLoginPwd     = signal('');
    showInlinePwd      = signal(false);

    // ── Phase A — Step 2 save address checkbox ───────────────────────────
    saveAddress        = signal(false);

    // Price freshness
    priceChangedWarning = signal(false);
    priceRefreshing     = signal(false);

    // RFC 5321-aligned email pattern — rejects `a@b`, requires real TLD
    private static readonly EMAIL_PATTERN = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    // Mexico phone: accepts +52 prefix (optional) then 10 digits, spaces/dashes allowed
    private static readonly MX_PHONE_PATTERN = /^(\+?52[\s\-]?)?(\d[\s\-]?){10}$/;

    emailControl = this.fb.control('', [
        Validators.required,
        Validators.pattern(CheckoutComponent.EMAIL_PATTERN),
    ]);

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
        phone:     ['', [
            Validators.required,
            Validators.pattern(CheckoutComponent.MX_PHONE_PATTERN),
        ]],
    });

    paymentForm = this.fb.group({
        // Kept minimal — Brick collects card data. We only need extra fields if Brick can't.
    });

    // ── Computed Totals ────────────────────────────────────────────────────────

    /** Discount amount in pesos (applied post-tax, on subtotal + shipping) */
    readonly discountAmount = computed(() => {
        const coupon = this.appliedCoupon();
        if (!coupon) return 0;
        const base = this.cartService.cartSubtotal() + (this.selectedRate()?.price ?? 0);
        if (coupon.type === 'percentage') {
            return parseFloat(((base * coupon.value) / 100).toFixed(2));
        } else {
            return Math.min(coupon.value, base);
        }
    });

    get orderTotal(): number {
        const base = this.cartService.cartSubtotal() + (this.selectedRate()?.price ?? 0);
        return Math.max(0, base - this.discountAmount());
    }

    /**
     * Smart shipping cost preview for the order summary column.
     * Returns 'Gratis 🎉' if threshold already met, null otherwise.
     */
    get shippingPreview(): string | null {
        const r = this.shippingConfig.rules();
        if (r.freeShipping.enabled && this.cartService.cartSubtotal() >= r.freeShipping.threshold) {
            const lang = this.translate.currentLang || 'es';
            return lang === 'es' ? 'Gratis 🎉' : 'Free 🎉';
        }
        return null;
    }

    constructor() {
        const user = this.authService.currentUser();
        if (user) this.emailControl.setValue(user.email || '');
    }

    async ngOnInit() {
        // Mark cart as checkout_started for abandoned-cart analytics
        this.cartService.markCheckoutStarted();

        await this.shippingConfig.load();

        // Load saved addresses for logged-in users
        if (this.authService.currentUser()) {
            await this.loadSavedAddresses();
        }

        // ZIP auto-fill
        this.shippingForm.get('zip')?.valueChanges.pipe(
            debounceTime(600),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(zip => {
            if (zip && zip.length === 5) {
                this.lookupZip(zip);
            } else {
                this.colonias.set([]);
            }
        });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ── Saved Addresses ───────────────────────────────────────────────────────

    private async loadSavedAddresses() {
        this.loadingAddresses.set(true);
        try {
            const addresses = await this.accountService.getAddresses();
            // Sort default first
            addresses.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
            this.savedAddresses.set(addresses);

            // Auto-select the default address
            const def = addresses.find(a => a.isDefault) ?? addresses[0];
            if (def) this.applyAddress(def);
        } catch (e) {
            console.warn('[Checkout] Could not load saved addresses:', e);
        } finally {
            this.loadingAddresses.set(false);
        }
    }

    applyAddress(address: Address) {
        this.selectedAddressId.set(address.id ?? null);
        this.shippingForm.patchValue({
            street:  address.street,
            extNum:  address.extNum,
            intNum:  address.intNum ?? '',
            colonia: address.colonia,
            city:    address.city,
            state:   address.state,
            zip:     address.zip,
        });
        // Trigger ZIP lookup so colonia dropdown populates
        if (address.zip?.length === 5) {
            this.lookupZip(address.zip);
        }
    }

    // ── ZIP Auto-fill ─────────────────────────────────────────────────────────

    private lookupZip(zip: string) {
        this.zipLoading.set(true);
        this.locationService.getZipCodeInfo(zip).pipe(
            takeUntil(this.destroy$)
        ).subscribe(response => {
            this.zipLoading.set(false);
            if (response?.places?.length) {
                const places = response.places;
                this.colonias.set(places.map(p => p['place name']));
                const stateName = places[0].state || '';
                this.shippingForm.patchValue({
                    state: stateName,
                    city: stateName,
                    colonia: places.length === 1 ? places[0]['place name'] : ''
                });
            } else {
                this.colonias.set([]);
                this.shippingForm.patchValue({ state: '', city: '', colonia: '' });
            }
        });
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    goToStep(step: number) {
        this.currentStep.set(step);
        if (step === 4) {
            // Mount the Bricks CardPayment form after the DOM is ready
            this.brickLoading.set(true);
            this.brickMounted.set(false);
            setTimeout(() => this.mountBrick(), 300);
        }
    }

    async continueFromAddress() {
        if (this.shippingForm.invalid) { this.shippingForm.markAllAsTouched(); return; }
        // Refresh prices from Firestore before moving forward — catches stale cart prices
        await this.refreshCartPrices();
        this.goToStep(3);
        await this.loadShippingRates();
    }

    /**
     * Re-reads product prices from Firestore for every cart item.
     * Updates the cart if any price changed and shows a warning banner.
     * Called at the address → shipping transition so the Brick always gets a fresh amount.
     */
    private async refreshCartPrices(): Promise<void> {
        const items = this.cartService.cartItems();
        if (!items.length) return;
        this.priceRefreshing.set(true);
        try {
            const snaps = await Promise.all(
                items.map(i => getDoc(doc(this.firestore, `products/${i.product.id}`)))
            );
            let changed = false;
            const updated = items.map((item, idx) => {
                const data = snaps[idx].data();
                if (!data) return item;
                const freshPrice: number = data['price'] ?? item.product.price;
                if (freshPrice !== item.product.price) {
                    changed = true;
                    return { ...item, product: { ...item.product, price: freshPrice } };
                }
                return item;
            });
            if (changed) {
                this.cartService.refreshPrices(updated);
                this.priceChangedWarning.set(true);
            }
        } catch (e) {
            console.warn('[Checkout] Price refresh failed — using cached prices:', e);
        } finally {
            this.priceRefreshing.set(false);
        }
    }


    /** Called when user taps a colonia chip */
    selectColonia(col: string) {
        this.shippingForm.patchValue({ colonia: col });
    }

    /** Resets ZIP + dependent fields so user can enter a new ZIP */
    resetZip() {
        this.shippingForm.patchValue({ zip: '', state: '', city: '', colonia: '' });
        this.colonias.set([]);
    }

    // ── Auth ────────────────────────────────────────────────────────────────────

    async loginWithGoogle() {
        await this.authService.loginWithGoogle();
        const user = this.authService.currentUser();
        if (user) { this.emailControl.setValue(user.email || ''); this.goToStep(2); }
    }

    /** Inline email+password sign-in — no redirect, no cart loss */
    async inlineLogin() {
        const email = this.emailControl.value ?? '';
        const pwd   = this.inlineLoginPwd();
        if (!email || !pwd) { this.inlineLoginError.set('Ingresa tu correo y contraseña.'); return; }
        this.inlineLoginLoading.set(true);
        this.inlineLoginError.set(null);
        try {
            await this.authService.loginWithEmail(email, pwd);
            const user = this.authService.currentUser();
            if (user) {
                this.emailControl.setValue(user.email || '');
                this.showInlineLogin.set(false);
                this.inlineLoginPwd.set('');
                await this.loadSavedAddresses(); // load saved addresses for authenticated user
                this.goToStep(2);
            }
        } catch (e: any) {
            this.inlineLoginError.set(e?.message ?? 'Correo o contraseña incorrectos.');
        } finally {
            this.inlineLoginLoading.set(false);
        }
    }

    /** Saves the shipping form data as a new address for the current user */
    private async saveAddressToAccount() {
        const user = this.authService.currentUser();
        if (!user || !this.saveAddress()) return;
        try {
            const v = this.shippingForm.value;
            await this.accountService.addAddress({
                street:    v.street    ?? '',
                extNum:    v.extNum    ?? '',
                intNum:    v.intNum    ?? undefined,
                colonia:   v.colonia   ?? '',
                city:      v.city      ?? '',
                state:     v.state     ?? '',
                zip:       v.zip       ?? '',
                country:   'MX',
                isDefault: false,
            });
        } catch (e) {
            console.warn('[Checkout] saveAddressToAccount failed:', e);
        }
    }

    // ── Coupon ────────────────────────────────────────────────────────────────

    async applyCoupon() {
        const code = this.couponCode().trim();
        if (!code) return;

        this.couponLoading.set(true);
        this.couponError.set(null);
        this.appliedCoupon.set(null);

        try {
            const coupon = await this.couponService.validateCoupon(code, this.cartService.cartSubtotal());
            this.appliedCoupon.set(coupon);
        } catch (e: any) {
            this.couponError.set(e?.message ?? 'Cupón no válido.');
        } finally {
            this.couponLoading.set(false);
        }
    }

    removeCoupon() {
        this.appliedCoupon.set(null);
        this.couponCode.set('');
        this.couponError.set(null);
    }

    // ── Shipping Rates ────────────────────────────────────────────────────────

    async loadShippingRates() {
        this.ratesError.set(null);
        this.selectedRate.set(null);
        this.shippingRates.set([]);

        const mode = this.shippingConfig.mode;

        if (mode === 'preset') {
            const subtotal = this.cartService.cartSubtotal();
            const lang     = this.translate.currentLang || this.translate.defaultLang || 'es';
            const rates    = this.shippingConfig.buildPresetRates(subtotal, lang);
            this.shippingRates.set(rates as any);
            if (rates.length === 1) {
                this.selectedRate.set(rates[0] as any);
            }
            if (rates.length === 0) {
                this.ratesError.set('No hay opciones de envío configuradas.');
            }
            return;
        }

        // Live mode: call Skydropx Cloud Function
        try {
            this.loadingRates.set(true);
            const zip     = this.shippingForm.value.zip || '';
            const parcels = this.buildParcel();
            const fn      = httpsCallable<any, { rates: ShippingRate[] }>(this.functions, 'skydropxGetRates');
            const res     = await fn({ zipTo: zip, parcel: parcels });
            const rates   = res.data?.rates ?? [];
            this.shippingRates.set(rates);
            if (rates.length === 0) this.ratesError.set('No hay opciones de envío disponibles para este código postal.');
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

    carrierColor(carrier: string): string {
        const map: Record<string, string> = {
            fedex: '#4d148c', dhl: '#ffcc00', ups: '#582619', estafeta: '#0057a8',
            redpack: '#c00', paquetexpress: '#ff6600', ampm: '#e6007e',
        };
        return map[carrier?.toLowerCase()] ?? '#334155';
    }

    // ── Order Number Generation ───────────────────────────────────────────────

    private async generateOrderNumber(): Promise<string> {
        const counterRef = doc(this.firestore, 'config/orderCounters');
        return runTransaction(this.firestore, async (transaction) => {
            const snap = await transaction.get(counterRef);
            const current = snap.exists() ? (snap.data()['web'] ?? 0) : 0;
            const next = current + 1;
            transaction.set(counterRef, { web: next }, { merge: true });
            return `WEB-${String(next).padStart(4, '0')}`;
        });
    }

    // ── MercadoPago Brick ─────────────────────────────────────────────────────

    async mountBrick() {
        const email  = this.emailControl.value || '';
        const amount = this.orderTotal;

        // Guard: valid amount required
        if (!amount || amount <= 0) {
            this.brickLoading.set(false);
            this.paymentError.set('El monto del pedido no es válido. Regresa al carrito.');
            return;
        }

        // Hard timeout — if onReady never fires within 20s, surface an error
        const brickTimeout = setTimeout(() => {
            if (this.brickLoading()) {
                console.error('[Brick] Timeout — Brick did not mount in 20s');
                this.brickLoading.set(false);
                this.paymentError.set('El formulario de pago tardó demasiado en cargar. Haz clic en "Reintentar".');
            }
        }, 20000);

        try {
            // Single Firestore read for both publicKey + installments config
            // (previously 2 sequential reads = ~1.5s extra latency before SDK even starts loading)
            const { publicKey, installmentsCfg } = await this.mpService.loadConfig();
            await this.mpService.init(publicKey);

            await this.mpService.mountCardPaymentBrick(
                'cardPaymentBrick_container',
                amount,
                email,
                installmentsCfg,
                async (formData) => this.onBrickSubmit(formData),
                (err) => {
                    clearTimeout(brickTimeout);
                    console.error('[Brick] Error:', err);
                    this.paymentError.set('Error al cargar el formulario de pago. Haz clic en "Reintentar".');
                    this.brickLoading.set(false);
                },
                () => {
                    clearTimeout(brickTimeout);
                    this.brickLoading.set(false);
                    this.brickMounted.set(true);
                }
            );
        } catch (e: any) {
            clearTimeout(brickTimeout);
            this.brickLoading.set(false);
            this.paymentError.set(e?.message ?? 'No se pudo inicializar el pago.');
        }
    }


    /** Called by the Brick's onSubmit — receives fully tokenized payment data */
    private async onBrickSubmit(formData: { token: string; payment_method_id: string; issuer_id: string | number; installments: number; payer: { email: string } }) {
        this.paymentProcessing.set(true);
        this.paymentError.set(null);

        const email = formData.payer?.email || this.emailControl.value || 'guest@importadoraeuro.com';
        const shipping = this.shippingForm.value;
        const rate     = this.selectedRate();
        const coupon   = this.appliedCoupon();

        try {
            // 1. Generate human-readable order number (WEB-0001 format)
            const orderNumber = await this.generateOrderNumber();

            // 2. Create Firestore order (status: pending_payment)
            const ordersRef = collection(this.firestore, 'orders');
            const orderDoc  = await addDoc(ordersRef, {
                orderNumber,
                sourceChannel:  'storefront',
                status:         'pending_payment',
                paymentStatus:  'pending',
                paymentMethod:  'mercadopago',
                createdAt:      serverTimestamp(),
                updatedAt:      serverTimestamp(),
                customer: {
                    email,
                    name: `${shipping.firstName} ${shipping.lastName}`.trim(),
                    firstName: shipping.firstName,
                    lastName:  shipping.lastName,
                    phone:     shipping.phone,
                },
                shippingAddress: {
                    street:         shipping.street,
                    exteriorNumber: shipping.extNum,
                    interiorNumber: shipping.intNum || null,
                    colonia:        shipping.colonia,
                    city:           shipping.city,
                    state:          shipping.state,
                    zipCode:        shipping.zip,
                    country:        'MX',
                },
                items: this.cartService.cartItems().map(i => ({
                    productId:    i.product.id,
                    productName:  i.product.name.es || i.product.name.en,
                    productImage: i.product.images?.main ?? '',
                    sku:          i.product.sku ?? '',
                    price:        i.product.price,
                    quantity:     i.quantity,
                    subtotal:     i.product.price * i.quantity,
                    brand:        i.product.brand,
                })),
                subtotal:     this.cartService.cartSubtotal(),
                shippingCost: rate?.price ?? 0,
                discount:     this.discountAmount(),
                tax:          0,  // IVA-inclusive prices
                total:        this.orderTotal,
                currency:     'MXN',
                couponCode:   coupon?.code ?? null,
                shipping: rate ? {
                    carrier:       rate.carrier,
                    serviceName:   rate.serviceName,
                    rateId:        rate.rateId,
                    estimatedDays: rate.estimatedDays,
                    currency:      rate.currency,
                    isFree:        rate.isFree ?? false,
                } : null,
                history: [{
                    status:    'pending_payment',
                    timestamp: new Date(),
                    note:      `Orden ${orderNumber} creada en storefront web`,
                    updatedBy: 'system',
                }],
                // ── Marketing attribution ──────────────────────────────────────────
                attribution: this.attributionSvc.get() ?? null,
            });

            const orderId = orderDoc.id;

            // 3. Call Cloud Function with Brick's tokenized data
            const processPaymentFn = httpsCallable<any, {
                success: boolean;
                status: string;
                paymentId: number;
                statusDetail: string;
                requires3DS?: boolean;
                challengeUrl?: string;
            }>(this.functions, 'processPayment');

            const result = await processPaymentFn({
                token:           formData.token,
                paymentMethodId: formData.payment_method_id,
                issuerId:        formData.issuer_id,
                installments:    formData.installments,
                amount:          this.orderTotal,
                email,
                description:     `Orden ${orderNumber} (${orderId})`,
                orderId,
                orderNumber,
                // Payer enrichment — improves MP fraud scoring (Payment Approval Quality)
                payerFirstName: shipping.firstName || '',
                payerLastName:  shipping.lastName  || '',
                payerPhone:     shipping.phone      || '',
                payerZip:       shipping.zip        || '',
                payerStreet:    shipping.street     || '',
            });

            // 4. Handle 3DS challenge
            if (result.data.requires3DS && result.data.challengeUrl) {
                this.challengeUrl.set(result.data.challengeUrl);
                this.awaitingChallenge.set(true);
                // Poll for order status change while user completes challenge
                this.pollOrderStatus(orderId, orderNumber, email);
                return;
            }

            // 5. Increment coupon usage atomically (prevents race conditions)
            if (coupon?.id) {
                this.couponService.updateCoupon(coupon.id, {
                    usageCount: increment(1) as any
                }).catch(() => {});
                // Mark the QR scan (if any) as converted — closes the funnel
                if (coupon.code) {
                    this.couponService.markScanConverted(
                        coupon.code,
                        orderId,
                        this.discountAmount()
                    ).catch(() => {});
                }
            }

            // 6. Archive cart (preserves record) and navigate to confirmation
            this.cartService.clearCart();
            await Promise.all([
                this.cartService.completeCart(orderId),
                this.saveAddressToAccount(),  // Phase A: persists address if checkbox checked
            ]);
            this.router.navigate(['/order-confirmation'], {
                state: { orderId, orderNumber, email, shipping: this.selectedRate() }
            });

        } catch (err: any) {
            console.error('[Checkout] Payment error:', err);
            this.paymentError.set(err?.message ?? 'No se pudo procesar el pago. Intenta de nuevo.');
        } finally {
            this.paymentProcessing.set(false);
        }
    }

    /** Polls the order document until payment is no longer pending (for 3DS flows) */
    private pollOrderStatus(orderId: string, orderNumber: string, email: string) {
        const import_doc = doc(this.firestore, `orders/${orderId}`);
        let attempts = 0;
        const maxAttempts = 30; // 30 x 3s = 90s max wait

        const poll = setInterval(async () => {
            attempts++;
            try {
                const { getDoc } = await import('@angular/fire/firestore');
                const snap = await getDoc(import_doc);
                const data = snap.data();
                const status = data?.['paymentStatus'];

                if (status === 'approved') {
                    clearInterval(poll);
                    this.awaitingChallenge.set(false);
                    const rate = this.selectedRate();
                    if (this.appliedCoupon()?.id) {
                        this.couponService.updateCoupon(this.appliedCoupon()!.id!, {
                            usageCount: (this.appliedCoupon()!.usageCount ?? 0) + 1
                        }).catch(() => {});
                        // Mark QR scan as converted for 3DS flow
                        if (this.appliedCoupon()!.code) {
                            this.couponService.markScanConverted(
                                this.appliedCoupon()!.code,
                                orderId,
                                this.discountAmount()
                            ).catch(() => {});
                        }
                    }
                    this.cartService.clearCart();
                    await this.cartService.completeCart(orderId);
                    this.router.navigate(['/order-confirmation'], {
                        state: { orderId, orderNumber, email, shipping: rate }
                    });
                } else if (status === 'rejected' || status === 'cancelled') {
                    clearInterval(poll);
                    this.awaitingChallenge.set(false);
                    this.paymentError.set('El pago fue rechazado. Intenta con otra tarjeta.');
                    this.paymentProcessing.set(false);
                } else if (attempts >= maxAttempts) {
                    clearInterval(poll);
                    this.awaitingChallenge.set(false);
                    this.paymentError.set('Tiempo de espera agotado. Verifica tu estado de cuenta y contáctanos si el cargo fue realizado.');
                    this.paymentProcessing.set(false);
                }
            } catch (e) {
                console.error('[3DS Poll] Error:', e);
            }
        }, 3000);
    }

    /** Legacy method stub — kept for compatibility, now calls Brick submit */
    async processPayment() {
        await this.mpService.submitBrick();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private buildParcel() {
        const items    = this.cartService.cartItems();
        const totalQty = items.reduce((s, i) => s + i.quantity, 0);
        return {
            weight: Math.max(1, totalQty * 5),
            height: 30,
            width:  65,
            length: 65,
        };
    }
}
