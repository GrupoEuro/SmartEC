import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
    selector: 'app-stats-card',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    <div class="stats-card" [class.clickable]="link" [routerLink]="link">
      <div class="stats-icon" [style.background]="iconBg">
        {{ icon }}
      </div>
      <div class="stats-content">
        <div class="stats-label">{{ label }}</div>
        <div class="stats-value">{{ value }}</div>
        @if (subtitle) {
          <div class="stats-subtitle">{{ subtitle }}</div>
        }
      </div>
    </div>
  `,
    styles: [`
    .stats-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
      display: flex;
      align-items: center;
      gap: 1rem;
      transition: all 0.2s;
      border: 1px solid #eee;
    }

    .stats-card.clickable {
      cursor: pointer;
    }

    .stats-card.clickable:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .stats-icon {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.75rem;
      flex-shrink: 0;
    }

    .stats-content {
      flex: 1;
    }

    .stats-label {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.25rem;
      font-weight: 500;
    }

    .stats-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: #1a1a2e;
      line-height: 1;
    }

    .stats-subtitle {
      font-size: 0.75rem;
      color: #999;
      margin-top: 0.5rem;
    }
  `]
})
export class StatsCardComponent {
    @Input() icon: string = '📊';
    @Input() iconBg: string = '#e3f2fd';
    @Input() label: string = '';
    @Input() value: string | number = 0;
    @Input() subtitle?: string;
    @Input() link?: string;
}
