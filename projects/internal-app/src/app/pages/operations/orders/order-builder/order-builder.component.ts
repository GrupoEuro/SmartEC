import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';

import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { OrderService } from '../../../../core/services/order.service';
import { ProductService } from '../../../../core/services/product.service';
import { LocationService } from '../../../../core/services/location.service';
import { SkydropxService, ShippingRate } from '../../../../core/services/skydropx.service';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { PaymentLinkService, CreatePaymentLinkResponse } from '../../../../core/services/payment-link.service';
import { UserProfile } from '../../../../core/models/user.model';
import { Product } from '../../../../core/models/product.model';
import { Order, OrderItem, ShippingAddress, SocialSource, ShippingMethod } from '../../../../core/models/order.model';

// Social source options for the UI
export const SOCIAL_SOURCES: { key: SocialSource; label: string; icon: string; color: string }[] = [
    { key: 'WHATSAPP',  label: 'WhatsApp',  icon: '📱', color: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
    { key: 'INSTAGRAM', label: 'Instagram', icon: '📸', color: 'border-pink-500/50 bg-pink-500/10 text-pink-300' },
    { key: 'FACEBOOK',  label: 'Facebook',  icon: '👤', color: 'border-blue-500/50 bg-blue-500/10 text-blue-300' },
    { key: 'TIKTOK',    label: 'TikTok',    icon: '🎵', color: 'border-purple-500/50 bg-purple-500/10 text-purple-300' },
    { key: 'PHONE',     label: 'Llamada',   icon: '📞', color: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300' },
    { key: 'WALK_IN',   label: 'Mostrador', icon: '🚶', color: 'border-slate-500/50 bg-slate-500/10 text-slate-300' },
    { key: 'B2B',       label: 'Flotillas/B2B', icon: '🤝', color: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' },
    { key: 'OTHER',     label: 'Otro',       icon: '💬', color: 'border-slate-500/50 bg-slate-500/10 text-slate-400' },
];

export const COMMON_TIRE_MEASURES = [
    '205/55R16', '225/45R17', '185/65R15', '215/60R16', '235/55R18', '245/45R18', '195/65R15'
];

export const BRANCH_OPTIONS = [
    { key: 'MATRIZ_SLP', label: 'San Luis Potosí — Matriz Juárez', code: 'SLP-01' },
    { key: 'CARRANZA_SLP', label: 'San Luis Potosí — Av. Carranza', code: 'SLP-02' },
    { key: 'CEDIS_CENTRO', label: 'CEDIS Central Eurollantas', code: 'CEDIS-01' },
];

@Component({
    selector: 'app-order-builder',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AppIconComponent, AdminPageHeaderComponent],
    templateUrl: './order-builder.component.html',
    styles: [`
        .wizard-container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .source-chip {
            cursor: pointer;
            border: 1px solid;
            border-radius: 9999px;
            padding: 0.4rem 0.95rem;
            font-size: 0.8rem;
            font-weight: 600;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
        }
        .source-chip.selected {
            transform: scale(1.04);
        }
        .measure-pill {
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(30, 41, 59, 0.6);
            color: #cbd5e1;
            padding: 0.3rem 0.75rem;
            border-radius: 0.5rem;
            font-size: 0.75rem;
            font-weight: 600;
            font-family: monospace;
            transition: all 0.15s ease;
        }
        .measure-pill:hover {
            background: rgba(99, 102, 241, 0.2);
            border-color: rgba(99, 102, 241, 0.4);
            color: #ffffff;
        }
        .pulse-radar {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
            animation: pulse-green 1.8s infinite;
        }
        @keyframes pulse-green {
            0% {
                transform: scale(0.98);
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 15px rgba(16, 185, 129, 0);
            }
            100% {
                transform: scale(0.98);
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
            }
        }
        @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
        }
    `]
})
export class OrderBuilderComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private orderService = inject(OrderService);
    private productService = inject(ProductService);
    private userService = inject(UserManagementService);
    private authService = inject(AuthService);
    private toast = inject(ToastService);
    private fb = inject(FormBuilder);
    private locationService = inject(LocationService);
    private skydropxService = inject(SkydropxService);
    private paymentLinkService = inject(PaymentLinkService);

    // ── Stepper State ─────────────────────────────────────────────────────────
    currentStep = signal<1 | 2 | 3 | 4>(1);

    // ── Customer & Branch (Step 1) ────────────────────────────────────────────
    customerId = '';
    customer = signal<UserProfile | null>(null);
    isLoadingCustomer = signal(false);

    customerSearchControl = new FormControl('');
    customerSearchResults = signal<UserProfile[]>([]);
    isSearchingCustomer = signal(false);

    showGuestForm = signal(false);
    guestName = '';
    guestEmail = '';
    guestPhone = '';

    socialSources = SOCIAL_SOURCES;
    selectedSource = signal<SocialSource | null>('WHATSAPP');
    sourceNote = '';

    branchOptions = BRANCH_OPTIONS;
    selectedBranch = signal<string>('MATRIZ_SLP');

    // ── Product Search & Catalog (Step 2) ────────────────────────────────────
    searchControl = new FormControl('');
    searchResults = signal<Product[]>([]);
    isSearching = signal(false);
    tireMeasures = COMMON_TIRE_MEASURES;

    cartItems = signal<OrderItem[]>([]);

    subtotal = computed(() => this.cartItems().reduce((acc, item) => acc + item.subtotal, 0));

    discountType   = signal<'percent' | 'fixed'>('percent');
    discountValue  = signal(0);
    discountReason = '';

    discountAmount = computed(() => {
        const base = this.subtotal();
        if (this.discountType() === 'percent') return base * (this.discountValue() / 100);
        return Math.min(this.discountValue(), base);
    });

    // Prices in catalog already include 16% IVA
    total = computed(() => Math.max(0, this.subtotal() - this.discountAmount() + this.shippingCost()));

    // Informative 16% IVA desglose (extracted from net total)
    tax = computed(() => {
        const netTotal = Math.max(0, this.subtotal() - this.discountAmount());
        return Math.round((netTotal - (netTotal / 1.16)) * 100) / 100;
    });

    // ── Delivery & Payment (Step 3) ──────────────────────────────────────────
    shippingCost    = signal(0);
    shippingMethod  = signal<ShippingMethod>('STORE_PICKUP');
    
    shippingAddress = signal<ShippingAddress | null>(null);
    showAddressForm = signal(false);

    shippingRates = signal<ShippingRate[]>([]);
    isLoadingRates = signal(false);
    selectedRateId = signal<string | null>(null);
    quoteZipCode = signal<string>('');
    selectedCarrier = signal<string | null>(null);

    colonias = signal<string[]>([]);
    isLoadingZip = signal(false);

    addressForm: FormGroup = this.fb.group({
        street: ['', Validators.required],
        exteriorNumber: ['', Validators.required],
        interiorNumber: [''],
        colonia: ['', Validators.required],
        city: ['', Validators.required],
        state: ['', Validators.required],
        zipCode: ['', [Validators.required, Validators.pattern('^[0-9]{5}$')]],
        country: ['México', Validators.required],
        references: ['']
    });

    selectedPaymentMethod = signal<'mercadopago_link' | 'bank_transfer' | 'cash' | 'card_terminal'>('mercadopago_link');

    // ── Confirmation & Real-Time Payment Monitor (Step 4) ────────────────────
    createdOrder = signal<Order | null>(null);
    createdOrderId = signal<string | null>(null);
    isGeneratingLink = signal(false);
    generatedLinkData = signal<{
        paymentUrl: string;
        preferenceId: string;
        qrCodeUrl: string;
        externalReference: string;
        orderId: string;
    } | null>(null);

    realTimePaymentStatus = signal<string>('pending_link');
    private paymentStatusSubscription: Subscription | null = null;

    isSubmitting = signal(false);
    private currentStaff: { uid: string; name: string } | null = null;

    constructor() {
        this.addressForm.get('zipCode')?.valueChanges.pipe(
            debounceTime(500),
            distinctUntilChanged()
        ).subscribe(zip => {
            if (zip && zip.length === 5) {
                this.isLoadingZip.set(true);
                this.locationService.getZipCodeInfo(zip).subscribe({
                    next: (response: any) => {
                        this.isLoadingZip.set(false);
                        if (response && response.places && response.places.length > 0) {
                            const newColonias = response.places.map((p: any) => p['place name']);
                            this.colonias.set(newColonias);
                            
                            const stateName = response.places[0].state || '';
                            this.addressForm.patchValue({
                                state: stateName,
                                city: stateName
                            });
                            
                            if (newColonias.length === 1) {
                                this.addressForm.get('colonia')?.setValue(newColonias[0]);
                            } else {
                                this.addressForm.get('colonia')?.setValue('');
                            }
                        } else {
                            this.colonias.set([]);
                        }
                    },
                    error: () => {
                        this.isLoadingZip.set(false);
                        this.colonias.set([]);
                    }
                });
            } else {
                this.colonias.set([]);
            }
        });

        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(term => {
                if (!term || term.length < 2) return of([]);
                this.isSearching.set(true);
                return this.productService.searchProducts(term);
            })
        ).subscribe({
            next: (products) => { this.searchResults.set(products); this.isSearching.set(false); },
            error: () => { this.toast.error('Error al buscar productos'); this.isSearching.set(false); }
        });

        this.customerSearchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(term => {
                if (!term || term.length < 2) return of([]);
                this.isSearchingCustomer.set(true);
                return this.userService.searchCustomers(term);
            })
        ).subscribe({
            next: (customers) => { this.customerSearchResults.set(customers); this.isSearchingCustomer.set(false); },
            error: () => { this.toast.error('Error al buscar clientes'); this.isSearchingCustomer.set(false); }
        });

        this.authService.userProfile$.subscribe(p => {
            if (p) this.currentStaff = { uid: p.uid, name: p.displayName || p.email || '' };
        });
    }

    ngOnInit() {
        this.route.queryParams.subscribe(params => {
            if (params['customerId']) {
                this.customerId = params['customerId'];
                this.loadCustomer(this.customerId);
            }
        });
    }

    ngOnDestroy() {
        if (this.paymentStatusSubscription) {
            this.paymentStatusSubscription.unsubscribe();
        }
    }

    // ── Stepper Navigation ───────────────────────────────────────────────────

    goToStep(step: 1 | 2 | 3 | 4) {
        if (step === 2 && !this.customer()) {
            this.toast.error('Selecciona o registra un cliente antes de continuar.');
            return;
        }
        if (step === 3 && this.cartItems().length === 0) {
            this.toast.error('Agrega al menos una llanta o producto al carrito.');
            return;
        }
        if (step === 4 && !this.createdOrder()) {
            this.toast.error('Crea el pedido primero para ver la confirmación.');
            return;
        }
        this.currentStep.set(step);
    }

    applyMeasureFilter(measure: string) {
        this.searchControl.setValue(measure);
    }

    // ── Customer Helpers ──────────────────────────────────────────────────────

    loadCustomer(id: string) {
        this.isLoadingCustomer.set(true);
        this.userService.getUserById(id).subscribe({
            next: (user) => { if (user) this.setCustomer(user); this.isLoadingCustomer.set(false); },
            error: () => this.isLoadingCustomer.set(false)
        });
    }

    setCustomer(user: UserProfile) {
        this.customer.set(user);
        this.customerId = user.uid;
        if (user.shippingAddress) this.shippingAddress.set(user.shippingAddress);
        this.customerSearchControl.setValue('');
        this.customerSearchResults.set([]);
        this.showGuestForm.set(false);
    }

    confirmGuest() {
        if (!this.guestName || !this.guestPhone) {
            this.toast.error('Nombre y teléfono son obligatorios para cliente prospecto/mostrador');
            return;
        }
        const guest: UserProfile = {
            uid: '',
            displayName: this.guestName,
            email: this.guestEmail || '',
            phone: this.guestPhone,
            role: 'CUSTOMER',
            isActive: true,
        } as any;
        this.customer.set(guest);
        this.showGuestForm.set(false);
    }

    clearCustomer() {
        this.customer.set(null);
        this.customerId = '';
        this.shippingAddress.set(null);
    }

    // ── Address ───────────────────────────────────────────────────────────────

    saveAddress() {
        if (this.addressForm.invalid) {
            this.toast.error('Calle, número exterior, ciudad, colonia y C.P. son obligatorios');
            this.addressForm.markAllAsTouched();
            return;
        }
        this.shippingAddress.set(this.addressForm.value as ShippingAddress);
        this.showAddressForm.set(false);
        this.shippingRates.set([]);
        this.selectedRateId.set(null); 
    }

    // ── Cart ──────────────────────────────────────────────────────────────────

    addItem(product: Product) {
        const existing = this.cartItems().find(i => i.productId === product.id);
        if (existing) {
            this.updateQuantity(product.id!, existing.quantity + 1);
        } else {
            const newItem: OrderItem = {
                productId: product.id!,
                productName: product.name['es'] || product.name['en'] || '',
                productImage: product.images?.main || '',
                sku: product.sku,
                price: product.price,
                quantity: 1,
                subtotal: product.price,
                brand: product.brand,
                category: product.categoryId,
                weight: (product as any).weight ?? undefined,
                dimensions: (product as any).dimensions ?? undefined,
            };
            this.cartItems.update(items => [...items, newItem]);
        }
        this.searchControl.setValue('');
        this.searchResults.set([]);
    }

    updateQuantity(productId: string, qty: number) {
        if (qty < 1) return;
        this.cartItems.update(items => items.map(item =>
            item.productId === productId ? { ...item, quantity: qty, subtotal: item.price * qty } : item
        ));
    }

    removeItem(productId: string) {
        this.cartItems.update(items => items.filter(i => i.productId !== productId));
        this.shippingRates.set([]);
    }

    // ── Shipping Quotes ───────────────────────────────────────────────────────

    fetchShippingRates() {
        const addr = this.shippingAddress();
        const zip = addr?.zipCode || this.quoteZipCode();

        if (!zip || zip.length < 5) {
            this.toast.error('Ingresa un Código Postal de 5 dígitos.');
            return;
        }

        const items = this.cartItems();
        if (items.length === 0) {
            this.toast.error('Agrega productos al pedido para cotizar envío.');
            return;
        }

        this.isLoadingRates.set(true);

        let totalWeight = 0;
        let totalHeight = 0;
        let maxLength = 0;
        let maxWidth = 0;

        for (const item of items) {
            const w = item.weight ?? null;
            const d = item.dimensions ?? null;
            totalWeight += item.quantity * (w ?? 5);
            totalHeight += item.quantity * (d?.height ?? 20);
            maxLength = Math.max(maxLength, d?.length ?? 65);
            maxWidth  = Math.max(maxWidth,  d?.width  ?? 65);
        }

        const parcel = {
            weight: Math.max(1, Math.round(totalWeight)),
            height: Math.max(1, Math.round(totalHeight)),
            length: Math.max(1, Math.round(maxLength)),
            width:  Math.max(1, Math.round(maxWidth)),
        };

        this.skydropxService.getRates({ zipTo: zip, parcel }).subscribe({
            next: (res) => {
                this.shippingRates.set(res.rates || []);
                this.isLoadingRates.set(false);
                if (!res.rates || res.rates.length === 0) this.toast.info('No se encontraron tarifas de paquetería.');
            },
            error: (err) => {
                this.toast.error('Error al cotizar paquetería con SkyDropX');
                console.error(err);
                this.isLoadingRates.set(false);
            }
        });
    }

    selectShippingRate(rate: ShippingRate) {
        this.selectedRateId.set(rate.rateId);
        this.shippingCost.set(rate.price);
        this.selectedCarrier.set(rate.carrier);
        this.shippingMethod.set('NATIONAL_CARRIER');
    }

    getCarrierColor(carrier: string) {
        return this.skydropxService.getCarrierColor(carrier);
    }

    // ── Source ────────────────────────────────────────────────────────────────

    selectSource(source: SocialSource) {
        this.selectedSource.set(this.selectedSource() === source ? null : source);
    }

    getSourceConfig(key: SocialSource) {
        return this.socialSources.find(s => s.key === key);
    }

    // ── Order Creation & MercadoPago Link Execution ───────────────────────────

    async processOrderSubmit() {
        const customer = this.customer();
        if (!customer) { this.toast.error('Cliente es requerido'); return; }
        if (this.cartItems().length === 0) { this.toast.error('El pedido no tiene productos'); return; }
        if (!this.shippingAddress() && this.shippingMethod() !== 'STORE_PICKUP') {
            this.toast.error('La dirección de envío es requerida (o selecciona Recoger en Sucursal)'); return;
        }

        this.isSubmitting.set(true);

        try {
            const isGuest = !customer.uid;
            const orderPayload: Order = {
                orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
                sourceChannel: 'on_behalf',
                fulfillmentType: 'merchant',
                customer: {
                    ...(customer.uid ? { id: customer.uid } : {}),
                    name: customer.displayName || customer.email || 'Cliente Mostrador',
                    email: customer.email || '',
                    phone: customer.phone || '',
                    isGuest,
                },
                items: this.cartItems(),
                subtotal: this.subtotal(),
                discount: this.discountAmount(),
                shippingCost: this.shippingCost(),
                tax: this.tax(),
                total: this.total(),
                status: 'pending',
                paymentStatus: 'pending',
                paymentMethod: this.selectedPaymentMethod() as any,
                shippingMethod: this.shippingMethod(),
                ...(this.selectedCarrier() ? { carrier: this.selectedCarrier()! } : {}),
                shippingAddress: this.shippingAddress() ?? {
                    street: 'Retiro en Sucursal', exteriorNumber: 'S/N', city: 'San Luis Potosí', state: 'San Luis Potosí', zipCode: '78000', country: 'México'
                },
                metadata: {
                    ...(this.currentStaff?.uid ? { enteredBy: this.currentStaff.uid } : {}),
                    ...(this.currentStaff?.name ? { enteredByName: this.currentStaff.name } : {}),
                    enteredAt: new Date(),
                    ...(this.selectedSource() ? { source: this.selectedSource()! } : {}),
                    sourceNote: this.sourceNote ? `[${this.selectedBranch()}] ${this.sourceNote}` : `[${this.selectedBranch()}]`,
                },
                ...(this.discountReason ? { notes: `Descuento: ${this.discountReason}` } : {}),
                createdAt: new Date(),
                updatedAt: new Date(),
                history: [],
                priorityLevel: 'standard',
            };

            // 1. Create order in Firestore
            const orderId = await this.orderService.createOrder(orderPayload);
            console.log('[OrderBuilder] Order created in Firestore:', orderId);

            this.createdOrderId.set(orderId);
            this.createdOrder.set({ ...orderPayload, id: orderId });

            // Advance to Step 4 Confirmation
            this.currentStep.set(4);

            // 2. Check if Payment Link is selected
            if (this.selectedPaymentMethod() === 'mercadopago_link') {
                this.isGeneratingLink.set(true);

                const linkReq = {
                    orderId,
                    amount: this.total(),
                    description: `Pedido Eurollantas ${orderPayload.orderNumber}`,
                    payerEmail: customer.email || 'ventas@eurollantas.com.mx',
                    items: this.cartItems(),
                    externalReference: orderId,
                };

                this.paymentLinkService.generatePaymentLink(linkReq).subscribe({
                    next: (res: CreatePaymentLinkResponse) => {
                        this.isGeneratingLink.set(false);
                        this.generatedLinkData.set({
                            ...res,
                            orderId,
                        });
                        this.realTimePaymentStatus.set('pending_link');
                        this.toast.success('Link de Pago MercadoPago generado exitosamente');

                        // Start watching order in real time
                        this.startRealTimePaymentWatch(orderId);
                    },
                    error: (err) => {
                        this.isGeneratingLink.set(false);
                        this.toast.error('Falló la generación del Link de Pago: ' + (err.message || 'Error desconocido'));
                        console.error('Payment link generation error:', err);
                    }
                });
            } else {
                this.toast.success('Pedido registrado exitosamente');
            }
        } catch (error) {
            console.error('Create Order Failed', error);
            this.toast.error('Error al crear el pedido');
        } finally {
            this.isSubmitting.set(false);
        }
    }

    private startRealTimePaymentWatch(orderId: string) {
        if (this.paymentStatusSubscription) {
            this.paymentStatusSubscription.unsubscribe();
        }

        this.paymentStatusSubscription = this.paymentLinkService.watchOrderPaymentStatus(orderId).subscribe({
            next: (orderData) => {
                if (orderData) {
                    const status = orderData.paymentStatus || 'pending_link';
                    this.realTimePaymentStatus.set(status);

                    if (['approved', 'paid'].includes(status)) {
                        this.toast.success('¡PAGO CONFIRMADO! MercadoPago aprobó la transacción.');
                    }
                }
            },
            error: (err) => console.error('Error watching order payment:', err)
        });
    }

    copyLinkToClipboard(url: string) {
        navigator.clipboard.writeText(url).then(() => {
            this.toast.success('¡Enlace de pago copiado al portapapeles!');
        }).catch(() => {
            this.toast.error('No se pudo copiar el enlace');
        });
    }

    sendWhatsAppLink() {
        const data = this.generatedLinkData();
        const cust = this.customer();
        if (!data || !cust) return;

        const rawPhone = cust.phone ? cust.phone.replace(/[^0-9]/g, '') : '';
        const phoneWithCountry = rawPhone.length === 10 ? `52${rawPhone}` : rawPhone;

        const message = `Hola ${cust.displayName || 'Estimado Cliente'}! 👋
Te compartimos tu *Link de Pago de Eurollantas* por un total de *${this.total().toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}*:

👉 ${data.paymentUrl}

Puedes pagar de forma segura con Tarjeta de Crédito/Débito, Meses Sin Intereses, SPEI o Efectivo en MercadoPago.
¡Muchas gracias por tu compra! 🚗💨`;

        const waUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        window.open(waUrl, '_blank');
    }

    goToFulfillment() {
        const id = this.createdOrderId();
        if (id) {
            this.router.navigate(['/operations/orders', id]);
        }
    }

    printReceipt() {
        window.print();
    }

    createNewOrder() {
        this.currentStep.set(1);
        this.customer.set(null);
        this.customerId = '';
        this.cartItems.set([]);
        this.shippingAddress.set(null);
        this.discountValue.set(0);
        this.discountReason = '';
        this.shippingCost.set(0);
        this.selectedCarrier.set(null);
        this.createdOrder.set(null);
        this.createdOrderId.set(null);
        this.generatedLinkData.set(null);
    }

    get shippingMethodOptions(): { key: ShippingMethod; label: string, icon: string, desc: string }[] {
        return [
            { key: 'STORE_PICKUP',      label: 'Recoger en Sucursal', icon: 'package', desc: 'Instalación / Retiro en Eurollantas SLP' },
            { key: 'LOCAL_DELIVERY',    label: 'Entrega Local SLP',   icon: 'truck',   desc: 'Envío directo dentro de San Luis Potosí' },
            { key: 'NATIONAL_CARRIER',  label: 'Envío Nacional',     icon: 'globe',   desc: 'Cotizador SkyDropX (FedEx, Estafeta, DHL)' },
        ];
    }
}
