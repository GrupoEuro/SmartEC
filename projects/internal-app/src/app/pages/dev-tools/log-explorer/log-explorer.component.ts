import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminLogService } from '../../../core/services/admin-log.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-log-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="logs-container">
      <div class="logs-header">
        <h1 class="page-title">Log Explorer</h1>
        <p class="page-subtitle">System-wide event tracking and audit trail.</p>
      </div>

      <!-- Controls -->
      <div class="controls-bar glass-panel">
        <div class="filter-group">
            <span class="filter-label">Module:</span>
            <div class="chip-group">
                <button *ngFor="let m of modules" 
                        (click)="setModule(m)"
                        [class.active]="currentModule() === m"
                        class="filter-chip">
                    {{ m }}
                </button>
            </div>
        </div>

        <div class="actions-group">
            <div class="search-box">
                <app-icon name="search" [size]="16" class="search-icon"></app-icon>
                <input type="text" placeholder="Search logs..." [ngModel]="searchText()" (ngModelChange)="searchText.set($event)">
            </div>
            <button (click)="refresh()" class="btn-refresh">
                <app-icon name="refresh" [size]="16"></app-icon>
                Refresh
            </button>
        </div>
      </div>

      <!-- Log Table -->
      <div class="table-wrapper glass-panel">
        <table class="log-table">
            <thead>
                <tr>
                    <th width="15%">Time</th>
                    <th width="10%">Module</th>
                    <th width="10%">Action</th>
                    <th width="20%">User</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                <tr *ngFor="let log of displayedLogs()" (click)="selectLog(log)" [class.selected]="selectedLog() === log">
                    <td class="text-mono">{{ log.timestamp | date:'short' }}</td>
                    <td>
                        <span class="badge" [ngClass]="getBadgeColor(log.module)">{{ log.module }}</span>
                    </td>
                    <td class="font-bold">{{ log.action }}</td>
                    <td class="text-muted">{{ log.userEmail || 'System' }}</td>
                    <td class="text-truncate">{{ log.details }}</td>
                </tr>
                <tr *ngIf="displayedLogs().length === 0">
                    <td colspan="5" class="empty-state">
                        <div class="empty-content">
                            <app-icon name="info" [size]="24"></app-icon>
                            No logs found matching your criteria.
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel glass-panel" *ngIf="selectedLog()">
        <div class="detail-header">
            <h3>Log Details</h3>
            <button (click)="selectLog(null)" class="btn-close">
                <app-icon name="x" [size]="16"></app-icon>
            </button>
        </div>
        <pre class="json-view">{{ selectedLog() | json }}</pre>
      </div>
    </div>
  `,
    styleUrls: ['./log-explorer.component.css']
})
export class LogExplorerComponent implements OnInit {
    private logService = inject(AdminLogService);

    modules = ['ALL', 'AUTH', 'ORDERS', 'INVENTORY', 'SYSTEM'];
    currentModule = signal('ALL');
    searchText = signal('');

    // Raw logs from DB (fetch more to allow client-side filtering)
    private rawLogs = signal<any[]>([]);

    selectedLog = signal<any>(null);

    // Client-side filtering computed
    displayedLogs = computed(() => {
        const logs = this.rawLogs();
        const mod = this.currentModule();
        const search = this.searchText().toLowerCase();

        return logs.filter(log => {
            // Module Filter
            if (mod !== 'ALL' && log.module !== mod) return false;

            // Search Filter
            if (search) {
                const content = `${log.action} ${log.details} ${log.userEmail} ${log.module}`.toLowerCase();
                if (!content.includes(search)) return false;
            }
            return true;
        });
    });

    ngOnInit() {
        this.refresh();
    }

    async refresh() {
        // Fetch ALL logs (limit 200) to allow client-side filtering without index issues
        const data = await this.logService.getLogs(200, 'ALL');
        this.rawLogs.set(data);
    }

    setModule(m: string) {
        this.currentModule.set(m);
        // No need to call refresh, computed will auto-update
    }

    selectLog(log: any) {
        this.selectedLog.set(log);
    }

    getBadgeColor(module: string): string {
        switch (module) {
            case 'AUTH': return 'badge-purple';
            case 'ORDERS': return 'badge-blue';
            case 'INVENTORY': return 'badge-green';
            case 'SYSTEM': return 'badge-red';
            default: return 'badge-gray';
        }
    }
}
