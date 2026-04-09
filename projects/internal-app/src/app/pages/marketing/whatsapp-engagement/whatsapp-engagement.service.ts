import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, query, where,
    orderBy, getDocs, Timestamp, limit
} from '@angular/fire/firestore';

export interface WaClick {
    id:           string;
    clickedAt:    Date;
    page:         string;
    sessionId?:   string;
    userId?:      string;
    cartValue?:   number;
    cartItems?:   number;
    device?:      { mobile?: boolean; userAgent?: string; timezone?: string };
    geo?:         { city?: string; region?: string; country?: string; ip?: string };
    utm?:         { source?: string; medium?: string; campaign?: string };
    campaignId?:  string;
    campaignName?:string;
    referrer?:    string;
}

export interface WaPageBreakdown {
    page:    string;
    label:   string;
    clicks:  number;
    pct:     number;
}

export interface WaUtmBreakdown {
    source:  string;
    clicks:  number;
    pct:     number;
}

export interface WaSummary {
    totalClicks:      number;
    uniqueSessions:   number;
    authenticatedPct: number;   // % of clicks with a userId
    mobileClicks:     number;
    mobilePct:        number;
    withCartClicks:   number;
    withCartPct:      number;
    avgCartValue:     number;
    topPages:         WaPageBreakdown[];
    topSources:       WaUtmBreakdown[];
    recentClicks:     WaClick[];
}

@Injectable({ providedIn: 'root' })
export class WhatsappEngagementService {
    private fs = inject(Firestore);

    async loadReport(from: Date, to: Date): Promise<WaSummary> {
        const fromTs = Timestamp.fromDate(from);
        const toTs   = Timestamp.fromDate(to);

        const snap = await getDocs(query(
            collection(this.fs, 'whatsappClicks'),
            where('clickedAt', '>=', fromTs),
            where('clickedAt', '<=', toTs),
            orderBy('clickedAt', 'desc'),
            limit(2000)
        ));

        const clicks: WaClick[] = snap.docs.map(d => {
            const data = d.data();
            return {
                id:          d.id,
                clickedAt:   data['clickedAt']?.toDate?.() ?? new Date(0),
                page:        data['page'] ?? '/',
                sessionId:   data['sessionId'],
                userId:      data['userId'],
                cartValue:   data['cartValue'],
                cartItems:   data['cartItems'],
                device:      data['device'],
                geo:         data['geo'],
                utm:         data['utm'],
                campaignId:  data['campaignId'],
                campaignName:data['campaignName'],
                referrer:    data['referrer'],
            } as WaClick;
        });

        return this.aggregate(clicks);
    }

    private aggregate(clicks: WaClick[]): WaSummary {
        const total          = clicks.length;
        const sessions       = new Set(clicks.map(c => c.sessionId).filter(Boolean)).size;
        const authenticated  = clicks.filter(c => c.userId).length;
        const mobile         = clicks.filter(c => c.device?.mobile === true).length;
        const withCart       = clicks.filter(c => (c.cartValue ?? 0) > 0).length;
        const cartValues     = clicks.filter(c => (c.cartValue ?? 0) > 0).map(c => c.cartValue ?? 0);
        const avgCart        = cartValues.length > 0
            ? cartValues.reduce((a, b) => a + b, 0) / cartValues.length
            : 0;

        // Page breakdown — normalize path label
        const pageMap = new Map<string, number>();
        for (const c of clicks) {
            const label = this.pageLabel(c.page);
            pageMap.set(label, (pageMap.get(label) ?? 0) + 1);
        }
        const topPages: WaPageBreakdown[] = [...pageMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([label, count]) => ({
                page: label,
                label,
                clicks: count,
                pct: total > 0 ? (count / total) * 100 : 0,
            }));

        // UTM source breakdown
        const srcMap = new Map<string, number>();
        for (const c of clicks) {
            const src = c.utm?.source || c.referrer || 'Directo';
            srcMap.set(src, (srcMap.get(src) ?? 0) + 1);
        }
        const topSources: WaUtmBreakdown[] = [...srcMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([source, count]) => ({
                source,
                clicks: count,
                pct: total > 0 ? (count / total) * 100 : 0,
            }));

        return {
            totalClicks:      total,
            uniqueSessions:   sessions,
            authenticatedPct: total > 0 ? (authenticated / total) * 100 : 0,
            mobileClicks:     mobile,
            mobilePct:        total > 0 ? (mobile / total) * 100 : 0,
            withCartClicks:   withCart,
            withCartPct:      total > 0 ? (withCart / total) * 100 : 0,
            avgCartValue:     avgCart,
            topPages,
            topSources,
            recentClicks:     clicks.slice(0, 50),
        };
    }

    private pageLabel(page: string): string {
        if (!page || page === '/') return 'Inicio';
        if (page.includes('/product/')) return 'Ficha de Producto';
        if (page.includes('/catalog'))  return 'Catálogo';
        if (page.includes('/checkout')) return 'Checkout';
        if (page.includes('/cart'))     return 'Carrito';
        if (page.includes('/account'))  return 'Mi Cuenta';
        if (page.includes('/blog'))     return 'Blog';
        return page.split('?')[0].slice(0, 30);
    }
}
