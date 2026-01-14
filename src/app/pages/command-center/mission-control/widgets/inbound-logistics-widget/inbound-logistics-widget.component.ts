
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChartCardComponent, TableColumn } from '../../../../../shared/components/chart-card/chart-card.component';
import { ProcurementService } from '../../../../../core/services/procurement.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-inbound-logistics-widget',
  standalone: true,
  imports: [CommonModule, ChartCardComponent, AppIconComponent],
  template: `
    <app-chart-card
      [title]="'Inbound Logistics'"
      subtitle="International PO Tracker"
      [tableData]="tableData()"
      [tableColumns]="tableColumns">
      
      <!-- Timeline Visualization -->
      <div class="po-tracker-list">
        <div class="po-item" *ngFor="let po of activePOs()">
          <div class="po-header">
            <span class="po-id">{{ po.id }}</span>
            <span class="po-supplier text-muted">{{ po.supplierName }}</span>
            <span class="po-eta" [class.delayed]="isDelayed(po)">
              ETA: {{ getEtaDate(po) | date:'MMM d' }}
              <app-icon *ngIf="isDelayed(po)" name="alert-triangle" [size]="14" class="text-danger"></app-icon>
            </span>
          </div>

          <!-- Progress Bar -->
          <div class="timeline-progress">
             <div class="progress-track">
               <div class="progress-fill" [style.width.%]="getProgressPercent(po.status)"></div>
             </div>
             
             <!-- Milestones -->
             <div class="milestones">
               <div class="milestone" [class.active]="isMilestoneActive(po.status, 'placed')" title="Placed">
                 <div class="dot"></div>
                 <span class="label">Ordered</span>
               </div>
               <div class="milestone" [class.active]="isMilestoneActive(po.status, 'manufacturing')" title="Manufacturing">
                 <div class="dot"></div>
                 <span class="label">Mfg</span>
               </div>
               <div class="milestone" [class.active]="isMilestoneActive(po.status, 'shipped')" title="In Transit">
                 <div class="dot"></div>
                 <span class="label">Shipped</span>
               </div>
               <div class="milestone warning-zone" [class.active]="isMilestoneActive(po.status, 'customs_hold')" title="Customs">
                 <div class="dot"></div>
                 <span class="label">Customs</span>
               </div>
               <div class="milestone" [class.active]="isMilestoneActive(po.status, 'last_mile')" title="Arrived">
                 <div class="dot"></div>
                 <span class="label">Last Mile</span>
               </div>
             </div>
          </div>
        </div>
        
        <div class="empty-state" *ngIf="activePOs().length === 0">
           <p>No active inbound orders.</p>
        </div>
      </div>

    </app-chart-card>
  `,
  styles: [`
    :host { display: block; height: auto; min-height: 100%; }

    .po-tracker-list {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      padding: 0.5rem 0;
    }

    .po-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .po-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.9rem;
    }

    .po-id { font-weight: 600; color: #fff; }
    .po-supplier { font-size: 0.8rem; color: #94a3b8; }
    .po-eta { 
      font-size: 0.8rem; 
      color: #64748b; 
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .po-eta.delayed { color: #ef4444; font-weight: 600; }

    /* Timeline Styles */
    .timeline-progress {
      position: relative;
      padding: 10px 0;
    }

    .progress-track {
      height: 4px;
      background: #334155;
      border-radius: 2px;
      position: relative;
      overflow: hidden;
      margin-top: 5px;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 2px;
      transition: width 0.5s ease-out;
    }

    .milestones {
      display: flex;
      justify-content: space-between;
      position: relative;
      margin-top: -9px; /* Pull up to align dots on line */
    }

    .milestone {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 20px;
    }

    .dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #1e293b;
      border: 2px solid #475569;
      z-index: 2;
      transition: all 0.3s;
    }

    .milestone.active .dot {
      background: #8b5cf6;
      border-color: #8b5cf6;
      box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
    }
    
    .milestone.warning-zone.active .dot {
        background: #f59e0b;
        border-color: #f59e0b;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
    }

    .label {
      margin-top: 4px;
      font-size: 0.65rem;
      color: #64748b;
      white-space: nowrap;
    }
    
    .milestone.active .label {
        color: #e2e8f0;
    }
    
    .empty-state {
        text-align: center;
        padding: 2rem;
        color: #64748b;
        font-style: italic;
    }
  `]
})
export class InboundLogisticsWidgetComponent {
  private procurementService = inject(ProcurementService);

  activePOs = toSignal(this.procurementService.getActiveInboundOrders(), { initialValue: [] });

  tableColumns: TableColumn[] = [
    { key: 'id', label: 'PO #' },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'status', label: 'Status' },
    { key: 'totalItems', label: 'Qty' },
    { key: 'arrivalDisplay', label: 'ETA' }
  ];

  tableData = computed(() => {
    return this.activePOs().map(po => ({
      id: po.id,
      supplierName: po.supplierName,
      status: po.status.replace('_', ' ').toUpperCase(),
      totalItems: po.totalItems,
      arrivalDisplay: po.estimatedArrivalDate ? new Date(po.estimatedArrivalDate as any).toLocaleDateString() : 'TBD'
    }));
  });

  getProgressPercent(status: string): number {
    switch (status) {
      case 'draft': return 5;
      case 'placed': return 20;
      case 'manufacturing': return 40;
      case 'ready_to_ship': return 55;
      case 'shipped': return 70;
      case 'customs_hold': return 80; // Stuck/Slow
      case 'customs_cleared': return 85;
      case 'last_mile': return 95;
      case 'received': return 100;
      default: return 0;
    }
  }

  isMilestoneActive(currentStatus: string, milestone: string): boolean {
    const order = ['draft', 'placed', 'manufacturing', 'ready_to_ship', 'shipped', 'customs_hold', 'customs_cleared', 'last_mile', 'received'];
    const currentIdx = order.indexOf(currentStatus);
    const milestoneIdx = order.indexOf(milestone);

    // Special handling for customs: if cleared, hold is passed
    if (currentStatus === 'customs_cleared' && milestone === 'customs_hold') return true;

    return currentIdx >= milestoneIdx;
  }

  isDelayed(po: any): boolean {
    if (!po.estimatedArrivalDate) return false;
    const eta = this.getEtaDate(po);
    return eta ? eta < new Date() && po.status !== 'received' : false;
  }

  getEtaDate(po: any): Date | null {
    if (!po.estimatedArrivalDate) return null;
    if (typeof po.estimatedArrivalDate.toDate === 'function') {
      return po.estimatedArrivalDate.toDate();
    }
    return new Date(po.estimatedArrivalDate);
  }
}
