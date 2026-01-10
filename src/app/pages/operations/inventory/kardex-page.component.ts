import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonModule as AppCommonModule } from '../../../shared/modules/common.module';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryLedgerService } from '../../../core/services/inventory-ledger.service';
import { ProductService } from '../../../core/services/product.service';
import { Product } from '../../../core/models/product.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { KardexHistoryTableComponent } from './kardex-page/kardex-history-table.component';
import { StockTrendChartComponent } from './kardex-page/stock-trend-chart.component';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-kardex-page',
  standalone: true,
  imports: [CommonModule, RouterLink, AppIconComponent, KardexHistoryTableComponent, StockTrendChartComponent],
  templateUrl: './kardex-page.component.html',
  styleUrls: ['./kardex-page.component.css']
})
export class KardexPageComponent {
  private route = inject(ActivatedRoute);
  private productService = inject(ProductService);
  private ledgerService = inject(InventoryLedgerService); // Available for child components if needed

  isLoading = signal(true);
  product = signal<Product | null>(null);
  currentStock = signal(0);

  // Filters state (shared with children)
  dateRange = signal<'7d' | '30d' | '90d' | 'all'>('30d');

  constructor() {
    this.route.params.subscribe(params => {
      if (params['productId']) {
        this.loadProduct(params['productId']);
      }
    });
  }

  async loadProduct(id: string) {
    this.isLoading.set(true);
    try {
      const product = await firstValueFrom(this.productService.getProduct(id));
      if (product) {
        this.product.set(product);
        this.currentStock.set(product.stockQuantity || 0); // Initial fast load
      }
    } catch (err) {
      console.error('Error loading product for kardex:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
  }
}
