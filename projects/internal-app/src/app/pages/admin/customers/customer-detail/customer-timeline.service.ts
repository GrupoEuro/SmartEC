import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection, collectionGroup,
    query, where, orderBy, limit,
    getDocs, Timestamp,
} from '@angular/fire/firestore';

// ── Data models ──────────────────────────────────────────────────────────────

export type TimelineCategory =
    | 'order'
    | 'cart'
    | 'qr_scan'
    | 'whatsapp'
    | 'account'
    | 'newsletter';

export interface TimelineEvent {
    id:          string;
    category:    TimelineCategory;
    icon:        string;           // emoji or icon key
    color:       string;           // CSS color token
    title:       string;
    detail?:     string;
    value?:      number;           // MXN amount, if relevant
    sessionId?:  string;
    timestampMs: number;
    meta?:       Record<string, any>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (v?.toMillis)  return v.toMillis();
    if (v?.seconds)   return v.seconds * 1000;
    const d = new Date(v).getTime();
    return isNaN(d) ? 0 : d;
}

function fmtMXN(n: number): string {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', maximumFractionDigits: 0
    }).format(n);
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class CustomerTimelineService {
    private fs = inject(Firestore);

    /**
     * Loads all timeline events for one customer.
     * Supply both uid (for auth-linked data) and email (for order/newsletter lookups).
     */
    async getTimeline(uid: string, email: string): Promise<TimelineEvent[]> {
        const events: TimelineEvent[] = [];

        await Promise.allSettled([
            this.loadCartSnapshots(uid, events),
            this.loadOrders(uid, email, events),
            this.loadWhatsappClicks(uid, events),
            this.loadQrScans(uid, events),
            this.loadNewsletter(email, events),
            this.loadRegistration(uid, events),
        ]);

        return events
            .filter(e => e.timestampMs > 0)
            .sort((a, b) => b.timestampMs - a.timestampMs);
    }

    // ── Cart Snapshots ────────────────────────────────────────────────────────
    private async loadCartSnapshots(uid: string, out: TimelineEvent[]) {
        const snap = await getDocs(
            query(
                collection(this.fs, 'cartSnapshots'),
                where('userId', '==', uid),
                limit(100)
            )
        );

        const eventConfig: Record<string, { title: string; icon: string; color: string }> = {
            item_added:        { title: 'Item Added to Cart',        icon: '🛒', color: '#3b82f6' },
            item_removed:      { title: 'Item Removed',              icon: '➖', color: '#f59e0b' },
            quantity_changed:  { title: 'Quantity Updated',          icon: '✏️',  color: '#8b5cf6' },
            cleared_by_user:   { title: 'Cart Cleared by User',      icon: '🗑️',  color: '#ef4444' },
            checkout_started:  { title: 'Checkout Initiated',        icon: '💳', color: '#6366f1' },
            completed:         { title: 'Order Placed',              icon: '✅', color: '#22c55e' },
            migrated:          { title: 'Session Linked to Account', icon: '🔗', color: '#a78bfa' },
            abandoned_detected:{ title: 'Cart Abandoned',            icon: '⏰', color: '#dc2626' },
        };

        snap.docs.forEach(d => {
            const data  = d.data();
            const event = data['event'] as string;
            const cfg   = eventConfig[event];
            if (!cfg) return;

            const ts    = toMs(data['createdAt']);
            const value = data['cartValue'] as number | undefined;
            const delta = data['itemsDelta'] as any;
            const itemName = (i: any) =>
                i.product?.name?.es || i.product?.name?.en || i.product?.name || 'Artículo';

            let detail: string | undefined;
            if (delta?.added?.length)     detail = `Agregado: ${delta.added.map(itemName).join(', ')}`;
            if (delta?.removed?.length)   detail = `Eliminado: ${delta.removed.map(itemName).join(', ')}`;
            if (delta?.qtyChanged?.length)detail = `${delta.qtyChanged.length} artículo(s) actualizados`;
            if (event === 'cleared_by_user' && data['items']?.length)
                detail = `${data['items'].length} artículo(s) · ${fmtMXN(value ?? 0)}`;
            if (event === 'completed') detail = fmtMXN(value ?? 0);
            if (event === 'checkout_started') detail = `Valor del carrito: ${fmtMXN(value ?? 0)}`;

            out.push({
                id:          d.id,
                category:    'cart',
                icon:        cfg.icon,
                color:       cfg.color,
                title:       cfg.title,
                detail,
                value:       event === 'completed' ? value : undefined,
                sessionId:   data['sessionId'],
                timestampMs: ts,
                meta:        { event, cartValue: value },
            });
        });
    }

    // ── Orders ────────────────────────────────────────────────────────────────
    private async loadOrders(uid: string, email: string, out: TimelineEvent[]) {
        // Try by uid first, then by email as fallback
        const queries = [
            query(collection(this.fs, 'orders'), where('customer.uid', '==', uid),   limit(50)),
            query(collection(this.fs, 'orders'), where('customer.email', '==', email), limit(50)),
        ];

        const seen = new Set<string>();
        for (const q of queries) {
            const snap = await getDocs(q).catch(() => null);
            if (!snap) continue;
            snap.docs.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                const data   = d.data();
                const ts     = toMs(data['createdAt']);
                const total  = data['total'] as number;
                const status = data['status'] as string;

                const statusColor: Record<string, string> = {
                    paid: '#22c55e', completed: '#22c55e', delivered: '#22c55e',
                    pending: '#f59e0b', processing: '#3b82f6', shipped: '#60a5fa',
                    cancelled: '#ef4444', payment_failed: '#ef4444',
                };

                out.push({
                    id:          d.id,
                    category:    'order',
                    icon:        '📦',
                    color:       statusColor[status] ?? '#94a3b8',
                    title:       `Orden #${data['orderNumber'] ?? d.id.slice(-6)}`,
                    detail:      `${status?.toUpperCase()} · ${fmtMXN(total ?? 0)}`,
                    value:       total,
                    timestampMs: ts,
                    meta:        { orderId: d.id, orderNumber: data['orderNumber'], status },
                });
            });
        }
    }

    // ── WhatsApp Clicks ───────────────────────────────────────────────────────
    private async loadWhatsappClicks(uid: string, out: TimelineEvent[]) {
        const snap = await getDocs(
            query(
                collection(this.fs, 'whatsappClicks'),
                where('userId', '==', uid),
                limit(50)
            )
        ).catch(() => null);
        if (!snap) return;

        snap.docs.forEach(d => {
            const data = d.data();
            out.push({
                id:          d.id,
                category:    'whatsapp',
                icon:        '💬',
                color:       '#25d366',
                title:       'WhatsApp Abierto',
                detail:      data['page'] ? `Desde: ${data['page']}` : undefined,
                sessionId:   data['sessionId'],
                timestampMs: toMs(data['clickedAt']),
                meta:        data,
            });
        });
    }

    // ── QR Scans (collectionGroup) ────────────────────────────────────────────
    private async loadQrScans(uid: string, out: TimelineEvent[]) {
        // Cap at 90 days — avoids scanning all historical scan sub-documents
        // across all coupons for long-tenured customers.
        const cutoff = Timestamp.fromDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
        const snap = await getDocs(
            query(
                collectionGroup(this.fs, 'scans'),
                where('userId', '==', uid),
                where('scannedAt', '>=', cutoff),
                limit(50)
            )
        ).catch(() => null);
        if (!snap) return;

        snap.docs.forEach(d => {
            const data     = d.data();
            const couponId = d.ref.parent.parent?.id ?? 'desconocido';
            const converted = data['converted'] === true;
            out.push({
                id:          d.id,
                category:    'qr_scan',
                icon:        '📱',
                color:       converted ? '#22c55e' : '#f59e0b',
                title:       'Cupón QR Escaneado',
                detail:      `Cupón: ${couponId}${converted ? ' · Convertido ✓' : ''}`,
                sessionId:   data['sessionId'],
                timestampMs: toMs(data['scannedAt']),
                meta:        { couponId, converted },
            });
        });
    }

    // ── Newsletter ────────────────────────────────────────────────────────────
    private async loadNewsletter(email: string, out: TimelineEvent[]) {
        const snap = await getDocs(
            query(
                collection(this.fs, 'newsletter'),
                where('email', '==', email),
                limit(5)
            )
        ).catch(() => null);
        if (!snap || snap.empty) return;

        snap.docs.forEach(d => {
            const data = d.data();
            out.push({
                id:          d.id,
                category:    'newsletter',
                icon:        '📩',
                color:       '#a78bfa',
                title:       'Suscripción a Newsletter',
                detail:      data['source'] ? `Fuente: ${data['source']}` : undefined,
                timestampMs: toMs(data['subscribedAt'] ?? data['createdAt']),
                meta:        data,
            });
        });
    }

    // ── Account Registration ──────────────────────────────────────────────────
    private async loadRegistration(uid: string, out: TimelineEvent[]) {
        const snap = await getDocs(
            query(collection(this.fs, 'users'), where('uid', '==', uid), limit(1))
        ).catch(() => null);
        if (!snap || snap.empty) return;

        const data = snap.docs[0].data();
        const ts   = toMs(data['createdAt']);
        if (!ts) return;

        out.push({
            id:          `reg_${uid}`,
            category:    'account',
            icon:        '👤',
            color:       '#6366f1',
            title:       'Cuenta Creada',
            detail:      data['acquisitionSource']
                ? `Fuente: ${data['acquisitionSource']}`
                : undefined,
            timestampMs: ts,
            meta:        { uid },
        });
    }
}
