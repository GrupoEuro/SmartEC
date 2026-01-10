import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus, OrderItem } from '../../../core/models/order.model';
import { ToastService } from '../../../core/services/toast.service';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { OrderAssignmentComponent } from '../../../shared/components/order-assignment/order-assignment.component';
import { OrderNotesComponent } from '../../../shared/components/order-notes/order-notes.component';
import { OrderPriorityComponent } from '../../../shared/components/order-priority/order-priority.component';
import { PdfGenerationService } from '../../../core/services/pdf-generation.service';
import { HelpContextButtonComponent } from '../../../shared/components/help-context-button/help-context-button.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-order-fulfillment',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, OrderAssignmentComponent, OrderNotesComponent, OrderPriorityComponent, HelpContextButtonComponent, AppIconComponent],
    templateUrl: './order-fulfillment.component.html',
    styleUrls: ['./order-fulfillment.component.css']
})
export class OrderFulfillmentComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private orderService = inject(OrderService);
    private toast = inject(ToastService);
    private fb = inject(FormBuilder);
    private pdfService = inject(PdfGenerationService);

    order = signal<Order | undefined>(undefined);
    isLoading = signal(true);
    isUpdating = signal(false);
    pickedItems = signal<Set<string>>(new Set());

    statusForm: FormGroup;

    // Available status transitions based on current status
    availableStatuses = signal<OrderStatus[]>([]);

    // Enhanced status card
    showShippingForm = false;

    // Print mode
    isPrintMode = signal(false);

    constructor() {
        this.statusForm = this.fb.group({
            status: ['', Validators.required],
            trackingNumber: [''],
            carrier: [''],
            notes: ['']
        });
    }

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.loadOrder(id);
        } else {
            this.router.navigate(['/operations/orders']);
        }
    }

    loadOrder(id: string) {
        this.isLoading.set(true);
        this.orderService.getOrderById(id).subscribe({
            next: (order) => {
                if (order) {
                    this.order.set(order);
                    this.statusForm.patchValue({
                        status: order.status,
                        trackingNumber: order.trackingNumber || '',
                        carrier: order.carrier || ''
                    });
                    this.updateAvailableStatuses(order.status);

                    // Internal notes are handled by OrderNotesComponent
                    // which uses OrderNotesService to persist to Firestore
                } else {
                    this.toast.error('Order not found');
                    this.router.navigate(['/operations/orders']);
                }
                this.isLoading.set(false);
            },
            error: () => {
                this.toast.error('Error loading order details');
                this.isLoading.set(false);
            }
        });
    }

    updateAvailableStatuses(currentStatus: OrderStatus) {
        // Define allowed status transitions
        const transitions: Record<OrderStatus, OrderStatus[]> = {
            'pending': ['processing', 'cancelled'],
            'processing': ['shipped', 'cancelled'],
            'shipped': ['delivered'],
            'delivered': [],
            'cancelled': [],
            'refunded': [],
            'returned': []
        };

        this.availableStatuses.set(transitions[currentStatus] || []);
    }

    // Item picking
    toggleItemPicked(productId: string) {
        const picked = new Set(this.pickedItems());
        if (picked.has(productId)) {
            picked.delete(productId);
        } else {
            picked.add(productId);
        }
        this.pickedItems.set(picked);
    }

    isItemPicked(productId: string): boolean {
        return this.pickedItems().has(productId);
    }

    allItemsPicked(): boolean {
        const order = this.order();
        if (!order) return false;
        return order.items.every(item => this.pickedItems().has(item.productId));
    }

    // Status update
    async updateStatus() {
        const order = this.order();
        if (!order || !order.id || this.statusForm.invalid) return;

        const newStatus = this.statusForm.value.status;
        const trackingNumber = this.statusForm.value.trackingNumber;
        const carrier = this.statusForm.value.carrier;
        const notes = this.statusForm.value.notes;

        // Validation for shipped status
        if (newStatus === 'shipped' && (!trackingNumber || !carrier)) {
            this.toast.error('Tracking number and carrier are required for shipped status');
            return;
        }

        this.isUpdating.set(true);

        try {
            await this.orderService.updateStatus(
                order.id,
                newStatus,
                notes,
                { carrier, trackingNumber }
            );

            this.toast.success('Order status updated successfully');
            this.statusForm.patchValue({ notes: '' }); // Clear notes field
            this.showShippingForm = false; // Hide shipping form
            this.loadOrder(order.id); // Reload to get updated data
        } catch (error) {
            this.toast.error('Error updating order status');
        } finally {
            this.isUpdating.set(false);
        }
    }

    // Quick status update (for action buttons)
    async quickUpdateStatus(newStatus: OrderStatus) {
        const order = this.order();
        if (!order || !order.id) return;

        // For shipped status, show the form instead
        if (newStatus === 'shipped') {
            this.showShippingForm = true;
            this.statusForm.patchValue({ status: 'shipped' });
            return;
        }

        this.isUpdating.set(true);

        try {
            await this.orderService.updateStatus(
                order.id,
                newStatus,
                this.statusForm.value.notes || ''
            );

            this.toast.success(`Order status updated to ${newStatus}`);
            this.statusForm.patchValue({ notes: '' });
            this.loadOrder(order.id);
        } catch (error) {
            this.toast.error('Error updating order status');
        } finally {
            this.isUpdating.set(false);
        }
    }

    // Check if a status has been completed (for progress timeline)
    isStatusCompleted(status: OrderStatus): boolean {
        const order = this.order();
        if (!order) return false;

        const statusOrder: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered'];
        const currentIndex = statusOrder.indexOf(order.status);
        const checkIndex = statusOrder.indexOf(status);

        return checkIndex < currentIndex;
    }




    // Print functionality
    printPackingSlip() {
        const order = this.order();
        if (!order) {
            this.toast.error('Order not found');
            return;
        }

        try {
            const pdf = this.pdfService.generatePackingSlip(order);
            this.pdfService.printPdf(pdf);
            this.toast.success('Packing slip sent to printer');
        } catch (error) {
            this.toast.error('Failed to generate packing slip');
        }
    }

    printInvoice() {
        const order = this.order();
        if (!order) {
            this.toast.error('Order not found');
            return;
        }

        try {
            const pdf = this.pdfService.generateInvoice(order);
            this.pdfService.printPdf(pdf);
            this.toast.success('Invoice sent to printer');
        } catch (error) {
            this.toast.error('Failed to generate invoice');
        }
    }

    // Navigation
    goBack() {
        this.router.navigate(['/operations/orders']);
    }

    // Utilities
    getStatusBadgeClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            'pending': 'status-pending',
            'processing': 'status-processing',
            'shipped': 'status-shipped',
            'delivered': 'status-delivered',
            'cancelled': 'status-cancelled',
            'refunded': 'status-refunded',
            'returned': 'bg-red-900/30 text-red-400 border-red-800/50'
        };
        return classes[status] || '';
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatShortDate(date: any): string {
        if (!date) return '';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    getProgressPercentage(): number {
        const order = this.order();
        if (!order || order.items.length === 0) return 0;
        return Math.round((this.pickedItems().size / order.items.length) * 100);
    }

    getChannelBadgeConfig(channel: string): { label: string, icon: string, class: string } {
        const configs: Record<string, { label: string, icon: string, class: string }> = {
            'WEB': { label: 'WEB', icon: 'globe', class: 'channel-web' },
            'POS': { label: 'POS', icon: 'credit-card', class: 'channel-pos' },
            'ON_BEHALF': { label: 'PHONE', icon: 'phone', class: 'channel-on-behalf' },
            'AMAZON_MFN': { label: 'AMZ', icon: 'package', class: 'channel-amazon' },
            'MELI_CLASSIC': { label: 'ML', icon: 'shopping-bag', class: 'channel-meli' },
            'AMAZON_FBA': { label: 'FBA', icon: 'box', class: 'channel-amazon' },
            'MELI_FULL': { label: 'FULL', icon: 'box', class: 'channel-meli' }
        };
        return configs[channel] || { label: channel, icon: 'help-circle', class: 'channel-web' };
    }

    getFulfillmentLocation(): string {
        const order = this.order();
        if (!order) return 'MAIN';

        // Determine fulfillment location based on channel
        if (order.channel === 'AMAZON_FBA') return 'AMAZON_FBA';
        if (order.channel === 'MELI_FULL') return 'MELI_FULL';
        return 'MAIN';
    }

    // Get company info for print
    getCompanyInfo() {
        return {
            name: 'Importadora Euro',
            address: 'Av. Salvador Nava No.704-1, Col. Nuevo Paseo',
            city: 'San Luis Potosí, S.L.P',
            phone: 'Tel: (444) 123-4567',
            email: 'contacto@importadoraeuro.com'
        };
    }
}
