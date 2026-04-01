import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore, doc, collection, setDoc, deleteDoc,
    collectionData, query, where, getDocs
} from '@angular/fire/firestore';
import { Auth, user } from '@angular/fire/auth';
import { Product } from '@lib/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, Observable } from 'rxjs';
import { AttributionService } from './attribution.service';

export interface WishlistItem {
    productId: string;
    product: Product;
    addedAt: Date;
}

const LS_KEY = 'euro_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
    private firestore      = inject(Firestore);
    private auth           = inject(Auth);
    private attributionSvc = inject(AttributionService);
    private platformId     = inject(PLATFORM_ID);

    // ── Local (guest) wishlist backed by localStorage + signal ─────────────────
    private _localIds = signal<Set<string>>(this.loadLocalIds());
    private _localItems = signal<WishlistItem[]>(this.loadLocalItems());

    // ── Auth user signal ────────────────────────────────────────────────────────
    private user$ = user(this.auth);

    // ── Wishlist items observable (Firestore for logged-in, localStorage for guest) ──
    readonly items$: Observable<WishlistItem[]> = this.user$.pipe(
        switchMap(u => {
            if (u) {
                // Logged-in: read from Firestore
                const ref = collection(this.firestore, `users/${u.uid}/wishlist`);
                return (collectionData(ref, { idField: 'productId' }) as Observable<WishlistItem[]>);
            }
            // Guest: use signal as observable
            return of(this._localItems());
        })
    );

    // ── Computed item IDs set — used for O(1) "is in wishlist" checks ───────────
    readonly wishlistIds$ = this.items$.pipe(
        map(items => new Set(items.map(i => i.productId)))
    );

    /** Total count signal for the nav badge */
    readonly count = computed(() => this._localIds().size);

    // ── Public API ─────────────────────────────────────────────────────────────

    isInWishlist(productId: string): boolean {
        return this._localIds().has(productId);
    }

    async toggle(product: Product): Promise<void> {
        const id = product.id!;
        const u = this.auth.currentUser;

        if (this.isInWishlist(id)) {
            await this.remove(id, u?.uid);
        } else {
            await this.add(product, u?.uid);
        }
    }

    async add(product: Product, uid?: string | null): Promise<void> {
        const id = product.id!;
        const item: WishlistItem = { productId: id, product, addedAt: new Date() };

        // Always update local signals (fast UI feedback)
        this._localIds.update(s => new Set([...s, id]));
        this._localItems.update(items => [...items.filter(i => i.productId !== id), item]);
        this.persistLocal();

        // Persist to Firestore if logged in
        if (uid) {
            const attr      = this.attributionSvc.get();
            const sessionId = isPlatformBrowser(this.platformId)
                ? (sessionStorage.getItem('cart_session_id') || null)
                : null;
            const ref = doc(this.firestore, `users/${uid}/wishlist/${id}`);
            await setDoc(ref, {
                productId: id,
                product,
                addedAt:   new Date(),
                // ── Attribution context ─────────────────────────────────────────────────
                sessionId,
                utm:       attr?.utm ?? null,
                source:    attr?.utm?.utm_source || attr?.referrerDomain || null,
            });
        }
    }

    async remove(productId: string, uid?: string | null): Promise<void> {
        this._localIds.update(s => { const n = new Set(s); n.delete(productId); return n; });
        this._localItems.update(items => items.filter(i => i.productId !== productId));
        this.persistLocal();

        if (uid) {
            const ref = doc(this.firestore, `users/${uid}/wishlist/${productId}`);
            await deleteDoc(ref);
        }
    }

    /** Merge localStorage wishlist into Firestore after login */
    async mergeAfterLogin(uid: string): Promise<void> {
        const localItems = this._localItems();
        if (localItems.length === 0) return;

        const writes = localItems.map(item =>
            setDoc(
                doc(this.firestore, `users/${uid}/wishlist/${item.productId}`),
                { productId: item.productId, product: item.product, addedAt: item.addedAt },
                { merge: true }
            )
        );
        await Promise.all(writes);
    }

    /** Load Firestore wishlist into local signals (called after login to sync ids set) */
    async syncFromFirestore(uid: string): Promise<void> {
        const ref = collection(this.firestore, `users/${uid}/wishlist`);
        const snap = await getDocs(ref);
        const items: WishlistItem[] = snap.docs.map(d => d.data() as WishlistItem);
        const ids = new Set(items.map(i => i.productId));
        this._localIds.set(ids);
        this._localItems.set(items);
        this.persistLocal();
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private loadLocalIds(): Set<string> {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return new Set();
            const items: WishlistItem[] = JSON.parse(raw);
            return new Set(items.map(i => i.productId));
        } catch { return new Set(); }
    }

    private loadLocalItems(): WishlistItem[] {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    private persistLocal(): void {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(this._localItems()));
        } catch { /* storage full — ignore */ }
    }
}
