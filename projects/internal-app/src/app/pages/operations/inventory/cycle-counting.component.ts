import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { CycleCount } from '../../../core/models/cycle-count.model';

@Component({
  selector: 'app-cycle-counting',
  standalone: true,
  imports: [CommonModule, RouterLink, AppIconComponent],
  templateUrl: './cycle-counting.component.html',
  styleUrls: ['./cycle-counting.component.css']
})
export class CycleCountingComponent {
  // Signals
  isLoading = signal(false);
  activeCounts = signal<CycleCount[]>([]);

  // Stats
  accuracyRate = signal(98.5);
  pendingItems = signal(142);
  completedThisWeek = signal(12);

  constructor() {
    this.loadDummyData();
  }

  loadDummyData() {
    // Simulate data loading
    this.activeCounts.set([
      {
        id: 'cc_123',
        createdAt: Timestamp.now(),
        scheduledDate: Timestamp.now(),
        status: 'IN_PROGRESS',
        type: 'ABC',
        notes: 'Weekly A-Items Count',
        items: [],
        metadata: {
          totalItems: 45,
          totalVarianceValue: 0,
          accuracyRate: 0
        }
      },
      {
        id: 'cc_124',
        createdAt: Timestamp.now(),
        scheduledDate: Timestamp.fromDate(new Date(Date.now() + 86400000)), // Tomorrow
        status: 'SCHEDULED',
        type: 'ZONE',
        notes: 'Zone B - Racks 1-5',
        items: [],
        metadata: {
          totalItems: 120,
          totalVarianceValue: 0,
          accuracyRate: 0
        }
      },
      {
        id: 'cc_122',
        createdAt: Timestamp.now(),
        scheduledDate: Timestamp.fromDate(new Date(Date.now() - 86400000)), // Yesterday
        status: 'COMPLETED',
        type: 'SPOT',
        notes: 'Spot check: Pirelli Tyres',
        items: [],
        metadata: {
          totalItems: 15,
          totalVarianceValue: -250.00,
          accuracyRate: 93.3
        }
      }
    ]);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'DRAFT': return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20';
      case 'SCHEDULED': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'IN_PROGRESS': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'COMPLETED': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'CANCELLED': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-zinc-400';
    }
  }

  getTypeLabel(type: string): string {
    switch (type) {
      case 'ABC': return 'ABC Analysis';
      case 'ZONE': return 'Zone Count';
      case 'SPOT': return 'Spot Check';
      case 'FULL': return 'Full Inventory';
      default: return type;
    }
  }
}
