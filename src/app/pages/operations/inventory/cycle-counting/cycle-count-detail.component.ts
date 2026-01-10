import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { Timestamp } from '@angular/fire/firestore';
import { CycleCount, CycleCountItem } from '../../../../core/models/cycle-count.model';

@Component({
  selector: 'app-cycle-count-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AppIconComponent],
  templateUrl: './cycle-count-detail.component.html',
  styleUrls: ['./cycle-count-detail.component.css']
})
export class CycleCountDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // State
  countId = signal<string>('');
  cycleCount = signal<CycleCount | null>(null);
  isLoading = signal(false);

  // Computed stats
  progress = signal(0);
  itemsCounted = signal(0);

  constructor() {
    this.route.params.subscribe(params => {
      this.countId.set(params['id']);
      this.loadCountData(params['id']);
    });
  }

  loadCountData(id: string) {
    // Simulate API call
    this.isLoading.set(true);
    setTimeout(() => {
      const mockData: CycleCount = {
        id: id,
        createdAt: Timestamp.now(),
        scheduledDate: Timestamp.now(),
        status: 'IN_PROGRESS',
        type: 'ABC',
        assignedTo: 'u_123',
        notes: 'Weekly A-Items Count - Zone A',
        metadata: { totalItems: 5, totalVarianceValue: 0, accuracyRate: 0 },
        items: [
          {
            productId: 'p_1',
            productName: 'Michelin Pilot Street 2',
            sku: 'MICH-PS2-140',
            expectedQuantity: 50,
            countedQuantity: undefined, // Not counted yet
            variance: 0,
            status: 'PENDING',
            location: 'A-01-01'
          },
          {
            productId: 'p_2',
            productName: 'Pirelli Diablo Rosso III',
            sku: 'PIR-DR3-150',
            expectedQuantity: 32,
            countedQuantity: 30, // Variance -2
            variance: -2,
            status: 'COUNTED',
            location: 'A-01-02'
          },
          {
            productId: 'p_3',
            productName: 'Dunlop Arrowmax GT601',
            sku: 'DUN-GT6-130',
            expectedQuantity: 15,
            countedQuantity: 15,
            variance: 0,
            status: 'COUNTED',
            location: 'A-02-01'
          },
          {
            productId: 'p_4',
            productName: 'Metzeler Sportec M9 RR',
            sku: 'MET-M9-160',
            expectedQuantity: 8,
            countedQuantity: undefined,
            variance: 0,
            status: 'PENDING',
            location: 'A-02-03'
          },
          {
            productId: 'p_5',
            productName: 'Bridgestone Battlax S22',
            sku: 'BRI-S22-180',
            expectedQuantity: 12,
            countedQuantity: undefined,
            variance: 0,
            status: 'PENDING',
            location: 'B-01-01'
          }
        ]
      };

      this.cycleCount.set(mockData);
      this.updateStats();
      this.isLoading.set(false);
    }, 500);
  }

  updateQuantity(item: CycleCountItem, quantity: number | null) {
    if (quantity === null) return;

    // Update item logic
    item.countedQuantity = quantity;
    item.variance = quantity - item.expectedQuantity;
    item.status = 'COUNTED';

    // Trigger signal update
    this.cycleCount.update(current => {
      if (!current) return null;
      return { ...current }; // Force refresh
    });

    this.updateStats();
  }

  updateStats() {
    const count = this.cycleCount();
    if (!count) return;

    const total = count.items.length;
    const counted = count.items.filter(i => i.status !== 'PENDING').length;

    this.itemsCounted.set(counted);
    this.progress.set(Math.round((counted / total) * 100));
  }

  completeCount() {
    if (confirm('Are you sure you want to complete this count? Inventory adjustments will be created for any variances.')) {
      // Here we would call the service to complete
      this.router.navigate(['/operations/cycle-counting']);
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'PENDING': return 'bg-zinc-800 text-zinc-400 border-zinc-700';
      case 'COUNTED': return 'bg-blue-900/20 text-blue-400 border-blue-500/20';
      case 'RECOUNT_NEEDED': return 'bg-amber-900/20 text-amber-400 border-amber-500/20';
      default: return 'bg-zinc-800 text-zinc-400';
    }
  }
}
