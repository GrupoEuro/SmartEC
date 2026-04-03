import { Component, inject, signal, computed, Signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp, getDocs, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Coupon } from '../../../core/models/coupon.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

type CouponFilter = 'all' | 'active' | 'inactive' | 'expired';

@Component({
    selector: 'app-mkt-coupons',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterLink, TranslateModule, AppIconComponent],
    templateUrl: './mkt-coupons.component.html',
    styleUrls: ['./mkt-coupons.component.css'],
})
export class MktCouponsComponent implements OnInit {
    private firestore = inject(Firestore);

    // Per-card copied feedback state
    copiedId = signal<string | null>(null);
    // Per-coupon order usage from orders collection: code -> { orders, savedAmount }
    orderUsageMap = signal<Map<string, { orders: number; savedAmount: number }>>(new Map());

    private allCoupons: Signal<Coupon[]> = toSignal(
        collectionData(
            query(collection(this.firestore, 'coupons'), orderBy('createdAt', 'desc')),
            { idField: 'id' }
        ) as any,
        { initialValue: [] as Coupon[] }
    );

    filter = signal<CouponFilter>('all');
    search = signal('');

    readonly filters: { value: CouponFilter; labelKey: string }[] = [
        { value: 'all',      labelKey: 'MARKETING.COUPONS.FILTER_ALL'      },
        { value: 'active',   labelKey: 'MARKETING.COUPONS.FILTER_ACTIVE'   },
        { value: 'inactive', labelKey: 'MARKETING.COUPONS.FILTER_INACTIVE' },
        { value: 'expired',  labelKey: 'MARKETING.COUPONS.FILTER_EXPIRED'  },
    ];

    readonly coupons = computed(() => {
        const f = this.filter();
        const q = this.search().toLowerCase();
        const now = new Date();

        return this.allCoupons().filter((c: Coupon) => {
            const isExpired = c.endDate ? this.toDate(c.endDate) < now : false;
            if (f === 'active'   && (!c.isActive || isExpired)) return false;
            if (f === 'inactive' && (c.isActive && !isExpired)) return false;
            if (f === 'expired'  && !isExpired)                  return false;
            if (q && !c.code.toLowerCase().includes(q) && !(c.description?.toLowerCase().includes(q))) return false;
            return true;
        });
    });

    // ── KPIs ─────────────────────────────────────────────────────────────────
    readonly totalActive  = computed(() => this.allCoupons().filter(c => c.isActive && !this.isExpired(c)).length);
    readonly totalUses    = computed(() => this.allCoupons().reduce((s, c) => s + (c.usageCount || 0), 0));
    readonly totalScans   = computed(() => this.allCoupons().reduce((s, c) => s + (c.scanCount || 0), 0));
    readonly convRate     = computed(() => {
        const scans = this.totalScans();
        const uses  = this.totalUses();
        return scans > 0 ? Math.round((uses / scans) * 100) : 0;
    });

    ngOnInit() { this.loadOrderUsage(); }

    /** Fetch real coupon usage from orders collection */
    private async loadOrderUsage() {
        const snap = await getDocs(
            query(collection(this.firestore, 'orders'),
                where('couponCode', '!=', null))
        ).catch(() => null);
        if (!snap) return;
        const map = new Map<string, { orders: number; savedAmount: number }>();
        snap.forEach(doc => {
            const d = doc.data() as any;
            const code = (d.couponCode || d.appliedCoupon || d.discountCode || '')?.toUpperCase();
            if (!code) return;
            const saved = d.discountAmount ?? d.couponDiscount ?? 0;
            const cur = map.get(code) ?? { orders: 0, savedAmount: 0 };
            map.set(code, { orders: cur.orders + 1, savedAmount: cur.savedAmount + saved });
        });
        this.orderUsageMap.set(map);
    }

    orderUsage(code: string): { orders: number; savedAmount: number } {
        return this.orderUsageMap().get(code?.toUpperCase()) ?? { orders: 0, savedAmount: 0 };
    }

    /** Copy storefront promo link to clipboard */
    async copyPromoLink(coupon: Coupon) {
        const url = `https://www.importadoraeuro.com/catalogo?coupon=${encodeURIComponent(coupon.code)}`;
        try {
            await navigator.clipboard.writeText(url);
            this.copiedId.set(coupon.id!);
            setTimeout(() => this.copiedId.set(null), 2000);
        } catch {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.copiedId.set(coupon.id!);
            setTimeout(() => this.copiedId.set(null), 2000);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    toDate(d: Timestamp | Date): Date {
        return d instanceof Date ? d : (d as Timestamp).toDate();
    }

    isExpired(c: Coupon): boolean {
        return c.endDate ? this.toDate(c.endDate) < new Date() : false;
    }

    usagePct(c: Coupon): number {
        if (!c.usageLimit) return 0;
        return Math.min(100, Math.round((c.usageCount / c.usageLimit) * 100));
    }

    statusLabel(c: Coupon): 'active' | 'inactive' | 'expired' {
        if (this.isExpired(c)) return 'expired';
        return c.isActive ? 'active' : 'inactive';
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
    }

    adminCouponUrl(id: string): string {
        return `/admin/coupons/${id}`;
    }
}
