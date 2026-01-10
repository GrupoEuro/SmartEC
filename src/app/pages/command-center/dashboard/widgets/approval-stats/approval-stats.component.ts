import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ApprovalWorkflowService } from '../../../../../core/services/approval-workflow.service';
import { ApprovalRequest } from '../../../../../core/models/approval-request.model';
import { CommandCenterContextService } from '../../../services/command-center-context.service';
import { timeout, Subject, takeUntil, switchMap, filter, combineLatest, map, catchError, of } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

interface ApprovalStats {
    pending: number;
    approved: number;
    rejected: number;
    autoApproved: number;
    averageApprovalTimeHours: number;
}

@Component({
    selector: 'app-approval-stats',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    template: `
        <div class="approval-stats-widget">
            <div class="widget-header">
                <div class="header-content">
                    <h3>{{ 'COMMAND_CENTER.APPROVALS.TITLE' | translate }}</h3>
                    <span class="subtitle">{{ 'COMMAND_CENTER.APPROVALS.STATS_SUBTITLE' | translate }}</span>
                </div>
                <button class="btn-view-all" [routerLink]="['/command-center/approvals']">
                    {{ 'COMMAND_CENTER.APPROVALS.VIEW_ALL' | translate }} →
                </button>
            </div>

            <div class="stats-grid" *ngIf="!isLoading()">
                <!-- Pending Approvals -->
                <div class="stat-item pending" [routerLink]="['/command-center/approvals']">
                    <div class="stat-icon">⏳</div>
                    <div class="stat-content">
                        <div class="stat-value">{{ stats().pending }}</div>
                        <div class="stat-label">{{ 'COMMAND_CENTER.APPROVALS.PENDING' | translate }}</div>
                    </div>
                </div>

                <!-- Approved -->
                <div class="stat-item approved">
                    <div class="stat-icon">✓</div>
                    <div class="stat-content">
                        <div class="stat-value">{{ stats().approved }}</div>
                        <div class="stat-label">{{ 'COMMAND_CENTER.APPROVALS.APPROVED' | translate }}</div>
                    </div>
                </div>

                <!-- Rejected -->
                <div class="stat-item rejected">
                    <div class="stat-icon">✗</div>
                    <div class="stat-content">
                        <div class="stat-value">{{ stats().rejected }}</div>
                        <div class="stat-label">{{ 'COMMAND_CENTER.APPROVALS.REJECTED' | translate }}</div>
                    </div>
                </div>

                <!-- Auto-Approved -->
                <div class="stat-item auto-approved">
                    <div class="stat-icon">⚡</div>
                    <div class="stat-content">
                        <div class="stat-value">{{ stats().autoApproved }}</div>
                        <div class="stat-label">{{ 'COMMAND_CENTER.APPROVALS.AUTO_APPROVED' | translate }}</div>
                    </div>
                </div>
            </div>

            <!-- Average Approval Time -->
            <div class="approval-time" *ngIf="!isLoading() && stats().averageApprovalTimeHours > 0">
                <div class="time-icon">⏱️</div>
                <div class="time-content">
                    <div class="time-label">{{ 'COMMAND_CENTER.APPROVALS.AVG_APPROVAL_TIME' | translate }}</div>
                    <div class="time-value">
                        {{ formatApprovalTime(stats().averageApprovalTimeHours) }}
                    </div>
                </div>
            </div>

            <!-- Loading State -->
            <div class="loading-state" *ngIf="isLoading()">
                <div class="spinner"></div>
                <p>{{ 'COMMAND_CENTER.LABELS.LOADING' | translate }}</p>
            </div>
        </div>
    `,
    styles: [`
        .approval-stats-widget {
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 1rem;
            padding: 1.25rem;
            backdrop-filter: blur(10px);
        }

        .widget-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }

        .header-content h3 {
            margin: 0 0 0.25rem 0;
            font-size: 1.25rem;
            font-weight: 700;
            color: #fbbf24;
        }

        .subtitle {
            font-size: 0.875rem;
            color: #94a3b8;
        }

        .btn-view-all {
            padding: 0.5rem 1rem;
            background: rgba(251, 191, 36, 0.1);
            color: #fbbf24;
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 0.5rem;
            font-weight: 600;
            font-size: 0.875rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-view-all:hover {
            background: rgba(251, 191, 36, 0.2);
            border-color: rgba(251, 191, 36, 0.5);
            transform: translateX(2px);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin-bottom: 1rem;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: rgba(15, 23, 42, 0.5);
            border-radius: 0.75rem;
            border-left: 3px solid;
            transition: all 0.2s;
        }

        .stat-item.pending {
            border-left-color: #fbbf24;
            cursor: pointer;
        }

        .stat-item.pending:hover {
            background: rgba(251, 191, 36, 0.1);
            transform: translateY(-2px);
        }

        .stat-item.approved {
            border-left-color: #22c55e;
        }

        .stat-item.rejected {
            border-left-color: #ef4444;
        }

        .stat-item.auto-approved {
            border-left-color: #3b82f6;
        }

        .stat-icon {
            font-size: 2rem;
            flex-shrink: 0;
        }

        .stat-content {
            flex: 1;
        }

        .stat-value {
            font-size: 1.75rem;
            font-weight: 700;
            color: #e2e8f0;
            line-height: 1;
            margin-bottom: 0.25rem;
        }

        .stat-label {
            font-size: 0.75rem;
            color: #94a3b8;
            text-transform: uppercase;
            font-weight: 600;
        }

        .approval-time {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(251, 191, 36, 0.05) 100%);
            border-radius: 0.75rem;
            border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .time-icon {
            font-size: 2rem;
        }

        .time-content {
            flex: 1;
        }

        .time-label {
            font-size: 0.875rem;
            color: #94a3b8;
            margin-bottom: 0.25rem;
        }

        .time-value {
            font-size: 1.25rem;
            font-weight: 700;
            color: #fbbf24;
        }

        .loading-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            color: #cbd5e1;
        }

        .spinner {
            width: 2rem;
            height: 2rem;
            border: 3px solid rgba(251, 191, 36, 0.2);
            border-top-color: #fbbf24;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 0.5rem;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }

            .widget-header {
                flex-direction: column;
                gap: 1rem;
            }

            .btn-view-all {
                width: 100%;
            }
        }
    `]
})
export class ApprovalStatsComponent implements OnDestroy {
    private approvalService = inject(ApprovalWorkflowService);
    private router = inject(Router);
    public contextService = inject(CommandCenterContextService);
    private destroy$ = new Subject<void>();

    // Reactive streams
    private dateRange$ = toObservable(this.contextService.dateRange).pipe(
        filter(range => range !== null),
        takeUntil(this.destroy$)
    );

    // Load pending approvals (not date-filtered, status-based)
    private pendingApprovals$ = this.approvalService.getPendingRequests().pipe(
        timeout(10000),
        map(requests => requests.length),
        catchError(err => {
            console.error('[ApprovalStats] Error loading pending approvals:', err);
            return of(0);
        }),
        takeUntil(this.destroy$)
    );

    // Load historical stats based on date range
    private historicalStats$ = this.dateRange$.pipe(
        switchMap(range => {
            console.log('[ApprovalStats] Loading historical stats for range:', range!.start, '-', range!.end);
            return this.approvalService.getRequestsByDateRange(range!.start, range!.end).pipe(
                timeout(10000),
                map(requests => {
                    console.log('[ApprovalStats] Loaded historical stats:', requests.length, 'requests');

                    const approved = requests.filter((r: ApprovalRequest) => r.status === 'APPROVED');
                    const rejected = requests.filter((r: ApprovalRequest) => r.status === 'REJECTED');
                    const autoApproved = requests.filter((r: ApprovalRequest) => r.autoApproved === true);

                    return {
                        approved: approved.length,
                        rejected: rejected.length,
                        autoApproved: autoApproved.length,
                        averageApprovalTimeHours: this.calculateAverageApprovalTime(approved)
                    };
                }),
                catchError(err => {
                    console.error('[ApprovalStats] Error loading historical stats:', err);
                    return of({
                        approved: 0,
                        rejected: 0,
                        autoApproved: 0,
                        averageApprovalTimeHours: 0
                    });
                })
            );
        }),
        takeUntil(this.destroy$)
    );

    // Combine pending and historical stats
    private combinedStats$ = combineLatest([
        this.pendingApprovals$,
        this.historicalStats$
    ]).pipe(
        map(([pending, historical]) => ({
            pending,
            ...historical
        })),
        takeUntil(this.destroy$)
    );

    // Convert to signal
    stats = toSignal(this.combinedStats$, {
        initialValue: {
            pending: 0,
            approved: 0,
            rejected: 0,
            autoApproved: 0,
            averageApprovalTimeHours: 0
        }
    });

    // Loading state
    isLoading = signal(false);

    ngOnDestroy() {
        console.log('[ApprovalStats] Component destroyed, cleaning up subscriptions');
        this.destroy$.next();
        this.destroy$.complete();
    }

    /**
     * Calculate average approval time from approved requests
     */
    calculateAverageApprovalTime(approvedRequests: ApprovalRequest[]): number {
        const requestsWithReviewTime = approvedRequests.filter(r => r.reviewedAt);

        if (requestsWithReviewTime.length === 0) {
            return 0;
        }

        const totalHours = requestsWithReviewTime.reduce((sum: number, req: ApprovalRequest) => {
            const requestedTime = req.requestedAt.toDate().getTime();
            const reviewedTime = req.reviewedAt!.toDate().getTime();
            const hours = (reviewedTime - requestedTime) / (1000 * 60 * 60);
            return sum + hours;
        }, 0);

        return totalHours / requestsWithReviewTime.length;
    }

    formatApprovalTime(hours: number): string {
        if (hours < 1) {
            const minutes = Math.round(hours * 60);
            return `${minutes}m`;
        } else if (hours < 24) {
            return `${hours.toFixed(1)}h`;
        } else {
            const days = Math.floor(hours / 24);
            const remainingHours = Math.round(hours % 24);
            return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
        }
    }
}
