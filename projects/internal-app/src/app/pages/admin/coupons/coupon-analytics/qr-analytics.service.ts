import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection, collectionGroup,
    doc, getDoc,
    query, where, limit,
    getDocs,
} from '@angular/fire/firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CartItem {
    name:      string;
    sku?:      string;
    price:     number;
    quantity:  number;
    imageUrl?: string;
    subtotal:  number;
}

export interface QrScan {
    id:          string;
    sessionId:   string;
    scannedAt:   number;          // ms
    userId?:     string;
    email?:      string;
    converted:   boolean;
    // attribution
    device?:     string;        // normalized label e.g. "Mobile · Chrome"
    city?:       string;
    region?:     string;
    country?:    string;
    timezone?:   string;
    isp?:        string;
    source?:     string;        // utm_source
    utmMedium?:  string;
    utmCampaign?:string;
    utmContent?: string;
    utmTerm?:    string;
    referrer?:   string;
    referrerDomain?: string;
    landingUrl?: string;
    campaignId?:   string;
    campaignName?: string;
    // downstream
    cartValue?:  number;
    cartStatus?: string;
    cartItems?:  CartItem[];
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

/** Unwrap multilingual name objects like { es: 'Llanta', en: 'Tire' } → 'Llanta' */
function resolveI18n(val: any): string | undefined {
    if (!val) return undefined;
    if (typeof val === 'string') return val || undefined;
    if (typeof val === 'object') {
        return val['es'] ?? val['en'] ?? val['mx'] ?? Object.values(val)[0] as string ?? undefined;
    }
    return String(val);
}

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
        // No orderBy here — docs lacking 'scannedAt' would be silently dropped by Firestore.
        // Client-side sort already handles ordering. Limit raised to 2000 to cover high-volume coupons.
        const snap = await getDocs(query(scansRef, limit(2000)));

        const rawScans: QrScan[] = snap.docs.map(d => {
            const data = d.data();

            // Device: stored as object { userAgent, mobile, timezone, language }
            // Normalize to a human-readable label string
            const deviceObj = data['device'];
            let deviceLabel: string | undefined;
            if (typeof deviceObj === 'string') {
                deviceLabel = deviceObj;
            } else if (deviceObj && typeof deviceObj === 'object') {
                deviceLabel = deviceObj['mobile'] ? 'Mobile' : 'Desktop';
                const ua: string = deviceObj['userAgent'] ?? '';
                if (ua) {
                    const browser = /Chrome\//.test(ua)  ? 'Chrome'
                                  : /Firefox\//.test(ua) ? 'Firefox'
                                  : /Safari\//.test(ua)  ? 'Safari'
                                  : /Edge\//.test(ua)    ? 'Edge'
                                  : '';
                    if (browser) deviceLabel += ` · ${browser}`;
                }
            }

            // City: stored under geo.city by coupon.service.ts (not attribution.city)
            const city: string | undefined =
                data['geo']?.city           ??
                data['attribution']?.city   ??
                data['city'];

            // Source: stored under utm.utm_source (not attribution.source)
            const utm = data['utm'] ?? {};
            const source: string | undefined =
                utm['utm_source']           ??
                utm['source']               ??
                data['attribution']?.source ??
                data['source'];

            // Referrer: stored as top-level field (not attribution.referrer)
            const referrer: string | undefined =
                data['referrer']            ??
                data['referrerDomain']      ??
                data['attribution']?.referrer;

            // Full geo object
            const geo = data['geo'] ?? {};

            // Full UTM object
            const utmObj = data['utm'] ?? {};

            return {
                id:        d.id,
                sessionId: data['sessionId'] ?? d.id,
                scannedAt: toMs(data['scannedAt']),
                userId:    data['userId'],
                email:     data['email'],
                converted: data['converted'] === true,
                device:    deviceLabel,
                // geo
                city:      city ?? geo['city'],
                region:    geo['region'],
                country:   geo['country'],
                timezone:  geo['timezone'] ?? (deviceObj && typeof deviceObj === 'object' ? deviceObj['timezone'] : undefined),
                isp:       geo['org'],
                // utm
                source,
                utmMedium:   utmObj['utm_medium'],
                utmCampaign: utmObj['utm_campaign'],
                utmContent:  utmObj['utm_content'],
                utmTerm:     utmObj['utm_term'],
                // referrer
                referrer,
                referrerDomain: data['referrerDomain'],
                landingUrl:     data['landingUrl'],
                // campaign
                campaignId:   data['campaignId'],
                campaignName: data['campaignName'],
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
                scan.cartItems  = cart.cartItems;
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

    private async buildCartMap(chunks: string[][]): Promise<Map<string, { cartValue: number; status: string; cartItems: CartItem[] }>> {
        const map = new Map<string, { cartValue: number; status: string; cartItems: CartItem[] }>();

        const processSnap = (snap: any, getSessionId: (d: any) => string) => {
            snap?.docs?.forEach((d: any) => {
                const data = d.data();
                const sid  = getSessionId(d);
                const raw: any[] = data['items'] ?? [];
                const cartItems: CartItem[] = raw.map((i: any) => ({
                    name:     resolveI18n(i.product?.name ?? i.name) ?? 'Producto',
                    sku:      i.product?.sku  ?? i.sku,
                    price:    i.product?.price ?? i.price ?? 0,
                    quantity: i.quantity ?? 1,
                    imageUrl: i.product?.imageUrl ?? i.imageUrl,
                    subtotal: (i.product?.price ?? i.price ?? 0) * (i.quantity ?? 1),
                }));
                const val = cartItems.reduce((s, ci) => s + ci.subtotal, 0);
                map.set(sid, { cartValue: val, status: data['status'] ?? 'unknown', cartItems });
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

    // ── Load a single scan by document ID ────────────────────────────────────
    /**
     * Fetches a single scan document directly (O(1) read) then enriches it.
     * Falls back to searching by sessionId if the docId lookup returns nothing.
     */
    async getScan(couponId: string, scanId: string): Promise<QrScan | null> {
        // 1. Try direct doc fetch
        const directSnap = await getDoc(doc(this.fs, `coupons/${couponId}/scans/${scanId}`));
        if (directSnap.exists()) {
            const scans = await this.mapSnap([directSnap as any]);
            await this.enrichScans(scans);
            return scans[0] ?? null;
        }
        // 2. Fallback: search by sessionId (scanId might BE the sessionId)
        const snap = await getDocs(
            query(
                collection(this.fs, `coupons/${couponId}/scans`),
                where('sessionId', '==', scanId),
                limit(1),
            )
        );
        if (snap.empty) return null;
        const scans = await this.mapSnap(snap.docs);
        await this.enrichScans(scans);
        return scans[0] ?? null;
    }

    /** Map raw Firestore docs to QrScan objects (extracted from getScansForCoupon) */
    private mapSnap(docs: any[]): QrScan[] {
        return docs.map((d: any) => {
            const data = d.data();
            const deviceObj = data['device'];
            let deviceLabel: string | undefined;
            if (typeof deviceObj === 'string') {
                deviceLabel = deviceObj;
            } else if (deviceObj && typeof deviceObj === 'object') {
                deviceLabel = deviceObj['mobile'] ? 'Mobile' : 'Desktop';
                const ua: string = deviceObj['userAgent'] ?? '';
                if (ua) {
                    const browser = /Chrome\//.test(ua)  ? 'Chrome'
                                  : /Firefox\//.test(ua) ? 'Firefox'
                                  : /Safari\//.test(ua)  ? 'Safari'
                                  : /Edge\//.test(ua)    ? 'Edge'
                                  : '';
                    if (browser) deviceLabel += ` · ${browser}`;
                }
            }
            const city: string | undefined =
                data['geo']?.city ?? data['attribution']?.city ?? data['city'];
            const utm    = data['utm'] ?? {};
            const source = utm['utm_source'] ?? utm['source'] ?? data['attribution']?.source ?? data['source'];
            const referrer = data['referrer'] ?? data['referrerDomain'] ?? data['attribution']?.referrer;
            const geo    = data['geo'] ?? {};
            const utmObj = data['utm'] ?? {};
            return {
                id:           d.id,
                sessionId:    data['sessionId'] ?? d.id,
                scannedAt:    toMs(data['scannedAt']),
                userId:       data['userId'],
                email:        data['email'],
                converted:    data['converted'] === true,
                device:       deviceLabel,
                city:         city ?? geo['city'],
                region:       geo['region'],
                country:      geo['country'],
                timezone:     geo['timezone'] ?? (deviceObj && typeof deviceObj === 'object' ? deviceObj['timezone'] : undefined),
                isp:          geo['org'],
                source,
                utmMedium:    utmObj['utm_medium'],
                utmCampaign:  utmObj['utm_campaign'],
                utmContent:   utmObj['utm_content'],
                utmTerm:      utmObj['utm_term'],
                referrer,
                referrerDomain: data['referrerDomain'],
                landingUrl:   data['landingUrl'],
                campaignId:   data['campaignId'],
                campaignName: data['campaignName'],
            } as QrScan;
        });
    }
}

