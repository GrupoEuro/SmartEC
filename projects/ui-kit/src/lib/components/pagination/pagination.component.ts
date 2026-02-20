import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

export interface PaginationConfig {
  id?: string;
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
}

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="pagination-container" *ngIf="totalPages > 0">
      <!-- Items per page selector -->
      <div class="items-per-page">
        <label for="itemsPerPage">{{ translationPrefix + '.ITEMS_PER_PAGE' | translate }}:</label>
        <select 
          id="itemsPerPage" 
          [ngModel]="config.itemsPerPage" 
          (ngModelChange)="onItemsPerPageChange($event)"
          class="items-select">
          <option [value]="5">5</option>
          <option [value]="10">10</option>
          <option [value]="25">25</option>
          <option [value]="50">50</option>
          <option [value]="100">100</option>
        </select>
      </div>

      <!-- Page info -->
      <div class="page-info">
        <span>{{ getPageInfo() }}</span>
      </div>

      <!-- Page navigation -->
      <div class="page-controls">
        <!-- First page -->
        <button 
          class="page-btn" 
          [disabled]="config.currentPage === 1"
          (click)="goToPage(1)"
          [title]="'PAGINATION.FIRST' | translate">
          ⏮
        </button>

        <!-- Previous page -->
        <button 
          class="page-btn" 
          [disabled]="config.currentPage === 1"
          (click)="goToPage(config.currentPage - 1)"
          [title]="'PAGINATION.PREVIOUS' | translate">
          ◀
        </button>

        <!-- Page numbers -->
        <div class="page-numbers">
          <button 
            *ngFor="let page of getPageNumbers()" 
            class="page-btn"
            [class.active]="page === config.currentPage"
            [class.ellipsis]="page === -1"
            [disabled]="page === -1"
            (click)="page !== -1 && goToPage(page)">
            {{ page === -1 ? '...' : page }}
          </button>
        </div>

        <!-- Next page -->
        <button 
          class="page-btn" 
          [disabled]="config.currentPage === totalPages"
          (click)="goToPage(config.currentPage + 1)"
          [title]="'PAGINATION.NEXT' | translate">
          ▶
        </button>

        <!-- Last page -->
        <button 
          class="page-btn" 
          [disabled]="config.currentPage === totalPages"
          (click)="goToPage(totalPages)"
          [title]="'PAGINATION.LAST' | translate">
          ⏭
        </button>
      </div>
    </div>
  `,
  styles: [`
    .pagination-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1rem 0;
      background: transparent;
      border-top: none;
      flex-wrap: wrap;
    }

    .items-per-page {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.875rem;
      color: #94a3b8;
    }

    .items-select {
      appearance: none;
      padding: 0.375rem 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      font-size: 0.875rem;
      background: rgba(255, 255, 255, 0.05);
      color: #e2e8f0;
      cursor: pointer;
      transition: all 0.2s;
    }

    .items-select:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .items-select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .page-info {
      font-size: 0.875rem;
      color: #94a3b8;
      flex: 1;
      text-align: center;
    }

    .page-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .page-numbers {
      display: flex;
      gap: 0.5rem;
      margin: 0 0.5rem;
    }

    .page-btn {
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: #e2e8f0;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .page-btn:hover:not(:disabled):not(.ellipsis) {
      background: rgba(59, 130, 246, 0.1);
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .page-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      border-color: transparent;
    }

    .page-btn.active {
      background: #3b82f6;
      border-color: #3b82f6;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .page-btn.ellipsis {
      border: none;
      background: transparent;
      cursor: default;
      color: #64748b;
    }

    @media (max-width: 768px) {
      .pagination-container {
        flex-direction: column;
        gap: 1rem;
        align-items: center;
      }
      
      .page-info {
        order: -1;
        width: 100%;
      }
      
      .items-per-page, .page-controls {
        justify-content: center;
      }
      
      .page-numbers {
        display: none;
      }
    }
  `]
})
export class PaginationComponent {
  @Input() config!: PaginationConfig;
  @Input() translationPrefix: string = 'ADMIN.PRODUCTS'; // Default to admin products
  @Output() pageChange = new EventEmitter<number>();
  @Output() itemsPerPageChange = new EventEmitter<number>();

  constructor(private translate: TranslateService) { }

  get totalPages(): number {
    return Math.ceil(this.config.totalItems / this.config.itemsPerPage);
  }

  getPageInfo(): string {
    const start = (this.config.currentPage - 1) * this.config.itemsPerPage + 1;
    const end = Math.min(this.config.currentPage * this.config.itemsPerPage, this.config.totalItems);
    return this.translate.instant(`${this.translationPrefix}.SHOWING_ITEMS`, {
      start: start,
      end: end,
      total: this.config.totalItems
    });
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    const current = this.config.currentPage;

    if (total <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (current > 3) {
        pages.push(-1); // Ellipsis
      }

      // Show pages around current
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (current < total - 2) {
        pages.push(-1); // Ellipsis
      }

      // Always show last page
      pages.push(total);
    }

    return pages;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.config.currentPage) {
      this.pageChange.emit(page);
    }
  }

  onItemsPerPageChange(value: number): void {
    this.itemsPerPageChange.emit(value);
  }
}
