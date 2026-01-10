import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-character-counter',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="character-counter" [class.warning]="isWarning" [class.danger]="isDanger">
      <div class="counter-bar">
        <div class="counter-progress" [style.width.%]="percentage" [class.warning]="isWarning" [class.danger]="isDanger"></div>
      </div>
      <div class="counter-text">
        <span class="current">{{ current }}</span>
        <span class="separator">/</span>
        <span class="limit">{{ limit }}</span>
        <span class="status-text" *ngIf="statusText">{{ statusText }}</span>
      </div>
    </div>
  `,
    styles: [`
    .character-counter {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.875rem;
      transition: all 0.2s;
    }

    .counter-bar {
      flex: 1;
      height: 6px;
      background: #e9ecef;
      border-radius: 3px;
      overflow: hidden;
    }

    .counter-progress {
      height: 100%;
      background: #28a745;
      transition: all 0.3s ease;
      border-radius: 3px;
    }

    .counter-progress.warning {
      background: #ffc107;
    }

    .counter-progress.danger {
      background: #dc3545;
    }

    .counter-text {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-weight: 500;
      min-width: 80px;
    }

    .current {
      color: #333;
    }

    .character-counter.warning .current {
      color: #ff8c00;
    }

    .character-counter.danger .current {
      color: #dc3545;
    }

    .separator {
      color: #999;
    }

    .limit {
      color: #666;
    }

    .status-text {
      margin-left: 0.5rem;
      font-size: 0.75rem;
      color: #666;
      font-style: italic;
    }

    .character-counter.warning .status-text {
      color: #ff8c00;
    }

    .character-counter.danger .status-text {
      color: #dc3545;
    }
  `]
})
export class CharacterCounterComponent {
    @Input() current: number = 0;
    @Input() limit: number = 100;
    @Input() softLimit?: number; // Warning threshold

    get percentage(): number {
        return Math.min((this.current / this.limit) * 100, 100);
    }

    get isWarning(): boolean {
        if (this.softLimit) {
            return this.current >= this.softLimit && this.current < this.limit;
        }
        return this.current >= this.limit * 0.9 && this.current < this.limit;
    }

    get isDanger(): boolean {
        return this.current >= this.limit;
    }

    get statusText(): string {
        if (this.isDanger) {
            return 'Too long';
        }
        if (this.isWarning) {
            return 'Almost there';
        }
        if (this.current > 0 && this.current < (this.softLimit || this.limit * 0.5)) {
            return 'Good';
        }
        return '';
    }
}
