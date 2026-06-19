import { Injectable, inject, isDevMode } from '@angular/core';
import {
    Firestore,
    collection, collectionGroup,
    query, limit, where, orderBy,
    getDocs
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, catchError, of, tap, from, timer, switchMap } from 'rxjs';

export interface AbandonedCartItem {
    name: string;
    image: string;
    price: number;
    quantity: number;
}

export type CartStage    = 'active' | 'checkout_started';
export type CartAudience = 'guest'  | 'authenticated';

export interface AbandonedCart {
    id: string;
    sessionId?: string;
    audience:      CartAudience;
    displayName:   string;
    email?:        string;
    items:         AbandonedCartItem[];
    cartValue:     number;
    stage:         CartStage;
    source:        string;
    campaign?:     string;
    city?:         string;
    country?:      string;
    region?:       string;
    connectionType?: string;   // 'wifi' | '4g' | etc
    device?:       string;
    deviceOs?:     string;
    language?:     string;
    lastSeenMs:    number;
    firstAddedMs?: number;
    checkoutStartedAt?: string;
    minutesIdle:   number;
    // raw attribution snapshot — available for journey panel
    _raw?: any;
}

// ── Journey event types ────────────────────────────────────────────────────────

export type JourneyEventType =
    | 'qr_scan'
    | 'cart_add'
    | 'cart_update'
    | 'cart_remove'
    | 'checkout_started'
    | 'whatsapp_click'
    | 'cleared_by_user'
    | 'abandoned';

export interface JourneyEvent {
    type:       JourneyEventType;
    label:      string;
    detail?:    string;
    timestampMs: number;
    icon:        string;
    couponCode?: string;
    page?:       string;
    converted?:  boolean;
}

// 60-minute abandonment threshold (Baymard Institute standard)
const ABANDON_THRESHOLD_MS = 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AbandonedCartsService {
    private fs = inject(Firestore);

    getAbandonedCarts(): Observable<AbandonedCart[]> {
        // NOTE: NO orderBy — Firestore orderBy silently excludes docs missing that field.
        // Fetch all docs and sort client-side to handle schema evolution.
        //
        // Switched from collectionData (persistent onSnapshot) to getDocs + hourly timer.
        // The live listeners were re-delivering 500 docs every time any customer updated
        // their storefront cart, causing ~4,400 reads/month from this page alone.

        const fetchGuestCarts$ = from(
            getDocs(query(collection(this.fs, 'guestCarts'), limit(500)))
        ).pipe(
            map(snap => snap.docs.map(d => ({ docId: d.id, ...d.data() }))),
            tap(docs => {
                if (isDevMode()) {
                    console.group('[AbandonedCarts] guestCarts raw docs:', docs.length);
                    docs.forEach((c: any) => console.log(
                        c.docId, '| status:', c.status,
                        '| items:', Array.isArray(c.items) ? c.items.length : 'N/A',
                        '| minutesIdle:', Math.floor((Date.now() - this.resolveLastMs(c)) / 60000)
                    ));
                    console.groupEnd();
                }
            }),
            catchError(err => {
                console.warn('[AbandonedCarts] guestCarts query failed:', err);
                return of([] as any[]);
            })
        );

        const fetchAuthCarts$ = from(
            getDocs(query(collection(this.fs, 'carts'), limit(500)))
        ).pipe(
            map(snap => snap.docs.map(d => ({ docId: d.id, ...d.data() }))),
            tap(docs => {
                if (isDevMode()) {
                    console.group('[AbandonedCarts] carts (auth) raw docs:', docs.length);
                    docs.forEach((c: any) => console.log(
                        c.docId, '| status:', c.status,
                        '| items.length:', Array.isArray(c.items) ? c.items.length : 'N/A',
                        '| minutesIdle:', Math.floor((Date.now() - this.resolveLastMs(c)) / 60000)
                    ));
                    console.groupEnd();
                }
            }),
            catchError(err => {
                console.warn('[AbandonedCarts] carts query failed:', err);
                return of([] as any[]);
            })
        );

        // Emit immediately, then re-fetch every hour.
        return timer(0, 3_600_000).pipe(
            switchMap(() => combineLatest([fetchGuestCarts$, fetchAuthCarts$])),
            map(([guests, auths]) => {
                const now = Date.now();

                const fromGuests: AbandonedCart[] = guests
                    .filter((c: any) => this.isAbandoned(c, now))
                    .map((c: any)  => this.mapGuest(c, now));

                const fromAuths: AbandonedCart[] = auths
                    .filter((c: any) => this.isCartDoc(c) && this.isAbandoned(c, now))
                    .map((c: any)  => this.mapAuth(c, now));

                return [...fromGuests, ...fromAuths]
                    .sort((a, b) => b.lastSeenMs - a.lastSeenMs);
            })
        );
    }

    // ── Journey query ──────────────────────────────────────────────────────────

    // Loads the full event trail for a session across:
    //   guestCarts/{sessionId}      → cart events
    //   coupons/{id}/scans          → QR scan events (collectionGroup query by sessionId)
    //   whatsappClicks              → WhatsApp click events
    async getJourney(cart: AbandonedCart): Promise<JourneyEvent[]> {
        const sessionId = cart.sessionId || cart.id;
        const events: JourneyEvent[] = [];

        // ── 1. QR Scan events (collectionGroup) ────────────────────────────────
        try {
            const scansQuery = query(
                collectionGroup(this.fs, 'scans'),
                where('sessionId', '==', sessionId),
                limit(10)
            );
            const scanSnap = await getDocs(scansQuery);
            scanSnap.docs.forEach(d => {
                const data = d.data();
                const parentPath = d.ref.parent.parent?.id ?? 'unknown';
                events.push({
                    type:        'qr_scan',
                    label:       'QR Code Scanned',
                    detail:      `Coupon: ${parentPath}`,
                    icon:        'qr-code',
                    timestampMs: this.toMs(data['scannedAt']),
                    couponCode:  parentPath,
                    converted:   data['converted'] === true,
                });
            });
        } catch (e) {
            console.warn('[Journey] scans query failed (may need index):', e);
        }

        // ── 2. WhatsApp clicks ─────────────────────────────────────────────────
        try {
            const waQuery = query(
                collection(this.fs, 'whatsappClicks'),
                where('sessionId', '==', sessionId),
                limit(10)
            );
            const waSnap = await getDocs(waQuery);
            waSnap.docs.forEach(d => {
                const data = d.data();
                events.push({
                    type:        'whatsapp_click',
                    label:       'WhatsApp Opened',
                    detail:      data['page'] ? `From: ${data['page']}` : undefined,
                    icon:        'message-circle',
                    page:        data['page'],
                    timestampMs: this.toMs(data['clickedAt']),
                });
            });
        } catch (e) {
            console.warn('[Journey] whatsappClicks query failed:', e);
        }

        // ── 3. Cart Snapshots — event ledger ───────────────────────────────────
        try {
            const snapQuery = query(
                collection(this.fs, 'cartSnapshots'),
                where('sessionId', '==', sessionId),
                limit(50)
            );
            const snapSnap = await getDocs(snapQuery);
            const fmtMXN   = (v: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

            snapSnap.docs.forEach(d => {
                const data  = d.data();
                const event = data['event'] as string;
                const ts    = this.toMs(data['createdAt']);
                if (!event || ts === 0) return;

                const snapshotEventMap: Record<string, { type: JourneyEventType; label: string; icon: string }> = {
                    'item_added':       { type: 'cart_add',        label: 'Item Added to Cart',        icon: 'shopping-cart' },
                    'item_removed':     { type: 'cart_remove',     label: 'Item Removed from Cart',    icon: 'minus-circle'  },
                    'quantity_changed': { type: 'cart_update',     label: 'Quantity Updated',          icon: 'edit-2'        },
                    'cleared_by_user':  { type: 'cleared_by_user', label: 'Cart Cleared by User',      icon: 'trash-2'       },
                    'checkout_started': { type: 'checkout_started',label: 'Checkout Initiated',        icon: 'credit-card'   },
                    'completed':        { type: 'cart_add',        label: 'Order Completed',           icon: 'check-circle'  },
                    'migrated':         { type: 'cart_update',     label: 'Session Linked to Account', icon: 'user-check'    },
                };

                const mapped = snapshotEventMap[event];
                if (!mapped) return;

                const delta = data['itemsDelta'];
                let detail: string | undefined;
                const itemName = (i: any) => i.product?.name?.es || i.product?.name?.en || i.product?.name || 'Item';
                if (delta?.added?.length)      detail = `Added: ${delta.added.map(itemName).join(', ')}`;
                if (delta?.removed?.length)    detail = `Removed: ${delta.removed.map(itemName).join(', ')}`;
                if (delta?.qtyChanged?.length) detail = `${delta.qtyChanged.length} item(s) quantity changed`;
                if (event === 'cleared_by_user' && data['items']?.length) {
                    detail = `${data['items'].length} item(s) removed · ${fmtMXN(data['cartValue'] ?? 0)}`;
                }
                if (event === 'completed') detail = `Order placed · ${fmtMXN(data['cartValue'] ?? 0)}`;

                events.push({ type: mapped.type, label: mapped.label, detail, icon: mapped.icon, timestampMs: ts });
            });
        } catch (e) {
            console.warn('[Journey] cartSnapshots query failed:', e);
        }

        // ── 3. Synthesize cart events from the cart doc itself ────────────────
        if (cart.firstAddedMs) {
            events.push({
                type:        'cart_add',
                label:       'First Item Added',
                detail:      `${cart.items.length} item${cart.items.length !== 1 ? 's' : ''} · ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cart.cartValue)}`,
                icon:        'shopping-cart',
                timestampMs: cart.firstAddedMs,
            });
        }

        if (cart.checkoutStartedAt) {
            events.push({
                type:        'checkout_started',
                label:       'Checkout Started',
                detail:      'Entered checkout flow',
                icon:        'credit-card',
                timestampMs: this.toMs(cart.checkoutStartedAt),
            });
        }

        // ── 4. Last activity / abandoned marker ────────────────────────────────
        events.push({
            type:        'abandoned',
            label:       'Session Went Cold',
            detail:      `${cart.minutesIdle < 60 ? cart.minutesIdle + 'm' : Math.floor(cart.minutesIdle / 60) + 'h'} idle · no further activity`,
            icon:        'alert-circle',
            timestampMs: cart.lastSeenMs,
        });

        return events.sort((a, b) => a.timestampMs - b.timestampMs);
    }

    // ── Filtering ──────────────────────────────────────────────────────────────

    private isAbandoned(c: any, now: number): boolean {
        const excluded = ['completed', 'migrated'];
        if (excluded.includes(c.status)) return false;
        if (!Array.isArray(c.items) || c.items.length === 0) return false;
        const lastMs = this.resolveLastMs(c);
        if (!lastMs) return false;
        return (now - lastMs) >= ABANDON_THRESHOLD_MS;
    }

    private isCartDoc(c: any): boolean {
        return Array.isArray(c.items);
    }

    // ── Mappers ────────────────────────────────────────────────────────────────

    private mapGuest(c: any, now: number): AbandonedCart {
        const lastSeenMs = this.resolveLastMs(c);
        const attr       = c.attribution || {};
        const geo        = attr.geo    || {};
        const device     = attr.device || {};
        const utm        = attr.utm    || {};
        return {
            id:              c.docId,
            sessionId:       c.sessionId || c.docId,
            audience:        'guest',
            displayName:     c.sessionId
                ? `guest-${String(c.sessionId).slice(-8)}`
                : c.docId.slice(-8),
            items:           this.mapItems(c.items),
            cartValue:       this.calcValue(c.items),
            stage:           (c.status as CartStage) || 'active',
            source:          attr.referrerDomain || utm.utm_source || c.source || 'Direct',
            campaign:        utm.utm_campaign,
            city:            geo.city,
            country:         geo.country,
            region:          geo.region,
            connectionType:  device.connection || undefined,
            device:          device.mobile ? 'mobile' : 'desktop',
            deviceOs:        device.platform || undefined,
            language:        device.language || undefined,
            lastSeenMs,
            firstAddedMs:    this.toMs(c.firstAddedAt) || undefined,
            minutesIdle:     Math.floor((now - lastSeenMs) / 60000),
            _raw:            c,
        };
    }

    private mapAuth(c: any, now: number): AbandonedCart {
        const lastSeenMs = this.resolveLastMs(c);
        const attr       = c.attribution || {};
        const geo        = attr.geo    || {};
        const device     = attr.device || {};
        const utm        = attr.utm    || {};
        return {
            id:                c.docId,
            sessionId:         c.sessionId || c.docId,
            audience:          'authenticated',
            displayName:       c.email || c.displayName || `user-${c.docId.slice(-6)}`,
            email:             c.email,
            items:             this.mapItems(c.items),
            cartValue:         this.calcValue(c.items),
            stage:             (c.status as CartStage) || 'active',
            source:            attr.referrerDomain || utm.utm_source || c.source || 'Direct',
            campaign:          utm.utm_campaign,
            city:              geo.city,
            country:           geo.country,
            region:            geo.region,
            connectionType:    device.connection || undefined,
            device:            device.mobile ? 'mobile' : 'desktop',
            deviceOs:          device.platform || undefined,
            language:          device.language || undefined,
            lastSeenMs,
            firstAddedMs:      this.toMs(c.firstAddedAt) || undefined,
            checkoutStartedAt: c.checkoutStartedAt,
            minutesIdle:       Math.floor((now - lastSeenMs) / 60000),
            _raw:              c,
        };
    }

    private mapItems(raw: any[]): AbandonedCartItem[] {
        if (!Array.isArray(raw)) return [];
        return raw.map(i => ({
            name:     i.product?.name?.es || i.product?.name?.en || i.product?.name || i.name || 'Unknown',
            image:    i.product?.images?.main || i.product?.images?.thumbnail || '',
            price:    i.product?.price || 0,
            quantity: i.quantity || 1,
        }));
    }

    private calcValue(items: any[]): number {
        if (!Array.isArray(items)) return 0;
        return items.reduce((sum, i) => sum + (i.product?.price || 0) * (i.quantity || 1), 0);
    }

    // ── Timestamp helpers ──────────────────────────────────────────────────────

    private resolveLastMs(c: any): number {
        return this.toMs(c.lastUpdated)
            || this.toMs(c.updatedAt)
            || this.toMs(c.firstAddedAt)
            || 0;
    }

    private toMs(val: any): number {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (val?.toMillis) return val.toMillis();
        if (val?.seconds)  return val.seconds * 1000;
        const d = new Date(val).getTime();
        return isNaN(d) ? 0 : d;
    }
}
