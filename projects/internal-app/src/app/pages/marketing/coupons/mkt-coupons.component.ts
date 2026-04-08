import { Component, inject, signal, computed, Signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp, getDocs, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
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
export class MktCouponsComponent implements OnInit {
    private firestore   = inject(Firestore);
    private couponSvc   = inject(CouponService);
    private auth        = inject(AuthService);
    private toast       = inject(ToastService);

    // ── Live coupon stream ───────────────────────────────────────────────────
    copiedId       = signal<string | null>(null);
    orderUsageMap  = signal<Map<string, { orders: number; savedAmount: number }>>(new Map());

    private allCoupons: Signal<Coupon[]> = toSignal(
        collectionData(
            query(collection(this.firestore, 'coupons'), orderBy('createdAt', 'desc')),
            { idField: 'id' }
        ) as any,
        { initialValue: [] as Coupon[] }
    );

    filter = signal<CouponFilter>('all');
    search = signal('');

    readonly filters: { value: CouponFilter; label: string }[] = [
        { value: 'all',      label: 'Todos'      },
        { value: 'active',   label: 'Activos'    },
        { value: 'inactive', label: 'Inactivos'  },
        { value: 'expired',  label: 'Expirados'  },
        { value: 'pending',  label: 'Pendientes' },
    ];

    readonly coupons = computed(() => {
        const f   = this.filter();
        const q   = this.search().toLowerCase();
        const now = new Date();

        return this.allCoupons().filter((c: Coupon) => {
            const isExpired  = c.endDate ? this.toDate(c.endDate) < now : false;
            const isPending  = c.status === 'pending';
            if (f === 'active'   && (!c.isActive || isExpired || isPending)) return false;
            if (f === 'inactive' && (c.isActive || isExpired || isPending))  return false;
            if (f === 'expired'  && !isExpired)                              return false;
            if (f === 'pending'  && !isPending)                              return false;
            if (q && !c.code.toLowerCase().includes(q) && !(c.description?.toLowerCase().includes(q))) return false;
            return true;
        });
    });

    // ── KPIs ─────────────────────────────────────────────────────────────────
    readonly totalActive  = computed(() => this.allCoupons().filter(c => c.isActive && !this.isExpired(c)).length);
    readonly totalPending = computed(() => this.allCoupons().filter(c => c.status === 'pending').length);
    readonly totalUses    = computed(() => this.allCoupons().reduce((s, c) => s + (c.usageCount || 0), 0));
    readonly totalScans   = computed(() => this.allCoupons().reduce((s, c) => s + (c.scanCount  || 0), 0));
    readonly convRate     = computed(() => {
        const scans = this.totalScans();
        const uses  = this.totalUses();
        return scans > 0 ? Math.round((uses / scans) * 100) : 0;
    });

    ngOnInit() { this.loadOrderUsage(); }

    private async loadOrderUsage() {
        const snap = await getDocs(
            query(collection(this.firestore, 'orders'), where('couponCode', '!=', null))
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

    // Simple form model (no reactive forms dependency)
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

    statusLabel(c: Coupon): 'active' | 'inactive' | 'expired' | 'pending' | 'rejected' {
        if (c.status === 'pending')  return 'pending';
        if (c.status === 'rejected') return 'rejected';
        if (this.isExpired(c))       return 'expired';
        return c.isActive ? 'active' : 'inactive';
    }

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
    }

    adminEditRoute(id: string): string[] {
        return ['/admin/coupons/edit', id];
    }
}
