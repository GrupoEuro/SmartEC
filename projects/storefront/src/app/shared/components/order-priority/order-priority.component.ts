import { Component, Input, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderPriorityService } from '../../../core/services/order-priority.service';
import { OrderPriority, PriorityLevel } from '../../../core/models/order-priority.model';
import { ToastService } from '../../../core/services/toast.service';
import { Timestamp } from '@angular/fire/firestore';

@Component({
    selector: 'app-order-priority',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './order-priority.component.html',
    styleUrls: ['./order-priority.component.css']
})
export class OrderPriorityComponent implements OnInit, OnDestroy {
    @Input() orderId!: string;
    @Input() orderCreatedAt: any;

    private priorityService = inject(OrderPriorityService);
    private toast = inject(ToastService);

    // State
    priority = signal<OrderPriority | null>(null);
    isLoading = signal<boolean>(false);
    isUpdating = signal<boolean>(false);
    selectedPriority = signal<PriorityLevel>('standard');
    showPriorityForm = signal<boolean>(false);

    // Countdown
    timeRemaining = signal<string>('');
    private countdownInterval: any;

    async ngOnInit() {
        await this.loadPriority();
        this.startCountdown();
    }

    ngOnDestroy() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
    }

    async loadPriority() {
        if (!this.orderId) return;

        this.isLoading.set(true);
        try {
            this.priorityService.getOrderPriority(this.orderId).subscribe({
                next: (priority) => {
                    this.priority.set(priority);
                    if (priority) {
                        this.selectedPriority.set(priority.level);
                    }
                    this.isLoading.set(false);
                },
                error: (error) => {
                    console.error('Error loading priority:', error);
                    this.isLoading.set(false);
                }
            });
        } catch (error) {
            console.error('Error loading priority:', error);
            this.isLoading.set(false);
        }
    }

    async setPriority() {
        if (!this.orderCreatedAt) return;

        this.isUpdating.set(true);
        try {
            const createdAt = this.orderCreatedAt instanceof Timestamp
                ? this.orderCreatedAt
                : Timestamp.fromDate(new Date(this.orderCreatedAt));

            const currentPriority = this.priority();
            if (currentPriority) {
                await this.priorityService.updatePriorityLevel(
                    this.orderId,
                    this.selectedPriority(),
                    createdAt
                );
                this.toast.success('Priority updated successfully');
            } else {
                await this.priorityService.setPriority(
                    this.orderId,
                    this.selectedPriority(),
                    createdAt
                );
                this.toast.success('Priority set successfully');
            }

            this.showPriorityForm.set(false);
            await this.loadPriority();
        } catch (error) {
            console.error('Error setting priority:', error);
            this.toast.error('Failed to set priority');
        } finally {
            this.isUpdating.set(false);
        }
    }

    togglePriorityForm() {
        this.showPriorityForm.set(!this.showPriorityForm());
    }

    startCountdown() {
        this.updateCountdown();
        this.countdownInterval = setInterval(() => {
            this.updateCountdown();
        }, 60000); // Update every minute
    }

    updateCountdown() {
        const p = this.priority();
        if (!p?.sla) {
            this.timeRemaining.set('');
            return;
        }

        const now = Date.now();
        const slaTime = p.sla instanceof Timestamp ? p.sla.toMillis() : new Date(p.sla).getTime();
        const diff = slaTime - now;

        if (diff <= 0) {
            this.timeRemaining.set('OVERDUE');
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            this.timeRemaining.set(`${days}d ${hours % 24}h`);
        } else if (hours > 0) {
            this.timeRemaining.set(`${hours}h ${minutes}m`);
        } else {
            this.timeRemaining.set(`${minutes}m`);
        }
    }

    getPriorityBadgeClass(level: PriorityLevel): string {
        switch (level) {
            case 'standard':
                return 'priority-standard';
            case 'express':
                return 'priority-express';
            case 'rush':
                return 'priority-rush';
            default:
                return 'priority-standard';
        }
    }

    getSLAStatusClass(): string {
        const p = this.priority();
        if (!p) return '';

        if (p.isOverdue) return 'sla-overdue';

        const now = Date.now();
        const slaTime = p.sla instanceof Timestamp ? p.sla.toMillis() : new Date(p.sla).getTime();
        const diff = slaTime - now;
        const hoursRemaining = diff / (1000 * 60 * 60);

        if (hoursRemaining <= 6) return 'sla-warning';
        return 'sla-ok';
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = date instanceof Timestamp ? date.toDate() : new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    getPriorityLabel(level: PriorityLevel): string {
        switch (level) {
            case 'standard':
                return 'Standard (72h)';
            case 'express':
                return 'Express (48h)';
            case 'rush':
                return 'Rush (24h)';
            default:
                return level;
        }
    }
}
