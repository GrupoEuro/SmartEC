import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';

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
export class CcMarketingPerformanceComponent implements OnInit {
    private fs = inject(Firestore);

    isLoading  = signal(true);
    kpis       = signal<MktKpi[]>([]);
    topSource  = signal('—');

    ngOnInit() { this.load(); }

    private async load() {
        const now  = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1); // MTD
        const fromTs = Timestamp.fromDate(from);
        const toTs   = Timestamp.fromDate(now);

        try {
            const [snapsSnap, ordersSnap] = await Promise.all([
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

            let totalRev = 0;
            for (const doc of ordersSnap.docs) {
                totalRev += (doc.data() as any).total ?? 0;
            }

            const convRate = sessions.size > 0
                ? ((ordersSnap.size / sessions.size) * 100).toFixed(1) + '%'
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
                    value: String(ordersSnap.size),
                    color: '#6366f1'
                },
                {
                    label: 'Sessions', labelKey: 'CC.MARKETING.SESSIONS',
                    value: String(sessions.size),
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
