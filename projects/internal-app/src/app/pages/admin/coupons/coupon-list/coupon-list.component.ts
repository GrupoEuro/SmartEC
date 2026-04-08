import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import * as QRCode from 'qrcode';
import { CouponService } from '../../../../core/services/coupon.service';
import { Coupon } from '../../../../core/models/coupon.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { map } from 'rxjs';

@Component({
    selector: 'app-coupon-list',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent, AppIconComponent],
    templateUrl: './coupon-list.component.html',
    styleUrls: ['./coupon-list.component.css']
})
export class CouponListComponent implements OnInit {
    private couponService = inject(CouponService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    coupons: Coupon[] = [];
    filteredCoupons: Coupon[] = [];
    isLoading = true;
    isActioning = new Set<string>(); // tracks per-row approve/reject pending

    // Filters
    searchControl = new FormControl('');
    statusFilter = new FormControl('all');
    typeFilter = new FormControl('all');

    // Pagination
    currentPage = 1;
    pageSize = 10;

    // Sorting
    sortColumn: string = 'code';
    sortDirection: 'asc' | 'desc' = 'asc';

    ngOnInit() {
        this.loadCoupons();

        // Combine filter changes
        this.searchControl.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
        this.statusFilter.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
        this.typeFilter.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
    }

    loadCoupons() {
        this.isLoading = true;
        this.couponService.getCoupons().subscribe({
            next: (data) => {
                this.coupons = data;
                this.applyFilters();
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading coupons:', error);
                this.toast.error('Error loading coupons');
                this.isLoading = false;
            }
        });
    }

    applyFilters() {
        let result = [...this.coupons];
        const search = (this.searchControl.value || '').toLowerCase().trim();
        const status = this.statusFilter.value || 'all';
        const type = this.typeFilter.value || 'all';

        // 1. Search
        if (search) {
            result = result.filter(c => c.code.toLowerCase().includes(search));
        }

        // 2. Status
        if (status !== 'all') {
            const isActive = status === 'active';
            result = result.filter(c => c.isActive === isActive);
        }

        // 3. Type
        if (type !== 'all') {
            result = result.filter(c => c.type === type);
        }

        // 4. Sort
        this.sortCoupons(result);

        this.filteredCoupons = result;
    }

    get pendingCoupons(): Coupon[] {
        return this.coupons.filter(c => c.status === 'pending');
    }

    sort(column: string) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        this.applyFilters();
    }

    sortCoupons(list: Coupon[]) {
        list.sort((a, b) => {
            let valA: any = a[this.sortColumn as keyof Coupon];
            let valB: any = b[this.sortColumn as keyof Coupon];

            // Handle special cases
            if (this.sortColumn === 'status') valA = a.isActive;
            if (this.sortColumn === 'validity') valA = a.endDate;

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    get paginatedCoupons() {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        return this.filteredCoupons.slice(startIndex, startIndex + this.pageSize);
    }

    onPageChange(page: number) {
        this.currentPage = page;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async toggleStatus(coupon: Coupon) {
        try {
            await this.couponService.toggleStatus(coupon.id!, coupon.isActive);
            this.toast.success(`Cupón ${coupon.code}: ${!coupon.isActive ? 'Activado' : 'Desactivado'}`);
        } catch (error) {
            console.error('Error toggling status:', error);
            this.toast.error('Error al cambiar el estado');
        }
    }

    async approveCoupon(coupon: Coupon) {
        if (!coupon.id || this.isActioning.has(coupon.id)) return;
        this.isActioning.add(coupon.id);
        try {
            await this.couponService.approveCoupon(coupon.id);
            this.toast.success(`¡Cupón ${coupon.code} aprobado y activado!`);
        } catch (err) {
            this.toast.error('Error al aprobar el cupón');
        } finally {
            this.isActioning.delete(coupon.id);
        }
    }

    async rejectCoupon(coupon: Coupon) {
        if (!coupon.id || this.isActioning.has(coupon.id)) return;
        const confirmed = await this.confirmDialog.confirm({
            title: `¿Rechazar cupón ${coupon.code}?`,
            message: 'Indica el motivo del rechazo (opcional):',
            confirmText: 'Rechazar',
            type: 'warning'
        });
        if (!confirmed) return;
        this.isActioning.add(coupon.id);
        try {
            await this.couponService.rejectCoupon(coupon.id, 'Rechazado por el administrador');
            this.toast.info(`Cupón ${coupon.code} rechazado`);
        } catch (err) {
            this.toast.error('Error al rechazar el cupón');
        } finally {
            this.isActioning.delete(coupon.id);
        }
    }

    async deleteCoupon(coupon: Coupon) {
        const confirmed = await this.confirmDialog.confirm({
            title: `¿Eliminar cupón ${coupon.code}?`,
            message: 'Esta acción no se puede deshacer.',
            confirmText: 'Eliminar',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await this.couponService.deleteCoupon(coupon.id!);
            this.toast.success('Cupón eliminado correctamente');
        } catch (error) {
            console.error('Error deleting coupon:', error);
            this.toast.error('Error al eliminar el cupón');
        }
    }

    async downloadQR(coupon: Coupon) {
        try {
            const qrImageDataUrl = await this.couponService.generateCompositeQR(coupon.code, coupon.qrLogoUrl);
            const a = document.createElement('a');
            a.href = qrImageDataUrl;
            a.download = `QR_${coupon.code}.png`;
            a.click();
        } catch (err) {
            console.error('Failed to generate composite QR code', err);
            this.toast.error('Failed to generate QR code');
        }
    }

    isExpired(coupon: Coupon): boolean {
        if (!coupon.endDate) return false;
        // Handle Firestore Timestamp or Date or string
        const end = (coupon.endDate as any).toDate ? (coupon.endDate as any).toDate() : new Date(coupon.endDate as any);
        return new Date() > end;
    }
}
