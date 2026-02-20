import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../../core/services/order.service';
import { Order, OrderStatus } from '../../../../core/models/order.model';
import { ToastService } from '../../../../core/services/toast.service';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';

@Component({
    selector: 'app-order-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './order-detail.component.html',
    styleUrls: ['./order-detail.component.css']
})
export class OrderDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private orderService = inject(OrderService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);
    private fb = inject(FormBuilder);

    order: Order | undefined;
    isLoading = true;
    isUpdating = false;

    statusForm: FormGroup;

    availableStatuses: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

    constructor() {
        this.statusForm = this.fb.group({
            status: ['', Validators.required],
            note: [''],
            carrier: [''],
            trackingNumber: ['']
        });
    }

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.loadOrder(id);
        } else {
            this.router.navigate(['/admin/orders']);
        }
    }

    loadOrder(id: string) {
        this.isLoading = true;
        this.orderService.getOrderById(id).subscribe({
            next: (order) => {
                if (order) {
                    this.order = order;



                    this.statusForm.patchValue({
                        status: order.status,
                        carrier: order.carrier || '',
                        trackingNumber: order.trackingNumber || ''
                    });
                } else {
                    this.toast.error('Order not found');
                    this.router.navigate(['/admin/orders']);
                }
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading order:', error);
                this.toast.error('Error loading order details');
                this.isLoading = false;
            }
        });
    }

    async onUpdateStatus() {
        if (!this.order?.id || this.statusForm.invalid || this.isUpdating) return;

        const newStatus = this.statusForm.get('status')?.value;
        const note = this.statusForm.get('note')?.value;
        const carrier = this.statusForm.get('carrier')?.value;
        const trackingNumber = this.statusForm.get('trackingNumber')?.value;

        // If status is same and no tracking/note update, return
        // Ideally we should allow updating tracking even if status is same
        /*
        if (newStatus === this.order.status && !note && !carrier && !trackingNumber) {
            return;
        }
        */

        // Confirmation for critical statuses
        if (newStatus === 'cancelled' || newStatus === 'refunded') {
            const confirmed = await this.confirmDialog.confirmWarning(
                'Confirm Status Change',
                `Are you sure you want to mark this order as ${newStatus}? This action might be irreversible.`
            );
            if (!confirmed) return;
        }

        this.isUpdating = true;

        try {
            await this.orderService.updateStatus(this.order.id, newStatus, note, { carrier, trackingNumber });
            this.toast.success('Order status updated successfully');
            this.loadOrder(this.order.id);
            this.statusForm.patchValue({ note: '' }); // Reset note
        } catch (error) {
            console.error('Error updating status:', error);
            this.toast.error('Failed to update status');
        } finally {
            this.isUpdating = false;
        }
    }

    getStatusClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            'pending': 'status-pending',
            'processing': 'status-processing',
            'shipped': 'status-shipped',
            'delivered': 'status-delivered',
            'cancelled': 'status-cancelled',
            'refunded': 'status-refunded',
            'returned': 'status-returned'
        };
        return classes[status] || 'status-default';
    }

    printOrder() {
        window.print();
    }

    copyToClipboard(text: string, label: string) {
        navigator.clipboard.writeText(text).then(() => {
            this.toast.success(`${label} copied to clipboard`);
        }).catch(err => {
            console.error('Could not copy text: ', err);
            this.toast.error('Failed to copy text');
        });
    }
}
