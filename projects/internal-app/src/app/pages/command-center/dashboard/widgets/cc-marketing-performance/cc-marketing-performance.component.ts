import { Component, OnInit, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';
import { MetricsBigqueryService } from '../../../../operations/metrics/services/metrics-bigquery.service';
import { CommandCenterContextService } from '../../../services/command-center-context.service';

interface MktKpi {
    label:    string;
    labelKey: string;
    value:    string;
    color:    string;
}

@Component({
    selector: 'app-cc-marketing-performance',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './cc-marketing-performance.component.html',
    styleUrls: ['./cc-marketing-performance.component.css'],
})
export class CcMarketingPerformanceComponent {
    private fs = inject(Firestore);
    private bqService = inject(MetricsBigqueryService);
    public contextService = inject(CommandCenterContextService);

    isLoading  = signal(true);
    kpis       = signal<MktKpi[]>([]);
    topSource  = signal('—');

    constructor() {
        effect(() => {
            const range = this.contextService.dateRange() as any;
            if (range) {
                this.load(range.start, range.end);
            }
        });
    }

    private async load(startDate: Date, endDate: Date) {
        this.isLoading.set(true);
        const fromTs = Timestamp.fromDate(startDate);
        const toTs   = Timestamp.fromDate(endDate);
        
        // Format dates for BigQuery
        const fromDateStr = startDate.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        const toDateStr   = endDate.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

        try {
            const [snapsSnap, bqMetrics] = await Promise.all([
                getDocs(query(
                    collection(this.fs, 'cartSnapshots'),
                    where('createdAt', '>=', fromTs),
                    where('createdAt', '<=', toTs),
                    orderBy('createdAt', 'desc'),
                )),
                this.bqService.querySummaryKpisBetween(fromDateStr, toDateStr)
            ]);

            const sessions = new Set<string>();
            const sourceMap = new Map<string, number>();
            let abandonedCount = 0;

            for (const doc of snapsSnap.docs) {
                const d = doc.data() as any;
                if (d.sessionId) sessions.add(d.sessionId);
                if (d.event === 'abandoned_detected') abandonedCount++;
                const src = d.attribution?.utm?.utm_source || d.attribution?.referrerDomain || 'direct';
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
            }

            // Accurate revenue and orders from BigQuery (excludes cancelled/failed)
            let totalRev = 0;
            let totalOrders = 0;
            for (const row of bqMetrics) {
                totalRev += row.revenue;
                totalOrders += row.orders;
            }

            let actualSessions = sessions.size;

            const convRate = actualSessions > 0
                ? ((totalOrders / actualSessions) * 100).toFixed(1) + '%'
                : '0%';

            let topSrc = '—', topCount = 0;
            for (const [src, cnt] of sourceMap) {
                if (cnt > topCount) { topCount = cnt; topSrc = src; }
            }

            this.topSource.set(topSrc);

            this.kpis.set([
                {
                    label: 'Revenue (MTD)', labelKey: 'CC.MARKETING.REVENUE',
                    value: new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(totalRev),
                    color: '#10b981'
                },
                {
                    label: 'Orders', labelKey: 'CC.MARKETING.ORDERS',
                    value: String(totalOrders),
                    color: '#6366f1'
                },
                {
                    label: 'Sessions', labelKey: 'CC.MARKETING.SESSIONS',
                    value: String(actualSessions),
                    color: '#8b5cf6'
                },
                {
                    label: 'Conv. Rate', labelKey: 'CC.MARKETING.CONV_RATE',
                    value: convRate,
                    color: '#f59e0b'
                },
                {
                    label: 'Abandoned', labelKey: 'CC.MARKETING.ABANDONED',
                    value: String(abandonedCount),
                    color: '#ef4444'
                },
            ]);
        } catch (e) {
            console.error('[CC:MarketingPerformance] load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }
}
