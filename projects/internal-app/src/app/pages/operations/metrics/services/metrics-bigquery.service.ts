import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MetricsAnalyticsService, DateRange } from './metrics-analytics.service';

// ─── Result types ──────────────────────────────────────────────────────────────

export interface ProductRevenueRow {
    sku:           string;
    product_id?:   string;
    product_name:  string;
    brand:         string | null;
    total_units:   number;
    total_revenue: number;
    total_orders:  number;
    avg_unit_price: number;
}

export interface GeoBreakdownRow {
    state:            string;
    total_orders:     number;
    total_revenue:    number;
    avg_ticket:       number;
    total_units:      number;
    unique_customers: number;
}

export interface ChannelSkuRow {
    source_channel: string;
    sku:            string;
    product_name:   string;
    total_units:    number;
    total_revenue:  number;
}

export interface SummaryKpisRow {
    source_channel: string;
    revenue:        number;
    orders:         number;
    units:          number;
    avg_ticket:     number;
}

export interface DailyTrendRow {
    order_date:     string;  // YYYY-MM-DD (BigQuery date serialized as string)
    revenue:        number;
    orders:         number;
    units:          number;
    source_channel?: string; // present when channel filter is used
}

export interface CustomerCohortRow {
    cohort_month:    string;
    activity_month:  string;
    customers:       number;
    revenue:         number;
    orders:          number;
}

export interface CancellationRateRow {
    source_channel:    string;
    total_orders:      number;
    completed_orders:  number;
    cancelled_orders:  number;
    cancellation_rate: number;  // 0–1
}

export interface BQResult<T> {
    queryType: string;
    fromDate:  string;
    toDate:    string;
    rowCount:  number;
    rows:      T[];
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class MetricsBigqueryService {

    private fns = inject(Functions);
    private svc = inject(MetricsAnalyticsService);

    // ── Date helpers ────────────────────────────────────────────────────────

    /** Returns { fromDate, toDate } as YYYY-MM-DD strings for the given DateRange. */
    getDateStrings(range: DateRange): { fromDate: string; toDate: string } {
        const [from, to] = this.svc.getDateRange(range.type);
        return {
            fromDate: from.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }),
            toDate:   to.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' }),
        };
    }

    // ── Query methods ───────────────────────────────────────────────────────

    async queryProductRevenue(
        range:    DateRange,
        channel?: string,
        limit     = 50,
    ): Promise<ProductRevenueRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<ProductRevenueRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'productRevenue', fromDate, toDate, channel, limit });
        return res.data.rows;
    }

    async queryGeoBreakdown(
        range:    DateRange,
        channel?: string,
        limit     = 32,
    ): Promise<GeoBreakdownRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<GeoBreakdownRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'geoBreakdown', fromDate, toDate, channel, limit });
        return res.data.rows;
    }

    async queryChannelSku(
        range:    DateRange,
        channel?: string,
        limit     = 200,
    ): Promise<ChannelSkuRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<ChannelSkuRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'channelSku', fromDate, toDate, channel, limit });
        return res.data.rows;
    }

    /** Returns aggregated KPIs grouped by channel for the given period. */
    async querySummaryKpis(
        range: DateRange,
    ): Promise<SummaryKpisRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<SummaryKpisRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'summaryKpis', fromDate, toDate });
        return res.data.rows;
    }

    /** Returns daily revenue/orders/units series — used for trend chart and forecast. */
    async queryDailyTrend(
        range:    DateRange,
        channel?: string,
    ): Promise<DailyTrendRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        return this._queryDailyTrendDates(fromDate, toDate, channel);
    }

    /** Same as queryDailyTrend but with explicit YYYY-MM-DD strings (compare mode, prior period). */
    async queryDailyTrendBetween(
        fromDate: string,
        toDate:   string,
        channel?: string,
    ): Promise<DailyTrendRow[]> {
        return this._queryDailyTrendDates(fromDate, toDate, channel);
    }

    /** Same as querySummaryKpis but with explicit YYYY-MM-DD strings. */
    async querySummaryKpisBetween(
        fromDate: string,
        toDate:   string,
    ): Promise<SummaryKpisRow[]> {
        const fn = httpsCallable<object, BQResult<SummaryKpisRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'summaryKpis', fromDate, toDate });
        return res.data.rows;
    }

    /** Same as queryProductRevenue but with explicit YYYY-MM-DD strings. */
    async queryProductRevenueBetween(
        fromDate: string,
        toDate:   string,
        limit     = 50,
        channel?: string
    ): Promise<ProductRevenueRow[]> {
        const fn = httpsCallable<object, BQResult<ProductRevenueRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'productRevenue', fromDate, toDate, limit, channel });
        return res.data.rows;
    }

    private async _queryDailyTrendDates(
        fromDate: string,
        toDate:   string,
        channel?: string,
    ): Promise<DailyTrendRow[]> {
        const fn = httpsCallable<object, BQResult<DailyTrendRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'dailyTrend', fromDate, toDate, channel });
        return res.data.rows.map(r => ({
            ...r,
            order_date: typeof r.order_date === 'object'
                ? (r.order_date as any).value ?? String(r.order_date)
                : String(r.order_date),
        }));
    }

    async queryCustomerCohorts(
        range:  DateRange,
        limit   = 500,
    ): Promise<CustomerCohortRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<CustomerCohortRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'customerCohorts', fromDate, toDate, limit });
        return res.data.rows;
    }

    /** Returns cancellation + return rate by channel for the given period. */
    async queryCancellationRate(
        range: DateRange,
    ): Promise<CancellationRateRow[]> {
        const { fromDate, toDate } = this.getDateStrings(range);
        const fn = httpsCallable<object, BQResult<CancellationRateRow>>(this.fns, 'queryMetrics');
        const res = await fn({ queryType: 'cancellationRate', fromDate, toDate });
        return res.data.rows;
    }

    // ── Admin: backfill ────────────────────────────────────────────────────

    async runBackfill(fromDate?: string, deleteFirst = false): Promise<{
        ordersWritten: number;
        itemsWritten:  number;
        dataset:       string;
    }> {
        const fn = httpsCallable<object, { ordersWritten: number; itemsWritten: number; dataset: string }>(
            this.fns, 'backfillOrdersToBigQuery'
        );
        const res = await fn({ fromDate, deleteFirst });
        return res.data;
    }
}
