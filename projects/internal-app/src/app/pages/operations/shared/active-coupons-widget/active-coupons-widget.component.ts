import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';
import { Coupon } from '../../../../core/models/coupon.model';

@Component({
    selector: 'app-active-coupons-widget',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterModule, TranslateModule],
    templateUrl: './active-coupons-widget.component.html',
    styleUrls: ['./active-coupons-widget.component.css'],
})
export class ActiveCouponsWidgetComponent implements OnInit {
    private fs = inject(Firestore);

    isLoading   = signal(true);
    coupons     = signal<Coupon[]>([]);
    isCollapsed = signal(false);

    ngOnInit() { this.load(); }

    private async load() {
        const now = Timestamp.now();
        try {
            // Active coupons that haven't expired or have no end date
            const snap = await getDocs(query(
                collection(this.fs, 'coupons'),
                where('isActive', '==', true),
                orderBy('createdAt', 'desc'),
            ));

            const active: Coupon[] = snap.docs
                .map(d => ({ id: d.id, ...d.data() }) as Coupon)
                .filter(c => !c.endDate || this.toDate(c.endDate) >= now.toDate());

            this.coupons.set(active);
        } catch (e) {
            console.warn('[ActiveCouponsWidget] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    toggle() { this.isCollapsed.update(v => !v); }

    toDate(d: Timestamp | Date): Date {
        return d instanceof Date ? d : (d as Timestamp).toDate();
    }

    daysLeft(endDate: Timestamp | Date): number {
        const ms = this.toDate(endDate).getTime() - Date.now();
        return Math.max(0, Math.ceil(ms / 86_400_000));
    }

    urgencyClass(c: Coupon): string {
        if (!c.endDate) return 'safe';
        const days = this.daysLeft(c.endDate);
        if (days <= 2)  return 'urgent';
        if (days <= 7)  return 'soon';
        return 'safe';
    }

    usagePct(c: Coupon): number {
        if (!c.usageLimit) return 0;
        return Math.min(100, Math.round((c.usageCount / c.usageLimit) * 100));
    }

    fmtDiscount(c: Coupon): string {
        return c.type === 'percentage'
            ? `${c.value}%`
            : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(c.value);
    }
}
