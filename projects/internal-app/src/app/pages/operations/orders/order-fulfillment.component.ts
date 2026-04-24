import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus, OrderItem, OrderActor } from '../../../core/models/order.model';
import { ToastService } from '../../../core/services/toast.service';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { OrderAssignmentComponent } from '../../../shared/components/order-assignment/order-assignment.component';
import { OrderNotesComponent } from '../../../shared/components/order-notes/order-notes.component';
import { OrderPriorityComponent } from '../../../shared/components/order-priority/order-priority.component';
import { PdfGenerationService } from '../../../core/services/pdf-generation.service';
import { HelpContextButtonComponent } from '../../../shared/components/help-context-button/help-context-button.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { SkydropxService, ShippingRate, TrackingResult } from '../../../core/services/skydropx.service';
import { MeliSyncService } from '../../../core/services/meli-sync.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
    selector: 'app-order-fulfillment',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, TranslateModule, AdminPageHeaderComponent, OrderAssignmentComponent, OrderNotesComponent, OrderPriorityComponent, HelpContextButtonComponent, AppIconComponent],
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
    private skydropx = inject(SkydropxService);
    meliSync = inject(MeliSyncService);
    private authService = inject(AuthService);

    order = signal<Order | undefined>(undefined);
    isLoading = signal(true);
    isUpdating = signal(false);
    pickedItems = signal<Set<string>>(new Set());

    /** Refund action states */
    isApprovingRefund = signal(false);
    isRejectingRefund = signal(false);

    /** Staff cancel flow */
    showStaffCancelModal = signal(false);
    staffCancelReason = signal('');
    isCancellingOrder = signal(false);

    /** MeLi Classic workflow action states */
    isAcknowledging = signal(false);
    isDownloadingLabel = signal(false);
    isConfirmingDropOff = signal(false);

    // ── Channel-aware workflow signals ───────────────────────────────────────

    /** Which guided workflow layout to render */
    workflowMode = computed<'meli_full' | 'meli_classic' | 'web'>(() => {
        const o = this.order();
        if (!o) return 'web';
        if (o.sourceChannel === 'mercadolibre' && o.fulfillmentType === 'platform') return 'meli_full';
        if (o.sourceChannel === 'mercadolibre') return 'meli_classic';
        return 'web';
    });

    /** Returns milliseconds until nativeSla deadline (negative = past) */
    slaTimeMs = computed<number>(() => {
        const o = this.order() as any;
        if (!o?.nativeSla) return Infinity;
        const slaDate = o.nativeSla instanceof Date ? o.nativeSla : (o.nativeSla?.toDate?.() ?? new Date(o.nativeSla));
        return slaDate.getTime() - Date.now();
    });

    /** Color-coded urgency level for SLA banner */
    slaUrgency = computed<'ok' | 'warning' | 'critical' | 'overdue'>(() => {
        const ms = this.slaTimeMs();
        if (ms === Infinity) return 'ok';
        if (ms < 0)                       return 'overdue';
        if (ms < 2 * 60 * 60 * 1000)     return 'critical';  // < 2h
        if (ms < 6 * 60 * 60 * 1000)     return 'warning';   // < 6h
        return 'ok';
    });

    /** Human-readable countdown string */
    slaLabel = computed<string>(() => {
        const ms = this.slaTimeMs();
        if (ms === Infinity) return 'Sin fecha límite';
        if (ms < 0) return 'FUERA DE TIEMPO';
        const h = Math.floor(ms / (1000 * 60 * 60));
        const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h restantes`;
        if (h > 0)  return `${h}h ${m}m restantes`;
        return `${m}m restantes`;
    });

    /** SLA deadline formatted date string */
    slaDeadlineFormatted = computed<string>(() => {
        const o = this.order() as any;
        if (!o?.nativeSla) return '';
        const d = o.nativeSla instanceof Date ? o.nativeSla : (o.nativeSla?.toDate?.() ?? new Date(o.nativeSla));
        return d.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    });

    /** Whether staff has taken ownership of this MeLi Classic order */
    isAcknowledged = computed(() => !!(this.order() as any)?.acknowledgedAt);

    /** Whether the MeLi label has been downloaded */
    isLabelDownloaded = computed(() => !!(this.order() as any)?.labelDownloadedAt);

    /**
     * MeLi Classic 4-step progress:
     * 1 = Not acknowledged  2 = Acknowledged (ready to print)  3 = Label downloaded  4 = Shipped
     */
    meliStep = computed<1 | 2 | 3 | 4>(() => {
        const o = this.order();
        if (!o) return 1;
        if (o.status === 'shipped' || o.status === 'delivered') return 4;
        if ((o as any).labelDownloadedAt) return 3;
        if ((o as any).acknowledgedAt) return 2;
        return 1;
    });

    /** Whether all picking checkboxes are checked (Web orders) */
    pickingComplete = computed(() => {
        const o = this.order();
        if (!o) return false;
        return o.items.every(item => this.pickedItems().has(item.productId));
    });

    /**
     * Web order step 1-5 progress:
     * 1=Pago  2=Picking  3=Guía  4=Envío  5=Entrega
     */
    webStep = computed<1 | 2 | 3 | 4 | 5>(() => {
        const o = this.order();
        if (!o) return 1;
        if (o.status === 'delivered') return 5;
        if (o.status === 'shipped') return 4;
        if (o.shippingLabelUrl || o.trackingNumber) return 3;
        return 2;
    });

    statusForm: FormGroup;

    // Available status transitions based on current status
    availableStatuses = signal<OrderStatus[]>([]);

    // Enhanced status card
    showShippingForm = false;

    // Print mode
    isPrintMode = signal(false);

    // ── SkyDropX Shipping Panel ────────────────────────────────────────────────
    showShippingPanel = signal(false);
    isLoadingRates = signal(false);
    isGeneratingLabel = signal(false);
    isLoadingTracking = signal(false);
    rates = signal<ShippingRate[]>([]);
    selectedRateId = signal<string | null>(null);
    quotationId = signal<string | null>(null);
    trackingResult = signal<TrackingResult | null>(null);

    // Parcel dimensions (defaults for a typical tire)
    parcelWeight = 5;
    parcelHeight = 30;
    parcelWidth = 30;
    parcelLength = 20;

    /** Resolved actor for the current staff member — passed to every updateStatus call */
    get currentActor(): OrderActor {
        const user = this.authService.currentUser();
        return {
            uid:         user?.uid         ?? 'unknown',
            displayName: user?.displayName ?? user?.email ?? 'Staff',
            role:        'OPERATIONS',
        };
    }

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
            'pending':         ['processing', 'cancelled'],
            'processing':      ['shipped', 'cancelled'],
            'shipped':         ['delivered'],
            'delivered':       [],
            'cancelled':       [],
            'refunded':        [],
            'returned':        [],
            // Web checkout statuses — managed by Cloud Functions, not manual fulfillment
            'pending_payment': [],
            'paid':            ['processing', 'cancelled'],
            'payment_failed':  [],
            'refund_pending':  [],
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
                { carrier, trackingNumber },
                this.currentActor
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

        // For cancel on a paid web order → open the staff cancel modal (triggers refund flow)
        if (newStatus === 'cancelled') {
            const isPaid = ['approved', 'paid'].includes((order as any).paymentStatus ?? '');
            const isWebOrder = (order as any).sourceChannel === 'storefront';
            if (isPaid && isWebOrder) {
                this.showStaffCancelModal.set(true);
                return;
            }
        }


        this.isUpdating.set(true);

        try {
            await this.orderService.updateStatus(
                order.id,
                newStatus,
                this.statusForm.value.notes || '',
                undefined,
                this.currentActor
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

    /** Staff cancel a paid web order — sets refund_pending for manual MP refund review */
    async confirmStaffCancel() {
        const order = this.order();
        if (!order?.id) return;
        this.isCancellingOrder.set(true);
        try {
            await this.orderService.updateStatus(
                order.id,
                'refund_pending',
                `Staff cancel — Motivo: ${this.staffCancelReason() || 'No especificado'}`,
                undefined,
                { ...this.currentActor, role: 'OPERATIONS' }
            );
            // Also stamp cancelledBy + cancelReason on the order doc
            const { getFirestore, doc, updateDoc, serverTimestamp } = await import('@angular/fire/firestore');
            const db = getFirestore();
            await updateDoc(doc(db, 'orders', order.id), {
                cancelledBy: 'staff',
                cancelledByUid: this.currentActor.uid,
                cancelReason: this.staffCancelReason() || 'No especificado',
                cancelledAt: serverTimestamp(),
            });
            this.toast.success('Orden marcada para reembolso. Página de aprobación lista.');
            this.showStaffCancelModal.set(false);
            this.staffCancelReason.set('');
            this.loadOrder(order.id);
        } catch (err: any) {
            this.toast.error(err?.message ?? 'Error al cancelar la orden');
        } finally {
            this.isCancellingOrder.set(false);
        }
    }

    // ── Refund Approval Actions ───────────────────────────────────────────────

    /** Staff approves the refund — calls the refundOrder Cloud Function */
    async approveRefund() {
        const order = this.order();
        if (!order?.id || !order.paymentId) {
            this.toast.error('No se puede procesar el reembolso: falta el ID de pago.');
            return;
        }
        this.isApprovingRefund.set(true);
        try {
            const { getFunctions, httpsCallable } = await import('@angular/fire/functions');
            const functions = getFunctions();
            const refundOrder = httpsCallable(functions, 'refundOrder');
            await refundOrder({ orderId: order.id, reason: 'Reembolso aprobado por staff' });
            this.toast.success('✅ Reembolso procesado correctamente');
            this.loadOrder(order.id);
        } catch (err: any) {
            console.error('Refund error:', err);
            this.toast.error(err?.message ?? 'Error al procesar el reembolso');
        } finally {
            this.isApprovingRefund.set(false);
        }
    }

    /** Staff rejects the refund — reverts order to paid */
    async rejectRefund() {
        const order = this.order();
        if (!order?.id) return;
        this.isRejectingRefund.set(true);
        try {
            await this.orderService.updateStatus(
                order.id,
                'paid',
                'Reembolso rechazado por staff — orden restaurada a pagado',
                undefined,
                { ...this.currentActor, role: 'OPERATIONS' }
            );
            this.toast.success('Reembolso rechazado. La orden vuelve a estado Pagado.');
            this.loadOrder(order.id);
        } catch (err) {
            this.toast.error('Error al rechazar el reembolso');
        } finally {
            this.isRejectingRefund.set(false);
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

    // Get the timestamp for a specific status from history
    getStatusDate(status: OrderStatus): Date | null {
        const order = this.order();
        if (!order || !order.history) return null;

        const entry = order.history.find(h => h.status === status);
        if (!entry || !entry.timestamp) return null;

        return entry.timestamp instanceof Date ? entry.timestamp : (entry.timestamp as any).toDate?.() || new Date(entry.timestamp as any);
    }




    // Print functionality
    printPackingSlip() {
        const order = this.order();
        if (!order) {
            this.toast.error('Order not found');
            return;
        }

        // MeLi Classic: use the official MercadoLibre shipping label
        if (order.sourceChannel === 'mercadolibre' && order.fulfillmentType === 'merchant') {
            this.getMeliLabel();
            return;
        }

        // All other channels: generate our own packing slip PDF
        try {
            const pdf = this.pdfService.generatePackingSlip(order);
            this.pdfService.printPdf(pdf);
            this.toast.success('Packing slip sent to printer');
        } catch (error) {
            console.error('Packing slip error:', error);
            this.toast.error('Failed to generate packing slip');
        }
    }

    getMeliLabel() {
        const order = this.order();
        const shippingId = (order as any)?.shippingId;
        if (!shippingId) {
            this.toast.error('No MercadoLibre shipping ID found for this order');
            return;
        }

        this.toast.success('Fetching MercadoLibre label...');
        this.meliSync.getShippingLabel(shippingId).subscribe({
            next: (result) => {
                const byteCharacters = atob(result.pdfBase64);
                const byteNumbers = Array.from(byteCharacters, c => c.charCodeAt(0));
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
            },
            error: (err) => {
                console.error('MeLi label error:', err);
                this.toast.error('Failed to fetch MercadoLibre label');
            }
        });
    }

    /** True when this is a MeLi Classic (merchant-fulfilled) order */
    isMeliClassic(): boolean {
        const o = this.order();
        return o?.sourceChannel === 'mercadolibre' && o?.fulfillmentType !== 'platform';
    }

    /** True when this is a MeLi Full (platform-fulfilled) order */
    isMeliFull(): boolean {
        const o = this.order();
        return o?.sourceChannel === 'mercadolibre' && o?.fulfillmentType === 'platform';
    }

    /** External MercadoLibre order URL */
    getMeliOrderUrl(): string {
        const o = this.order();
        return o?.externalOrderId ? `https://www.mercadolibre.com.mx/ventas/${o.externalOrderId}/detalle` : '';
    }

    /** MeLi tracking URL using shippingId */
    getMeliTrackingUrl(): string {
        const o = this.order();
        return o?.shippingId ? `https://www.mercadolibre.com.mx/envios/${o.shippingId}` : '';
    }

    // ── MeLi Classic Workflow Actions ─────────────────────────────────────────

    /** Step 1 — Staff takes ownership of this order (internal stamp, no MeLi API call) */
    async acknowledgeOrder() {
        const order = this.order();
        if (!order?.id) return;
        this.isAcknowledging.set(true);
        try {
            await this.meliSync.acknowledgeOrder(order.id, this.currentActor.displayName);
            this.toast.success('✅ Orden tomada — puedes descargar la guía ahora');
            this.loadOrder(order.id);
        } catch (err: any) {
            this.toast.error(err?.message ?? 'Error al confirmar la orden');
        } finally {
            this.isAcknowledging.set(false);
        }
    }

    /** Step 2 — Download MeLi shipping label PDF, then stamp labelDownloadedAt */
    async downloadMeliLabel() {
        const order = this.order();
        if (!order?.shippingId) {
            this.toast.error('No hay ID de envío disponible aún. Sincroniza la orden.');
            return;
        }
        this.isDownloadingLabel.set(true);
        this.meliSync.getShippingLabel(order.shippingId).subscribe({
            next: async (result) => {
                // Open PDF in new tab
                const bytes = atob(result.pdfBase64);
                const arr = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
                const blob = new Blob([arr], { type: 'application/pdf' });
                window.open(URL.createObjectURL(blob), '_blank');
                // Stamp download timestamp
                try {
                    await this.meliSync.stampLabelDownloaded(order.id!, this.currentActor.uid);
                    this.toast.success('📄 Guía descargada — imprime y pega en el paquete');
                    this.loadOrder(order.id!);
                } catch { /* stamp failure is non-critical */ }
            },
            error: (err) => {
                console.error('MeLi label error:', err);
                this.toast.error('Error al descargar la guía de MercadoLibre');
            },
            complete: () => this.isDownloadingLabel.set(false),
        });
    }

    /** Step 4 — Staff confirms physical drop-off at MeLi carrier point */
    async confirmMeliDropOff() {
        const order = this.order();
        if (!order?.id) return;
        this.isConfirmingDropOff.set(true);
        try {
            await this.orderService.updateStatus(
                order.id,
                'shipped',
                'Entregado al punto de recolecta MercadoLibre',
                undefined,
                this.currentActor
            );
            // Stamp dropOffAt
            const { getFirestore, doc, updateDoc, serverTimestamp } = await import('@angular/fire/firestore');
            await updateDoc(doc(getFirestore(), 'orders', order.id), { dropOffAt: serverTimestamp() });
            this.toast.success('✅ Orden entregada al transportista — MeLi actualizará el seguimiento');
            this.loadOrder(order.id);
        } catch (err: any) {
            this.toast.error(err?.message ?? 'Error al confirmar entrega');
        } finally {
            this.isConfirmingDropOff.set(false);
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

    // ── SkyDropX Methods ──────────────────────────────────────────────────────

    getRates() {
        const order = this.order();
        if (!order?.id) return;

        // Extract destination zip from the order's shipping address
        const zipTo: string | undefined = (order as any).shippingAddress?.zipCode;
        if (!zipTo) {
            this.toast.error('This order has no shipping address zip code. Cannot fetch rates.');
            return;
        }

        this.isLoadingRates.set(true);
        this.rates.set([]);
        this.selectedRateId.set(null);

        this.skydropx.getRates({
            zipTo,
            parcel: {
                weight: this.parcelWeight,
                height: this.parcelHeight,
                width: this.parcelWidth,
                length: this.parcelLength,
            }
        }).subscribe({
            next: (result) => {
                this.quotationId.set(result.quotationId);
                this.rates.set(result.rates);
                if (result.rates.length === 0) {
                    this.toast.error('No rates available for this destination. Check the shipping address.');
                } else {
                    this.selectedRateId.set(result.rates[0].rateId); // pre-select cheapest
                    this.toast.success(`${result.rates.length} shipping rates found`);
                }
                this.isLoadingRates.set(false);
            },
            error: (err) => {
                console.error('SkyDropX rates error', err);
                this.toast.error('Could not fetch rates. Check that the SkyDropX API key is configured.');
                this.isLoadingRates.set(false);
            }
        });
    }

    generateLabel() {
        const order = this.order();
        const rateId = this.selectedRateId();
        if (!order?.id || !rateId) return;

        this.isGeneratingLabel.set(true);

        this.skydropx.createLabel(order.id, rateId).subscribe({
            next: (result) => {
                this.toast.success(`Guía generada ✓ — Tracking: ${result.trackingNumber}`);
                this.isGeneratingLabel.set(false);
                this.showShippingPanel.set(false);
                this.loadOrder(order.id!); // reload to show updated status + tracking
            },
            error: (err) => {
                console.error('SkyDropX label error', err);
                this.toast.error('Label generation failed. See console for details.');
                this.isGeneratingLabel.set(false);
            }
        });
    }

    viewLiveTracking() {
        const order = this.order();
        if (!order?.trackingNumber) return;

        this.isLoadingTracking.set(true);
        this.skydropx.getTracking(order.trackingNumber).subscribe({
            next: (result) => {
                this.trackingResult.set(result);
                this.isLoadingTracking.set(false);
            },
            error: () => {
                this.toast.error('Could not load tracking information.');
                this.isLoadingTracking.set(false);
            }
        });
    }

    getCarrierColor(carrier: string): string {
        return this.skydropx.getCarrierColor(carrier);
    }

    // Utilities
    getStatusBadgeClass(status: OrderStatus): string {
        const classes: Record<OrderStatus, string> = {
            'pending':         'status-pending',
            'processing':      'status-processing',
            'shipped':         'status-shipped',
            'delivered':       'status-delivered',
            'cancelled':       'status-cancelled',
            'refunded':        'status-refunded',
            'returned':        'bg-red-900/30 text-red-400 border-red-800/50',
            // Web checkout statuses
            'pending_payment': 'status-pending',
            'paid':            'status-delivered',
            'payment_failed':  'status-cancelled',
            'refund_pending':  'status-returned',
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
        if (order.sourceChannel === 'amazon' && order.fulfillmentType === 'platform') return 'AMAZON_FBA';
        if (order.sourceChannel === 'mercadolibre' && order.fulfillmentType === 'platform') return 'MELI_FULL';
        return 'MAIN';
    }

    getLegacyChannel(order: Order): string {
        if (!order.sourceChannel) return 'WEB';
        if (order.sourceChannel === 'storefront') return 'WEB';
        if (order.sourceChannel === 'pos') return 'POS';
        if (order.sourceChannel === 'on_behalf') return 'ON_BEHALF';
        if (order.sourceChannel === 'amazon') return order.fulfillmentType === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (order.sourceChannel === 'mercadolibre') return order.fulfillmentType === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
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
