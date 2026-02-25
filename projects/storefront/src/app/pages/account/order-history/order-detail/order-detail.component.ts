import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { AuthService } from '@lib/core';
import { Order } from '@lib/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-order-detail',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatProgressSpinnerModule,
        TranslateModule
    ],
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
        .status-delivered { background: rgba(147, 213, 0, 0.15); color: #93D500; }
        .status-shipped { background: rgba(0, 172, 216, 0.15); color: #00ACD8; }
        .status-processing { background: rgba(255, 215, 0, 0.15); color: #FFD700; }
        .status-pending { background: rgba(136, 136, 136, 0.15); color: #888; }
        .status-cancelled, .status-failed { background: rgba(255, 68, 68, 0.15); color: #FF4444; }
        .status-paid { background: rgba(147, 213, 0, 0.15); color: #93D500; }

        /* Two Column Grid */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-bottom: 32px; }
        .card-title { font-size: 1.1rem; font-weight: 600; color: var(--cyan); margin-bottom: 16px; border-bottom: 1px solid rgba(0, 172, 216, 0.2); padding-bottom: 12px; }
        .card-content p { color: #aaa; margin: 0 0 4px 0; line-height: 1.5; }
        .card-content .payment-title { color: #fff; font-size: 1.25rem; font-weight: 700; margin-bottom: 12px; }
        .card-content .payment-status { display: flex; align-items: center; gap: 8px; }
        
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
        
        .actions-section { text-align: right; margin-bottom: 40px; }
        .btn-primary { background: linear-gradient(135deg, #00ACD8, #0088cc); color: white; padding: 12px 32px; font-weight: 600; border-radius: 30px; border: none; font-size: 1.1rem; cursor: pointer; transition: all 0.3s ease; text-decoration: none; display: inline-block; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0, 172, 216, 0.4); }

        .error-state { text-align: center; padding: 60px; background: rgba(255, 68, 68, 0.1); border: 1px dashed rgba(255, 68, 68, 0.4); border-radius: 16px; margin-top: 40px; }
        .error-icon { color: #ff4444; margin-bottom: 16px; }
        .error-state p { color: #ffcfcf; margin-bottom: 24px; font-size: 1.1rem; }
        
        .loading-state { display: flex; justify-content: center; padding: 100px 0; }
        
        @media (max-width: 768px) {
            .header-content { flex-direction: column; align-items: flex-start; gap: 16px; }
            .item-row { flex-direction: column; text-align: center; }
            .price-col { text-align: center; margin-top: 12px; }
        }
    `]
})
export class OrderDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private firestore = inject('FIRESTORE' as any) as Firestore;
    private authService = inject(AuthService);

    order: Order | null = null;
    loading = true;
    error: string | null = null;

    ngOnInit() {
        const orderId = this.route.snapshot.paramMap.get('id');
        if (orderId) {
            this.loadOrder(orderId);
        } else {
            this.error = 'Order ID not found';
            this.loading = false;
        }
    }

    async loadOrder(id: string) {
        this.loading = true;
        try {
            const user = this.authService.currentUser();
            if (!user) throw new Error('User not logged in');

            const docRef = doc(this.firestore, `users/${user.uid}/orders/${id}`);
            const snapshot = await getDoc(docRef);

            if (snapshot.exists()) {
                this.order = { id: snapshot.id, ...snapshot.data() } as Order;
            } else {
                this.error = 'Order not found.';
            }
        } catch (e: any) {
            console.error(e);
            this.error = 'Could not load order details.';
        } finally {
            this.loading = false;
        }
    }
}
