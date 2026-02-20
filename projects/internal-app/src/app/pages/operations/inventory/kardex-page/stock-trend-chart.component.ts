import { Component, Input, OnChanges, SimpleChanges, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { InventoryLedgerService } from '../../../../core/services/inventory-ledger.service';
import { firstValueFrom } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-stock-trend-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  template: `
    <div class="w-full h-full relative" *ngIf="!isLoading()">
      <canvas baseChart
        [data]="lineChartData"
        [options]="lineChartOptions"
        [type]="'line'">
      </canvas>
    </div>
    <div *ngIf="isLoading()" class="w-full h-full flex items-center justify-center text-zinc-500">
        Loading Chart...
    </div>
  `,
  styles: [`:host { display: block; width: 100%; height: 100%; }`]
})
export class StockTrendChartComponent implements OnChanges {
  @Input() productId: string = '';
  @Input() dateRange: '7d' | '30d' | '90d' | 'all' = '30d';

  private ledgerService = inject(InventoryLedgerService);

  isLoading = signal(true);

  public lineChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [],
    labels: []
  };

  public lineChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    elements: {
      line: { tension: 0.4 },
      point: { radius: 2, hoverRadius: 6 }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#71717a' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#71717a', maxTicksLimit: 8 }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(24, 24, 27, 0.9)',
        titleColor: '#fff',
        bodyColor: '#a1a1aa',
        borderColor: '#3f3f46',
        borderWidth: 1
      }
    }
  };

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['productId'] || changes['dateRange']) {
      if (this.productId) {
        await this.loadChartData();
      }
    }
  }

  async loadChartData() {
    this.isLoading.set(true);
    try {
      // Fetch logic similar to table but we need chronological order for current state
      // Chart needs to show the trend. 
      // We get DESC order from service. We need to reverse it for chart.
      const entries$ = this.ledgerService.getHistory(this.productId, 100); // Limit 100 for chart smoothness
      const entries = await firstValueFrom(entries$);

      // Reverse to get ASC date
      const chronological = [...entries].reverse();

      const labels = chronological.map(e => {
        const date = (e.date as Timestamp).toDate();
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });

      const dataPoints = chronological.map(e => e.balanceAfter);

      this.lineChartData = {
        labels: labels,
        datasets: [
          {
            data: dataPoints,
            label: 'Stock Level',
            fill: true,
            borderColor: '#3b82f6', // blue-500
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            pointBackgroundColor: '#3b82f6'
          }
        ]
      };

    } catch (err) {
      console.error('Error loading chart:', err);
    } finally {
      this.isLoading.set(false);
    }
  }
}
