import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    template: `
        <div class="detail-container">
            <h1>{{ 'OPERATIONS.CUSTOMERS.TITLE' | translate }}</h1>
            <p>Customer ID: {{ customerId }}</p>
            <p>Customer Detail - Coming in Phase 3</p>
        </div>
    `,
    styles: [`
        .detail-container {
            padding: 2rem;
        }
    `]
})
export class CustomerDetailComponent {
    customerId: string | null = null;

    constructor(private route: ActivatedRoute) {
        this.customerId = this.route.snapshot.paramMap.get('id');
    }
}
