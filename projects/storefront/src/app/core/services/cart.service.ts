import { Injectable, signal, computed, effect, inject, PLATFORM_ID, NgZone, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CartItem, CartState, CartStatus, CartEventType, CartItemDelta } from '../models/cart.model';
import { Product } from '../models/product.model';
import {
    Firestore, doc, setDoc, getDoc, addDoc,
    collection, Timestamp
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { ShippingConfigService } from './shipping-config.service';
import { AttributionService, stripUndefined } from './attribution.service';
import { SessionService } from './session.service';
import { CampaignService } from './campaign.service';
import { environment } from '../../../environments/environment';

// GA4 e-commerce helper — lightweight, no service dependency
declare let gtag: Function;
function fireGtag(event: string, params: object) {
    try { if (typeof gtag !== 'undefined') gtag('event', event, params); } catch { /* non-critical */ }
}

@Injectable({
    providedIn: 'root'
})
export class CartService {
    private readonly STORAGE_KEY = 'praxis_guest_cart';
    private firestore        = inject(Firestore);
    private authService      = inject(AuthService);
    private platformId       = inject(PLATFORM_ID);
    private shippingConfig   = inject(ShippingConfigService);
    private zone             = inject(NgZone);
    private attributionSvc   = inject(AttributionService);
    private sessionSvc       = inject(SessionService);
    private campaignSvc      = inject(CampaignService);
    private injector         = inject(Injector);

    /**
     * Lazy getter for TrackingService — avoids circular DI since TrackingService
     * depends on TrackingConfigService which uses Firestore (same as CartService).
     * Resolved on first use, cached after that.
     */
    private _trackingSvc: any = null;
    private get trackingSvc(): any {
        if (!this._trackingSvc) {
            try {
                // Dynamic resolve — TrackingService is injected lazily
                const { TrackingService } = require('./tracking.service');
                this._trackingSvc = this.injector.get(TrackingService);
            } catch { /* pixel tracking is non-critical — never crash cart */ }
        }
        return this._trackingSvc;
    }

    /** True once the campaign coupon has been auto-applied this session */
    private couponAutoApplied = false;

    /** Stable cross-tab session ID — owned by SessionService */
    private get sessionId(): string { return this.sessionSvc.sessionId; }

    /** UTM source or referrer — captured once on service init */
    private readonly source = this.captureSource();

    /** Prevent Firestore from overwriting local state on every auth re-emit */
    private firestoreLoaded = false;

    // ── State Signals ─────────────────────────────────────────────────────────
    private cartState = signal<CartState>(this.loadFromStorage());

    // UI State
    readonly isDrawerOpen = signal(false);

    // Computed Selectors
    readonly cartItems    = computed(() => this.cartState().items);
    readonly cartCount    = computed(() => this.cartItems().reduce((t, i) => t + i.quantity, 0));
    readonly cartSubtotal = computed(() =>
        this.cartItems().reduce((t, i) => t + (i.product.price || 0) * i.quantity, 0)
    );

    /** Dynamic free-shipping threshold — reads from admin Firestore config */
    readonly freeShippingThreshold   = computed(() => this.shippingConfig.freeThreshold);
    readonly amountToFreeShipping    = computed(() => {
        const rem = this.freeShippingThreshold() - this.cartSubtotal();
        return rem > 0 ? rem : 0;
    });

    constructor() {
        // Effect 1: persist every cart state change to localStorage + Firestore
        effect(() => {
            const state = this.cartState();
            this.saveToStorage(state);
            if (!environment.production) console.log('[Cart] State changed — items:', state.items.length, '| status:', state.status);
            this.saveToFirestore(state);
        });

        // Effect 2: When attribution resolves, push one more Firestore write with full data.
        effect(() => {
            const attr = this.attributionSvc.attribution();
            if (!attr) return;
            if (!environment.production) console.log('[Cart] Effect 2: attribution resolved — flushing to Firestore.');
            this.saveToFirestore(this.cartState());
        });

        // Auth listener — load cloud cart ONCE per session on login
        this.authService.user$.subscribe(user => {
            if (user && !this.firestoreLoaded) {
                this.firestoreLoaded = true;
                this.migrateGuestCartAndLoad(user.uid, user.email ?? '');
            } else if (!user) {
                this.firestoreLoaded = false;
            }
        });
    }

    // ── Cloud Persistence ─────────────────────────────────────────────────────
    private saveTimeout: any;

    /** Debounced save to user cart doc (logged-in) OR guest cart doc */
    private async saveToFirestore(state: CartState) {
        if (!isPlatformBrowser(this.platformId)) return;
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        this.saveTimeout = setTimeout(async () => {
            try {
                const user = this.authService.currentUser();

                const items = (state.items ?? []).map(item => ({
                    ...item,
                    addedAt: item.addedAt ? Timestamp.fromMillis(item.addedAt) : Timestamp.now(),
                }));

                const attribution = this.attributionSvc.get();
                const attributionFs = attribution ? {
                    ...attribution,
                    capturedAt: Timestamp.fromMillis(attribution.capturedAt),
                } : undefined;

                const now             = Timestamp.now();
                const firstAddedAt    = state.firstAddedAt
                    ? Timestamp.fromMillis(state.firstAddedAt)
                    : (state.items.length > 0 ? now : undefined);
                const updatedAt       = state.updatedAt
                    ? Timestamp.fromMillis(state.updatedAt)
                    : now;
                const checkoutStartedAt = state.checkoutStartedAt
                    ? Timestamp.fromDate(new Date(state.checkoutStartedAt))
                    : undefined;
                const clearedAt = state.clearedAt
                    ? Timestamp.fromMillis(state.clearedAt)
                    : undefined;

                if (user) {
                    // ── Logged-in: save to carts/{uid} ──────────────────────
                    const cartRef = doc(this.firestore, `carts/${user.uid}`);
                    if (!environment.production) console.log('[Cart] Writing to Firestore — uid:', user.uid, '| status:', state.status);

                    // Preserve clearedItems as Firestore-friendly format
                    const clearedItemsFs = state.clearedItems?.map(item => ({
                        ...item,
                        addedAt: item.addedAt ? Timestamp.fromMillis(item.addedAt) : Timestamp.now(),
                    }));

                    await setDoc(cartRef, stripUndefined({
                        ...state,
                        items,
                        clearedItems:      clearedItemsFs,
                        userId:            user.uid,
                        email:             user.email,
                        sessionId:         this.sessionId,
                        source:            state.source ?? this.source,
                        status:            state.status ?? 'active',
                        firstAddedAt,
                        updatedAt,
                        checkoutStartedAt,
                        clearedAt,
                        attribution:       attributionFs,
                        lastUpdated:       now,
                    }), { merge: true });
                    if (!environment.production) console.log('[Cart] ✅ Firestore write complete.');

                } else {
                    // ── Guest: save to guestCarts/{sessionId} ────────────────
                    // Always write cleared_by_user status — skip only if truly empty with no history
                    const isEmptyNoHistory = state.items.length === 0
                        && state.status !== 'cleared_by_user'
                        && !state.firstAddedAt;
                    if (isEmptyNoHistory) return;

                    const guestRef = doc(this.firestore, `guestCarts/${this.sessionId}`);
                    if (!environment.production) console.log('[Cart] Writing GUEST cart — sessionId:', this.sessionId, '| status:', state.status);

                    const clearedItemsFs = state.clearedItems?.map(item => ({
                        ...item,
                        addedAt: item.addedAt ? Timestamp.fromMillis(item.addedAt) : Timestamp.now(),
                    }));

                    await setDoc(guestRef, stripUndefined({
                        ...state,
                        items,
                        clearedItems:      clearedItemsFs,
                        sessionId:         this.sessionId,
                        source:            state.source ?? this.source,
                        status:            state.status ?? 'active',
                        firstAddedAt,
                        updatedAt,
                        checkoutStartedAt,
                        clearedAt,
                        attribution:       attributionFs,
                        lastUpdated:       now,
                    }), { merge: true });
                    if (!environment.production) console.log('[Cart] ✅ Guest Firestore write complete.');
                }
            } catch (e) {
                console.error('[Cart] Error syncing to Firestore:', e);
            }
        }, 1000);
    }

    /**
     * On login: migrate the guest cart (guestCarts/{sessionId}) into the user cart,
     * then load the merged result.
     */
    private async migrateGuestCartAndLoad(userId: string, email: string) {
        try {
            const guestRef = doc(this.firestore, `guestCarts/${this.sessionId}`);
            const userRef  = doc(this.firestore, `carts/${userId}`);

            const [guestSnap, userSnap] = await Promise.all([getDoc(guestRef), getDoc(userRef)]);

            const guestCart  = guestSnap.exists()  ? (guestSnap.data()  as CartState) : null;
            const cloudCart  = userSnap.exists()   ? (userSnap.data()   as CartState) : null;

            // Don't reload a completed or cleared cart
            const skipStatuses: CartStatus[] = ['completed', 'migrated', 'cleared_by_user'];
            if (cloudCart?.status && skipStatuses.includes(cloudCart.status)) {
                if (!environment.production) console.log('[Cart] Skipping cloud cart with status:', cloudCart.status);
                if (guestCart?.items?.length) {
                    this.zone.run(() => this.updateState(guestCart.items, 'active'));
                }
                return;
            }

            const guestItems = guestCart?.items   ?? [];
            const cloudItems = cloudCart?.items   ?? [];
            const localItems = this.cartState().items;

            const merged = this.mergeItems([...cloudItems, ...guestItems, ...localItems]);

            if (merged.length > 0) {
                this.zone.run(() => this.updateState(merged, 'active'));
            } else if (cloudItems.length > 0) {
                this.zone.run(() => this.updateState(cloudItems, 'active'));
            }

            // Stitch: write previousSessionId to user cart doc so we can join
            // anonymous QR scans (which used the guest sessionId) to this user.
            if (guestSnap.exists()) {
                const userCartRef = doc(this.firestore, `carts/${userId}`);
                await setDoc(userCartRef, {
                    previousSessionId: this.sessionId,
                    stitchedAt:        Timestamp.now(),
                }, { merge: true });
            }

            // Archive the guest cart doc as migrated + write snapshot
            if (guestSnap.exists()) {
                await setDoc(guestRef, {
                    status:    'migrated',
                    migratedTo: userId,
                    migratedAt: Timestamp.now()
                }, { merge: true });

                // Write user_identified snapshot so CustomerTimelineService
                // can show the session-stitching event in the timeline.
                await this.writeSnapshot('migrated', guestCart?.items ?? [], {
                    removed: [],
                    stitched: { sessionId: this.sessionId, uid: userId, email },
                } as any, userId, email);
            }

            // Fire the attribution identity flush (sessionId → uid mapping)
            this.attributionSvc.flushSessionIdentity(userId, email)
                .catch(e => console.warn('[Cart] flushSessionIdentity failed:', e));

        } catch (e) {
            console.error('[Cart] Error during guest migration:', e);
        }
    }

    private mergeItems(items: CartItem[]): CartItem[] {
        const map = new Map<string, CartItem>();
        for (const item of items) {
            const key = item.product.id ?? item.product.sku ?? String(item.addedAt);
            const existing = map.get(key);
            if (existing) {
                map.set(key, { ...existing, quantity: Math.max(existing.quantity, item.quantity) });
            } else {
                map.set(key, item);
            }
        }
        return Array.from(map.values());
    }

    // ── Core Actions ──────────────────────────────────────────────────────────

    addToCart(product: Product, quantity: number = 1) {
        const currentItems = this.cartItems();
        const existingIdx  = currentItems.findIndex(i => i.product.id === product.id);
        let   updatedItems = [...currentItems];
        const delta: CartItemDelta = {};

        if (existingIdx > -1) {
            const prev = updatedItems[existingIdx];
            updatedItems[existingIdx] = {
                ...prev,
                quantity: prev.quantity + quantity
            };
            delta.qtyChanged = [{ productId: product.id!, from: prev.quantity, to: prev.quantity + quantity }];
        } else {
            updatedItems.push({ product, quantity, addedAt: Date.now() });
            delta.added = [{ product, quantity, addedAt: Date.now() }];
        }

        const current = this.cartState();
        const wasEmpty = current.items.length === 0;
        const firstAddedAt = current.firstAddedAt ?? Date.now();
        this.cartState.set({
            ...current,
            items:        updatedItems,
            updatedAt:    Date.now(),
            firstAddedAt,
            status:       current.status === 'cleared_by_user' ? 'active' : (current.status ?? 'active'),
            sessionId:    current.sessionId ?? this.sessionId,
            source:       current.source    ?? this.source,
            // Clear the cleared snapshot if they're shopping again
            clearedAt:    undefined,
            clearedItems: undefined,
        });

        // ── Phase 2: Auto-apply campaign coupon on first item added ────────────
        if (wasEmpty && !this.couponAutoApplied) {
            this.applyCampaignCoupon();
        }

        // GA4: add_to_cart (lightweight direct call)
        fireGtag('add_to_cart', {
            currency: 'MXN',
            value: product.price * quantity,
            items: [{
                item_id:   product.sku || product.id,
                item_name: product.name?.es || product.name?.en,
                item_brand: product.brand,
                price:     product.price,
                quantity,
            }]
        });

        // Meta / TikTok / Pinterest / Snapchat: AddToCart
        // TrackingService reads Firestore config so only enabled pixels fire.
        try {
            this.trackingSvc?.trackAddToCart('MXN', product.price * quantity, [{
                item_id:    product.sku || product.id || '',
                item_name:  product.name?.es || product.name?.en || '',
                item_brand: product.brand,
                price:      product.price,
                quantity,
            }]);
        } catch { /* non-critical — never crash cart */ }

        // Write snapshot (debounced fire-and-forget)
        this.writeSnapshotDebounced(existingIdx > -1 ? 'quantity_changed' : 'item_added', updatedItems, delta);
    }

    removeFromCart(productId: string) {
        const removed = this.cartItems().filter(i => i.product.id === productId);
        const updatedItems = this.cartItems().filter(i => i.product.id !== productId);
        this.updateState(updatedItems);
        if (removed.length) {
            this.writeSnapshotDebounced('item_removed', updatedItems, { removed });
            // GA4: remove_from_cart
            fireGtag('remove_from_cart', {
                currency: 'MXN',
                value: removed.reduce((s, i) => s + i.product.price * i.quantity, 0),
                items: removed.map(i => ({
                    item_id:    i.product.sku || i.product.id,
                    item_name:  i.product.name?.es || i.product.name?.en,
                    item_brand: i.product.brand,
                    price:      i.product.price,
                    quantity:   i.quantity,
                }))
            });
        }
    }

    updateQuantity(productId: string, quantity: number) {
        const prev = this.cartItems().find(i => i.product.id === productId);
        let updated = this.cartItems().map(i =>
            i.product.id === productId ? { ...i, quantity: Math.max(0, quantity) } : i
        ).filter(i => i.quantity > 0);
        this.updateState(updated);
        if (prev) {
            this.writeSnapshotDebounced('quantity_changed', updated, {
                qtyChanged: [{ productId, from: prev.quantity, to: quantity }]
            });
        }
    }

    /**
     * Phase 1: Soft-delete the cart instead of silently erasing.
     * Persists cleared_by_user status and preserves the items snapshot
     * for recovery, segmentation, and product intelligence.
     */
    clearCart() {
        const itemsBeforeClear = [...this.cartItems()];
        const current = this.cartState();
        const now     = Date.now();

        // Only record a clear event if there were actual items
        if (itemsBeforeClear.length === 0) {
            this.updateState([]);
            return;
        }

        // Update state: empty items but preserve history + flag the event
        this.cartState.set({
            ...current,
            items:        [],
            updatedAt:    now,
            status:       'cleared_by_user',
            clearedAt:    now,
            clearedItems: itemsBeforeClear,
        });

        // Write a snapshot so the event ledger has a record
        this.writeSnapshot('cleared_by_user', itemsBeforeClear, { removed: itemsBeforeClear });
    }

    /**
     * Mark cart as checkout_started — call when the user lands on /checkout.
     */
    markCheckoutStarted() {
        const current = this.cartState();
        if (current.status === 'checkout_started' || current.status === 'completed') return;
        this.cartState.set({
            ...current,
            status:            'checkout_started',
            checkoutStartedAt: new Date().toISOString(),
        });
        this.writeSnapshotDebounced('checkout_started', current.items);

        // GA4: begin_checkout (lightweight direct call)
        fireGtag('begin_checkout', {
            currency: 'MXN',
            value: this.cartSubtotal(),
            items: current.items.map(i => ({
                item_id:    i.product.sku || i.product.id,
                item_name:  i.product.name?.es || i.product.name?.en,
                item_brand: i.product.brand,
                price:      i.product.price,
                quantity:   i.quantity,
            }))
        });

        // Meta / TikTok / Pinterest / Snapchat: InitiateCheckout
        try {
            this.trackingSvc?.trackBeginCheckout('MXN', this.cartSubtotal(),
                current.items.map(i => ({
                    item_id:    i.product.sku || i.product.id || '',
                    item_name:  i.product.name?.es || i.product.name?.en || '',
                    item_brand: i.product.brand,
                    price:      i.product.price,
                    quantity:   i.quantity,
                }))
            );
        } catch { /* non-critical — never crash cart */ }
    }

    /**
     * Archive the cart as completed instead of deleting it.
     * Keeps a permanent record of what was purchased for analytics.
     */
    async completeCart(orderId: string): Promise<void> {
        const user = this.authService.currentUser();
        if (!user) return;
        try {
            const cartRef = doc(this.firestore, `carts/${user.uid}`);
            const snap    = await getDoc(cartRef);
            const current = snap.exists() ? snap.data() as CartState : this.cartState();

            await setDoc(cartRef, stripUndefined({
                ...current,
                items:       [],
                status:      'completed',
                orderId,
                completedAt: Timestamp.now(),
                lastUpdated: Timestamp.now(),
            }));

            await this.writeSnapshot('completed', current.items ?? [], undefined, user.uid, user.email ?? undefined);
            console.log(`[Cart] Archived as completed → orderId: ${orderId}`);
        } catch (e) {
            console.warn('[Cart] Could not archive cart:', e);
        }
    }

    // ── UI Actions ────────────────────────────────────────────────────────────
    toggleCart() { this.isDrawerOpen.update(v => !v); }
    openCart()   { this.isDrawerOpen.set(true); }
    closeCart()  { this.isDrawerOpen.set(false); }

    // ── Phase 2: Campaign Coupon Auto-Apply ───────────────────────────────────

    /**
     * Silently applies the active campaign's coupon to the cart state.
     * Called once on the first addToCart() when the cart was empty.
     * Idempotent: skips if coupon already applied or no campaign is active.
     *
     * Industry research: removing coupon code friction increases checkout
     * conversion 15-30%. The user sees "PROMO20 aplicado ✓" in the cart
     * without ever having to type anything.
     */
    private applyCampaignCoupon() {
        const campaign = this.campaignSvc.activeCampaign();
        const coupon   = this.campaignSvc.campaignCoupon();
        if (!campaign || !coupon) return;

        // Skip if this coupon is already applied
        const state = this.cartState();
        if ((state as any).appliedCouponCode === coupon.code) return;

        this.couponAutoApplied = true;
        const discountValue = coupon.type === 'percentage'
            ? this.cartSubtotal() * (coupon.value / 100)
            : coupon.value;

        this.cartState.set({
            ...state,
            appliedCouponCode:    coupon.code,
            appliedCouponId:      coupon.id,
            appliedCampaignId:    campaign.id,
            couponDiscountType:   coupon.type,
            couponDiscountValue:  coupon.value,
            couponDiscountAmount: discountValue,
            couponAutoApplied:    true,
            updatedAt:            Date.now(),
        } as any);

        // Persist campaignId to the snapshot for funnel analytics
        this.writeSnapshotDebounced('item_added', this.cartItems(), undefined);

        if (!environment.production) {
            console.log(`[Cart] ✅ Campaign coupon auto-applied: ${coupon.code} (${coupon.type} ${coupon.value})`);
        }
    }

    /** Returns the currently auto-applied campaign coupon state (for cart UI) */
    get appliedCoupon(): { code: string; type: string; value: number; amount: number } | null {
        const s = this.cartState() as any;
        if (!s.appliedCouponCode) return null;
        return {
            code:   s.appliedCouponCode,
            type:   s.couponDiscountType,
            value:  s.couponDiscountValue,
            amount: s.couponDiscountAmount,
        };
    }

    // ── Internal State ────────────────────────────────────────────────────────
    private updateState(items: CartItem[], status?: CartState['status']) {
        const current = this.cartState();
        this.cartState.set({
            ...current,
            items,
            updatedAt: Date.now(),
            ...(status ? { status } : {}),
        });
    }

    private saveToStorage(state: CartState) {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('[Cart] Failed to save to localStorage:', e);
        }
    }

    private loadFromStorage(): CartState {
        if (!isPlatformBrowser(this.platformId)) return { items: [], updatedAt: Date.now() };
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            if (!data) return { items: [], updatedAt: Date.now() };
            const parsed: CartState = JSON.parse(data);
            // If the locally-stored cart was completed, start fresh
            if (parsed.status === 'completed') return { items: [], updatedAt: Date.now() };
            return parsed;
        } catch (e) {
            console.warn('[Cart] Failed to load from localStorage:', e);
            return { items: [], updatedAt: Date.now() };
        }
    }

    // ── Phase 2: Cart Snapshot (event ledger) ─────────────────────────────────

    private snapshotDebounceMap = new Map<string, any>();

    /**
     * Debounced snapshot write — prevents flooding on rapid qty changes.
     * Each event type key gets its own debounce timer.
     */
    private writeSnapshotDebounced(
        event: CartEventType,
        items: CartItem[],
        delta?: CartItemDelta,
        userId?: string,
        email?: string
    ) {
        if (this.snapshotDebounceMap.has(event)) {
            clearTimeout(this.snapshotDebounceMap.get(event));
        }
        const timer = setTimeout(() => {
            this.writeSnapshot(event, items, delta, userId, email);
            this.snapshotDebounceMap.delete(event);
        }, 1500);
        this.snapshotDebounceMap.set(event, timer);
    }

    /**
     * Writes a single event snapshot to the cartSnapshots collection.
     * This is the append-only ledger — never updated, only created.
     */
    private async writeSnapshot(
        event: CartEventType,
        items: CartItem[],
        delta?: CartItemDelta,
        userId?: string,
        email?: string
    ) {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            const user = this.authService.currentUser();
            const resolvedUserId = userId ?? user?.uid;
            const resolvedEmail  = email  ?? user?.email ?? undefined;
            const attribution    = this.attributionSvc.get();
            const cartValue      = items.reduce((sum, i) => sum + (i.product.price || 0) * i.quantity, 0);

            // Firestore-safe items (convert addedAt numbers to Timestamps)
            const itemsFs = items.map(item => ({
                ...item,
                addedAt: item.addedAt ? Timestamp.fromMillis(item.addedAt) : Timestamp.now(),
            }));

            const snapshotRef = collection(this.firestore, 'cartSnapshots');
            await addDoc(snapshotRef, stripUndefined({
                sessionId:  this.sessionId,
                userId:     resolvedUserId,
                email:      resolvedEmail,
                event,
                items:      itemsFs,
                itemsDelta: delta,
                cartValue,
                attribution: attribution ? {
                    ...attribution,
                    capturedAt: Timestamp.fromMillis(attribution.capturedAt),
                } : undefined,
                createdAt: Timestamp.now(),
            }));

            if (!environment.production) console.log(`[CartSnapshot] ✅ Written: ${event}`);
        } catch (e) {
            // Non-critical — don't crash the cart if snapshot fails
            console.warn('[CartSnapshot] Failed to write snapshot:', e);
        }
    }

    // ── Session & Attribution Helpers ─────────────────────────────────────────

    private captureSource(): string {
        if (!isPlatformBrowser(this.platformId)) return 'direct';
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('utm_source'))   return params.get('utm_source')!;
            if (params.get('utm_medium'))   return params.get('utm_medium')!;
            if (params.get('utm_campaign')) return params.get('utm_campaign')!;
            if (document.referrer) {
                try { return new URL(document.referrer).hostname; } catch { return document.referrer; }
            }
            return 'direct';
        } catch { return 'direct'; }
    }
}
