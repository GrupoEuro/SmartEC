import {
    Component, OnInit, inject, signal, computed,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';

import { MetricsBigqueryService, CustomerCohortRow } from '../services/metrics-bigquery.service';
import { MetricsTimeframeService } from '../services/metrics-timeframe.service';
import { DATE_RANGES, DateRange } from '../services/metrics-analytics.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CohortSummary {
    cohort_month:    string;
    total_customers: number;
    total_revenue:   number;
    total_orders:    number;
    months:          Map<string, { customers: number; revenue: number; orders: number }>;
    retention:       Map<string, number>; // month_offset → % of cohort still active
}

@Component({
    selector: 'app-customer-cohorts',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule],
    templateUrl: './customer-cohorts.component.html',
    styleUrl:    './customer-cohorts.component.scss',
})
export class CustomerCohortsComponent implements OnInit {

    private bqSvc = inject(MetricsBigqueryService);
    private tf     = inject(MetricsTimeframeService);

    // ── Date range selector ──────────────────────────────────────────────────
    readonly dateRanges = DATE_RANGES;
    readonly selectedRange = this.tf.selected;

    selectRange(r: DateRange) { this.tf.set(r); this.load(); }

    // ── State ────────────────────────────────────────────────────────────────
    isLoading = signal(true);
    rawRows   = signal<CustomerCohortRow[]>([]);
    viewMode  = signal<'retention' | 'revenue' | 'orders'>('retention');

    // ── Derived: cohort matrix ────────────────────────────────────────────────
    readonly cohorts = computed<CohortSummary[]>(() => {
        const rows = this.rawRows();
        if (!rows.length) return [];

        // Group by cohort_month
        const map = new Map<string, CohortSummary>();
        for (const r of rows) {
            if (!map.has(r.cohort_month)) {
                map.set(r.cohort_month, {
                    cohort_month:    r.cohort_month,
                    total_customers: 0,
                    total_revenue:   0,
                    total_orders:    0,
                    months:          new Map(),
                    retention:       new Map(),
                });
            }
            const c = map.get(r.cohort_month)!;
            c.months.set(r.activity_month, {
                customers: r.customers,
                revenue:   r.revenue,
                orders:    r.orders,
            });
        }

        // For each cohort, find base (first month customers), compute retention
        map.forEach(c => {
            const sortedMonths = Array.from(c.months.keys()).sort();
            const base = c.months.get(sortedMonths[0])?.customers ?? 1;
            c.total_customers = base;
            sortedMonths.forEach((m, idx) => {
                const d = c.months.get(m)!;
                c.total_revenue += d.revenue;
                c.total_orders  += d.orders;
                c.retention.set(m, d.customers / base);
            });
        });

        return Array.from(map.values()).sort((a, b) => a.cohort_month.localeCompare(b.cohort_month));
    });

    // ── All activity months (columns) ────────────────────────────────────────
    readonly allMonths = computed<string[]>(() => {
        const months = new Set<string>();
        this.rawRows().forEach(r => months.add(r.activity_month));
        return Array.from(months).sort();
    });

    // ── KPIs ────────────────────────────────────────────────────────────────
    readonly totalCustomers = computed(() =>
        this.cohorts().reduce((s, c) => s + c.total_customers, 0)
    );
    readonly totalRevenue = computed(() =>
        this.cohorts().reduce((s, c) => s + c.total_revenue, 0)
    );
    readonly avgOrdersPerCohort = computed(() => {
        const cs = this.cohorts();
        if (!cs.length) return 0;
        return cs.reduce((s, c) => s + c.total_orders, 0) / cs.length;
    });
    readonly overallRetentionM1 = computed(() => {
        // Average % of cohorts that returned in month 2
        const cs = this.cohorts();
        const withM2 = cs.filter(c => c.months.size >= 2);
        if (!withM2.length) return 0;
        const sum = withM2.reduce((s, c) => {
            const months = Array.from(c.months.keys()).sort();
            const m2 = months[1];
            return s + (c.retention.get(m2) ?? 0);
        }, 0);
        return sum / withM2.length;
    });

    // ── Cell helpers ────────────────────────────────────────────────────────
    cellValue(cohort: CohortSummary, month: string): number {
        const d = cohort.months.get(month);
        if (!d) return 0;
        const vm = this.viewMode();
        if (vm === 'retention') return cohort.retention.get(month) ?? 0;
        if (vm === 'revenue')   return d.revenue;
        return d.orders;
    }

    /** 0–1 heat intensity for the cell */
    heatIntensity(cohort: CohortSummary, month: string): number {
        const v = this.cellValue(cohort, month);
        if (!v) return 0;
        const vm = this.viewMode();
        if (vm === 'retention') return v; // already 0-1
        const allVals = this.cohorts()
            .map(c => this.cellValue(c, month))
            .filter(x => x > 0);
        const max = Math.max(...allVals);
        return max ? v / max : 0;
    }

    isFirstMonth(cohort: CohortSummary, month: string): boolean {
        const months = Array.from(cohort.months.keys()).sort();
        return months[0] === month;
    }

    formatCell(cohort: CohortSummary, month: string): string {
        const d = cohort.months.get(month);
        if (!d) return '—';
        const vm = this.viewMode();
        if (vm === 'retention') {
            const pct = (cohort.retention.get(month) ?? 0) * 100;
            return pct.toFixed(0) + '%';
        }
        if (vm === 'revenue') {
            const v = d.revenue;
            return v >= 1_000_000
                ? '$' + (v / 1_000_000).toFixed(1) + 'M'
                : v >= 1000
                    ? '$' + (v / 1000).toFixed(0) + 'K'
                    : '$' + v.toFixed(0);
        }
        return d.orders.toString();
    }

    /** Returns M2 retention rate for a specific cohort */
    cohortM2Retention(cohort: CohortSummary): number {
        if (cohort.months.size < 2) return 0;
        const months = Array.from(cohort.months.keys()).sort();
        return cohort.retention.get(months[1]) ?? 0;
    }

    fmtMonth(ym: string): string {
        const [y, m] = ym.split('-');
        const date = new Date(+y, +m - 1, 1);
        return date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
    }

    fmtMoney(v: number) {
        if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
        if (v >= 1000)      return '$' + (v / 1000).toFixed(1) + 'K';
        return '$' + v.toFixed(0);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    ngOnInit() { this.load(); }

    private async load() {
        this.isLoading.set(true);
        try {
            const rows = await this.bqSvc.queryCustomerCohorts(this.tf.selected(), 1000);
            this.rawRows.set(rows);
        } catch (err) {
            console.error('[CustomerCohorts] BQ query failed:', err);
        } finally {
            this.isLoading.set(false);
        }
    }
}
