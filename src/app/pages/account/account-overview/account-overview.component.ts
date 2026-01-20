import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { AccountService } from '../../../core/services/account.service';  // Check if relative path is correct: overview -> account -> pages -> app -> src -> core
import { OrderSummary } from '../../../core/models/order.model';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-account-overview',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatButtonModule,
        MatIconModule,
        MatCardModule,
        MatListModule,
        TranslateModule
    ],
    templateUrl: './account-overview.component.html',
    styleUrls: ['./account-overview.component.css']
})
export class AccountOverviewComponent implements OnInit {
    accountService = inject(AccountService);
    recentOrders: OrderSummary[] = [];
    userName: string = 'Customer'; // Dynamic name not strictly required for overview but nice to have

    ngOnInit() {
        this.loadDashboardData();
    }

    async loadDashboardData() {
        try {
            const allOrders = await this.accountService.getOrders();
            // Sort desc date
            allOrders.sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : (a.date as any).toDate();
                const dateB = b.date instanceof Date ? b.date : (b.date as any).toDate();
                return dateB - dateA;
            });
            this.recentOrders = allOrders.slice(0, 3);

            const profile = await this.accountService.getProfile();
            if (profile?.displayName) {
                this.userName = profile.displayName;
            }
        } catch (error) {
            console.error('Error loading dashboard', error);
        }
    }
}
