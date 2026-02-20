import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderAssignmentService } from '../../../core/services/order-assignment.service';
import { OrderAssignment } from '../../../core/models/order-assignment.model';
import { UserProfile } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';

@Component({
    selector: 'app-order-assignment',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './order-assignment.component.html',
    styleUrls: ['./order-assignment.component.css']
})
export class OrderAssignmentComponent implements OnInit {
    @Input() orderId!: string;
    @Input() orderCreatedAt: any;

    private assignmentService = inject(OrderAssignmentService);
    private authService = inject(AuthService);
    private toast = inject(ToastService);
    private firestore = inject(Firestore);

    // State
    currentAssignment = signal<OrderAssignment | null>(null);
    availableStaff = signal<UserProfile[]>([]);
    selectedStaffId = signal<string>('');
    isLoading = signal<boolean>(false);
    isAssigning = signal<boolean>(false);
    currentUser = signal<UserProfile | null>(null);

    async ngOnInit() {
        await this.loadCurrentUser();
        await this.loadAvailableStaff();
        await this.loadCurrentAssignment();
    }

    async loadCurrentUser() {
        // Get current user from auth service
        const user = await this.authService.getCurrentUser();
        this.currentUser.set(user);
    }

    async loadAvailableStaff() {
        try {
            // Get all users with OPERATIONS or ADMIN role
            const usersRef = collection(this.firestore, 'users');
            const q = query(
                usersRef,
                where('role', 'in', ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'])
            );

            const snapshot = await getDocs(q);
            const staff = snapshot.docs
                .map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile))
                .filter(user => user.isActive);

            this.availableStaff.set(staff);
        } catch (error) {
            console.error('Error loading staff:', error);
            this.toast.error('Failed to load staff members');
        }
    }

    async loadCurrentAssignment() {
        if (!this.orderId) return;

        this.isLoading.set(true);
        try {
            this.assignmentService.getOrderAssignment(this.orderId).subscribe({
                next: (assignment) => {
                    this.currentAssignment.set(assignment);
                    if (assignment) {
                        this.selectedStaffId.set(assignment.assignedTo);
                    }
                    this.isLoading.set(false);
                },
                error: (error) => {
                    console.error('Error loading assignment:', error);
                    this.isLoading.set(false);
                }
            });
        } catch (error) {
            console.error('Error loading assignment:', error);
            this.isLoading.set(false);
        }
    }

    async assignOrder() {
        if (!this.selectedStaffId() || !this.currentUser()) return;

        const selectedStaff = this.availableStaff().find(s => s.uid === this.selectedStaffId());
        if (!selectedStaff) return;

        this.isAssigning.set(true);
        try {
            const currentAssignment = this.currentAssignment();
            const user = this.currentUser()!;

            if (currentAssignment) {
                // Reassign
                await this.assignmentService.reassignOrder(
                    currentAssignment.id!,
                    selectedStaff.uid,
                    selectedStaff.displayName || selectedStaff.email,
                    user.uid,
                    user.displayName || user.email
                );
                this.toast.success(`Order reassigned to ${selectedStaff.displayName || selectedStaff.email}`);
            } else {
                // New assignment
                await this.assignmentService.assignOrder(
                    this.orderId,
                    selectedStaff.uid,
                    selectedStaff.displayName || selectedStaff.email,
                    user.uid,
                    user.displayName || user.email
                );
                this.toast.success(`Order assigned to ${selectedStaff.displayName || selectedStaff.email}`);
            }

            await this.loadCurrentAssignment();
        } catch (error) {
            console.error('Error assigning order:', error);
            this.toast.error('Failed to assign order');
        } finally {
            this.isAssigning.set(false);
        }
    }

    async updateStatus(status: OrderAssignment['status']) {
        const assignment = this.currentAssignment();
        if (!assignment?.id) return;

        try {
            await this.assignmentService.updateStatus(assignment.id, status);
            this.toast.success('Assignment status updated');
            await this.loadCurrentAssignment();
        } catch (error) {
            console.error('Error updating status:', error);
            this.toast.error('Failed to update status');
        }
    }

    getStatusBadgeClass(status: OrderAssignment['status']): string {
        switch (status) {
            case 'assigned':
                return 'badge-info';
            case 'in-progress':
                return 'badge-warning';
            case 'completed':
                return 'badge-success';
            default:
                return 'badge-secondary';
        }
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}
