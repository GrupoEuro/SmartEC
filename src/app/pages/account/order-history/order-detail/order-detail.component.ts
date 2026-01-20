import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { AuthService } from '../../../../core/services/auth.service';
import { Order } from '../../../../core/models/order.model';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-order-detail',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatButtonModule,
        MatIconModule,
        MatCardModule,
        MatDividerModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        TranslateModule
    ],
    templateUrl: './order-detail.component.html',
    styles: [`
        .order-detail-container { padding: 24px; max-width: 1000px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        h1 { margin: 0; font-size: 24px; }
        .back-link { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); text-decoration: none; margin-bottom: 16px; }
        .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; margin-top: 24px; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 24px; margin-bottom: 24px; }
        .items-list { display: flex; flex-direction: column; gap: 16px; }
        .item-row { display: flex; align-items: center; gap: 16px; padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; }
        .item-image { width: 80px; height: 80px; object-fit: contain; background: #f5f5f5; border-radius: 4px; }
        .item-details { flex: 1; }
        .item-name { font-weight: 500; margin: 0 0 4px 0; }
        .item-meta { color: var(--text-secondary); font-size: 14px; margin: 0; }
        .price-col { text-align: right; font-weight: 500; }
        .summary-section { background: #f9f9f9; padding: 20px; border-radius: 8px; margin-top: 24px; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .summary-row.total { font-weight: 700; font-size: 18px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 12px; }
        .error-state, .loading-state { text-align: center; padding: 48px; }
    `]
})
export class OrderDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private firestore = inject(Firestore);
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
