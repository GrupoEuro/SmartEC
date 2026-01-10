import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandCenterContextService } from '../../../pages/command-center/services/command-center-context.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { toObservable } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-dashboard-diagnostics',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="debug-footer" [class.collapsed]="!isExpanded()">
        <div class="debug-header" (click)="toggle()">
            <div class="header-left">
                <h4>🔍 System Diagnostics</h4>
                <span class="version-badge">{{ buildVersion }}</span>
            </div>
            <div class="header-right">
                <span class="status-indicator">●</span>
                <app-icon [name]="isExpanded() ? 'chevron-down' : 'chevron-up'" [size]="16"></app-icon>
            </div>
        </div>

        <div class="diagnostics-content" *ngIf="isExpanded()">
            <div class="diagnostics-info">
                <div class="info-row">
                    <strong>User:</strong> {{ (user$ | async)?.email || 'Not Logged In' }}
                </div>
                <div class="info-row">
                    <strong>Role:</strong> {{ (userProfile$ | async)?.role || 'Unknown' }}
                </div>
                <div class="info-row">
                    <strong>Date Range:</strong> 
                    {{ contextService.dateRange()?.start | date:'short' }} - 
                    {{ contextService.dateRange()?.end | date:'short' }}
                </div>
            </div>

            <div *ngIf="logs.length > 0" class="activity-log">
                <h5>📋 Activity Log:</h5>
                <div *ngFor="let msg of logs" 
                    [class.error]="msg.includes('Error') || msg.includes('❌')"
                    [class.info]="!msg.includes('Error') && !msg.includes('❌')">
                    {{ msg }}
                </div>
            </div>
            <div *ngIf="logs.length === 0" class="status-ok">
                ✅ No errors ... (waiting for data)
            </div>
        </div>
    </div>
  `,
    styles: [`
    .debug-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        margin: 0;
        background: rgba(15, 23, 42, 0.98);
        border-top: 2px solid #fbbf24;
        color: #cbd5e1;
        font-family: monospace;
        font-size: 0.8rem;
        z-index: 9999;
        box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(8px);
        transition: all 0.3s ease;
    }

    .debug-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 1.5rem;
        cursor: pointer;
        background: rgba(30, 41, 59, 0.5);
    }
    
    .debug-header:hover {
        background: rgba(30, 41, 59, 0.8);
    }

    .header-left, .header-right {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .debug-footer h4 {
        margin: 0;
        font-size: 0.85rem;
        color: #fbbf24;
    }

    .version-badge {
        background: rgba(251, 191, 36, 0.1);
        color: #fbbf24;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.7rem;
    }

    .status-indicator {
        color: #22c55e;
        font-size: 0.7rem;
    }

    .diagnostics-content {
        padding: 0.75rem 1.5rem;
        max-height: 200px;
        overflow-y: auto;
        border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .diagnostics-info {
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #334155;
    }
    .info-row {
        margin-bottom: 0.25rem;
    }
    .activity-log h5 {
        color: #94a3b8;
        margin: 0.5rem 0;
    }
    .error {
        color: #ef4444;
    }
    .info {
        color: #3b82f6;
    }
    .status-ok {
        color: #22c55e;
    }
  `]
})
export class DashboardDiagnosticsComponent {
    @Input() logs: string[] = [];
    @Input() buildVersion: string = 'v1.0.0';

    public contextService = inject(CommandCenterContextService);
    private authService = inject(AuthService);

    user$ = this.authService.user$;
    userProfile$ = this.authService.userProfile$;

    isExpanded = signal(false); // Default to collapsed

    toggle() {
        this.isExpanded.update(v => !v);
    }
}
