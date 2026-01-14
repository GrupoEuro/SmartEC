
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChartCardComponent, TableColumn } from '../../../../../shared/components/chart-card/chart-card.component';
import { CustomerUnificationService } from '../../../../../core/services/customer-unification.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { UnifiedCustomer } from '../../../../../core/models/unified-customer.model';

@Component({
    selector: 'app-unified-crm-widget',
    standalone: true,
    imports: [CommonModule, ChartCardComponent, AppIconComponent],
    template: `
    <app-chart-card
      [title]="'Omnichannel Customer 360'"
      subtitle="Unified Identity & LTV Analysis"
      [tableData]="tableData()"
      [tableColumns]="tableColumns">
        
       <div class="crm-overview">
         <!-- Highlights -->
         <div class="metrics-row">
            <div class="metric-card">
               <span class="label">Cross-Channel Shoppers</span>
               <span class="value highlight">{{ crossChannelCount() }}</span>
            </div>
            <div class="metric-card">
               <span class="label">Avg Unified LTV</span>
               <span class="value">{{ avgUnifiedLtv() | currency }}</span>
            </div>
         </div>

         <!-- Top List -->
         <div class="top-customers-list">
            <div class="list-header text-muted">Top High-Value Customers</div>
            
            <div class="customer-item" *ngFor="let cust of topCustomers()">
               <div class="cust-info">
                  <div class="cust-avatar">
                    {{ cust.displayName.charAt(0) }}
                  </div>
                  <div class="cust-details">
                    <span class="cust-name">{{ cust.displayName }}</span>
                    <span class="cust-email">{{ cust.email }}</span>
                  </div>
               </div>

               <div class="cust-channels">
                  <ng-container *ngFor="let ch of cust.channels">
                      <span class="channel-badge" [class]="ch.toLowerCase()">
                         {{ getChannelLabel(ch) }}
                      </span>
                  </ng-container>
               </div>

               <div class="cust-ltv">
                 <span class="value">{{ cust.totalLifetimeValue | currency }}</span>
                 <span class="label">LTV</span>
               </div>
            </div>
         </div>
       </div>

    </app-chart-card>
  `,
    styles: [`
    :host { display: block; height: auto; min-height: 100%; }

    .crm-overview {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .metrics-row {
      display: flex;
      gap: 1rem;
    }

    .metric-card {
       flex: 1;
       background: rgba(255,255,255,0.03);
       border-radius: 8px;
       padding: 1rem;
       display: flex;
       flex-direction: column;
       align-items: center;
    }

    .metric-card .label { font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.25rem; }
    .metric-card .value { font-size: 1.25rem; font-weight: 700; color: #e2e8f0; }
    .metric-card .value.highlight { color: #8b5cf6; }

    .top-customers-list {
       display: flex;
       flex-direction: column;
       gap: 0.75rem;
    }
    
    .list-header { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }

    .customer-item {
       display: flex;
       align-items: center;
       justify-content: space-between;
       padding: 0.75rem;
       background: rgba(255,255,255,0.02);
       border: 1px solid rgba(255,255,255,0.05);
       border-radius: 8px;
       transition: background 0.2s;
    }
    .customer-item:hover { background: rgba(255,255,255,0.05); }

    .cust-info { display: flex; align-items: center; gap: 0.75rem; flex: 2; }
    
    .cust-avatar {
       width: 32px; height: 32px;
       border-radius: 50%;
       background: linear-gradient(135deg, #cbd5e1, #94a3b8);
       color: #1e293b;
       display: flex; align-items: center; justify-content: center;
       font-weight: 700;
       font-size: 0.9rem;
    }

    .cust-details { display: flex; flex-direction: column; }
    .cust-name { font-size: 0.9rem; font-weight: 600; color: #e2e8f0; }
    .cust-email { font-size: 0.75rem; color: #64748b; }

    .cust-channels { 
        display: flex; 
        gap: 0.25rem; 
        flex: 1; 
        justify-content: center;
        flex-wrap: wrap;
    }

    .channel-badge {
       font-size: 0.65rem;
       padding: 2px 6px;
       border-radius: 4px;
       font-weight: 600;
       background: #334155;
       color: #fff;
    }
    
    .channel-badge.amazon_fba, .channel-badge.amazon_mfn { background: #f59e0b; color: #000; }
    .channel-badge.meli_classic, .channel-badge.meli_full { background: #fee600; color: #000; }
    .channel-badge.web { background: #3b82f6; }
    .channel-badge.pos { background: #10b981; }

    .cust-ltv { display: flex; flex-direction: column; align-items: flex-end; flex: 1; }
    .cust-ltv .value { font-weight: 700; color: #e2e8f0; }
    .cust-ltv .label { font-size: 0.65rem; color: #64748b; }

  `]
})
export class UnifiedCrmWidgetComponent {
    private crmService = inject(CustomerUnificationService);

    unifiedCustomers = toSignal(this.crmService.getUnifiedCustomers(), { initialValue: [] });

    crossChannelCount = computed(() => this.unifiedCustomers().filter(c => c.channels.length > 1).length);

    avgUnifiedLtv = computed(() => {
        const crossChannel = this.unifiedCustomers().filter(c => c.channels.length > 1);
        if (crossChannel.length === 0) return 0;
        const total = crossChannel.reduce((sum, c) => sum + c.totalLifetimeValue, 0);
        return total / crossChannel.length;
    });

    topCustomers = computed(() => this.unifiedCustomers().slice(0, 5));

    tableColumns: TableColumn[] = [
        { key: 'displayName', label: 'Customer' },
        { key: 'email', label: 'Identity' },
        { key: 'channelsDisplay', label: 'Channels' },
        { key: 'totalLifetimeValue', label: 'LTV', format: 'currency' }
    ];

    tableData = computed(() => {
        return this.unifiedCustomers().map(c => ({
            displayName: c.displayName,
            email: c.email,
            channelsDisplay: c.channels.map(ch => this.getChannelLabel(ch)).join(', '),
            totalLifetimeValue: c.totalLifetimeValue
        }));
    });

    getChannelLabel(id: string): string {
        const map: any = {
            'WEB': 'Web',
            'POS': 'Store',
            'AMAZON_FBA': 'Amz FBA',
            'AMAZON_MFN': 'Amz MFN',
            'MELI_CLASSIC': 'MeLi',
            'MELI_FULL': 'MeLi Full',
            'ON_BEHALF': 'Phone'
        };
        return map[id] || id;
    }
}
