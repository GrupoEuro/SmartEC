import { Component, Input, booleanAttribute, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../app-icon/app-icon.component';

@Component({
    selector: 'app-system-diagnostics',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
        <div class="diagnostics-panel">
            <div class="diagnostics-header" (click)="toggle()">
                <div class="header-left">
                    <app-icon name="tool" [size]="16" class="text-orange-500"></app-icon>
                    <span class="title">System Diagnostics</span>
                    <span class="version-badge">{{ version }}</span>
                </div>
                <div class="header-right">
                    <span class="status-dot" [class.active]="isConnected"></span>
                    <span class="timestamp">{{ timestamp | date:'mediumTime' }}</span>
                    <app-icon [name]="isExpanded() ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
                </div>
            </div>

            <div class="diagnostics-content" *ngIf="isExpanded()">
                <div class="data-section" *ngFor="let item of data | keyvalue">
                    <div class="key-label">{{ item.key }}:</div>
                    <pre class="json-dump">{{ item.value | json }}</pre>
                </div>
                
                <div class="empty-state" *ngIf="!data || (data | json) === '{}'">
                    No diagnostic data available.
                </div>
            </div>
        </div>
    `,
    styles: [`
        .diagnostics-panel {
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            margin-top: 2rem;
            overflow: hidden;
            font-family: 'JetBrains Mono', monospace;
        }

        .diagnostics-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 1rem;
            background: #1e293b;
            cursor: pointer;
            user-select: none;
        }

        .header-left, .header-right {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .title {
            color: #e2e8f0;
            font-weight: 600;
            font-size: 0.9rem;
        }

        .version-badge {
            background: #3b82f6;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: bold;
        }

        .timestamp {
            color: #94a3b8;
            font-size: 0.8rem;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ef4444;
            transition: background 0.3s ease;
        }

        .status-dot.active {
            background: #22c55e;
        }

        .diagnostics-content {
            padding: 1rem;
            border-top: 1px solid #334155;
            max-height: 500px;
            overflow-y: auto;
        }

        .data-section {
            margin-bottom: 1rem;
        }

        .key-label {
            color: #94a3b8;
            font-size: 0.8rem;
            margin-bottom: 0.25rem;
            font-weight: bold;
            text-transform: uppercase;
        }

        .json-dump {
            background: #020617;
            color: #22c55e;
            padding: 0.75rem;
            border-radius: 6px;
            font-size: 0.75rem;
            overflow-x: auto;
            margin: 0;
            border: 1px solid #1e293b;
        }

        .empty-state {
            color: #64748b;
            font-style: italic;
            text-align: center;
            padding: 1rem;
        }
    `]
})
export class SystemDiagnosticsComponent {
    @Input() data: any = {};
    @Input() version: string = 'v0.0.0';
    @Input() isConnected: boolean = true;

    isExpanded = signal(true);
    timestamp = new Date();

    toggle() {
        this.isExpanded.update(v => !v);
    }
}
