import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ProductStatus = 'draft' | 'published' | 'archived';

@Component({
    selector: 'app-status-badge',
    standalone: true,
    imports: [CommonModule],
    template: `
    <span class="status-badge" 
          [class.draft]="status === 'draft'"
          [class.published]="status === 'published'"
          [class.archived]="status === 'archived'"
          [class.small]="size === 'small'"
          [class.large]="size === 'large'"
          [attr.aria-label]="'Status: ' + statusLabel">
      <span class="badge-icon">{{ statusIcon }}</span>
      <span class="badge-text">{{ statusLabel }}</span>
    </span>
  `,
    styles: [`
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1;
      transition: all 0.2s;
      white-space: nowrap;
    }

    /* Size Variants */
    .status-badge.small {
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      gap: 0.25rem;
    }

    .status-badge.large {
      padding: 0.5rem 1rem;
      font-size: 1rem;
      gap: 0.5rem;
    }

    /* Draft Status */
    .status-badge.draft {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      color: #6c757d;
      border: 1px solid #dee2e6;
    }

    /* Published Status */
    .status-badge.published {
      background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
      color: #155724;
      border: 1px solid #b1dfbb;
    }

    /* Archived Status */
    .status-badge.archived {
      background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
      color: #856404;
      border: 1px solid #ffd93d;
    }

    .badge-icon {
      font-size: 1em;
      line-height: 1;
    }

    .badge-text {
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Hover Effect */
    .status-badge {
      cursor: default;
    }

    @media (max-width: 768px) {
      .status-badge {
        font-size: 0.8rem;
        padding: 0.3rem 0.6rem;
      }
    }
  `]
})
export class StatusBadgeComponent {
    @Input() status: ProductStatus = 'draft';
    @Input() size: 'small' | 'medium' | 'large' = 'medium';

    get statusIcon(): string {
        switch (this.status) {
            case 'draft':
                return '📝';
            case 'published':
                return '✅';
            case 'archived':
                return '📦';
            default:
                return '❓';
        }
    }

    get statusLabel(): string {
        switch (this.status) {
            case 'draft':
                return 'Draft';
            case 'published':
                return 'Published';
            case 'archived':
                return 'Archived';
            default:
                return 'Unknown';
        }
    }
}
