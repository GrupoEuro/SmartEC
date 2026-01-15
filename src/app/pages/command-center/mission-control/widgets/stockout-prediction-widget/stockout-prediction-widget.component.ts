import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { InventoryIntelligenceService } from '../../../../../services/inventory-intelligence.service';
import { ChartCardComponent } from '../../../../../shared/components/chart-card/chart-card.component';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-stockout-prediction-widget',
    standalone: true,
    imports: [CommonModule, ChartCardComponent, AppIconComponent],
    template: `
    <app-chart-card [title]="'Stockout Risks'" subtitle="Autonomous Replenishment Alerts">
        <div class="stock-list">
            <div *ngIf="predictions().length === 0" class="empty-state">
                <app-icon name="check-circle" [size]="32" class="text-emerald-500 mb-2"></app-icon>
                <p>Inventory health is excellent. No critical risks.</p>
            </div>

            <div *ngFor="let item of predictions().slice(0, 5)" class="stock-item">
                <div class="item-info">
                    <span class="sku">{{ item.sku }}</span>
                    <span class="name">{{ item.productName }}</span>
                    <div *ngIf="item.suggestedReorder > 0" class="reorder-suggestion">
                        <app-icon name="plus-circle" [size]="12"></app-icon>
                        Reorder: {{ item.suggestedReorder }}
                    </div>
                </div>
                <div class="item-metrics">
                    <div class="days-pill" [ngClass]="item.status">
                        {{ item.daysRemaining | number:'1.0-0' }} Days Left
                    </div>
                </div>
            </div>
            
            <div *ngIf="predictions().length > 5" class="more-link">
                +{{ predictions().length - 5 }} more at risk
            </div>
        </div>
    </app-chart-card>
  `,
    styles: [`

    :host { display: block; height: 100%; }
    .stock-list { 
        display: flex; flex-direction: column; gap: 0.5rem; 
        overflow-y: auto; max-height: 280px; 
        padding-right: 4px;
    }
    .stock-item { 
        display: flex; justify-content: space-between; align-items: flex-start; 
        padding: 0.75rem; 
        background: rgba(255, 255, 255, 0.03); 
        border-radius: 8px; 
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: background 0.2s;
    }
    .stock-item:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .item-info { display: flex; flex-direction: column; gap: 4px; }
    .sku { font-size: 0.7rem; color: #64748b; font-family: monospace; letter-spacing: 0.05em; }
    .name { font-weight: 500; font-size: 0.9rem; color: #f1f5f9; }
    
    .reorder-suggestion {
        display: flex; align-items: center; gap: 4px;
        font-size: 0.75rem; color: #60a5fa; margin-top: 4px;
        background: rgba(37, 99, 235, 0.15); padding: 4px 8px; border-radius: 4px; align-self: flex-start;
    }
    
    .item-metrics { display: flex; align-items: center; }
    .days-pill {
        padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; white-space: nowrap;
        background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .days-pill.critical { 
        background: rgba(239, 68, 68, 0.15); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3); 
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.1);
    }
    .days-pill.warning { 
        background: rgba(245, 158, 11, 0.15); color: #fcd34d; border-color: rgba(245, 158, 11, 0.3); 
    }
    
    .empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 200px;
        color: #64748b; text-align: center;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 8px;
        border: 1px dashed rgba(255, 255, 255, 0.05);
    }
    .more-link { 
        text-align: center; font-size: 0.8rem; color: #64748b; padding-top: 0.75rem; cursor: pointer; 
        transition: color 0.2s;
    }
    .more-link:hover { color: #94a3b8; }
    
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
  `]
})
export class StockoutPredictionWidgetComponent {
    private inventoryService = inject(InventoryIntelligenceService);

    // Fetch just once for V1 dashboard
    predictions = toSignal(this.inventoryService.getStockoutPredictions(), { initialValue: [] });
}
