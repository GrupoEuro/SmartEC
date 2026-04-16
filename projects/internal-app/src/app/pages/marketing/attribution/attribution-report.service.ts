import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, query,
    where, getDocs, orderBy, Timestamp,
} from '@angular/fire/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttributionRow {
    channel:        string;   // resolved channel label
    medium:         string;   // utm_medium (empty for non-UTM channels)
    campaign:       string;   // utm_campaign
    sessions:       number;   // unique sessions from cartSnapshots
    cartAdds:       number;   // item_added events
    orders:         number;
    revenue:        number;
    conversionRate: number;   // orders / sessions (0 for channels with no web funnel)
    avgOrderValue:  number;
    hasWebFunnel:   boolean;  // false for ML/POS/On-Behalf (no cartSnapshot possible)
}

export interface AttributionSummary {
    rows:            AttributionRow[];
    totalSessions:   number;
    totalOrders:     number;
    totalRevenue:    number;
    topSource:       string;
    dateRangeLabel?: string;
}

// ─── Internal Firestore doc shapes ───────────────────────────────────────────

interface OrderDoc {
    total?:           number;
    totalAmount?:     number;
    createdAt?:       Timestamp;
    // Authoritative channel field — set by ALL ingestion paths
    sourceChannel?:   'storefront' | 'mercadolibre' | 'amazon' | 'pos' | 'on_behalf' | string;
    // ML-specific: distinguishes Classic (merchant packs) vs Full (ML packs) vs Flex (same-day)
    fulfillmentType?: 'merchant' | 'platform' | 'flex' | string;
    // On-Behalf: social origin
    metadata?:        { source?: string; sourceNote?: string };
    // Storefront: UTM + referrer written at checkout
    attribution?: {
        utm?:            { utm_source?: string; utm_medium?: string; utm_campaign?: string };
        referrerDomain?: string;
        landingPath?:    string;
        capturedAt?:     Timestamp;
    };
}

interface CartSnapshotDoc {
    event:       string;
    sessionId?:  string;
    cartValue?:  number;
    attribution?: {
        utm?:            { utm_source?: string; utm_medium?: string; utm_campaign?: string };
        referrerDomain?: string;
    };
    createdAt?: Timestamp;
}

// ─── Channels that never have a web funnel (session/cartAdd N/A) ──────────────
const NO_FUNNEL_PREFIXES = ['mercadolibre', 'pos', 'on_behalf', 'amazon', 'whatsapp',
    'instagram', 'facebook', 'tiktok'];

function isWebFunnelChannel(channel: string): boolean {
    const c = channel.toLowerCase();
    return !NO_FUNNEL_PREFIXES.some(p => c.startsWith(p));
}

/**
 * Normalises a raw referrer domain into a clean, business-meaningful label.
 * Exported as a standalone function so both AttributionReportService and
 * MarketingDashboardComponent use identical logic (no drift).
 *
 * Rules (top-down):
 *  1. *.safeframe.googlesyndication.com → "Google Display Ads"
 *  2. google.com variants               → "Google Organic"
 *  3. *.taboola.com / *.taboolanews.com → "Taboola"
 *  4. *.facebook.com                   → "Facebook"
 *  5. *.instagram.com                  → "Instagram"
 *  6. *.tiktok.com                     → "TikTok"
 *  7. *.bing.com                       → "Bing"
 *  8. *.yahoo.com                      → "Yahoo"
 *  9. Else: strip www/m/news/blog prefix
 */
export function normalizeReferrerDomain(raw: string): string {
    if (!raw) return 'direct';
    const d = raw.toLowerCase().trim();

    if (d.endsWith('.safeframe.googlesyndication.com') ||
        d === 'safeframe.googlesyndication.com' ||
        d.includes('googlesyndication')) return 'Google Display Ads';

    if (d === 'www.google.com' || d === 'google.com' ||
        d.startsWith('www.google.') || d.startsWith('google.') ||
        d.endsWith('.google.com')) return 'Google Organic';

    if (d.endsWith('.taboola.com') || d.endsWith('.taboolanews.com') ||
        d === 'taboola.com') return 'Taboola';

    if (d.endsWith('.facebook.com') || d === 'facebook.com' ||
        d === 'l.facebook.com' || d.endsWith('.fb.com')) return 'Facebook';

    if (d.endsWith('.instagram.com') || d === 'instagram.com') return 'Instagram';
    if (d.endsWith('.tiktok.com')    || d === 'tiktok.com')    return 'TikTok';
    if (d.endsWith('.bing.com')      || d === 'bing.com')      return 'Bing';
    if (d.endsWith('.yahoo.com')     || d === 'yahoo.com')     return 'Yahoo';

    // Strip common subdomains -> registrable domain
    return d.replace(/^(www|m|news|blog|amp|mobile|es|en)[.]/i, '');
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AttributionReportService {
    private fs = inject(Firestore);

    /**
     * Load attribution summary for a given date range.
     * Reads cartSnapshots (for session/cart counts) and orders (for revenue).
     *
     * Channel resolution priority per order:
     *  1. sourceChannel (authoritative — set by ALL ingestion paths)
     *     - 'mercadolibre' + fulfillmentType → 'MercadoLibre Classic' | 'MercadoLibre Full'
     *     - 'on_behalf' + metadata.source  → 'WhatsApp', 'Instagram', etc.
     *     - 'pos'                          → 'POS'
     *     - 'amazon'                       → 'Amazon'
     *     - 'storefront' → falls through to UTM/referrer
     *  2. attribution.utm.utm_source  (storefront paid/social traffic)
     *  3. attribution.referrerDomain  (storefront referral traffic)
     *  4. 'direct'                    (storefront, no tracking)
     */
    async loadReport(from: Date, to: Date): Promise<AttributionSummary> {
        const fromTs = Timestamp.fromDate(from);
        const toTs   = Timestamp.fromDate(to);

        const [snapshotsSnap, ordersSnap] = await Promise.all([
            getDocs(query(
                collection(this.fs, 'cartSnapshots'),
                where('createdAt', '>=', fromTs),
                where('createdAt', '<=', toTs),
                orderBy('createdAt', 'desc'),
            )),
            getDocs(query(
                collection(this.fs, 'orders'),
                where('createdAt', '>=', fromTs),
                where('createdAt', '<=', toTs),
                orderBy('createdAt', 'desc'),
            )),
        ]);

        // ── Aggregate sessions + cart adds from cartSnapshots ─────────────────
        // cartSnapshots are storefront-only, so channelKey here uses UTM/referrer
        const sessionMap  = new Map<string, Set<string>>();  // key → Set<sessionId>
        const cartAddMap  = new Map<string, number>();
        const channelMeta = new Map<string, { medium: string; campaign: string }>();

        for (const doc of snapshotsSnap.docs) {
            const d = doc.data() as CartSnapshotDoc;
            // Normalise referrer domain before building the key so cartSnapshot
            // sessions group under the same label as orders (e.g. "Google Display Ads")
            const normalisedAttr = d.attribution ? {
                ...d.attribution,
                referrerDomain: d.attribution.referrerDomain
                    ? this.normalizeReferrerDomain(d.attribution.referrerDomain)
                    : undefined,
            } : undefined;
            const key      = this.channelKey({ attribution: normalisedAttr });

            const medium   = d.attribution?.utm?.utm_medium   ?? '';
            const campaign = d.attribution?.utm?.utm_campaign ?? '';
            if (!channelMeta.has(key)) channelMeta.set(key, { medium, campaign });

            if (d.sessionId) {
                if (!sessionMap.has(key)) sessionMap.set(key, new Set());
                sessionMap.get(key)!.add(d.sessionId);
            }
            if (d.event === 'item_added') {
                cartAddMap.set(key, (cartAddMap.get(key) ?? 0) + 1);
            }
        }

        // ── Aggregate revenue from orders — using full doc for channel resolution
        const orderMap = new Map<string, {
            count: number; revenue: number;
            medium: string; campaign: string;
        }>();

        for (const doc of ordersSnap.docs) {
            const d   = doc.data() as OrderDoc;
            const key = this.channelKey(d);
            const rev = d.total ?? d.totalAmount ?? 0;

            // Prefer UTM meta from orders for storefront rows
            const medium   = d.attribution?.utm?.utm_medium   ?? '';
            const campaign = d.attribution?.utm?.utm_campaign ?? '';

            const cur = orderMap.get(key) ?? { count: 0, revenue: 0, medium, campaign };
            orderMap.set(key, {
                count:    cur.count + 1,
                revenue:  cur.revenue + rev,
                medium:   cur.medium || medium,
                campaign: cur.campaign || campaign,
            });
        }

        // ── Build rows ────────────────────────────────────────────────────────
        const allKeys = new Set([...sessionMap.keys(), ...orderMap.keys()]);
        const rows: AttributionRow[] = [];

        for (const key of allKeys) {
            const sessions = sessionMap.get(key)?.size ?? 0;
            const cartAdds = cartAddMap.get(key) ?? 0;
            const ord      = orderMap.get(key) ?? { count: 0, revenue: 0, medium: '', campaign: '' };
            // Prefer meta from orders (more complete UTM), fallback to snapshot meta
            const meta     = { ...channelMeta.get(key), ...ord };
            const funnel   = isWebFunnelChannel(key);

            rows.push({
                channel:        key,
                medium:         meta.medium    ?? '',
                campaign:       meta.campaign  ?? '',
                sessions,
                cartAdds,
                orders:         ord.count,
                revenue:        ord.revenue,
                conversionRate: sessions > 0 ? ord.count / sessions : 0,
                avgOrderValue:  ord.count > 0 ? ord.revenue / ord.count : 0,
                hasWebFunnel:   funnel,
            });
        }

        rows.sort((a, b) => b.revenue - a.revenue);

        const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
        const totalOrders   = rows.reduce((s, r) => s + r.orders,   0);
        const totalRevenue  = rows.reduce((s, r) => s + r.revenue,  0);
        const topSource     = rows[0]?.channel ?? '—';

        return { rows, totalSessions, totalOrders, totalRevenue, topSource };
    }

    // ── Channel resolver ──────────────────────────────────────────────────────

    /**
     * Resolves the correct channel label from a Firestore order document.
     *
     * Priority:
     *  1. sourceChannel (non-storefront authoritative field)
     *  2. attribution.utm.utm_source  (storefront UTM)
     *  3. attribution.referrerDomain  (storefront referral)
     *  4. Legacy 'channel' field from old meli-order.service
     *  5. 'direct'
     */
    private channelKey(doc: Pick<OrderDoc, 'sourceChannel' | 'fulfillmentType' | 'metadata' | 'attribution'>): string {
        const sc = doc.sourceChannel;

        // ── ML: three distinct fulfillment models ─────────────────────────────
        if (sc === 'mercadolibre') {
            if (doc.fulfillmentType === 'platform') return 'MercadoLibre Full';    // ML warehouse
            if (doc.fulfillmentType === 'flex')     return 'MercadoLibre Flex';    // same-day, seller packs
            return 'MercadoLibre Classic';                                          // standard seller-fulfilled
        }

        // ── On-Behalf: drill into social source ───────────────────────────────
        if (sc === 'on_behalf') {
            const social = doc.metadata?.source;
            if (social) {
                // Normalize: 'WHATSAPP' → 'WhatsApp', 'INSTAGRAM' → 'Instagram'
                return this.normalizeSocialSource(social);
            }
            return 'On-Behalf';
        }

        if (sc === 'pos')     return 'POS';
        if (sc === 'amazon')  return 'Amazon';

        // ── Storefront: use UTM → referrer → direct ───────────────────────────
        // (also falls here when sourceChannel is 'storefront' or absent)
        const utm = doc.attribution?.utm;
        if (utm?.utm_source) return utm.utm_source;
        if (doc.attribution?.referrerDomain) {
            return this.normalizeReferrerDomain(doc.attribution.referrerDomain);
        }

        // ── Legacy: old meli-order.service used 'channel' field ───────────────
        if ((doc as any).channel === 'MELI_CLASSIC') return 'MercadoLibre Classic';
        if ((doc as any).channel === 'MELI_FULL')    return 'MercadoLibre Full';

        return 'direct';
    }

    /** Delegates to the exported standalone function for backward compat. */
    normalizeReferrerDomain(raw: string): string {
        return normalizeReferrerDomain(raw);
    }



    private normalizeSocialSource(raw: string): string {
        const map: Record<string, string> = {
            WHATSAPP:  'WhatsApp',
            INSTAGRAM: 'Instagram',
            FACEBOOK:  'Facebook',
            TIKTOK:    'TikTok',
            PHONE:     'Phone',
            EMAIL:     'Email',
            B2B:       'B2B',
            WALK_IN:   'Walk-In',
            OTHER:     'Other',
        };
        return map[raw.toUpperCase()] ?? raw;
    }
}
