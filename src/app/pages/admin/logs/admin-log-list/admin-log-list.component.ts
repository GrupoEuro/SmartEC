import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Firestore, collection, query, orderBy, limit, getDocs, Timestamp } from '@angular/fire/firestore';
import { AdminLog } from '../../../../core/models/admin-log.model';
import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-log-list',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslateModule, AdminPageHeaderComponent, PaginationComponent, FormsModule],
  templateUrl: './admin-log-list.component.html',
  styleUrl: './admin-log-list.component.css'
})
export class AdminLogListComponent implements OnInit {
  private firestore = inject(Firestore);
  private cdr = inject(ChangeDetectorRef);
  private toast = inject(ToastService);

  // Data State
  allLogs: AdminLog[] = [];
  filteredLogs: AdminLog[] = []; // Logs after search/filter but before pagination
  displayedLogs: AdminLog[] = []; // Logs for current page

  loading = true;
  error = false;

  // Filter State
  searchTerm = '';
  selectedModule = '';
  selectedAction = '';

  // Unique values for filter dropdowns
  modules: string[] = [];
  actions: string[] = [];

  // Pagination Configuration
  paginationConfig: PaginationConfig = {
    currentPage: 1,
    itemsPerPage: 10,
    totalItems: 0
  };

  async ngOnInit() {
    await this.loadLogs();
  }

  async loadLogs() {
    this.loading = true;
    this.cdr.markForCheck();

    try {
      // Fetch more logs to allow for meaningful filtering
      const colRef = collection(this.firestore, 'admin_logs');
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(500));
      const querySnapshot = await getDocs(q);

      this.allLogs = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data['timestamp'] instanceof Timestamp
            ? (data['timestamp'] as Timestamp).toDate()
            : data['timestamp']
        } as AdminLog;
      });

      this.extractFilterOptions();
      this.applyFilters();
      this.loading = false;
    } catch (err) {
      console.error('❌ Error loading logs:', err);
      this.error = true;
      this.loading = false;
      this.toast.error('Failed to load system logs');
    }
    this.cdr.detectChanges();
  }

  extractFilterOptions() {
    const uniqueModules = new Set(this.allLogs.map(log => log.module).filter(m => !!m));
    const uniqueActions = new Set(this.allLogs.map(log => log.action).filter(a => !!a));

    this.modules = Array.from(uniqueModules).sort();
    this.actions = Array.from(uniqueActions).sort();
  }

  applyFilters() {
    let result = [...this.allLogs];

    // 1. Module Filter
    if (this.selectedModule) {
      result = result.filter(log => log.module === this.selectedModule);
    }

    // 2. Action Filter
    if (this.selectedAction) {
      result = result.filter(log => log.action === this.selectedAction);
    }

    // 3. Search Filter
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase().trim();
      result = result.filter(log =>
        (log.userEmail?.toLowerCase().includes(term)) ||
        (log.details?.toLowerCase().includes(term)) ||
        (log.ipAddress?.includes(term))
      );
    }

    this.filteredLogs = result;
    this.paginationConfig.totalItems = result.length;
    this.paginationConfig.currentPage = 1; // Reset to first page on filter change
    this.updateDisplayedLogs();
  }

  updateDisplayedLogs() {
    console.log('--- updateDisplayedLogs ---');
    console.log('Config:', JSON.stringify(this.paginationConfig));
    console.log('Total items in filtered array:', this.filteredLogs.length);
    const startIndex = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
    const endIndex = startIndex + this.paginationConfig.itemsPerPage;
    this.displayedLogs = this.filteredLogs.slice(startIndex, endIndex);
    console.log('Displayed items count:', this.displayedLogs.length);
    console.log('---------------------------');
    this.cdr.markForCheck();
  }

  onSearchChange() {
    this.applyFilters();
  }

  onFilterChange() {
    this.applyFilters();
  }

  clearFilters() {
    this.searchTerm = '';
    this.selectedAction = '';
    this.selectedModule = '';
    this.applyFilters();
  }

  // Pagination Event Handlers
  onPageChange(page: number) {
    this.paginationConfig.currentPage = page;
    this.updateDisplayedLogs();
    // Optional: Scroll to top of grid
    const grid = document.querySelector('.product-grid-view');
    if (grid) grid.scrollTop = 0;
  }

  onItemsPerPageChange(itemsPerPage: number) {
    this.paginationConfig.itemsPerPage = itemsPerPage;
    this.paginationConfig.currentPage = 1;
    this.applyFilters(); // Re-apply to update totals/pages
  }
}
