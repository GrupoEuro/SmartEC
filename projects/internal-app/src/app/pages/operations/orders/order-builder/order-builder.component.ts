import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { OrderService } from '../../../../core/services/order.service';
import { ProductService } from '../../../../core/services/product.service';
import { LocationService } from '../../../../core/services/location.service';
import { SkydropxService, ShippingRate } from '../../../../core/services/skydropx.service';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserProfile } from '../../../../core/models/user.model';
import { Product } from '../../../../core/models/product.model';
import { Order, OrderItem, ShippingAddress, SocialSource, ShippingMethod } from '../../../../core/models/order.model';

// Social source options for the UI
export const SOCIAL_SOURCES: { key: SocialSource; label: string; icon: string; color: string }[] = [
    { key: 'WHATSAPP',  label: 'WhatsApp',  icon: '📱', color: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
    { key: 'INSTAGRAM', label: 'Instagram', icon: '📸', color: 'border-pink-500/50 bg-pink-500/10 text-pink-300' },
    { key: 'FACEBOOK',  label: 'Facebook',  icon: '👤', color: 'border-blue-500/50 bg-blue-500/10 text-blue-300' },
    { key: 'TIKTOK',    label: 'TikTok',    icon: '🎵', color: 'border-purple-500/50 bg-purple-500/10 text-purple-300' },
    { key: 'PHONE',     label: 'Phone',     icon: '📞', color: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300' },
    { key: 'WALK_IN',   label: 'Walk-in',   icon: '🚶', color: 'border-slate-500/50 bg-slate-500/10 text-slate-300' },
    { key: 'B2B',       label: 'B2B',       icon: '🤝', color: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' },
    { key: 'OTHER',     label: 'Other',     icon: '💬', color: 'border-slate-500/50 bg-slate-500/10 text-slate-400' },
];

@Component({
    selector: 'app-order-builder',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AppIconComponent, AdminPageHeaderComponent],
    templateUrl: './order-builder.component.html',
    styles: [`
        .order-builder-grid {
            display: grid;
            grid-template-columns: 1fr 380px;
            gap: 1.5rem;
        }
        @media (max-width: 1024px) {
            .order-builder-grid {
                grid-template-columns: 1fr;
            }
        }
        .source-chip {
            cursor: pointer;
            border: 1px solid;
            border-radius: 9999px;
            padding: 0.35rem 0.85rem;
            font-size: 0.78rem;
            font-weight: 600;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
        }
        .source-chip.selected {
            ring: 2px;
            transform: scale(1.05);
        }
    `]
})
export class OrderBuilderComponent implements OnInit {
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

    // ── Customer ──────────────────────────────────────────────────────────────
    customerId = '';
    customer = signal<UserProfile | null>(null);
    isLoadingCustomer = signal(false);

    // Customer search (registered users)
    customerSearchControl = new FormControl('');
    customerSearchResults = signal<UserProfile[]>([]);
    isSearchingCustomer = signal(false);

    // Guest Customer form (for social / walk-in leads not in Firebase Auth)
    showGuestForm = signal(false);
    guestName = '';
    guestEmail = '';
    guestPhone = '';

    // ── Social Source ─────────────────────────────────────────────────────────
    socialSources = SOCIAL_SOURCES;
    selectedSource = signal<SocialSource | null>(null);
    sourceNote = '';

    // ── Product Search ────────────────────────────────────────────────────────
    searchControl = new FormControl('');
    searchResults = signal<Product[]>([]);
    isSearching = signal(false);

    // ── Cart ──────────────────────────────────────────────────────────────────
    cartItems = signal<OrderItem[]>([]);

    // ── Financials ────────────────────────────────────────────────────────────
    subtotal = computed(() => this.cartItems().reduce((acc, item) => acc + item.subtotal, 0));
    tax      = computed(() => this.subtotal() * 0.16);

    discountType   = signal<'percent' | 'fixed'>('percent');
    discountValue  = signal(0);
    discountReason = '';

    discountAmount = computed(() => {
        const base = this.subtotal();
        if (this.discountType() === 'percent') return base * (this.discountValue() / 100);
        return Math.min(this.discountValue(), base);
    });

    total = computed(() => Math.max(0, this.subtotal() - this.discountAmount() + this.tax() + this.shippingCost()));

    // ── Shipping ──────────────────────────────────────────────────────────────
    shippingCost    = signal(0);
    shippingMethod  = signal<ShippingMethod>('NATIONAL_CARRIER');
    
    shippingAddress = signal<ShippingAddress | null>(null);
    showAddressForm = signal(true);

    // SkyDropX Integrations
    shippingRates = signal<ShippingRate[]>([]);
    isLoadingRates = signal(false);
    selectedRateId = signal<string | null>(null);
    quoteZipCode = signal<string>('');
    selectedCarrier = signal<string | null>(null);

    // Inline address form fields
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

    // ── Payment ───────────────────────────────────────────────────────────────
    selectedPaymentMethod = signal<Order['paymentMethod']>('bank_transfer');

    // ── UI ────────────────────────────────────────────────────────────────────
    isSubmitting = signal(false);

    // Current staff info for metadata
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
            error: () => { this.toast.error('Product search failed'); this.isSearching.set(false); }
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
            error: () => { this.toast.error('Customer search failed'); this.isSearchingCustomer.set(false); }
        });

        // Track current staff
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
            this.toast.error('Guest customer requires a name and phone number');
            return;
        }
        // Build a synthetic UserProfile shape (no uid = guest)
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
            this.toast.error('Street, city, col and ZIP are required');
            this.addressForm.markAllAsTouched();
            return;
        }
        this.shippingAddress.set(this.addressForm.value as ShippingAddress);
        this.showAddressForm.set(false);
        this.shippingRates.set([]); // Clear stale rates
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
                productImage: product.images.main || '',
                sku: product.sku,
                price: product.price,
                quantity: 1,
                subtotal: product.price,
                brand: product.brand,
                category: product.categoryId
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
            this.toast.error('Enter a valid 5-digit ZIP code to calculate shipping.');
            return;
        }

        this.isLoadingRates.set(true);

        const totalQty = this.cartItems().reduce((acc, item) => acc + item.quantity, 0);
        const parcel = { weight: Math.max(1, totalQty * 10), height: 30, width: 30, length: 20 };

        const addressTo = {
            name: this.customer()?.displayName || this.customer()?.email || 'N/A',
            phone: this.customer()?.phone || '0000000000',
            email: this.customer()?.email || 'quote@example.com',
            address1: addr ? `${addr.street} ${addr.exteriorNumber}` : 'N/A',
            address2: addr?.colonia || 'N/A',
            city: addr?.city || 'N/A',
            province: addr?.state || 'N/A',
            zip: zip,
            country_code: 'MX' 
        };

        this.skydropxService.getRates({ addressTo, parcel }).subscribe({
            next: (res) => {
                this.shippingRates.set(res.rates || []);
                this.isLoadingRates.set(false);
                if (!res.rates || res.rates.length === 0) this.toast.info('No rates found for this zip code.');
            },
            error: (err) => {
                this.toast.error('SkyDropX rate quote failed');
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

    // ── Submit ────────────────────────────────────────────────────────────────

    async createOrder() {
        const customer = this.customer();
        if (!customer) { this.toast.error('Customer is required'); return; }
        if (this.cartItems().length === 0) { this.toast.error('Cart is empty'); return; }
        if (!this.shippingAddress() && this.shippingMethod() !== 'STORE_PICKUP') {
            this.toast.error('Shipping address is required (or select Store Pickup)'); return;
        }

        this.isSubmitting.set(true);

        try {
            const isGuest = !customer.uid;
            const orderPayload: Order = {
                orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
                sourceChannel: 'on_behalf',
                fulfillmentType: 'merchant',
                customer: {
                    id: customer.uid || undefined,
                    name: customer.displayName || customer.email || 'Guest',
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
                paymentMethod: this.selectedPaymentMethod(),
                shippingMethod: this.shippingMethod(),
                carrier: this.selectedCarrier() || undefined,
                shippingAddress: this.shippingAddress() ?? {
                    street: '', exteriorNumber: '', city: '', state: '', zipCode: '', country: 'México'
                },
                metadata: {
                    enteredBy: this.currentStaff?.uid,
                    enteredByName: this.currentStaff?.name,
                    enteredAt: new Date(),
                    source: this.selectedSource() ?? undefined,
                    sourceNote: this.sourceNote || undefined,
                },
                notes: this.discountReason ? `Discount: ${this.discountReason}` : undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
                history: [],
                priorityLevel: 'standard',
            };

            const orderId = await this.orderService.createOrder(orderPayload);
            this.toast.success('Order created successfully');
            this.router.navigate(['/operations/orders', orderId]);
        } catch (error) {
            console.error('Create Order Failed', error);
            this.toast.error('Failed to create order');
            this.isSubmitting.set(false);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    get shippingMethodOptions(): { key: ShippingMethod; label: string, icon: string, desc: string }[] {
        return [
            { key: 'STORE_PICKUP',      label: 'Store Pickup', icon: 'package', desc: 'Free pickup at EuroLlantas' },
            { key: 'LOCAL_DELIVERY',    label: 'Local Delivery', icon: 'truck', desc: 'Direct delivery in SLP' },
            { key: 'NATIONAL_CARRIER',  label: 'National Courier', icon: 'globe', desc: 'Quote via SkyDropX' },
        ];
    }
}
