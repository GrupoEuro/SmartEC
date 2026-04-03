import { Component, inject, signal, computed, Signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp } from '@angular/fire/firestore';
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
export class MktCouponsComponent {
    private firestore = inject(Firestore);

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
