import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, getDocs, query, where } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { Coupon } from '../../../core/models/coupon.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CouponService } from '../../../core/services/coupon.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

type CouponFilter = 'all' | 'active' | 'inactive' | 'expired' | 'pending';

@Component({
    selector: 'app-mkt-coupons',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterLink, FormsModule, TranslateModule, AppIconComponent],
    templateUrl: './mkt-coupons.component.html',
    styleUrls: ['./mkt-coupons.component.css'],
})
export class MktCouponsComponent implements OnInit, OnDestroy {
    private firestore   = inject(Firestore);
    private couponSvc   = inject(CouponService);
    private auth        = inject(AuthService);
    private toast       = inject(ToastService);

    // ── State ────────────────────────────────────────────────────────────────
    isLoading      = signal(true);
    copiedId       = signal<string | null>(null);
    orderUsageMap  = signal<Map<string, { orders: number; savedAmount: number }>>(new Map());

    private rawCoupons = signal<Coupon[]>([]);
    private sub?: Subscription;

    // ── Filters / Search ─────────────────────────────────────────────────────
    filter = signal<CouponFilter>('all');
    search = signal('');

    readonly filters: { value: CouponFilter; label: string }[] = [
        { value: 'all',      label: 'Todos'      },
        { value: 'active',   label: 'Activos'    },
        { value: 'inactive', label: 'Inactivos'  },
        { value: 'expired',  label: 'Expirados'  },
        { value: 'pending',  label: 'Pendientes' },
    ];

    // ── Sorted & Filtered ─────────────────────────────────────────────────────
    private readonly sortedCoupons = computed<Coupon[]>(() =>
        [...this.rawCoupons()].sort((a, b) => {
            const getTs = (d: any) =>
                d instanceof Date ? d.getTime() :
                d?.toDate?.()?.getTime?.() ?? 0;
            return getTs(b.createdAt) - getTs(a.createdAt);
        })
    );

    readonly coupons = computed(() => {
        const f   = this.filter();
        const q   = this.search().trim().toLowerCase();
        const now = new Date();

        return this.sortedCoupons().filter((c: Coupon) => {
            const isExpired = c.endDate ? this.toDate(c.endDate) < now : false;
            const isPending = c.status === 'pending';
            if (f === 'active'   && (!c.isActive || isExpired || isPending)) return false;
            if (f === 'inactive' && (c.isActive  || isExpired || isPending)) return false;
            if (f === 'expired'  && !isExpired)                              return false;
            if (f === 'pending'  && !isPending)                              return false;
            if (q && !c.code?.toLowerCase().includes(q) &&
                !c.description?.toLowerCase().includes(q)) return false;
            return true;
        });
    });

    // ── KPIs ─────────────────────────────────────────────────────────────────
    readonly totalActive  = computed(() => this.rawCoupons().filter(c => c.isActive && !this.isExpired(c) && c.status !== 'pending').length);
    readonly totalPending = computed(() => this.rawCoupons().filter(c => c.status === 'pending').length);
    readonly totalUses    = computed(() => this.rawCoupons().reduce((s, c) => s + (c.usageCount || 0), 0));
    readonly totalScans   = computed(() => this.rawCoupons().reduce((s, c) => s + (c.scanCount  || 0), 0));
    readonly convRate     = computed(() => {
        const scans = this.totalScans();
        const uses  = this.totalUses();
        return scans > 0 ? Math.round((uses / scans) * 100) : 0;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() {
        this.isLoading.set(true);

        // Use CouponService.getAllCoupons() — same tested path as admin list,
        // converts timestamps, guarantees id is set, no orderBy exclusions.
        this.sub = this.couponSvc.getAllCoupons().subscribe({
            next: (coupons) => {
                this.rawCoupons.set(coupons);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('[MktCoupons] Firestore error:', err);
                this.isLoading.set(false);
            }
        });

        this.loadOrderUsage();
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
    }

    private async loadOrderUsage() {
        // Limit to last 12 months to avoid full-collection scans on mature stores
        const from = new Date();
        from.setFullYear(from.getFullYear() - 1);
        const { Timestamp: Ts, orderBy: ob } = await import('@angular/fire/firestore');
        const snap = await getDocs(
            query(
                collection(this.firestore, 'orders'),
                where('couponCode', '!=', null),
                ob('couponCode'),
                where('createdAt', '>=', Ts.fromDate(from)),
                ob('createdAt', 'desc'),
            )
        ).catch(() => null);
        if (!snap) return;
        const map = new Map<string, { orders: number; savedAmount: number }>();
        snap.forEach(doc => {
            const d    = doc.data() as any;
            const code = (d.couponCode || d.appliedCoupon || d.discountCode || '')?.toUpperCase();
            if (!code) return;
            const saved = d.discountAmount ?? d.couponDiscount ?? 0;
            const cur   = map.get(code) ?? { orders: 0, savedAmount: 0 };
            map.set(code, { orders: cur.orders + 1, savedAmount: cur.savedAmount + saved });
        });
        this.orderUsageMap.set(map);
    }

    orderUsage(code: string) {
        return this.orderUsageMap().get(code?.toUpperCase()) ?? { orders: 0, savedAmount: 0 };
    }

    async copyPromoLink(coupon: Coupon) {
        const url = `https://www.importadoraeuro.com/catalogo?coupon=${encodeURIComponent(coupon.code)}`;
        try { await navigator.clipboard.writeText(url); } catch {
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        }
        this.copiedId.set(coupon.id!);
        setTimeout(() => this.copiedId.set(null), 2000);
    }

    // ── Request Modal ─────────────────────────────────────────────────────────
    showModal    = signal(false);
    isSubmitting = signal(false);

    form = signal({
        code:          '',
        type:          'percentage' as 'percentage' | 'fixed_amount',
        value:         10,
        description:   '',
        redirectUrl:   '',
        startDate:     new Date().toISOString().slice(0, 10),
        endDate:       '',
        usageLimit:    0,
        minPurchase:   0,
    });

    patchForm(patch: Partial<ReturnType<typeof this.form>>) {
        this.form.set({ ...this.form(), ...patch });
    }

    openModal()  { this.showModal.set(true); }
    closeModal() { this.showModal.set(false); this.resetForm(); }

    resetForm() {
        this.form.set({
            code: '', type: 'percentage', value: 10, description: '',
            redirectUrl: '', startDate: new Date().toISOString().slice(0, 10),
            endDate: '', usageLimit: 0, minPurchase: 0,
        });
    }

    async submitRequest() {
        const f = this.form();
        if (!f.code.trim()) { this.toast.error('El código es obligatorio'); return; }
        if (!f.value || f.value <= 0) { this.toast.error('El valor debe ser mayor a 0'); return; }

        this.isSubmitting.set(true);
        try {
            const user = this.auth.currentUser();
            await this.couponSvc.requestCoupon(
                {
                    code:              f.code.trim().toUpperCase(),
                    type:              f.type,
                    value:             f.value,
                    description:       f.description || undefined,
                    redirectUrl:       f.redirectUrl || undefined,
                    startDate:         new Date(f.startDate),
                    endDate:           f.endDate ? new Date(f.endDate) : undefined,
                    usageLimit:        f.usageLimit ?? 0,
                    minPurchaseAmount: f.minPurchase > 0 ? f.minPurchase : undefined,
                },
                user?.uid ?? 'marketing',
                user?.displayName ?? user?.email ?? 'Marketing'
            );
            this.toast.success('¡Solicitud enviada! Pendiente de aprobación del Admin.');
            this.closeModal();
        } catch (err: any) {
            this.toast.error(err?.message ?? 'Error al enviar la solicitud');
        } finally {
            this.isSubmitting.set(false);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    toDate(d: any): Date {
        if (!d) return new Date(0);
        if (d instanceof Date) return d;
        if (typeof d?.toDate === 'function') return d.toDate();
        return new Date(d);
    }

    isExpired(c: Coupon): boolean {
        return c.endDate ? this.toDate(c.endDate) < new Date() : false;
    }

    usagePct(c: Coupon): number {
        if (!c.usageLimit) return 0;
        return Math.min(100, Math.round((c.usageCount / c.usageLimit) * 100));
    }

    statusLabel(c: Coupon): 'active' | 'inactive' | 'expired' | 'pending' | 'rejected' {
        if (c.status === 'pending')  return 'pending';
        if (c.status === 'rejected') return 'rejected';
        if (this.isExpired(c))       return 'expired';
        return c.isActive ? 'active' : 'inactive';
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v ?? 0);
    }

    adminEditRoute(id: string): string[] {
        return ['/admin/coupons/edit', id];
    }
}
