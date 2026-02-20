import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { InventoryLedgerService } from '../../../../core/services/inventory-ledger.service';
import { KardexEntry, InventoryBalance } from '../../../../core/models/inventory-ledger.model';
import { firstValueFrom } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-kardex-history-table',
  standalone: true,
  imports: [CommonModule, AppIconComponent],
  templateUrl: './kardex-history-table.component.html',
  styleUrls: ['./kardex-history-table.component.css']
})
export class KardexHistoryTableComponent implements OnChanges {
  @Input() productId: string = '';
  @Input() dateRange: '7d' | '30d' | '90d' | 'all' = '30d';

  private ledgerService = inject(InventoryLedgerService);

  entries = signal<KardexEntry[]>([]);
  isLoading = signal(true);

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['productId'] || changes['dateRange']) {
      if (this.productId) {
        await this.loadData();
      }
    }
  }

  async loadData() {
    this.isLoading.set(true);
    try {
      // 1. Fetch History (Limit based on range approx or fetch all for now and filter?)
      // For now fetching 100 recent entries.
      // SOTA: Should be server-side filtering by date. 
      // The service currently supports `limitCount` but not range. 
      // We will fetch more rows for 'all', or implement date query in service later.
      let limit = 100;
      if (this.dateRange === '30d') limit = 300;
      if (this.dateRange === '90d') limit = 1000;
      if (this.dateRange === 'all') limit = 5000;

      const entries$ = this.ledgerService.getHistory(this.productId, limit);
      const rawEntries = await firstValueFrom(entries$);

      // 2. Fetch Current Balance (Anchor) for verification if needed
      // The entries usually contain balanceAfter, so we trust the ledger.
      // But we might need to filter by date client-side if the query doesn't support it yet

      const filtered = this.filterByDate(rawEntries);

      // 3. Process/Format
      this.entries.set(filtered);

    } catch (err) {
      console.error('Error loading history:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  private filterByDate(entries: KardexEntry[]): KardexEntry[] {
    if (this.dateRange === 'all') return entries;

    const now = new Date();
    const cutoff = new Date();

    if (this.dateRange === '7d') cutoff.setDate(now.getDate() - 7);
    if (this.dateRange === '30d') cutoff.setDate(now.getDate() - 30);
    if (this.dateRange === '90d') cutoff.setDate(now.getDate() - 90);

    return entries.filter(e => {
      const date = this.getDate(e.date);
      return date >= cutoff;
    });
  }

  getDate(date: Timestamp | Date): Date {
    // Handle Firestore Timestamp or native Date
    if (!date) return new Date();
    return (date as any).toDate ? (date as any).toDate() : (date as Date);
  }

  getTypeColor(type: string): string {
    switch (type) {
      case 'SALE': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'PURCHASE': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'ADJUSTMENT': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'RETURN_IN': return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
      case 'RETURN_OUT': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      case 'INITIAL_LOAD': return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20';
      default: return 'text-zinc-400 bg-zinc-800 border-zinc-700';
    }
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'SALE': return 'minus-circle';
      case 'PURCHASE': return 'plus-circle';
      case 'ADJUSTMENT': return 'sliders';
      case 'RETURN_IN': return 'rotate-ccw';
      case 'RETURN_OUT': return 'log-out';
      case 'INITIAL_LOAD': return 'package';
      default: return 'circle';
    }
  }
}
