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
    .stock-list { display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; max-height: 280px; }
    .stock-item { 
        display: flex; justify-content: space-between; align-items: center; 
        padding: 0.75rem; background: rgba(30, 41, 59, 0.5); border-radius: 0.5rem; border: 1px solid rgba(71, 85, 105, 0.2);
    }
    .item-info { display: flex; flex-direction: column; }
    .sku { font-size: 0.75rem; color: #94a3b8; font-family: monospace; }
    .name { font-weight: 500; font-size: 0.9rem; color: #e2e8f0; }
    .days-pill {
        padding: 0.25rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
    }
    .days-pill.critical { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .days-pill.warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px;
        color: #94a3b8; text-align: center;
    }
    .more-link { text-align: center; font-size: 0.8rem; color: #64748b; padding-top: 0.5rem; cursor: pointer; }
  `]
})
export class StockoutPredictionWidgetComponent {
    private inventoryService = inject(InventoryIntelligenceService);

    // Fetch just once for V1 dashboard
    predictions = toSignal(this.inventoryService.getStockoutPredictions(), { initialValue: [] });
}
