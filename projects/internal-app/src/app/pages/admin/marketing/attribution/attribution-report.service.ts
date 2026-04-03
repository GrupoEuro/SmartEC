import { Injectable, inject } from '@angular/core';
import {
    Firestore, collectionGroup, collection, query,
    where, getDocs, orderBy, limit, Timestamp,
} from '@angular/fire/firestore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AttributionRow {
    channel:       string;   // utm_source or 'direct' / 'organic' / 'referral'
    medium:        string;   // utm_medium
    campaign:      string;   // utm_campaign
    sessions:      number;
    cartAdds:      number;
    orders:        number;
    revenue:       number;
    conversionRate: number;  // orders / sessions
    avgOrderValue: number;
}

export interface AttributionSummary {
    rows:            AttributionRow[];
    totalSessions:   number;
    totalOrders:     number;
    totalRevenue:    number;
    topSource:       string;
    dateRangeLabel?: string;
}

// Firestore doc shape we read from
interface OrderDoc {
    total?:        number;
    totalAmount?:  number;
    createdAt?:    Timestamp;
    attribution?: {
        utm?:          { utm_source?: string; utm_medium?: string; utm_campaign?: string };
        referrerDomain?: string;
        landingPath?:  string;
        capturedAt?:   Timestamp;
    };
}

interface CartSnapshotDoc {
    event:       string;
    sessionId?:  string;
    cartValue?:  number;
    attribution?: {
        utm?: { utm_source?: string; utm_medium?: string; utm_campaign?: string };
        referrerDomain?: string;
    };
    createdAt?: Timestamp;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AttributionReportService {
    private fs = inject(Firestore);

    /**
     * Load attribution summary for a given date range.
     * Reads cartSnapshots (for session/cart counts) and orders (for revenue).
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
        // session_start events → sessions per channel
        const sessionMap   = new Map<string, Set<string>>(); // channelKey → Set<sessionId>
        const cartAddMap   = new Map<string, number>();       // channelKey → count
        const channelMeta  = new Map<string, { medium: string; campaign: string }>();

        for (const doc of snapshotsSnap.docs) {
            const d = doc.data() as CartSnapshotDoc;
            const key    = this.channelKey(d.attribution?.utm, d.attribution?.referrerDomain);
            const medium   = d.attribution?.utm?.utm_medium   ?? '';
            const campaign = d.attribution?.utm?.utm_campaign ?? '';
            channelMeta.set(key, { medium, campaign });

            // Count unique sessions
            if (d.sessionId) {
                if (!sessionMap.has(key)) sessionMap.set(key, new Set());
                sessionMap.get(key)!.add(d.sessionId);
            }

            // Count cart add events
            if (d.event === 'item_added') {
                cartAddMap.set(key, (cartAddMap.get(key) ?? 0) + 1);
            }
        }

        // ── Aggregate revenue from orders ─────────────────────────────────────
        const orderMap   = new Map<string, { count: number; revenue: number }>();

        for (const doc of ordersSnap.docs) {
            const d   = doc.data() as OrderDoc;
            const key = this.channelKey(d.attribution?.utm, d.attribution?.referrerDomain);
            const rev = d.total ?? d.totalAmount ?? 0;
            const cur = orderMap.get(key) ?? { count: 0, revenue: 0 };
            orderMap.set(key, { count: cur.count + 1, revenue: cur.revenue + rev });
        }

        // ── Build rows ─────────────────────────────────────────────────────────
        const allKeys = new Set([...sessionMap.keys(), ...orderMap.keys()]);
        const rows: AttributionRow[] = [];

        for (const key of allKeys) {
            const sessions = sessionMap.get(key)?.size ?? 0;
            const cartAdds = cartAddMap.get(key) ?? 0;
            const ord      = orderMap.get(key) ?? { count: 0, revenue: 0 };
            const meta     = channelMeta.get(key) ?? { medium: '', campaign: '' };

            rows.push({
                channel:        key,
                medium:         meta.medium,
                campaign:       meta.campaign,
                sessions,
                cartAdds,
                orders:         ord.count,
                revenue:        ord.revenue,
                conversionRate: sessions > 0 ? ord.count / sessions : 0,
                avgOrderValue:  ord.count > 0 ? ord.revenue / ord.count : 0,
            });
        }

        // Sort by revenue desc
        rows.sort((a, b) => b.revenue - a.revenue);

        const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
        const totalOrders   = rows.reduce((s, r) => s + r.orders, 0);
        const totalRevenue  = rows.reduce((s, r) => s + r.revenue, 0);
        const topSource     = rows[0]?.channel ?? '—';

        return { rows, totalSessions, totalOrders, totalRevenue, topSource };
    }

    /**
     * Stable channel key from UTM + referrer.
     * Follows the Google Analytics source / medium convention.
     */
    private channelKey(
        utm?: { utm_source?: string; utm_medium?: string },
        referrerDomain?: string
    ): string {
        if (utm?.utm_source) return utm.utm_source;
        if (referrerDomain)  return referrerDomain;
        return 'direct';
    }
}
