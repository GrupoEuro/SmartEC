import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { KPICard } from '../../../core/models/business-metrics.model';
import { AppIconComponent } from '../app-icon/app-icon.component';

@Component({
    selector: 'app-kpi-card',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    template: `
        <div class="kpi-card" [class.loading]="card.loading">
            <div class="kpi-header">
                <span class="kpi-icon-wrapper">
                    <app-icon [name]="card.icon" [size]="28" class="text-yellow-400 drop-shadow-glow"></app-icon>
                </span>
                <h3 class="kpi-title">{{ card.title | translate }}</h3>
            </div>

            <div class="kpi-value">
                <span class="value">{{ formatValue(card.value, card.format) }}</span>
            </div>

            <div class="kpi-footer">
                <span class="trend" [class.up]="card.trend === 'up'" 
                      [class.down]="card.trend === 'down'"
                      [class.neutral]="card.trend === 'neutral'">
                    <app-icon [name]="getTrendIconName(card.trend)" [size]="16" class="trend-icon-svg"></app-icon>
                    <span class="trend-value">{{ formatChange(card.change, card.format) }}</span>
                </span>
                <span class="trend-label">{{ card.changeLabel | translate }}</span>
            </div>

            <div class="loading-overlay" *ngIf="card.loading">
                <div class="spinner"></div>
            </div>
        </div>
    `,
    styles: [`
        .kpi-card {
            position: relative;
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 1rem;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
            transition: all 0.3s;
            overflow: hidden;
        }

        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);
            opacity: 0;
            transition: opacity 0.3s;
        }

        .kpi-card:hover {
            border-color: rgba(251, 191, 36, 0.4);
            transform: translateY(-4px);
            box-shadow: 0 8px 24px rgba(251, 191, 36, 0.15);
        }

        .kpi-card:hover::before {
            opacity: 1;
        }

        .kpi-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }

        .kpi-icon-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: rgba(251, 191, 36, 0.1);
            border: 1px solid rgba(251, 191, 36, 0.2);
        }

        /* Helper class for icon color inheritance */
        :host ::ng-deep .text-yellow-400 {
            color: #fbbf24;
        }
        
        :host ::ng-deep .drop-shadow-glow {
            filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.3));
        }

        .kpi-title {
            margin: 0;
            font-size: 0.875rem;
            font-weight: 600;
            color: #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .kpi-value {
            margin-bottom: 1rem;
        }

        .value {
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1;
        }

        .kpi-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
        }

        .trend {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.25rem 0.75rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            font-weight: 600;
        }

        .trend.up {
            background: rgba(34, 197, 94, 0.1);
            color: #22c55e;
        }

        .trend.down {
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
        }

        .trend.neutral {
            background: rgba(148, 163, 184, 0.1);
            color: #94a3b8;
        }

        .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(15, 23, 42, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(251, 191, 36, 0.2);
            border-top-color: #fbbf24;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
            .value {
                font-size: 2rem;
            }
        }
    `]
})
export class KpiCardComponent {
    @Input() card!: KPICard;

    formatValue(value: number | string, format: string): string {
        if (typeof value === 'string') return value;

        switch (format) {
            case 'currency':
                return new Intl.NumberFormat('es-MX', {
                    style: 'currency',
                    currency: 'MXN',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                }).format(value);
            case 'percentage':
                return `${value.toFixed(1)}%`;
            case 'number':
            default:
                return new Intl.NumberFormat('es-MX').format(value);
        }
    }

    formatChange(change: number, format: string): string {
        if (change === 0) return '—';

        const prefix = change > 0 ? '+' : '';

        if (format === 'percentage' || format === 'number') {
            return `${prefix}${change.toFixed(1)}%`;
        }

        return `${prefix}${change.toFixed(1)}%`;
    }

    getTrendIconName(trend: 'up' | 'down' | 'neutral'): string {
        switch (trend) {
            case 'up': return 'trending-up';
            case 'down': return 'trending-down';
            case 'neutral': return 'trending-neutral';
        }
    }
}
