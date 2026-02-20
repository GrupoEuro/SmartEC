import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { ApprovalWorkflowService } from '../../../../core/services/approval-workflow.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ApprovalRequest, CouponApprovalData, PriceChangeData, BulkDiscountData, FlashSaleData, PromotionApprovalData } from '../../../../core/models/approval-request.model';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-approval-detail',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TranslateModule,
        FormsModule,
        AdminPageHeaderComponent,
        AppIconComponent
    ],
    templateUrl: './approval-detail.component.html',
    styleUrls: ['./approval-detail.component.css'],
    styles: [`
        .btn-icon {
            display: flex;
            align-items: center;
        }
        .btn-content {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn-back {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn-approve, .btn-reject {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
    `]
})
export class ApprovalDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private approvalService = inject(ApprovalWorkflowService);
    private toast = inject(ToastService);

    request = signal<ApprovalRequest | null>(null);
    isLoading = signal(true);
    isProcessing = signal(false);

    // For rejection
    showRejectModal = signal(false);
    rejectionReason = '';

    // For approval
    showApproveModal = signal(false);
    reviewerNotes = '';

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.loadApprovalRequest(id);
        } else {
            this.toast.error('Invalid approval request ID');
            this.router.navigate(['/command-center/approvals']);
        }
    }

    async loadApprovalRequest(id: string) {
        this.isLoading.set(true);
        try {
            const request = await this.approvalService.getApprovalRequest(id);
            if (request) {
                this.request.set(request);
            } else {
                this.toast.error('Approval request not found');
                this.router.navigate(['/command-center/approvals']);
            }
        } catch (error) {
            console.error('Error loading approval request:', error);
            this.toast.error('Error loading approval request');
            this.router.navigate(['/command-center/approvals']);
        } finally {
            this.isLoading.set(false);
        }
    }

    getTypeIcon(type: string): string {
        const icons: Record<string, string> = {
            'COUPON_CREATION': 'tag',
            'FLASH_SALE': 'lightning',
            'PRICE_CHANGE': 'banknote',
            'BULK_DISCOUNT': 'box',
            'PROMOTION_CREATION': 'gift'
        };
        return icons[type] || 'document';
    }

    getRequestTitle(): string {
        const req = this.request();
        if (!req) return '';

        const data = req.data;
        switch (req.type) {
            case 'COUPON_CREATION':
                const coupon = data as CouponApprovalData;
                return coupon.code;
            case 'PRICE_CHANGE':
                const price = data as PriceChangeData;
                return price.productName;
            case 'BULK_DISCOUNT':
                const bulk = data as BulkDiscountData;
                return `${bulk.productCount} Products - ${bulk.discountPercentage}% Off`;
            case 'FLASH_SALE':
                const flash = data as FlashSaleData;
                return flash.name;
            case 'PROMOTION_CREATION':
                const promo = data as PromotionApprovalData;
                return promo.name;
            default:
                return 'Approval Request';
        }
    }

    getRequestDescription(): string {
        const req = this.request();
        if (!req) return '';

        const data = req.data;
        switch (req.type) {
            case 'COUPON_CREATION':
                const coupon = data as CouponApprovalData;
                return `${coupon.type === 'percentage' ? coupon.value + '%' : '$' + coupon.value} ${coupon.description || 'discount'}`;
            case 'PRICE_CHANGE':
                const price = data as PriceChangeData;
                return `Price change: $${price.currentPrice} → $${price.newPrice} (${price.changePercentage > 0 ? '+' : ''}${price.changePercentage.toFixed(1)}%)`;
            case 'BULK_DISCOUNT':
                const bulk = data as BulkDiscountData;
                return `${bulk.discountPercentage}% discount for ${bulk.duration} days`;
            case 'FLASH_SALE':
                const flash = data as FlashSaleData;
                return `${flash.discountPercentage}% off ${flash.targetProducts.length} products`;
            case 'PROMOTION_CREATION':
                const promo = data as PromotionApprovalData;
                return `${promo.discountPercentage}% discount`;
            default:
                return '';
        }
    }

    getDetailedData(): any {
        const req = this.request();
        if (!req) return null;
        return req.data;
    }

    getCouponData() {
        return this.getDetailedData() as CouponApprovalData;
    }

    getPriceChangeData() {
        return this.getDetailedData() as PriceChangeData;
    }

    getBulkDiscountData() {
        return this.getDetailedData() as BulkDiscountData;
    }

    getFlashSaleData() {
        return this.getDetailedData() as FlashSaleData;
    }

    getPromotionData() {
        return this.getDetailedData() as PromotionApprovalData;
    }

    formatDate(timestamp: any): string {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate();
        return date.toLocaleString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    getTimeAgo(timestamp: any): string {
        if (!timestamp) return '';
        const now = new Date();
        const date = timestamp.toDate();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }

    canApproveOrReject(): boolean {
        const req = this.request();
        return req?.status === 'PENDING';
    }

    openApproveModal() {
        this.showApproveModal.set(true);
        this.reviewerNotes = '';
    }

    closeApproveModal() {
        this.showApproveModal.set(false);
        this.reviewerNotes = '';
    }

    openRejectModal() {
        this.showRejectModal.set(true);
        this.rejectionReason = '';
    }

    closeRejectModal() {
        this.showRejectModal.set(false);
        this.rejectionReason = '';
    }

    async handleApprove() {
        const req = this.request();
        if (!req) return;

        this.isProcessing.set(true);
        try {
            await this.approvalService.approveRequest(req.id, this.reviewerNotes || undefined);
            this.toast.success('Request approved successfully');
            this.closeApproveModal();
            // Reload the request to show updated status
            await this.loadApprovalRequest(req.id);
        } catch (error: any) {
            console.error('Error approving request:', error);
            this.toast.error(error.message || 'Error approving request');
        } finally {
            this.isProcessing.set(false);
        }
    }

    async handleReject() {
        const req = this.request();
        if (!req || !this.rejectionReason.trim()) {
            this.toast.error('Please provide a rejection reason');
            return;
        }

        this.isProcessing.set(true);
        try {
            await this.approvalService.rejectRequest(req.id, this.rejectionReason);
            this.toast.success('Request rejected');
            this.closeRejectModal();
            // Reload the request to show updated status
            await this.loadApprovalRequest(req.id);
        } catch (error: any) {
            console.error('Error rejecting request:', error);
            this.toast.error(error.message || 'Error rejecting request');
        } finally {
            this.isProcessing.set(false);
        }
    }

    goBack() {
        this.router.navigate(['/command-center/approvals']);
    }
}
