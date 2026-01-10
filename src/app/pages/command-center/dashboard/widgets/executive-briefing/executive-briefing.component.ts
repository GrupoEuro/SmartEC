import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { ExecutiveBriefing, Insight } from '../../../services/smart-briefing.service';

@Component({
    selector: 'app-executive-briefing',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
        <div class="briefing-container glass-panel" [ngClass]="briefing?.tone?.toLowerCase()">
            <!-- Header Section -->
            <div class="briefing-header">
                <div class="headline-group">
                    <div class="ai-badge">
                        <app-icon name="sparkles" [size]="14"></app-icon>
                        <span>AI Analyst</span>
                    </div>
                    <h1>{{ briefing?.headline || 'Analyzing business signals...' }}</h1>
                    <p class="timestamp" *ngIf="briefing">Generated at {{ briefing?.generatedAt | date:'shortTime' }}</p>
                </div>
                
                <!-- Health Score -->
                <div class="health-score" *ngIf="briefing">
                    <svg viewBox="0 0 36 36" class="circular-chart">
                        <path class="circle-bg"
                            d="M18 2.0845
                            a 15.9155 15.9155 0 0 1 0 31.831
                            a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path class="circle"
                            [attr.stroke-dasharray]="briefing.score + ', 100'"
                            d="M18 2.0845
                            a 15.9155 15.9155 0 0 1 0 31.831
                            a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                    </svg>
                    <div class="score-value">
                        <span class="number">{{ briefing.score }}</span>
                        <span class="label">Health</span>
                    </div>
                </div>
            </div>

            <!-- Insights Grid -->
            <div class="insights-grid" *ngIf="briefing && briefing.insights.length > 0">
                <div class="insight-card click-card" 
                     *ngFor="let insight of briefing.insights" 
                     [ngClass]="insight.type.toLowerCase()"
                     (click)="navigateToInsight(insight)">
                    
                    <div class="insight-icon">
                        <app-icon [name]="getIconForType(insight.type)" [size]="20"></app-icon>
                    </div>
                    
                    <div class="insight-content">
                        <div class="insight-top">
                            <span class="category-tag">{{ insight.category }}</span>
                            <!-- Drill Down Indicator -->
                            <app-icon name="arrow-right" [size]="12" class="arrow-icon"></app-icon>
                        </div>
                        <h3>{{ insight.title }}</h3>
                        <p>{{ insight.message }}</p>
                        <div class="impact-badge" *ngIf="insight.impact">
                            {{ insight.impact }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        .glass-panel {
            background: rgba(30, 41, 59, 0.6); /* Matched KPI Card Base */
            backdrop-filter: blur(12px);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
        }

        /* Subtle Top Border Glow instead of heavy left border */
        .glass-panel.positive { border-top: 2px solid rgba(16, 185, 129, 0.5); }
        .glass-panel.negative { border-top: 2px solid rgba(239, 68, 68, 0.5); }
        .glass-panel.mixed { border-top: 2px solid rgba(245, 158, 11, 0.5); }
        
        /* Subtle background tint based on tone */
        .glass-panel.positive::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(16, 185, 129, 0.05), transparent 70%); pointer-events: none; }
        .glass-panel.negative::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(239, 68, 68, 0.05), transparent 70%); pointer-events: none; }
        .glass-panel.mixed::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(245, 158, 11, 0.05), transparent 70%); pointer-events: none; }

        .briefing-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1.5rem;
            position: relative;
            z-index: 2;
        }

        .ai-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.7rem;
            font-weight: 600;
            color: #e2e8f0;
            margin-bottom: 0.75rem;
        }

        h1 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #f8fafc;
            margin: 0;
            line-height: 1.2;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .timestamp {
            font-size: 0.8rem;
            color: #94a3b8;
            margin-top: 0.5rem;
        }

        /* Health Score Chart */
        .health-score {
            position: relative;
            width: 70px; /* Slightly smaller for cleaner look */
            height: 70px;
        }
        .circular-chart {
            display: block;
            margin: 0 auto;
            max-width: 100%;
            max-height: 100%;
        }
        .circle-bg {
            fill: none;
            stroke: rgba(148, 163, 184, 0.1);
            stroke-width: 3;
        }
        .circle {
            fill: none;
            stroke: #10b981; 
            stroke-width: 3;
            stroke-linecap: round;
            animation: progress 1s ease-out forwards;
        }
        .negative .circle { stroke: #ef4444; }
        .mixed .circle { stroke: #f59e0b; }
        
        @keyframes progress {
            0% { stroke-dasharray: 0 100; }
        }

        .score-value {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            display: flex;
            flex-direction: column;
        }
        .score-value .number {
            font-size: 1.1rem;
            font-weight: 700;
            color: #e2e8f0;
            line-height: 1;
        }
        .score-value .label {
            font-size: 0.5rem;
            text-transform: uppercase;
            color: #94a3b8;
            margin-top: 2px;
        }

        /* Insights Grid */
        .insights-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            position: relative;
            z-index: 2;
        }

        .insight-card {
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 0.75rem;
            padding: 1rem;
            display: flex;
            gap: 1rem;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            position: relative;
        }
        
        .insight-card:hover {
            background: rgba(255, 255, 255, 0.08);
            transform: translateY(-2px);
            border-color: rgba(255, 255, 255, 0.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .click-card:active {
            transform: translateY(0);
        }

        .insight-icon {
            width: 36px;
            height: 36px;
            border-radius: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: transform 0.2s;
        }
        
        .insight-card:hover .insight-icon {
             transform: scale(1.1);
        }
        
        .insight-card:hover .arrow-icon {
            opacity: 1;
            transform: translateX(0);
        }

        .critical .insight-icon { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .warning .insight-icon { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .success .insight-icon { background: rgba(16, 185, 129, 0.15); color: #10b981; }

        .insight-content { flex: 1; }
        
        .insight-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.25rem;
        }
        
        .arrow-icon {
            opacity: 0;
            transform: translateX(-5px);
            transition: all 0.2s;
            color: #94a3b8;
        }
        
        .category-tag {
            font-size: 0.65rem;
            font-weight: 600;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .impact-badge {
            display: inline-block;
            margin-top: 0.5rem;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255,255,255,0.1);
            color: #e2e8f0;
        }

        h3 {
            font-size: 0.9rem;
            font-weight: 600;
            color: #f1f5f9;
            margin: 0.25rem 0;
        }

        p {
            font-size: 0.8rem;
            color: #cbd5e1;
            margin: 0;
            line-height: 1.4;
        }
    `]
})
export class ExecutiveBriefingComponent {
    @Input() briefing: ExecutiveBriefing | null = null;
    private router = inject(Router);

    getIconForType(type: string): string {
        switch (type) {
            case 'CRITICAL': return 'alert-triangle';
            case 'WARNING': return 'alert-circle';
            case 'SUCCESS': return 'trending-up';
            default: return 'info';
        }
    }

    navigateToInsight(insight: Insight) {
        let route = '/command-center/dashboard';
        switch (insight.category) {
            case 'SALES':
                route = '/command-center/sales-analytics';
                break;
            case 'INVENTORY':
                route = '/command-center/inventory-analytics';
                break;
            case 'OPERATIONS':
                route = '/command-center/operational-metrics';
                break;
            case 'FINANCIAL':
                route = '/command-center/financials';
                break;
        }
        this.router.navigate([route]);
    }
}
