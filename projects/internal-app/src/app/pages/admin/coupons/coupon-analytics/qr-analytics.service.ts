import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection, collectionGroup,
    doc, getDoc,
    query, where, orderBy, limit,
    getDocs,
} from '@angular/fire/firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QrScan {
    id:          string;
    sessionId:   string;
    scannedAt:   number;          // ms
    userId?:     string;
    email?:      string;
    converted:   boolean;
    device?:     string;
    city?:       string;
    source?:     string;
    referrer?:   string;
    // downstream
    cartValue?:  number;
    cartStatus?: string;
    waClicked?:  boolean;
    orderId?:    string;
    orderTotal?: number;
}

export interface QrFunnelStats {
    totalScans:       number;
    uniqueSessions:   number;
    cartAdds:         number;
    checkoutStarts:   number;
    orders:           number;
    waClicks:         number;
    cartClears:       number;
    conversionRate:   number;   // orders / totalScans
    avgCartValue:     number;
    totalRevenue:     number;
    topCities:        { label: string; count: number }[];
    topDevices:       { label: string; count: number }[];
    topSources:       { label: string; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (v?.toMillis) return v.toMillis();
    if (v?.seconds)  return v.seconds * 1000;
    const d = new Date(v).getTime();
    return isNaN(d) ? 0 : d;
}

function topN(map: Map<string, number>, n = 5): Array<{ label: string; count: number }> {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => ({ label: k, count: v }));
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class QrAnalyticsService {
    private fs = inject(Firestore);

    // ── Load all scans for one coupon ─────────────────────────────────────────
    async getScansForCoupon(couponId: string): Promise<QrScan[]> {
        const scansRef = collection(this.fs, `coupons/${couponId}/scans`);
        const snap = await getDocs(query(scansRef, orderBy('scannedAt', 'desc'), limit(500)));

        const rawScans: QrScan[] = snap.docs.map(d => {
            const data = d.data();
            return {
                id:        d.id,
                sessionId: data['sessionId'] ?? d.id,
                scannedAt: toMs(data['scannedAt']),
                userId:    data['userId'],
                email:     data['email'],
                converted: data['converted'] === true,
                device:    data['device'],
                city:      data['attribution']?.city ?? data['city'],
                source:    data['attribution']?.source ?? data['source'],
                referrer:  data['attribution']?.referrer,
            };
        });

        // Enrich each scan with downstream journey data
        await this.enrichScans(rawScans);
        return rawScans;
    }

    // ── Enrich scans with cart + order + WA data ──────────────────────────────
    private async enrichScans(scans: QrScan[]): Promise<void> {
        const sessionIds = [...new Set(scans.map(s => s.sessionId).filter(Boolean))];
        if (!sessionIds.length) return;

        // Batch into chunks of 10 (Firestore `in` limit per query)
        const chunks: string[][] = [];
        for (let i = 0; i < sessionIds.length; i += 10) {
            chunks.push(sessionIds.slice(i, i + 10));
        }

        const [cartMap, waMap, orderMap, snapshotMap] = await Promise.all([
            this.buildCartMap(chunks),
            this.buildWaMap(chunks),
            this.buildOrderMap(scans),
            this.buildSnapshotMap(chunks),
        ]);

        for (const scan of scans) {
            const sid = scan.sessionId;
            const cart = cartMap.get(sid);
            if (cart) {
                scan.cartValue  = cart.cartValue;
                scan.cartStatus = cart.status;
            }
            if (waMap.has(sid)) scan.waClicked = true;
            const order = orderMap.get(scan.userId ?? '') ?? orderMap.get(scan.email ?? '');
            if (order) {
                scan.orderId     = order.orderId;
                scan.orderTotal  = order.total;
                scan.converted   = true;
            }
            // Override cartValue from snapshots if we have it
            const snVal = snapshotMap.get(sid);
            if (snVal && !scan.cartValue) scan.cartValue = snVal;
        }
    }

    private async buildCartMap(chunks: string[][]): Promise<Map<string, { cartValue: number; status: string }>> {
        const map = new Map<string, { cartValue: number; status: string }>();

        const processSnap = (snap: any, getSessionId: (d: any) => string) => {
            snap?.docs?.forEach((d: any) => {
                const data = d.data();
                const sid  = getSessionId(d);
                const items: any[] = data['items'] ?? [];
                const val  = items.reduce((s: number, i: any) => s + (i.product?.price || 0) * (i.quantity || 1), 0);
                map.set(sid, { cartValue: val, status: data['status'] ?? 'unknown' });
            });
        };

        for (const chunk of chunks) {
            const [gSnap, cSnap] = await Promise.all([
                getDocs(query(collection(this.fs, 'guestCarts'), where('sessionId', 'in', chunk))).catch(() => null),
                getDocs(query(collection(this.fs, 'carts'),      where('sessionId', 'in', chunk))).catch(() => null),
            ]);
            processSnap(gSnap, d => d.data()['sessionId']);
            processSnap(cSnap, d => d.data()['sessionId']);
        }
        return map;
    }

    private async buildWaMap(chunks: string[][]): Promise<Set<string>> {
        const set = new Set<string>();
        for (const chunk of chunks) {
            const snap = await getDocs(
                query(collection(this.fs, 'whatsappClicks'), where('sessionId', 'in', chunk))
            ).catch(() => null);
            snap?.docs?.forEach(d => set.add(d.data()['sessionId']));
        }
        return set;
    }

    private async buildOrderMap(scans: QrScan[]): Promise<Map<string, { orderId: string; total: number }>> {
        const map = new Map<string, { orderId: string; total: number }>();
        const uids   = [...new Set(scans.map(s => s.userId).filter(Boolean))] as string[];
        const emails = [...new Set(scans.map(s => s.email).filter(Boolean))]  as string[];

        const chunks = (arr: string[]) => {
            const r: string[][] = [];
            for (let i = 0; i < arr.length; i += 10) r.push(arr.slice(i, i + 10));
            return r;
        };

        for (const chunk of chunks(uids)) {
            const snap = await getDocs(
                query(collection(this.fs, 'orders'), where('customer.uid', 'in', chunk), limit(100))
            ).catch(() => null);
            snap?.docs?.forEach(d => {
                const data = d.data();
                map.set(data['customer']?.uid, { orderId: d.id, total: data['total'] ?? 0 });
            });
        }

        for (const chunk of chunks(emails)) {
            const snap = await getDocs(
                query(collection(this.fs, 'orders'), where('customer.email', 'in', chunk), limit(100))
            ).catch(() => null);
            snap?.docs?.forEach(d => {
                const data = d.data();
                if (!map.has(data['customer']?.uid)) {
                    map.set(data['customer']?.email, { orderId: d.id, total: data['total'] ?? 0 });
                }
            });
        }
        return map;
    }

    private async buildSnapshotMap(chunks: string[][]): Promise<Map<string, number>> {
        const map = new Map<string, number>();
        for (const chunk of chunks) {
            const snap = await getDocs(
                query(collection(this.fs, 'cartSnapshots'), where('sessionId', 'in', chunk))
            ).catch(() => null);
            snap?.docs?.forEach(d => {
                const data = d.data();
                const sid  = data['sessionId'] as string;
                const val  = data['cartValue'] as number;
                if (val > (map.get(sid) ?? 0)) map.set(sid, val);
            });
        }
        return map;
    }

    // ── Compute funnel stats from enriched scans ───────────────────────────────
    computeStats(scans: QrScan[]): QrFunnelStats {
        const uniqueSessions = new Set(scans.map(s => s.sessionId)).size;
        const cartAdds       = scans.filter(s => (s.cartValue ?? 0) > 0).length;
        const checkouts      = scans.filter(s => s.cartStatus === 'checkout_started').length;
        const orders         = scans.filter(s => s.orderId).length;
        const waClicks       = scans.filter(s => s.waClicked).length;
        const cartClears     = scans.filter(s => s.cartStatus === 'cleared_by_user').length;
        const revenue        = scans.filter(s => s.orderTotal).reduce((s, e) => s + (e.orderTotal ?? 0), 0);
        const avgCart        = cartAdds > 0
            ? scans.filter(s => (s.cartValue ?? 0) > 0).reduce((s, e) => s + (e.cartValue ?? 0), 0) / cartAdds
            : 0;

        const cityMap   = new Map<string, number>();
        const deviceMap = new Map<string, number>();
        const sourceMap = new Map<string, number>();

        for (const s of scans) {
            if (s.city)   cityMap.set(s.city,     (cityMap.get(s.city)     ?? 0) + 1);
            if (s.device) deviceMap.set(s.device, (deviceMap.get(s.device) ?? 0) + 1);
            const src = s.source ?? 'direct';
            sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
        }

        return {
            totalScans:     scans.length,
            uniqueSessions,
            cartAdds,
            checkoutStarts: checkouts,
            orders,
            waClicks,
            cartClears,
            conversionRate: scans.length > 0 ? (orders / scans.length) * 100 : 0,
            avgCartValue:   avgCart,
            totalRevenue:   revenue,
            topCities:   topN(cityMap),
            topDevices:  topN(deviceMap),
            topSources:  topN(sourceMap),
        };
    }

    // ── Load coupon metadata ──────────────────────────────────────────────────
    async getCoupon(couponId: string): Promise<any> {
        const snap = await getDoc(doc(this.fs, `coupons/${couponId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }
}
