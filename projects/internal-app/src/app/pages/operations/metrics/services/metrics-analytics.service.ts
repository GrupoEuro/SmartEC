import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, collectionData, doc, docData,
    query, where, orderBy, getDocs, getDoc,
} from '@angular/fire/firestore';
import { Observable, from, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ChannelBreakdown {
    revenue: number;
    orders:  number;
    units:   number;
}

export interface AnalyticsDailyDoc {
    date:         string;        // YYYY-MM-DD
    month:        string;        // YYYY-MM
    dayOfWeek:    number;        // 0=Mon … 6=Sun
    totalRevenue: number;
    totalOrders:  number;
    totalUnits:   number;
    avgTicket:    number;
    byChannel:    Record<string, ChannelBreakdown>;
}

export interface ChannelSnapshotDoc {
    channel:        string;
    date:           string;
    month:          string;
    revenue:        number;
    orders:         number;
    units:          number;
    avgPrice:       number;
    visits?:        number;
    conversionRate?: number;
}

// ─── Calendar-aware date ranges ───────────────────────────────────────────────

export type DateRangeType = '7D' | 'MTD' | 'PAST_MONTH' | 'YTD';

export interface DateRange {
    type:  DateRangeType;
    label: string;
}

export const DATE_RANGES: DateRange[] = [
    { type: '7D',         label: '7D'       },
    { type: 'MTD',        label: 'Este Mes'  },   // default
    { type: 'PAST_MONTH', label: 'Mes Ant.'  },
    { type: 'YTD',        label: 'Año'       },
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class MetricsAnalyticsService {
    private fs = inject(Firestore);

    private readonly TZ = 'America/Mexico_City';

    // ── Calendar helpers ─────────────────────────────────────────────────────

    /** Returns [from, to] Date pair for the current period */
    getDateRange(type: DateRangeType): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        switch (type) {
            case '7D':         return [new Date(now.getTime() - 6 * 86400000), now];
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59)];
            case 'YTD':        return [new Date(y, 0, 1), now];
        }
    }

    /** Returns [from, to] Date pair for the equivalent prior period (for delta %) */
    getPriorRange(type: DateRangeType): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        const d   = now.getDate();
        switch (type) {
            case '7D':         return [new Date(now.getTime() - 13 * 86400000), new Date(now.getTime() - 7 * 86400000)];
            case 'MTD':        return [new Date(y, m - 1, 1), new Date(y, m - 1, d, 23, 59, 59)];
            case 'PAST_MONTH': return [new Date(y, m - 2, 1), new Date(y, m - 1, 0, 23, 59, 59)];
            case 'YTD':        return [new Date(y - 1, 0, 1), new Date(y - 1, m, d, 23, 59, 59)];
        }
    }

    /** Generates all YYYY-MM-DD keys between two dates (inclusive) in MX timezone */
    getDatesBetween(from: Date, to: Date): string[] {
        const keys: string[] = [];
        const cur = new Date(from);
        cur.setHours(12, 0, 0, 0); // noon avoids DST boundary issues
        const end = new Date(to);
        end.setHours(12, 0, 0, 0);
        while (cur <= end) {
            keys.push(cur.toLocaleDateString('sv-SE', { timeZone: this.TZ }));
            cur.setDate(cur.getDate() + 1);
        }
        return keys;
    }

    /** @deprecated — use getDailyDocs(range) */
    getDateKeys(days: number): string[] {
        const keys: string[] = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            keys.push(d.toLocaleDateString('sv-SE', { timeZone: this.TZ }));
        }
        return keys;
    }

    /**
     * Loads pre-aggregated daily docs for the given DateRange.
     * Uses calendar-aware date boundaries (MTD = from 1st, YTD = Jan 1, etc.)
     */
    async getDailyDocs(range: DateRange): Promise<AnalyticsDailyDoc[]> {
        const [from, to] = this.getDateRange(range.type);
        const keys       = this.getDatesBetween(from, to);
        const snaps      = await Promise.all(
            keys.map(k => getDoc(doc(this.fs, `analytics_daily/${k}`)))
        );
        return snaps
            .filter(s => s.exists())
            .map(s => s.data() as AnalyticsDailyDoc);
    }

    /**
     * Loads pre-aggregated daily docs between two explicit dates.
     * Used by the comparison engine where arbitrary periods are needed.
     */
    async getDailyDocsBetween(from: Date, to: Date): Promise<AnalyticsDailyDoc[]> {
        const keys  = this.getDatesBetween(from, to);
        const snaps = await Promise.all(
            keys.map(k => getDoc(doc(this.fs, `analytics_daily/${k}`)))
        );
        return snaps.filter(s => s.exists()).map(s => s.data() as AnalyticsDailyDoc);
    }

    /**
     * Loads channel snapshot docs for a specific channel and range.
     * Used by MELI Full Performance tab to get visit + conversion data.
     */
    async getChannelSnapshots(channelId: string, range: DateRange): Promise<ChannelSnapshotDoc[]> {
        const [from, to] = this.getDateRange(range.type);
        const keys       = this.getDatesBetween(from, to);
        const snaps      = await Promise.all(
            keys.map(k =>
                getDoc(doc(this.fs, `analytics_channel_snapshots/${channelId}/days/${k}`))
            )
        );
        return snaps
            .filter(s => s.exists())
            .map(s => s.data() as ChannelSnapshotDoc);
    }

    /**
     * Aggregates daily docs into KPI summary for the period.
     */
    aggregateDocs(docs: AnalyticsDailyDoc[]): {
        totalRevenue: number;
        totalOrders:  number;
        totalUnits:   number;
        avgTicket:    number;
        byChannel:    Record<string, ChannelBreakdown>;
    } {
        const byChannel: Record<string, ChannelBreakdown> = {};
        let totalRevenue = 0, totalOrders = 0, totalUnits = 0;

        for (const d of docs) {
            totalRevenue += d.totalRevenue ?? 0;
            totalOrders  += d.totalOrders  ?? 0;
            totalUnits   += d.totalUnits   ?? 0;
            for (const [ch, v] of Object.entries(d.byChannel ?? {})) {
                if (!byChannel[ch]) byChannel[ch] = { revenue: 0, orders: 0, units: 0 };
                byChannel[ch].revenue += v.revenue ?? 0;
                byChannel[ch].orders  += v.orders  ?? 0;
                byChannel[ch].units   += v.units   ?? 0;
            }
        }

        return {
            totalRevenue,
            totalOrders,
            totalUnits,
            avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
            byChannel,
        };
    }

    /** Loads docs for the equivalent prior period (for Δ% calculation) */
    async getPriorPeriodDocs(range: DateRange): Promise<AnalyticsDailyDoc[]> {
        const [from, to] = this.getPriorRange(range.type);
        const keys       = this.getDatesBetween(from, to);
        const snaps      = await Promise.all(
            keys.map(k => getDoc(doc(this.fs, `analytics_daily/${k}`)))
        );
        return snaps.filter(s => s.exists()).map(s => s.data() as AnalyticsDailyDoc);
    }

    /** % change helper */
    pctChange(current: number, prior: number): number | null {
        if (prior === 0) return null;
        return Math.round(((current - prior) / prior) * 1000) / 10;
    }
}
