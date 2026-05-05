import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export type SearchQueryType =
    'funnel' | 'topTerms' | 'zeroResults' | 'heatmap' | 'dailyVolume' | 'trendingTerms' | 'revenueAttribution';

export interface FunnelRow {
    event_type:      string;
    event_count:     number;
    unique_sessions: number;
    unique_users:    number;
}

export interface TopTermRow {
    term:               string;
    searches:           number;
    unique_sessions:    number;
    clicks:             number;
    ctr:                number;
    zero_result_searches: number;
    zero_result_rate:   number;
    avg_result_count:   number;
    cart_adds:          number;
    conversions:        number;
    attributed_revenue: number;
    avg_click_position: number;
    variants:           number;   // how many raw spelling variants were merged
}

export interface ZeroResultRow {
    term:            string;
    searches:        number;
    unique_sessions: number;
    unique_users:    number;
    first_seen:      string;
    last_seen:       string;
}

export interface HeatmapRow {
    day_of_week:     number;   // 1=Sun…7=Sat (BigQuery convention)
    hour_of_day:     number;
    searches:        number;
    unique_sessions: number;
}

export interface DailyVolumeRow {
    event_date:      string;   // YYYY-MM-DD
    day_of_week:     number;   // 1=Sun…7=Sat
    searches:        number;
    unique_sessions: number;
}

export interface TrendingTermRow {
    term:           string;
    daily_avg_7d:   number;
    daily_avg_30d:  number;
    velocity_ratio: number;
    searches_7d:    number;
    searches_30d:   number;
}

export interface RevenueAttributionRow {
    term:                string;
    attributed_orders:   number;
    attributed_revenue:  number;
    avg_order_value:     number;
    converting_sessions: number;
    searches:            number;
    purchase_rate:       number;
}

@Injectable({ providedIn: 'root' })
export class SearchReportService {
    private fns = inject(Functions);

    private callFn = httpsCallable<any, { rows: any[]; rowCount: number }>(
        this.fns, 'querySearchAnalytics'
    );

    async query<T>(queryType: SearchQueryType, fromDate: string, toDate: string, limit = 100): Promise<T[]> {
        const result = await this.callFn({ queryType, fromDate, toDate, limit });
        return result.data.rows as T[];
    }

    async getFunnel(fromDate: string, toDate: string): Promise<FunnelRow[]> {
        return this.query<FunnelRow>('funnel', fromDate, toDate);
    }

    async getTopTerms(fromDate: string, toDate: string, limit = 50): Promise<TopTermRow[]> {
        return this.query<TopTermRow>('topTerms', fromDate, toDate, limit);
    }

    async getZeroResults(fromDate: string, toDate: string, limit = 100): Promise<ZeroResultRow[]> {
        return this.query<ZeroResultRow>('zeroResults', fromDate, toDate, limit);
    }

    async getHeatmap(fromDate: string, toDate: string): Promise<HeatmapRow[]> {
        return this.query<HeatmapRow>('heatmap', fromDate, toDate);
    }

    async getDailyVolume(fromDate: string, toDate: string): Promise<DailyVolumeRow[]> {
        return this.query<DailyVolumeRow>('dailyVolume', fromDate, toDate, 93); // max 31+62 days
    }

    async getTrendingTerms(fromDate: string, toDate: string, limit = 30): Promise<TrendingTermRow[]> {
        return this.query<TrendingTermRow>('trendingTerms', fromDate, toDate, limit);
    }

    async getRevenueAttribution(fromDate: string, toDate: string, limit = 50): Promise<RevenueAttributionRow[]> {
        return this.query<RevenueAttributionRow>('revenueAttribution', fromDate, toDate, limit);
    }

    /** Returns YYYY-MM-DD strings for a standard date range. */
    getDateRange(daysBack: number): { fromDate: string; toDate: string } {
        const to   = new Date();
        const from = new Date();
        from.setDate(from.getDate() - daysBack);
        const fmt = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        return { fromDate: fmt(from), toDate: fmt(to) };
    }

    /** Returns the start of the current month to today. */
    getMtdRange(): { fromDate: string; toDate: string } {
        const now  = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const fmt  = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        return { fromDate: fmt(from), toDate: fmt(now) };
    }
}
