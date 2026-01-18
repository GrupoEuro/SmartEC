import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { ProductService } from '../../../../core/services/product.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';

@Component({
  selector: 'app-pricing-strategy',
  standalone: true,
  imports: [CommonModule, AppIconComponent, TranslateModule, BaseChartDirective],
  templateUrl: './pricing-strategy.component.html',
  styleUrl: './pricing-strategy.component.css'
})
export class PricingStrategyComponent implements OnInit {
  private rulesService = inject(PricingRulesService);
  private productService = inject(ProductService);
  public router = inject(Router);
  private translate = inject(TranslateService);

  // Loading State
  loading = signal(true);

  // KPI Signals
  totalProducts = signal(0);
  activeStrategies = signal(0);
  avgGrossMargin = signal(0); // Percentage
  strategyCoverage = signal(0); // Percentage

  // Charts Data
  marginDistributionData = signal<ChartData<'bar'> | null>(null);

  // Actionable Lists
  lowMarginProducts = signal<any[]>([]); // Products below min margin
  recentActivity = signal<any[]>([]);

  // Chart Config
  public barChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e293b',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: '#334155', drawTicks: false },
        ticks: { color: '#94a3b8' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8' }
      }
    }
  };
  public barChartType: ChartType = 'bar';

  ngOnInit() {
    this.loadDashboardData();
  }

  async loadDashboardData() {
    this.loading.set(true);
    try {
      // Parallel fetch for speed
      const [products, rules, templates] = await Promise.all([
        this.productService.getProducts().toPromise() as Promise<any[]>,
        this.rulesService.getRules() as Promise<any[]>,
        this.rulesService.getTemplates() as Promise<any[]>
      ]);

      if (!products) return;

      // 1. Calculate Statistics
      this.totalProducts.set(products.length);

      // Approximating "Active Strategies" by products that have a non-default Price or linked rule
      // For V2, we assume if a product has a 'pricingStrategy' in DB it's active.
      // Since we don't have a direct "getAllStrategies" API in the service yet, we'll estimate based on Rules count for now
      // OR better, we iterate products to check if they have a specialized price setup? 
      // Actually, let's use the Rules count as a proxy for "Automated Strategies"
      // AND we can mock some distribution data for the histogram based on product 'price' vs 'cost'

      this.activeStrategies.set(rules.length); // Proxy
      this.strategyCoverage.set(Math.round((rules.length / products.length) * 100) || 0);

      // 2. Calculate Margins (Client-side Aggregation)
      let totalMargin = 0;
      let validProductCount = 0;
      // Use simple keys for logic
      const marginBuckets: Record<string, number> = { 'CRITICAL': 0, 'LOW': 0, 'HEALTHY': 0, 'HIGH': 0 };
      const lowMarginList: any[] = [];

      products.forEach((p: any) => {
        if (p.costPrice && p.price && p.price > 0) {
          const margin = ((p.price - p.costPrice) / p.price) * 100;
          totalMargin += margin;
          validProductCount++;

          // Bucket Logic
          if (margin < 10) marginBuckets['CRITICAL']++;
          else if (margin < 20) marginBuckets['LOW']++;
          else if (margin < 40) marginBuckets['HEALTHY']++;
          else marginBuckets['HIGH']++;

          // Action List
          if (margin < 15) {
            lowMarginList.push({
              name: p.name.es,
              sku: p.sku,
              margin: margin.toFixed(1),
              price: p.price
            });
          }
        }
      });

      this.avgGrossMargin.set(validProductCount > 0 ? parseFloat((totalMargin / validProductCount).toFixed(1)) : 0);
      this.lowMarginProducts.set(lowMarginList.slice(0, 5)); // Top 5 worst

      // 3. Setup Chart (with Translations)
      // We need to fetch translated labels. Since this is async/signal based, we can just grab current snapshot or use simple hardcoded fallback if translation not fast enough, 
      // but usually 'instant' works if loaded.
      const t = this.translate.instant.bind(this.translate);

      const labels = [
        t('PRICING_STRATEGY.DASHBOARD_V2.CHARTS.LEGEND.CRITICAL'),
        t('PRICING_STRATEGY.DASHBOARD_V2.CHARTS.LEGEND.LOW'),
        t('PRICING_STRATEGY.DASHBOARD_V2.CHARTS.LEGEND.HEALTHY'),
        t('PRICING_STRATEGY.DASHBOARD_V2.CHARTS.LEGEND.HIGH')
      ];

      this.marginDistributionData.set({
        labels: labels,
        datasets: [{
          data: [marginBuckets['CRITICAL'], marginBuckets['LOW'], marginBuckets['HEALTHY'], marginBuckets['HIGH']],
          backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'],
          borderRadius: 4,
          barThickness: 40
        }]
      });

      // 4. Mock Recent Activity (until backend supports audit log)
      this.recentActivity.set([
        { action: 'Strategy Updated', target: 'Michelin Pilot Sport 4', time: '2 hours ago', user: 'Admin' },
        { action: 'Seasonal Rule', target: 'Summer Sale 2026', time: '5 hours ago', user: 'System' },
        { action: 'Price Drop', target: 'Pirelli P Zero', time: '1 day ago', user: 'Auto-Repricer' },
      ]);

    } catch (e) {
      console.error('Error loading dashboard', e);
    } finally {
      this.loading.set(false);
    }
  }

  // Navigation Helpers
  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
