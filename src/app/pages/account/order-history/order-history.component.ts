import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { AccountService } from '../../../core/services/account.service';
import { OrderSummary } from '../../../core/models/order.model';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-order-history',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        TranslateModule
    ],
    templateUrl: './order-history.component.html',
    styles: [`
        .order-history-container { padding: 24px; max-width: 1200px; margin: 0 auto; }
        .header { margin-bottom: 32px; }
        h1 { font-size: 24px; font-weight: 600; margin: 0 0 8px 0; color: var(--text-primary); }
        .subtitle { color: var(--text-secondary); margin: 0; }
        table { width: 100%; }
        .mat-column-actions { width: 120px; text-align: right; }
        .empty-state { display: flex; flex-direction: column; align-items: center; padding: 64px 0; gap: 16px; color: var(--text-secondary); }
        .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.5; }
    `]
})
export class OrderHistoryComponent implements OnInit {
    accountService = inject(AccountService);

    orders: OrderSummary[] = [];
    loading = true;
    displayedColumns: string[] = ['orderNumber', 'date', 'status', 'total', 'actions'];

    ngOnInit() {
        this.loadOrders();
    }

    async loadOrders() {
        this.loading = true;
        try {
            this.orders = await this.accountService.getOrders();
            // Sort by date desc
            this.orders.sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : (a.date as any).toDate();
                const dateB = b.date instanceof Date ? b.date : (b.date as any).toDate();
                return dateB - dateA;
            });
        } catch (error: any) {
            console.error('Error loading orders', error);
        } finally {
            this.loading = false;
        }
    }
}
