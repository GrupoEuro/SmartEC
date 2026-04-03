import { Component, inject, Signal, computed, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp, getDocs, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Campaign } from '../../../core/models/campaign.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-mkt-campaigns',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterLink, TranslateModule, AppIconComponent],
    templateUrl: './mkt-campaigns.component.html',
    styleUrls: ['./mkt-campaigns.component.css'],
})
export class MktCampaignsComponent implements OnInit {
    private firestore = inject(Firestore);
    private router    = inject(Router);

    // Campaign performance: utm_campaign slug → { orders, revenue }
    perfMap   = signal<Map<string, { orders: number; revenue: number }>>(new Map());
    perfLoading = signal(true);

    campaigns: Signal<Campaign[]> = toSignal(
        collectionData(
            query(collection(this.firestore, 'campaigns'), orderBy('startDate', 'asc')),
            { idField: 'id' }
        ) as any,
        { initialValue: [] as Campaign[] }
    );

    readonly active   = computed(() => this.campaigns().filter(c => c.isActive && c.startDate.toDate() <= new Date() && c.endDate.toDate() >= new Date()));
    readonly upcoming = computed(() => this.campaigns().filter(c => c.startDate.toDate() > new Date()));
    readonly past     = computed(() => this.campaigns().filter(c => c.endDate.toDate() < new Date()));

    ngOnInit() { this.loadPerf(); }

    /** Load last-90-days orders to build per-campaign performance map */
    private async loadPerf() {
        this.perfLoading.set(true);
        try {
            const from = new Date();
            from.setDate(from.getDate() - 90);
            const snap = await getDocs(
                query(
                    collection(this.firestore, 'orders'),
                    where('createdAt', '>=', Timestamp.fromDate(from)),
                    orderBy('createdAt', 'desc'),
                )
            );
            const map = new Map<string, { orders: number; revenue: number }>();
            snap.forEach(doc => {
                const d = doc.data() as any;
                const camp = (d.attribution?.utm?.utm_campaign ?? '').toLowerCase().trim();
                if (!camp) return;
                const rev = d.total ?? d.totalAmount ?? 0;
                const cur = map.get(camp) ?? { orders: 0, revenue: 0 };
                map.set(camp, { orders: cur.orders + 1, revenue: cur.revenue + rev });
            });
            this.perfMap.set(map);
        } catch (e) {
            console.error('[Campaigns] loadPerf error:', e);
        } finally {
            this.perfLoading.set(false);
        }
    }

    /** Get performance stats for a campaign by name */
    perfFor(name: string): { orders: number; revenue: number } {
        const slug = name.toLowerCase().trim();
        // Try exact match first, then partial match
        const exact = this.perfMap().get(slug);
        if (exact) return exact;
        for (const [key, val] of this.perfMap()) {
            if (slug.includes(key) || key.includes(slug)) return val;
        }
        return { orders: 0, revenue: 0 };
    }

    daysRemaining(end: Timestamp) { return Math.ceil((end.toDate().getTime() - Date.now()) / 86400000); }
    duration(s: Timestamp, e: Timestamp) { return Math.ceil((e.toDate().getTime() - s.toDate().getTime()) / 86400000); }

    themeColor(themeId: string): string {
        const map: Record<string, string> = {
            black_friday: '#f59e0b',
            hot_sale:     '#ef4444',
            dia_de_madres:'#ec4899',
            navidad:      '#22c55e',
            default:      '#6366f1',
        };
        return map[themeId?.toLowerCase()] ?? map['default'];
    }
}
