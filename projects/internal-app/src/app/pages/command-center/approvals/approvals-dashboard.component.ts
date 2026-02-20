import { Component, OnInit, inject, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { ApprovalWorkflowService } from '../../../core/services/approval-workflow.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApprovalRequest, ApprovalStatus, ApprovalRequestType, ApprovalPriority } from '../../../core/models/approval-request.model';
import { ApprovalCardComponent } from '../../../shared/components/approval-card/approval-card.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { take, finalize, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
    selector: 'app-approvals-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        TranslateModule,
        FormsModule,
        ApprovalCardComponent,
        AppIconComponent
    ],
    templateUrl: './approvals-dashboard.component.html',
    styleUrls: ['./approvals-dashboard.component.css']
})
export class ApprovalsDashboardComponent implements OnInit, OnDestroy {
    private approvalService = inject(ApprovalWorkflowService);
    private toast = inject(ToastService);
    private router = inject(Router);
    private contextService = inject(CommandCenterContextService);
    private destroy$ = new Subject<void>();

    allRequests = signal<ApprovalRequest[]>([]);
    filteredRequests = signal<ApprovalRequest[]>([]);
    isLoading = signal(true);

    // Filters
    selectedStatus: ApprovalStatus | 'ALL' = 'PENDING';
    selectedType: ApprovalRequestType | 'ALL' = 'ALL';
    selectedPriority: ApprovalPriority | 'ALL' = 'ALL';
    searchTerm = '';

    // Stats
    pendingCount = signal(0);
    approvedCount = signal(0);
    rejectedCount = signal(0);

    constructor() {
        // React to Global Date Range
        effect(() => {
            const range = this.contextService.dateRange();
            // Only reload if NOT in 'PENDING' mode (which ignores dates usually) or if we want to enforce dates everywhere.
            // For now, let's keep 'PENDING' as always-current, but history specific.
            if (range && this.selectedStatus !== 'PENDING') {
                this.loadRequests();
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit() {
        this.loadRequests();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    loadRequests() {
        this.isLoading.set(true);

        const range = this.contextService.dateRange();

        // Logical decision: 
        // If status is PENDING, we usually want ALL pending regardless of date (unless the user specifically wants older pending).
        // If status is APPROVED/REJECTED, we definitely want date filtering.

        let request$;

        if (this.selectedStatus === 'PENDING') {
            request$ = this.approvalService.getPendingRequests();
        } else if (this.selectedStatus === 'ALL') {
            // For ALL, if we have a date range, use it. Otherwise getting ALL history is dangerous.
            if (range) {
                request$ = this.approvalService.getRequestsByDateRange(range.start, range.end);
            } else {
                // Fallback to purely pending if no range (safety)
                request$ = this.approvalService.getPendingRequests();
            }
        } else {
            // Specific status (APPROVED/REJECTED)
            // Ideally we need getRequestsByStatusAndDate. 
            // For now, let's use getRequestsByStatus but warn. 
            // Actually, getRequestsByDateRange gets everything, we can filter client side.
            if (range) {
                request$ = this.approvalService.getRequestsByDateRange(range.start, range.end);
            } else {
                request$ = this.approvalService.getRequestsByStatus(this.selectedStatus);
            }
        }

        request$.pipe(
            take(1),
            finalize(() => this.isLoading.set(false))
        ).subscribe({
            next: (requests: ApprovalRequest[]) => {
                // If we fetched by date range, we might need to filter by status properly if it wasn't 'ALL'
                let data = requests;
                if (range && this.selectedStatus !== 'ALL' && this.selectedStatus !== 'PENDING') {
                    data = requests.filter(r => r.status === this.selectedStatus);
                }

                this.allRequests.set(data);
                this.calculateStats(data); // Note: stats might look weird if we only fetched filtered data
                this.applyFilters();
            },
            error: (err: any) => {
                console.error('Error loading approval requests:', err);
                this.toast.error('Error loading approval requests');
            }
        });
    }

    // loadByStatus is redundant if we use the effect/loadRequests logic, but keeping for UI compatibility
    loadByStatus(status: ApprovalStatus | 'ALL') {
        this.selectedStatus = status;
        this.loadRequests();
    }

    calculateStats(requests: ApprovalRequest[]) {
        // If we are filtering by date, these stats are only for that period.
        this.pendingCount.set(requests.filter(r => r.status === 'PENDING').length);
        this.approvedCount.set(requests.filter(r => r.status === 'APPROVED').length);
        this.rejectedCount.set(requests.filter(r => r.status === 'REJECTED').length);
    }

    applyFilters() {
        let filtered = [...this.allRequests()];

        // Filter by type
        if (this.selectedType !== 'ALL') {
            filtered = filtered.filter(r => r.type === this.selectedType);
        }

        // Filter by priority
        if (this.selectedPriority !== 'ALL') {
            filtered = filtered.filter(r => r.priority === this.selectedPriority);
        }

        // Filter by search term
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter(r =>
                r.requestedBy.name.toLowerCase().includes(term) ||
                r.requestedBy.email.toLowerCase().includes(term) ||
                JSON.stringify(r.data).toLowerCase().includes(term)
            );
        }

        this.filteredRequests.set(filtered);
    }

    onFilterChange() {
        this.applyFilters();
    }

    async handleApprove(requestId: string) {
        const confirmed = confirm('¿Aprobar esta solicitud?');
        if (!confirmed) return;

        try {
            await this.approvalService.approveRequest(requestId);
            this.toast.success('Solicitud aprobada exitosamente');
            this.loadRequests(); // Reload to update list
        } catch (error) {
            console.error('Error approving request:', error);
            this.toast.error('Error al aprobar la solicitud');
        }
    }

    async handleReject(requestId: string) {
        const reason = prompt('Razón del rechazo:');
        if (!reason) return;

        try {
            await this.approvalService.rejectRequest(requestId, reason);
            this.toast.success('Solicitud rechazada');
            this.loadRequests(); // Reload
        } catch (error) {
            console.error('Error rejecting request:', error);
            this.toast.error('Error al rechazar la solicitud');
        }
    }

    handleViewDetails(requestId: string) {
        this.router.navigate(['/command-center/approvals', requestId]);
    }

    refreshData() {
        this.loadRequests();
    }
}
