import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { QrAnalyticsService, QrScan, QrFunnelStats } from './qr-analytics.service';

type SortCol = 'scannedAt' | 'cartValue' | 'cartStatus' | 'converted';
type ScanFilter = 'all' | 'converted' | 'cart_only' | 'no_action' | 'wa_clicked';

@Component({
    selector: 'app-coupon-analytics',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './coupon-analytics.component.html',
    styleUrls: ['./coupon-analytics.component.css']
})
export class CouponAnalyticsComponent implements OnInit {
    private route    = inject(ActivatedRoute);
    private router   = inject(Router);
    private svc      = inject(QrAnalyticsService);

    couponId = '';
    coupon   = signal<any>(null);
    scans    = signal<QrScan[]>([]);
    stats    = signal<QrFunnelStats | null>(null);
    isLoading = signal(true);

    // Table controls
    sortCol  = signal<SortCol>('scannedAt');
    sortDir  = signal<'asc' | 'desc'>('desc');
    filter   = signal<ScanFilter>('all');
    search   = signal('');

    filteredScans = computed(() => {
        let rows = [...this.scans()];
        const f  = this.filter();
        const q  = this.search().toLowerCase().trim();

        if (f === 'converted')   rows = rows.filter(s => !!s.orderId);
        if (f === 'cart_only')   rows = rows.filter(s => (s.cartValue ?? 0) > 0 && !s.orderId);
        if (f === 'no_action')   rows = rows.filter(s => !(s.cartValue) && !s.orderId);
        if (f === 'wa_clicked')  rows = rows.filter(s => s.waClicked);
        if (q) rows = rows.filter(s =>
            s.sessionId?.toLowerCase().includes(q) ||
            s.email?.toLowerCase().includes(q) ||
            s.city?.toLowerCase().includes(q)
        );

        const col = this.sortCol();
        const dir = this.sortDir() === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const av = a[col] ?? 0;
            const bv = b[col] ?? 0;
            return av < bv ? -dir : av > bv ? dir : 0;
        });

        return rows;
    });

    readonly filterOptions: { id: ScanFilter; key: string; label: string; icon: string }[] = [
        { id: 'all',        key: 'ALL',  label: 'All scans',         icon: '⚡' },
        { id: 'converted',  key: 'CONV', label: 'Converted',         icon: '✅' },
        { id: 'cart_only',  key: 'CART', label: 'Cart only',         icon: '🛒' },
        { id: 'wa_clicked', key: 'WA',   label: 'Opened WhatsApp',   icon: '💬' },
        { id: 'no_action',  key: 'NONE', label: 'No action',         icon: '👻' },
    ];

    ngOnInit() {
        this.couponId = this.route.snapshot.paramMap.get('id') ?? '';
        if (!this.couponId) { this.router.navigate(['/admin/coupons']); return; }
        this.load();
    }

    private async load() {
        this.isLoading.set(true);
        try {
            const [coupon, scans] = await Promise.all([
                this.svc.getCoupon(this.couponId),
                this.svc.getScansForCoupon(this.couponId),
            ]);
            this.coupon.set(coupon);
            this.scans.set(scans);
            this.stats.set(this.svc.computeStats(scans));
        } catch (e) {
            console.error('[QR Analytics] Failed:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    setFilter(f: ScanFilter) { this.filter.set(f); }

    sortBy(col: SortCol) {
        if (this.sortCol() === col) {
            this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortCol.set(col);
            this.sortDir.set('desc');
        }
    }

    onSearch(e: Event) {
        this.search.set((e.target as HTMLInputElement).value);
    }

    openAbandonedCarts() {
        this.router.navigate(['/admin/marketing/abandoned-carts']);
    }

    fmtMXN(n: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(n);
    }

    fmtPct(n: number): string { return n.toFixed(1) + '%'; }

    fmtDate(ms: number): string {
        if (!ms) return '—';
        return new Date(ms).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    fmtRelative(ms: number): string {
        if (!ms) return '—';
        const diff  = Date.now() - ms;
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins  < 2)  return 'Ahora';
        if (mins  < 60) return `Hace ${mins}m`;
        if (hours < 24) return `Hace ${hours}h`;
        return `Hace ${days}d`;
    }

    scanStatusLabel(scan: QrScan): { key: string; label: string; css: string; icon: string } {
        if (scan.orderId)              return { key: 'ORDER',     label: 'Order',     css: 'pill-success', icon: '✅' };
        if (scan.cartStatus === 'checkout_started') return { key: 'CHECKOUT', label: 'Checkout', css: 'pill-info',    icon: '💳' };
        if ((scan.cartValue ?? 0) > 0) return { key: 'CART',      label: 'Cart',      css: 'pill-warn',    icon: '🛒' };
        if (scan.waClicked)            return { key: 'WHATSAPP',  label: 'WhatsApp',  css: 'pill-wa',      icon: '💬' };
        return                                { key: 'SCAN_ONLY', label: 'Scan only', css: 'pill-dim',     icon: '👻' };
    }

    funnelSteps(stats: QrFunnelStats): { label: string; key: string; value: number; pct: number; color: string }[] {
        const base = stats.totalScans || 1;
        return [
            { label: 'Scans',    key: 'SCANS',    value: stats.totalScans,    pct: 100,                                 color: '#6366f1' },
            { label: 'Cart',     key: 'CART',     value: stats.cartAdds,       pct: (stats.cartAdds / base) * 100,       color: '#3b82f6' },
            { label: 'Checkout', key: 'CHECKOUT', value: stats.checkoutStarts, pct: (stats.checkoutStarts / base) * 100, color: '#f59e0b' },
            { label: 'Order',    key: 'ORDER',    value: stats.orders,         pct: (stats.orders / base) * 100,         color: '#22c55e' },
        ];
    }
}
