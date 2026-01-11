import { Component, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { OrderService } from '../../../core/services/order.service';
import { ProductService } from '../../../core/services/product.service';
import { firstValueFrom, forkJoin, take } from 'rxjs';

interface AnalysisProduct {
  id: string;
  name: string;
  sku: string;
  revenue: number;
  units: number;
  lastSale: Date | null;
  currentStock: number;
  class?: 'A' | 'B' | 'C' | 'D';
  cumulativePercent?: number;
}

@Component({
  selector: 'app-abc-analysis',
  standalone: true,
  imports: [CommonModule, AppIconComponent, TranslateModule, FormsModule],
  templateUrl: './abc-analysis.component.html', // Fixed URL
  styleUrls: ['./abc-analysis.component.css']
})
export class AbcAnalysisComponent {
  private orderService = inject(OrderService);
  private productService = inject(ProductService);

  isLoading = signal(false);
  lastUpdated = signal<Date | null>(null);
  analyzedProducts = signal<AnalysisProduct[]>([]);

  // Computed Stats
  stats = computed(() => {
    const products = this.analyzedProducts();
    const totalRevenue = products.reduce((acc, p) => acc + p.revenue, 0);

    return {
      a: this.getStatsForClass(products, 'A', totalRevenue),
      b: this.getStatsForClass(products, 'B', totalRevenue),
      c: this.getStatsForClass(products, 'C', totalRevenue),
      d: this.getStatsForClass(products, 'D', totalRevenue),
      totalRevenue,
      totalCount: products.length
    };
  });

  private getStatsForClass(products: AnalysisProduct[], clazz: string, totalRevenue: number) {
    const classProducts = products.filter(p => p.class === clazz);
    const revenue = classProducts.reduce((acc, p) => acc + p.revenue, 0);
    return {
      count: classProducts.length,
      revenue,
      percentCount: products.length > 0 ? (classProducts.length / products.length) * 100 : 0,
      percentRevenue: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0
    };
  }

  constructor() {
    this.runAnalysis();
  }

  async runAnalysis() {
    this.isLoading.set(true);
    console.log('Starting ABC Analysis...');

    try {
      // Fetch Products and Orders concurrently
      console.log('Fetching data...');
      const [products, orders] = await firstValueFrom(
        forkJoin([
          this.productService.getProducts().pipe(take(1)),
          this.orderService.getOrders().pipe(take(1))
        ])
      );

      console.log(`Fetched ${products?.length} products and ${orders?.length} orders.`);

      // Process Data
      const analysisData = this.processData(products, orders);
      console.log(`Processed ${analysisData.length} analysis items.`);

      const classified = this.performParetoAnalysis(analysisData);
      console.log('Classification complete.');

      this.analyzedProducts.set(classified);
      this.lastUpdated.set(new Date());

    } catch (error) {
      console.error('Error running ABC Analysis:', error);
    } finally {
      this.isLoading.set(false);
      console.log('Analysis finished.');
    }
  }

  private processData(products: any[], orders: any[]): AnalysisProduct[] {
    const productMap = new Map<string, AnalysisProduct>();

    // 1. Initialize map with all products (to catch those with 0 sales)
    products.forEach(p => {
      productMap.set(p.id, {
        id: p.id,
        name: p.name?.es || p.name?.en || 'Unknown Product',
        sku: p.sku || 'N/A',
        revenue: 0,
        units: 0,
        lastSale: null,
        currentStock: p.stockQuantity || 0
      });
    });

    // 2. Aggregate Sales from Orders
    // Filter orders? Maybe exclude cancelled/refunded?
    const validOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded');

    validOrders.forEach(order => {
      const orderDate = this.getDateFromTimestamp(order.createdAt);

      order.items?.forEach((item: any) => {
        const prod = productMap.get(item.productId);
        if (prod) {
          prod.revenue += (item.price || 0) * (item.quantity || 0);
          prod.units += (item.quantity || 0);

          // Update last sale date
          if (!prod.lastSale || orderDate > prod.lastSale) {
            prod.lastSale = orderDate;
          }
        }
      });
    });

    return Array.from(productMap.values());
  }

  private performParetoAnalysis(products: AnalysisProduct[]): AnalysisProduct[] {
    // 1. Sort by Revenue DESC
    const sorted = [...products].sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = sorted.reduce((acc, p) => acc + p.revenue, 0);
    let runningRevenue = 0;

    return sorted.map(p => {
      // Check for Dead Stock (e.g., No sales > 90 days AND has stock)
      // Or just strictly by Revenue contribution?
      // Standard ABC:
      // A: Top 80% Revenue
      // B: Next 15% (80-95%)
      // C: Bottom 5% (95-100%)
      // D: Dead Stock (No sales in X days? Or 0 Revenue?)

      // Let's implement Hybrid: If 0 Revenue, it's D. 
      // If it has revenue, check Pareto.
      if (p.revenue === 0) {
        return { ...p, class: 'D', cumulativePercent: 100 };
      }

      runningRevenue += p.revenue;
      const cumulativePercent = totalRevenue > 0 ? (runningRevenue / totalRevenue) * 100 : 0;

      let classification: 'A' | 'B' | 'C' = 'C';
      if (cumulativePercent <= 80) classification = 'A';
      else if (cumulativePercent <= 95) classification = 'B';

      return { ...p, class: classification, cumulativePercent };
    });
  }

  private getDateFromTimestamp(timestamp: any): Date {
    if (!timestamp) return new Date();
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    return new Date(timestamp);
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(amount);
  }
}
