import { Component, inject, Signal, computed, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp, getDocs, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Campaign } from '../../../core/models/campaign.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CouponService } from '../../../core/services/coupon.service';
import { AdInsightsPanelComponent } from './ad-insights-panel/ad-insights-panel.component';

interface CouponSnippet { id: string; code: string; type: string; value: number; }

/** Priority 1-10 dot-scale array */
const PRIORITY_SCALE = [1,2,3,4,5,6,7,8,9,10];


@Component({
    selector: 'app-mkt-campaigns',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterLink, TranslateModule, AppIconComponent, AdInsightsPanelComponent],
    templateUrl: './mkt-campaigns.component.html',
    styleUrls: ['./mkt-campaigns.component.css'],
})
export class MktCampaignsComponent implements OnInit, OnDestroy {
    private firestore   = inject(Firestore);
    private router      = inject(Router);
    private couponSvc   = inject(CouponService);
    private couponSub?: Subscription;

    // Campaign performance: utm_campaign slug → { orders, revenue }
    perfMap     = signal<Map<string, { orders: number; revenue: number }>>(new Map());
    perfLoading = signal(true);

    // Cart adds per campaign ID (from cartSnapshots)
    cartAddsMap = signal<Map<string, number>>(new Map());

    // Coupon map: couponId → CouponSnippet
    couponMap     = signal<Map<string, CouponSnippet>>(new Map());
    couponsLoaded = signal(false);


    readonly priorityScale = PRIORITY_SCALE;

    campaigns: Signal<Campaign[]> = toSignal(
        collectionData(
            query(collection(this.firestore, 'campaigns'), orderBy('startDate', 'asc')),
            { idField: 'id' }
        ) as any,
        { initialValue: [] as Campaign[] }
    );

    readonly active   = computed(() => this.campaigns().filter(c => c.isActive && c.startDate?.toDate?.() <= new Date() && c.endDate?.toDate?.() >= new Date()));
    readonly upcoming = computed(() => this.campaigns().filter(c => c.startDate?.toDate?.() > new Date()));
    readonly past     = computed(() => this.campaigns().filter(c => c.endDate?.toDate?.() < new Date()));

    ngOnInit() {
        this.loadPerf();
        // Use CouponService so timestamp conversion + code fallback are consistent
        this.couponSub = this.couponSvc.getAllCoupons().subscribe(coupons => {
            const map = new Map<string, CouponSnippet>();
            coupons.forEach(c => map.set(c.id!, {
                id:    c.id!,
                code:  c.code,
                type:  c.type ?? 'percentage',
                value: c.value ?? 0,
            }));
            this.couponMap.set(map);
            this.couponsLoaded.set(true);
        });
    }

    ngOnDestroy() { this.couponSub?.unsubscribe(); }

    couponFor(id: string | undefined): CouponSnippet | null {
        if (!id) return null;
        return this.couponMap().get(id) ?? null;
    }



    /** Load last-90-days orders AND cartSnapshots to build per-campaign performance map */
    private async loadPerf() {
        this.perfLoading.set(true);
        try {
            const from = new Date();
            from.setDate(from.getDate() - 90);

            const [orderSnap, cartSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(this.firestore, 'orders'),
                        where('createdAt', '>=', Timestamp.fromDate(from)),
                        orderBy('createdAt', 'desc'),
                    )
                ),
                getDocs(
                    query(
                        collection(this.firestore, 'cartSnapshots'),
                        where('appliedCampaignId', '!=', null),
                        where('createdAt', '>=', Timestamp.fromDate(from)),
                    )
                ),
            ]);

            // Build orders/revenue map keyed by utm_campaign slug
            const map = new Map<string, { orders: number; revenue: number }>();
            orderSnap.forEach(doc => {
                const d = doc.data() as any;
                const camp = (d.attribution?.utm?.utm_campaign ?? '').toLowerCase().trim();
                if (!camp) return;
                const rev = d.total ?? d.totalAmount ?? 0;
                const cur = map.get(camp) ?? { orders: 0, revenue: 0 };
                map.set(camp, { orders: cur.orders + 1, revenue: cur.revenue + rev });
            });
            this.perfMap.set(map);

            // Build cart-adds map keyed by campaign.id
            const cartMap = new Map<string, number>();
            cartSnap.forEach(doc => {
                const d = doc.data() as any;
                const cid = d.appliedCampaignId as string | undefined;
                if (!cid) return;
                cartMap.set(cid, (cartMap.get(cid) ?? 0) + 1);
            });
            this.cartAddsMap.set(cartMap);

        } catch (e) {
            console.error('[Campaigns] loadPerf error:', e);
        } finally {
            this.perfLoading.set(false);
        }
    }


    /** Get performance stats for a campaign by name */
    perfFor(name: string): { orders: number; revenue: number } {
        const slug = name.toLowerCase().trim();
        const exact = this.perfMap().get(slug);
        if (exact) return exact;
        for (const [key, val] of this.perfMap()) {
            if (slug.includes(key) || key.includes(slug)) return val;
        }
        return { orders: 0, revenue: 0 };
    }

    /** Cart adds for a campaign by campaign.id */
    cartAddsFor(campaignId: string): number {
        return this.cartAddsMap().get(campaignId) ?? 0;
    }

    /**
     * Produces the 4-step conversion funnel for a campaign card.
     * Steps: Impressions → Clicks → Cart Adds → Orders
     * Each step carries: label, value, pct (vs top), dropPct (vs previous), color.
     */
    funnelSteps(c: Campaign): { label: string; value: number; pct: number; dropPct: number | null; color: string }[] {
        const imp   = this.totalImpressions(c);
        const clk   = this.totalClicks(c);
        const cart  = this.cartAddsFor(c.id ?? '');
        const ord   = this.perfFor(c.name).orders;
        const base  = Math.max(imp, 1);

        return [
            { label: 'Impresiones', value: imp,  pct: 100,                         dropPct: null,                                            color: '#6366f1' },
            { label: 'Clicks',      value: clk,  pct: (clk  / base) * 100,         dropPct: imp  > 0 ? (1 - clk  / imp)  * 100 : null,      color: '#3b82f6' },
            { label: 'Carrito',     value: cart, pct: (cart / base) * 100,         dropPct: clk  > 0 ? (1 - cart / clk)  * 100 : null,      color: '#f59e0b' },
            { label: 'Órdenes',     value: ord,  pct: (ord  / base) * 100,         dropPct: cart > 0 ? (1 - ord  / cart) * 100 : null,      color: '#22c55e' },
        ];
    }


    daysRemaining(end: Timestamp) { return Math.max(0, Math.ceil((end.toDate().getTime() - Date.now()) / 86400000)); }
    duration(s: Timestamp, e: Timestamp) { return Math.ceil((e.toDate().getTime() - s.toDate().getTime()) / 86400000); }

    // ── Rich card helpers ───────────────────────────────────────────────────

    /** First active slide URL, fallback to first slide, fallback to empty string */
    slideThumb(c: Campaign): string {
        const slides = c.slides ?? [];
        return slides.find(s => s.active !== false)?.imageUrl
            ?? slides[0]?.imageUrl
            ?? '';
    }

    /** 0-100% through the campaign's lifetime (clamped) */
    campaignProgress(c: Campaign): number {
        const start = c.startDate?.toDate?.()?.getTime?.() ?? 0;
        const end   = c.endDate?.toDate?.()?.getTime?.()   ?? 0;
        const now   = Date.now();
        if (!start || !end || now <= start) return 0;
        if (now >= end) return 100;
        return Math.round(((now - start) / (end - start)) * 100);
    }

    /** Total clicks across all slides */
    totalSlideClicks(c: Campaign): number {
        return (c.slides ?? []).reduce((sum, s) => sum + (s.clickCount ?? 0), 0);
    }

    /** Slides with a CTA URL configured */
    ctaCount(c: Campaign): number {
        return (c.slides ?? []).filter(s => !!s.ctaUrl).length;
    }

    /** CSS modifier for days-remaining urgency colour */
    urgencyClass(days: number): string {
        if (days <= 2) return 'urgent';
        if (days <= 7) return 'warning';
        return 'ok';
    }

    /** Storefront preview link */
    storefrontUrl(c: Campaign): string {
        return `https://www.importadoraeuro.com/?utm_source=admin&utm_medium=preview&utm_campaign=${encodeURIComponent(c.name)}`;
    }

    // ── slideStats analytics ────────────────────────────────────────────────

    /** Total impressions across all slides (reads from slideStats map) */
    totalImpressions(c: Campaign): number {
        const stats = c.slideStats;
        if (!stats) return 0;
        return Object.values(stats).reduce((sum, s) => sum + (s.impressions ?? 0), 0);
    }

    /** Total clicks across all slides (prefers slideStats, falls back to legacy clickCount) */
    totalClicks(c: Campaign): number {
        const stats = c.slideStats;
        if (stats && Object.keys(stats).length > 0) {
            return Object.values(stats).reduce((sum, s) => sum + (s.clicks ?? 0), 0);
        }
        // Legacy fallback
        return this.totalSlideClicks(c);
    }

    /** CTR % (0-100, 1 decimal) — returns null if no impressions yet */
    ctr(c: Campaign): number | null {
        const imp = this.totalImpressions(c);
        if (imp === 0) return null;
        return Math.round((this.totalClicks(c) / imp) * 1000) / 10;
    }

    themeColor(themeId: string): string {
        const map: Record<string, string> = {
            black_friday:  '#f59e0b',  // amber
            hot_sale:      '#ef4444',  // red
            dia_de_madres: '#ec4899',  // pink
            navidad:       '#22c55e',  // green
            christmas:     '#22c55e',  // green (alias)
            halloween:     '#f97316',  // orange
            'buen-fin':    '#3b82f6',  // blue
            buen_fin:      '#3b82f6',  // blue (underscore alias)
            default:       '#6366f1',  // indigo
        };
        return map[themeId?.toLowerCase()] ?? map['default'];
    }
}
