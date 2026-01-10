import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { ABCClassification } from '../../../core/models/abc-analysis.model';
import { Timestamp } from '@angular/fire/firestore';

interface AnalysisProduct {
  id: string;
  name: string;
  sku: string;
  revenue: number;
  units: number;
  lastSale: Date;
  currentStock: number;
  class?: 'A' | 'B' | 'C' | 'D';
  cumulativePercent?: number;
}

@Component({
  selector: 'app-abc-analysis',
  standalone: true,
  imports: [CommonModule, AppIconComponent],
  templateUrl: './abc-analysis.component.html',
  styleUrls: ['./abc-analysis.component.css']
})
export class AbcAnalysisComponent {

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
      percentCount: (classProducts.length / products.length) * 100 || 0,
      percentRevenue: (revenue / totalRevenue) * 100 || 0
    };
  }

  constructor() {
    this.runAnalysis(); // Auto-run on load for now
  }

  runAnalysis() {
    this.isLoading.set(true);

    // Simulate API delay
    setTimeout(() => {
      const data = this.generateDummyData();
      const classified = this.performParetoAnalysis(data);

      this.analyzedProducts.set(classified);
      this.lastUpdated.set(new Date());
      this.isLoading.set(false);
    }, 800);
  }

  private performParetoAnalysis(products: AnalysisProduct[]): AnalysisProduct[] {
    // 1. Sort by Revenue DESC
    const sorted = [...products].sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = sorted.reduce((acc, p) => acc + p.revenue, 0);
    let runningRevenue = 0;

    return sorted.map(p => {
      // Check for Dead Stock (No sales in 90 days)
      const daysSinceSale = (new Date().getTime() - p.lastSale.getTime()) / (1000 * 3600 * 24);
      if (daysSinceSale > 90) {
        return { ...p, class: 'D', cumulativePercent: 100 };
      }

      runningRevenue += p.revenue;
      const cumulativePercent = (runningRevenue / totalRevenue) * 100;

      let classification: 'A' | 'B' | 'C' = 'C';
      if (cumulativePercent <= 80) classification = 'A';
      else if (cumulativePercent <= 95) classification = 'B';

      return { ...p, class: classification, cumulativePercent };
    });
  }

  private generateDummyData(): AnalysisProduct[] {
    const products: AnalysisProduct[] = [];
    const count = 50; // Generate 50 items

    for (let i = 0; i < count; i++) {
      // Skew revenue generation to create Pareto distribution
      // First few items get huge revenue, tail gets small revenue
      let revenueBase = 0;
      if (i < 5) revenueBase = 50000 + Math.random() * 50000; // Top 10%
      else if (i < 15) revenueBase = 10000 + Math.random() * 20000; // Next 20%
      else revenueBase = Math.random() * 5000; // Tail

      products.push({
        id: `p_${i}`,
        name: `Product ${i + 1} - ${this.getRandomTyreName()}`,
        sku: `SKU-${1000 + i}`,
        revenue: revenueBase,
        units: Math.floor(revenueBase / 2000), // Avg price approx 2000
        lastSale: new Date(Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 100), // Random last 100 days
        currentStock: Math.floor(Math.random() * 50)
      });
    }
    return products;
  }

  private getRandomTyreName(): string {
    const brands = ['Michelin', 'Pirelli', 'Bridgestone', 'Dunlop', 'Continental'];
    const models = ['Pilot Sport', 'Diablo Rosso', 'Battlax', 'RoadSmart', 'ContiMotion'];
    const sizes = ['120/70', '180/55', '190/50', '160/60'];

    return `${brands[Math.floor(Math.random() * brands.length)]} ${models[Math.floor(Math.random() * models.length)]} ${sizes[Math.floor(Math.random() * sizes.length)]}`;
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(amount);
  }
}
