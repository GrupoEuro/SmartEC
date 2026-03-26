import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { PromotionService } from '../../../../core/services/promotion.service';
import { Promotion, PromotionTrigger } from '../../../../core/models/promotion.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';

@Component({
    selector: 'app-promotion-list',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AppIconComponent, PaginationComponent],
    templateUrl: './promotion-list.component.html',
    styleUrls: ['./promotion-list.component.css']
})
export class PromotionListComponent implements OnInit {
    private promotionService = inject(PromotionService);
    private toast            = inject(ToastService);
    private confirmDialog    = inject(ConfirmDialogService);

    promotions:         Promotion[] = [];
    filteredPromotions: Promotion[] = [];
    isLoading = true;

    searchControl  = new FormControl('');
    statusFilter   = new FormControl('all');
    triggerFilter  = new FormControl('all');

    currentPage = 1;
    pageSize    = 10;
    sortColumn: string        = 'priority';
    sortDirection: 'asc'|'desc' = 'desc';

    readonly triggerLabels: Record<PromotionTrigger, string> = {
        exit_intent:  '🚪 Exit Intent',
        welcome_user: '👋 Welcome User',
        timed_delay:  '⏱ Timed Delay',
        scroll_depth: '📜 Scroll Depth',
        seasonal:     '🗓 Seasonal',
    };

    readonly statusColors: Record<string, string> = {
        active:    'badge-active',
        paused:    'badge-inactive',
        scheduled: 'badge-scheduled',
    };

    ngOnInit() {
        this.loadPromotions();
        this.searchControl.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
        this.statusFilter.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
        this.triggerFilter.valueChanges.subscribe(() => { this.currentPage = 1; this.applyFilters(); });
    }

    loadPromotions() {
        this.isLoading = true;
        this.promotionService.getPromotions().subscribe({
            next: (data) => { this.promotions = data; this.applyFilters(); this.isLoading = false; },
            error: () => { this.toast.error('Failed to load promotions'); this.isLoading = false; }
        });
    }

    applyFilters() {
        let result = [...this.promotions];
        const q = this.searchControl.value?.toLowerCase() ?? '';
        if (q) result = result.filter(p => p.name.toLowerCase().includes(q) || p.couponCode?.toLowerCase().includes(q));
        if (this.statusFilter.value !== 'all') result = result.filter(p => p.status === this.statusFilter.value);
        if (this.triggerFilter.value !== 'all') result = result.filter(p => p.trigger === this.triggerFilter.value);
        this.filteredPromotions = this.sortList(result);
    }

    sort(col: string) {
        if (this.sortColumn === col) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        else { this.sortColumn = col; this.sortDirection = 'asc'; }
        this.applyFilters();
    }

    private sortList(list: Promotion[]): Promotion[] {
        return [...list].sort((a, b) => {
            const av = (a as any)[this.sortColumn] ?? '';
            const bv = (b as any)[this.sortColumn] ?? '';
            return this.sortDirection === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
    }

    get pagedPromotions(): Promotion[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredPromotions.slice(start, start + this.pageSize);
    }

    async toggleStatus(p: Promotion) {
        const next = p.status === 'active' ? 'paused' : 'active';
        await this.promotionService.update(p.id!, { status: next });
        this.toast.success(`Promotion ${next}`);
    }

    async deletePromotion(p: Promotion) {
        const confirmed = await this.confirmDialog.confirm({ message: `Delete promotion "${p.name}"?`, title: 'Delete Promotion', confirmText: 'Delete' });
        if (!confirmed) return;
        await this.promotionService.delete(p.id!);
        this.toast.success('Promotion deleted');
    }

    clearFilters() {
        this.searchControl.reset();
        this.statusFilter.setValue('all');
        this.triggerFilter.setValue('all');
    }

    get hasActiveFilters(): boolean {
        return !!(this.searchControl.value || this.statusFilter.value !== 'all' || this.triggerFilter.value !== 'all');
    }

    ctrPercent(p: Promotion): string {
        if (!p.totalShown) return '—';
        return ((p.totalClicked / p.totalShown) * 100).toFixed(1) + '%';
    }
}
