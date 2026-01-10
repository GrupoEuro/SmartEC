import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { CouponService } from '../../../core/services/coupon.service';
import { ToastService } from '../../../core/services/toast.service';
import { Coupon } from '../../../core/models/coupon.model';
import { TableDataSource } from '../../../core/utils/table-data-source';
import { PaginationComponent } from '../../admin/shared/pagination/pagination.component';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-promotions-reference',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, PaginationComponent, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './promotions-reference.component.html',
    styleUrls: ['./promotions-reference.component.css']
})
export class PromotionsReferenceComponent implements OnInit {
    private couponService = inject(CouponService);
    private toast = inject(ToastService);

    dataSource = new TableDataSource<Coupon>([], 10);
    searchControl = new FormControl('');

    // Filters
    statusFilter = signal<'all' | 'active' | 'inactive'>('all');

    ngOnInit() {
        this.loadPromotions();
        this.setupSearch();
    }

    loadPromotions() {
        this.couponService.getCoupons().subscribe({
            next: (coupons) => {
                this.dataSource.setData(coupons);
                this.applyFilters();
            },
            error: () => this.toast.error('Error loading promotions')
        });
    }

    setupSearch() {
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged()
        ).subscribe(() => {
            this.applyFilters();
        });
    }

    applyFilters() {
        const term = (this.searchControl.value || '').toLowerCase();
        const status = this.statusFilter();

        this.dataSource.refresh((coupon) => {
            // matches search?
            if (term) {
                const matchesCode = coupon.code.toLowerCase().includes(term);
                const matchesDesc = (coupon.description || '').toLowerCase().includes(term);
                if (!matchesCode && !matchesDesc) return false;
            }

            // matches status?
            if (status !== 'all') {
                const isActive = status === 'active';
                if (coupon.isActive !== isActive) return false;
            }

            return true;
        });
    }

    onStatusChange(status: 'all' | 'active' | 'inactive') {
        this.statusFilter.set(status);
        this.applyFilters();
    }

    onSort(field: keyof Coupon) {
        this.dataSource.sort(field);
    }

    onPageChange(page: number) {
        this.dataSource.setPage(page);
    }

    // Template helpers
    formatDate(date: any): Date | null {
        if (!date) return null;
        return date.toDate ? date.toDate() : new Date(date);
    }

    // Export to CSV
    handleExport() {
        const filtered = this.dataSource.filteredData;
        this.exportToCSV(filtered);
    }

    exportToCSV(coupons: Coupon[]) {
        const escapeCSVField = (field: string): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['Código', 'Descripción', 'Tipo', 'Valor', 'Uso', 'Límite', 'Inicio', 'Fin', 'Estado'];
        const rows = coupons.map(c => {
            const startDate = this.formatDate(c.startDate);
            const endDate = this.formatDate(c.endDate);
            return [
                escapeCSVField(c.code),
                escapeCSVField(c.description || ''),
                escapeCSVField(c.type === 'percentage' ? 'Porcentaje' : 'Monto Fijo'),
                escapeCSVField(c.type === 'percentage' ? `${c.value}%` : `$${c.value}`),
                escapeCSVField(c.usageCount.toString()),
                escapeCSVField(c.usageLimit ? c.usageLimit.toString() : 'Sin límite'),
                escapeCSVField(startDate ? startDate.toLocaleDateString('es-MX') : ''),
                escapeCSVField(endDate ? endDate.toLocaleDateString('es-MX') : 'Sin expiración'),
                escapeCSVField(c.isActive ? 'Activa' : 'Inactiva')
            ];
        });

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `promociones_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.toast.success('Promociones exportadas exitosamente');
    }
}
