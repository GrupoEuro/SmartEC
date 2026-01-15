
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
       border-radius: 12px;
       border: 1px solid rgba(255,255,255,0.05);
       padding: 1.25rem;
       display: flex;
       flex-direction: column;
       align-items: center;
       justify-content: center;
       transition: background 0.2s;
    }
    .metric-card:hover { background: rgba(255,255,255,0.05); }

    .metric-card .label { font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.5rem; letter-spacing: 0.05em; text-transform: uppercase; }
    .metric-card .value { font-size: 1.75rem; font-weight: 700; color: #e2e8f0; }
    .metric-card .value.highlight { color: #a78bfa; text-shadow: 0 0 20px rgba(139, 92, 246, 0.4); }

    .top-customers-list {
       display: flex;
       flex-direction: column;
       gap: 0.75rem;
    }
    
    .list-header { 
        font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; 
        color: #64748b; font-weight: 600;
    }

    .customer-item {
       display: flex;
       align-items: center;
       justify-content: space-between;
       padding: 0.85rem 1rem;
       background: rgba(255,255,255,0.02);
       border: 1px solid rgba(255,255,255,0.05);
       border-radius: 10px;
       transition: all 0.2s;
    }
    .customer-item:hover { 
        background: rgba(255,255,255,0.06); 
        transform: translateX(4px);
    }

    .cust-info { display: flex; align-items: center; gap: 1rem; flex: 2; }
    
    .cust-avatar {
       width: 36px; height: 36px;
       border-radius: 50%;
       background: linear-gradient(135deg, #475569, #1e293b);
       color: #e2e8f0;
       border: 1px solid rgba(255,255,255,0.1);
       display: flex; align-items: center; justify-content: center;
       font-weight: 600;
       font-size: 0.9rem;
    }

    .cust-details { display: flex; flex-direction: column; gap: 2px; }
    .cust-name { font-size: 0.95rem; font-weight: 500; color: #f1f5f9; }
    .cust-email { font-size: 0.75rem; color: #64748b; }

    .cust-channels { 
        display: flex; 
        gap: 0.4rem; 
        flex: 1; 
        justify-content: center;
        flex-wrap: wrap;
    }

    .channel-badge {
       font-size: 0.65rem;
       padding: 3px 8px;
       border-radius: 4px;
       font-weight: 600;
       background: #334155;
       color: #f8fafc;
       border: 1px solid rgba(255,255,255,0.05);
    }
    
    .channel-badge.amazon_fba, .channel-badge.amazon_mfn { 
        background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); 
    }
    .channel-badge.meli_classic, .channel-badge.meli_full { 
        background: rgba(254, 240, 138, 0.1); color: #fef08a; border-color: rgba(254, 240, 138, 0.3); 
    }
    .channel-badge.web { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border-color: rgba(59, 130, 246, 0.3); }
    .channel-badge.pos { background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.3); }

    .cust-ltv { display: flex; flex-direction: column; align-items: flex-end; flex: 1; min-width: 80px; }
    .cust-ltv .value { font-weight: 700; font-size: 1rem; color: #e2e8f0; }
    .cust-ltv .label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; }

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
