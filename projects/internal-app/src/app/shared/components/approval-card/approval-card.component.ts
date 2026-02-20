import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { ApprovalRequest, CouponApprovalData, PriceChangeData, BulkDiscountData, FlashSaleData } from '../../../core/models/approval-request.model';

@Component({
    selector: 'app-approval-card',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    template: `
        <div class="approval-card" [class.urgent]="request.priority === 'URGENT'" [class.high]="request.priority === 'HIGH'">
            <div class="card-header">
                <div class="type-badge" [class]="'type-' + request.type.toLowerCase()">
                    <span class="icon">
                        <app-icon [name]="getTypeIcon(request.type)" [size]="16"></app-icon>
                    </span>
                    <span class="label">{{ 'COMMAND_CENTER.APPROVALS.TYPES.' + request.type | translate }}</span>
                </div>
                <div class="priority-badge" [class]="'priority-' + request.priority.toLowerCase()">
                    {{ 'COMMAND_CENTER.APPROVALS.PRIORITY.' + request.priority | translate }}
                </div>
            </div>

            <div class="card-body">
                <h3 class="request-title">{{ getRequestTitle() }}</h3>
                <p class="request-description">{{ getRequestDescription() }}</p>

                <div class="request-meta">
                    <div class="meta-item">
                        <span class="meta-label">{{ 'COMMAND_CENTER.APPROVALS.REQUESTED_BY' | translate }}:</span>
                        <span class="meta-value">{{ request.requestedBy.name }}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">{{ 'COMMAND_CENTER.APPROVALS.REQUESTED_AT' | translate }}:</span>
                        <span class="meta-value">{{ getTimeAgo() }}</span>
                    </div>
                </div>

                <div class="request-notes" *ngIf="request.notes">
                    <strong>{{ 'COMMAND_CENTER.APPROVALS.NOTES' | translate }}:</strong>
                    <p>{{ request.notes }}</p>
                </div>
            </div>

            <div class="card-actions">
                <button class="btn-approve" (click)="onApprove()">
                    <span class="btn-icon"><app-icon name="check" [size]="16"></app-icon></span>
                    {{ 'COMMAND_CENTER.APPROVALS.ACTIONS.APPROVE' | translate }}
                </button>
                <button class="btn-reject" (click)="onReject()">
                    <span class="btn-icon"><app-icon name="x" [size]="16"></app-icon></span>
                    {{ 'COMMAND_CENTER.APPROVALS.ACTIONS.REJECT' | translate }}
                </button>
                <button class="btn-details" (click)="onViewDetails()">
                    <span class="btn-icon"><app-icon name="eye" [size]="16"></app-icon></span>
                    {{ 'COMMAND_CENTER.APPROVALS.ACTIONS.VIEW_DETAILS' | translate }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        .approval-card {
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 1rem;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
            transition: all 0.3s;
            margin-bottom: 1rem;
        }

        .approval-card:hover {
            border-color: rgba(251, 191, 36, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(251, 191, 36, 0.15);
        }

        .approval-card.urgent {
            border-left: 4px solid #ef4444;
        }

        .approval-card.high {
            border-left: 4px solid #f59e0b;
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }

        .type-badge {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            font-weight: 600;
        }

        .type-coupon_creation {
            background: rgba(59, 130, 246, 0.1);
            color: #3b82f6;
        }

        .type-flash_sale {
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
        }

        .type-price_change {
            background: rgba(251, 191, 36, 0.1);
            color: #fbbf24;
        }

        .type-bulk_discount {
            background: rgba(168, 85, 247, 0.1);
            color: #a855f7;
        }

        .type-promotion_creation {
            background: rgba(34, 197, 94, 0.1);
            color: #22c55e;
        }

        .priority-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 0.5rem;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }

        .priority-urgent {
            background: rgba(239, 68, 68, 0.2);
            color: #ef4444;
        }

        .priority-high {
            background: rgba(251, 191, 36, 0.2);
            color: #fbbf24;
        }

        .priority-normal {
            background: rgba(148, 163, 184, 0.2);
            color: #94a3b8;
        }

        .priority-low {
            background: rgba(148, 163, 184, 0.1);
            color: #64748b;
        }

        .card-body {
            margin-bottom: 1.5rem;
        }

        .request-title {
            margin: 0 0 0.5rem 0;
            font-size: 1.25rem;
            font-weight: 700;
            color: #fbbf24;
        }

        .request-description {
            margin: 0 0 1rem 0;
            color: #cbd5e1;
            font-size: 0.9375rem;
        }

        .request-meta {
            display: flex;
            gap: 2rem;
            margin-bottom: 1rem;
        }

        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .meta-label {
            font-size: 0.75rem;
            color: #94a3b8;
            text-transform: uppercase;
        }

        .meta-value {
            font-size: 0.875rem;
            color: #cbd5e1;
            font-weight: 500;
        }

        .request-notes {
            padding: 1rem;
            background: rgba(15, 23, 42, 0.5);
            border-radius: 0.5rem;
            border-left: 3px solid #fbbf24;
        }

        .request-notes strong {
            color: #fbbf24;
            font-size: 0.875rem;
        }

        .request-notes p {
            margin: 0.5rem 0 0 0;
            color: #cbd5e1;
            font-size: 0.875rem;
        }

        .card-actions {
            display: flex;
            gap: 0.75rem;
        }

        .card-actions button {
            flex: 1;
            padding: 0.75rem 1rem;
            border: none;
            border-radius: 0.5rem;
            font-weight: 600;
            font-size: 0.875rem;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }

        .btn-icon {
            display: flex;
            align-items: center;
        }

        .btn-approve {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: white;
        }

        .btn-approve:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
        }

        .btn-reject {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
        }

        .btn-reject:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        }

        .btn-details {
            background: rgba(148, 163, 184, 0.1);
            color: #cbd5e1;
            border: 1px solid rgba(148, 163, 184, 0.3);
        }

        .btn-details:hover {
            background: rgba(148, 163, 184, 0.2);
            border-color: rgba(251, 191, 36, 0.5);
        }

        @media (max-width: 768px) {
            .card-actions {
                flex-direction: column;
            }

            .request-meta {
                flex-direction: column;
                gap: 0.75rem;
            }
        }
    `]
})
export class ApprovalCardComponent {
    @Input() request!: ApprovalRequest;
    @Output() approve = new EventEmitter<string>();
    @Output() reject = new EventEmitter<string>();
    @Output() viewDetails = new EventEmitter<string>();

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
        const data = this.request.data;

        switch (this.request.type) {
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

            default:
                return 'Approval Request';
        }
    }

    getRequestDescription(): string {
        const data = this.request.data;

        switch (this.request.type) {
            case 'COUPON_CREATION':
                const coupon = data as CouponApprovalData;
                return `${coupon.type === 'percentage' ? coupon.value + '%' : '$' + coupon.value} ${coupon.description || 'discount'}`;

            case 'PRICE_CHANGE':
                const price = data as PriceChangeData;
                return `Price change: $${price.currentPrice} → $${price.newPrice} (${price.changePercentage > 0 ? '+' : ''}${price.changePercentage.toFixed(1)}%)`;

            case 'BULK_DISCOUNT':
                const bulk = data as BulkDiscountData;
                return `${bulk.discountPercentage}% discount for ${bulk.duration} days - ${bulk.reason}`;

            case 'FLASH_SALE':
                const flash = data as FlashSaleData;
                return `${flash.discountPercentage}% off ${flash.targetProducts.length} products`;

            default:
                return '';
        }
    }

    getTimeAgo(): string {
        const now = new Date();
        const requested = this.request.requestedAt.toDate();
        const diffMs = now.getTime() - requested.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }

    onApprove() {
        this.approve.emit(this.request.id);
    }

    onReject() {
        this.reject.emit(this.request.id);
    }

    onViewDetails() {
        this.viewDetails.emit(this.request.id);
    }
}
