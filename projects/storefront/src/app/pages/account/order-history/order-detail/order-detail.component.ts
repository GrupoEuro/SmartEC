import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '@lib/core';
import { Order } from '@lib/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-order-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './order-detail.component.html',
    styles: [`
        .order-detail-container { padding: 32px; max-width: 1000px; margin: 0 auto; min-height: 80vh; }
        .back-link { display: inline-flex; align-items: center; gap: 8px; color: var(--cyan); text-decoration: none; margin-bottom: 24px; font-weight: 600; padding: 8px 16px; border-radius: 20px; transition: background 0.2s; }
        .back-link:hover { background: rgba(0, 172, 216, 0.1); }

        /* Glass Card Base */
        .glass-card { background: #000; border: 1px solid var(--cyan); border-radius: 16px; padding: 24px; transition: all 0.3s ease; }
        .glass-card:hover { transform: translateY(-2px); box-shadow: 0 10px 30px -10px rgba(0, 172, 216, 0.3); }

        /* Header Info */
        .header-card { margin-bottom: 24px; }
        .header-content { display: flex; justify-content: space-between; align-items: center; }
        .header-left h1 { margin: 0 0 8px 0; font-size: 28px; font-weight: 700; color: #fff; }
        .header-left .subtitle { color: #888; margin: 0; font-size: 1.1rem; }

        /* Status Badges */
        .status-badge { padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .status-delivered, .status-paid { background: rgba(147, 213, 0, 0.15); color: #93D500; }
        .status-shipped { background: rgba(0, 172, 216, 0.15); color: #00ACD8; }
        .status-processing { background: rgba(255, 215, 0, 0.15); color: #FFD700; }
        .status-pending, .status-pending-payment { background: rgba(136, 136, 136, 0.15); color: #888; }
        .status-cancelled, .status-failed, .status-payment-failed { background: rgba(255, 68, 68, 0.15); color: #FF4444; }
        .status-refund-pending { background: rgba(255, 150, 0, 0.15); color: #ff9600; }

        /* Two Column Grid */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-bottom: 32px; }
        .card-title { font-size: 1.1rem; font-weight: 600; color: var(--cyan); margin-bottom: 16px; border-bottom: 1px solid rgba(0, 172, 216, 0.2); padding-bottom: 12px; }
        .card-content p { color: #aaa; margin: 0 0 4px 0; line-height: 1.5; }

        /* Items List */
        .items-section { margin-bottom: 32px; }
        .section-title { font-size: 1.25rem; font-weight: 600; color: #fff; margin-bottom: 16px; }
        .items-list { display: flex; flex-direction: column; gap: 16px; }
        .item-row { display: flex; align-items: center; gap: 24px; padding: 16px 24px; }
        .item-image { width: 80px; height: 80px; object-fit: contain; border-radius: 8px; background: rgba(255, 255, 255, 0.05); padding: 8px; }
        .item-details { flex: 1; }
        .item-name { font-weight: 600; font-size: 1.1rem; color: #fff; margin: 0 0 8px 0; }
        .item-meta { color: #888; font-size: 0.95rem; margin: 0 0 4px 0; }
        .price-col { text-align: right; font-weight: 700; font-size: 1.25rem; color: #fff; }

        /* Order Summary */
        .summary-section { margin-bottom: 32px; background: linear-gradient(135deg, rgba(0, 0, 0, 1), rgba(10, 10, 10, 1)); }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 12px; color: #aaa; font-size: 1.1rem; }
        .summary-row.total { font-weight: 700; font-size: 1.75rem; color: #fff; border-top: 1px solid rgba(0, 172, 216, 0.3); padding-top: 16px; margin-top: 16px; }
        .discount-label, .discount-val { color: #93D500; }

        .actions-section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; flex-wrap: wrap; gap: 12px; }
        .btn-primary { background: linear-gradient(135deg, #00ACD8, #0088cc); color: white; padding: 12px 32px; font-weight: 600; border-radius: 30px; border: none; font-size: 1.1rem; cursor: pointer; transition: all 0.3s ease; text-decoration: none; display: inline-block; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0, 172, 216, 0.4); }
        .btn-cancel { background: transparent; color: #FF4444; padding: 12px 24px; font-weight: 600; border-radius: 30px; border: 1px solid rgba(255, 68, 68, 0.4); font-size: 0.95rem; cursor: pointer; transition: all 0.3s ease; }
        .btn-cancel:hover { background: rgba(255, 68, 68, 0.08); border-color: #FF4444; }
        .btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Cancel Modal Overlay */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
        .modal-box { background: #0f0f0f; border: 1px solid rgba(255, 68, 68, 0.4); border-radius: 20px; padding: 36px; max-width: 480px; width: 100%; }
        .modal-title { font-size: 1.3rem; font-weight: 700; color: #fff; margin: 0 0 12px 0; }
        .modal-body { color: #aaa; font-size: 1rem; line-height: 1.6; margin-bottom: 28px; }
        .modal-body strong { color: #fff; }
        .modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
        .btn-ghost { background: transparent; color: #888; padding: 10px 20px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.95rem; transition: all 0.2s; }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.3); color: #fff; }
        .btn-danger { background: linear-gradient(135deg, #c00, #FF4444); color: white; padding: 10px 24px; border-radius: 20px; border: none; cursor: pointer; font-size: 0.95rem; font-weight: 600; transition: all 0.2s; }
        .btn-danger:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(255, 68, 68, 0.4); }
        .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        /* Alert banners */
        .alert-success { padding: 14px 20px; border-radius: 12px; background: rgba(147, 213, 0, 0.08); border: 1px solid rgba(147, 213, 0, 0.3); color: #93D500; margin-bottom: 20px; font-size: 0.95rem; }
        .alert-warning { padding: 14px 20px; border-radius: 12px; background: rgba(255, 150, 0, 0.08); border: 1px solid rgba(255, 150, 0, 0.3); color: #ff9600; margin-bottom: 20px; font-size: 0.95rem; }
        .alert-error { padding: 14px 20px; border-radius: 12px; background: rgba(255, 68, 68, 0.08); border: 1px solid rgba(255, 68, 68, 0.3); color: #FF4444; margin-bottom: 20px; font-size: 0.95rem; }

        .error-state { text-align: center; padding: 60px; background: rgba(255, 68, 68, 0.1); border: 1px dashed rgba(255, 68, 68, 0.4); border-radius: 16px; margin-top: 40px; }
        .error-state p { color: #ffcfcf; margin-bottom: 24px; font-size: 1.1rem; }
        .loading-state { display: flex; justify-content: center; padding: 100px 0; }

        @media (max-width: 768px) {
            .header-content { flex-direction: column; align-items: flex-start; gap: 16px; }
            .item-row { flex-direction: column; text-align: center; }
            .price-col { text-align: center; margin-top: 12px; }
            .actions-section { flex-direction: column-reverse; }
        }
    `]
})
export class OrderDetailComponent implements OnInit {
    private route      = inject(ActivatedRoute);
    private router     = inject(Router);
    private firestore  = inject(Firestore);
    private functions  = inject(Functions);
    private authService = inject(AuthService);
    private translate  = inject(TranslateService);

    order   = signal<Order | null>(null);
    loading = signal(true);
    error   = signal<string | null>(null);

    // Cancellation state
    showCancelModal  = signal(false);
    cancelling       = signal(false);
    cancelSuccess    = signal<string | null>(null);
    cancelError      = signal<string | null>(null);

    // 24-hour window: can this order still be cancelled?
    readonly CANCEL_WINDOW_HOURS = 24;

    ngOnInit() {
        const orderId = this.route.snapshot.paramMap.get('id');
        if (orderId) this.loadOrder(orderId);
        else { this.error.set('Order ID not found'); this.loading.set(false); }
    }

    async loadOrder(id: string) {
        this.loading.set(true);
        try {
            const user = this.authService.currentUser();
            if (!user) throw new Error('User not logged in');
            const docRef   = doc(this.firestore, `orders/${id}`);
            const snapshot = await getDoc(docRef);
            if (snapshot.exists()) {
                this.order.set({ id: snapshot.id, ...snapshot.data() } as Order);
            } else {
                this.error.set('Order not found.');
            }
        } catch (e: any) {
            console.error(e);
            this.error.set('Could not load order details.');
        } finally {
            this.loading.set(false);
        }
    }

    /** True if the cancel button should appear */
    get canCancel(): boolean {
        const o = this.order();
        if (!o) return false;
        // Already cancelled/refunded
        if (['cancelled', 'refunded', 'refund_pending'].includes(o.status as string)) return false;
        // Only storefront orders
        if (o.sourceChannel !== 'storefront' && (o as any).sourceChannel !== 'web') return false;
        // Within 24-hour window
        const createdAt = (o.createdAt as any)?.toDate ? (o.createdAt as any).toDate() : new Date(o.createdAt as any);
        const ageMs     = Date.now() - createdAt.getTime();
        return ageMs < this.CANCEL_WINDOW_HOURS * 60 * 60 * 1000;
    }

    /** True if this will trigger a refund request (paid orders) */
    get requiresRefundFlow(): boolean {
        const o = this.order();
        return !!(o && (o.paymentStatus === 'approved' || o.status === 'paid'));
    }

    openCancelModal()  { this.showCancelModal.set(true); this.cancelError.set(null); }
    closeCancelModal() { if (!this.cancelling()) this.showCancelModal.set(false); }

    async confirmCancel() {
        const o = this.order();
        if (!o?.id || this.cancelling()) return;

        this.cancelling.set(true);
        this.cancelError.set(null);

        try {
            const cancelFn = httpsCallable<any, { success: boolean; requiresRefund: boolean; message: string }>(
                this.functions, 'cancelOrder'
            );
            const result = await cancelFn({
                orderId:   o.id,
                sessionId: sessionStorage.getItem('sessionId') ?? undefined,
                reason:    'Cancelación solicitada por el cliente desde Mi Cuenta',
            });

            this.showCancelModal.set(false);
            this.cancelSuccess.set(result.data.message);
            // Reload order to reflect new status
            await this.loadOrder(o.id);
        } catch (e: any) {
            this.cancelError.set(e?.message ?? 'No se pudo cancelar el pedido. Inténtalo de nuevo.');
        } finally {
            this.cancelling.set(false);
        }
    }

    getStatusClass(status: string): string {
        const map: Record<string, string> = {
            delivered: 'status-delivered', paid: 'status-paid',
            shipped: 'status-shipped', processing: 'status-processing',
            pending: 'status-pending', pending_payment: 'status-pending-payment',
            cancelled: 'status-cancelled', payment_failed: 'status-payment-failed',
            refund_pending: 'status-refund-pending', refunded: 'status-delivered',
        };
        return map[status] ?? 'status-pending';
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = date?.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount ?? 0);
    }
}
