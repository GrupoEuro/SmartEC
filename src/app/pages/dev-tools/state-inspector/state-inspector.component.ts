import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StateRegistryService } from '../../../core/services/state-registry.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface Snapshot {
    id: string;
    name: string;
    timestamp: Date;
    data: any;
}

@Component({
    selector: 'app-state-inspector',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="inspector-container">
      <div class="header">
        <h1 class="page-title">State Inspector</h1>
        <p class="page-subtitle">Time-travel debugging and centralized state management.</p>
      </div>

      <div class="layout">
         <!-- Sidebar: Services -->
         <div class="sidebar glass-panel">
            <div class="section-title">
                <span>Services</span>
                <small>{{services().length}} active</small>
            </div>
            
            <div class="service-list">
                <button *ngFor="let service of services()" 
                        (click)="selectService(service)"
                        [class.active]="currentService() === service"
                        class="service-item">
                    <app-icon name="box" [size]="16"></app-icon>
                    <span>{{ service }}</span>
                </button>
                <div *ngIf="services().length === 0" class="empty-msg">
                    No active services found.<br>
                    <small>Register via StateRegistryService</small>
                </div>
            </div>

            <div class="section-title mt-8" style="margin-top: 2rem;">
                <span>Snapshots</span>
                <span class="badge-count" *ngIf="snapshots().length">{{snapshots().length}}</span>
            </div>
            
            <div class="snapshot-list">
                <div *ngFor="let snap of snapshots()" class="snapshot-item">
                    <div class="snap-info">
                        <span class="snap-name">{{ snap.name }}</span>
                        <span class="snap-time">{{ snap.timestamp | date:'mediumTime' }}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                         <button (click)="restoreSnapshot(snap)" class="action-btn" title="Restore this state">
                            <app-icon name="refresh-cw" [size]="14"></app-icon>
                        </button>
                        <button (click)="deleteSnapshot(snap.id)" class="action-btn danger" title="Delete">
                            <app-icon name="trash" [size]="14"></app-icon>
                        </button>
                    </div>
                </div>
                 <div *ngIf="snapshots().length === 0" class="empty-msg">
                    No snapshots captured yet.
                </div>
            </div>
         </div>

         <!-- Main: State Viewer -->
         <div class="main-content glass-panel">
            <div class="toolbar">
                <div class="current-label" *ngIf="currentService(); else noSelect">
                    <app-icon name="database" [size]="18" class="text-blue-400"></app-icon>
                    <span class="text-muted">Viewing:</span> 
                    <strong>{{ currentService() }}</strong>
                    <span class="badge-live">LIVE</span>
                </div>
                <ng-template #noSelect>
                    <div class="current-label text-muted">Select a service to inspect</div>
                </ng-template>

                <div class="actions">
                     <button (click)="refresh()" class="btn-tool" [disabled]="!currentService()" title="Force Refresh">
                        <app-icon name="refresh" [size]="16"></app-icon>
                        Refresh
                    </button>
                    <button (click)="takeSnapshot()" class="btn-tool primary" [disabled]="!currentService()">
                        <app-icon name="camera" [size]="16"></app-icon>
                        Snapshot
                    </button>
                     <button (click)="exportState()" class="btn-tool" [disabled]="!currentService()">
                        <app-icon name="download" [size]="16"></app-icon>
                        Export
                    </button>
                </div>
            </div>

            <div class="json-viewer" *ngIf="currentState(); else emptyState">
                <!-- TODO: Could use a real syntax highlighter lib here -->
                <pre [innerHTML]="formatJson(currentState())"></pre>
            </div>
            
            <ng-template #emptyState>
                <div class="empty-state-view">
                    <app-icon name="activity" [size]="64" class="opacity-50"></app-icon>
                    <h3>Ready to Inspect</h3>
                    <p>Select a service from the left sidebar to view its real-time state.</p>
                </div>
            </ng-template>
         </div>
      </div>
    </div>
  `,
    styles: [`
    .inspector-container { 
        padding: 2rem; 
        color: #e2e8f0; 
        height: calc(100vh - 64px); 
        display: flex; 
        flex-direction: column; 
        gap: 1.5rem;
        max-width: 1400px;
        margin: 0 auto;
    }
    
    .header { flex-shrink: 0; }
    .page-title { font-size: 1.8rem; font-weight: 700; color: #fff; margin: 0 0 0.5rem 0; letter-spacing: -0.025em; }
    .page-subtitle { color: #94a3b8; margin: 0; }

    .layout { 
        display: flex; 
        gap: 1.5rem; 
        flex: 1; 
        min-height: 0; 
    }
    
    .sidebar { 
        width: 300px; 
        flex-shrink: 0; 
        display: flex; 
        flex-direction: column; 
        gap: 2rem;
    }

    .section-title { 
        text-transform: uppercase; 
        font-size: 0.75rem; 
        color: #94a3b8; 
        font-weight: 700; 
        letter-spacing: 0.1em;
        margin-bottom: 1rem; 
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .service-list, .snapshot-list { 
        display: flex; 
        flex-direction: column; 
        gap: 0.5rem; 
        overflow-y: auto; 
    }
    
    /* Service Item */
    .service-item { 
        display: flex; 
        align-items: center; 
        gap: 1rem; 
        padding: 0.75rem 1rem; 
        width: 100%; 
        text-align: left; 
        background: transparent; 
        border: 1px solid transparent; 
        border-radius: 8px; 
        color: #cbd5e1; 
        cursor: pointer; 
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-weight: 500;
    }
    
    .service-item:hover { 
        background: rgba(255, 255, 255, 0.05); 
        color: #fff; 
        transform: translateX(4px);
    }
    
    .service-item.active { 
        background: rgba(59, 130, 246, 0.15); 
        border-color: rgba(59, 130, 246, 0.3); 
        color: #60a5fa; 
        transform: translateX(4px);
    }

    /* Snapshot Item */
    .snapshot-item { 
        background: rgba(30, 41, 59, 0.5); 
        padding: 0.75rem; 
        border-radius: 8px; 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        border: 1px solid rgba(255, 255, 255, 0.05); 
        transition: all 0.2s;
    }
    
    .snapshot-item:hover {
        border-color: rgba(255, 255, 255, 0.1);
        background: rgba(30, 41, 59, 0.8);
    }
    
    .snap-info { display: flex; flex-direction: column; gap: 0.25rem; }
    .snap-name { font-size: 0.825rem; font-weight: 600; color: #e2e8f0; }
    .snap-time { font-size: 0.7rem; color: #94a3b8; font-family: monospace; }
    
    .action-btn { 
        background: transparent; 
        border: none; 
        color: #94a3b8; 
        padding: 0.4rem; 
        border-radius: 6px; 
        cursor: pointer; 
        transition: all 0.2s; 
    }
    .action-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .action-btn.danger:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

    .empty-msg { 
        font-size: 0.875rem; 
        color: #64748b; 
        text-align: center; 
        padding: 2rem 0; 
        border: 1px dashed #334155;
        border-radius: 8px;
    }

    /* Main Content */
    /* Main Content */
    .main-content { 
        flex: 1; 
        display: flex; 
        flex-direction: column; 
        overflow: hidden; 
        /* box-shadow provided by glass-panel, but maybe we want the larger shadow here? */
        /* box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); */
    }
    
    .toolbar { 
        padding: 1rem 1.5rem; 
        border-bottom: 1px solid rgba(255, 255, 255, 0.05); 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        background: rgba(2, 6, 23, 0.5); 
        backdrop-filter: blur(8px);
    }
    
    .current-label { font-size: 1rem; color: #fff; display: flex; align-items: center; gap: 0.5rem; }
    .badge-live {
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
        font-size: 0.65rem;
        padding: 0.1rem 0.5rem;
        border-radius: 99px;
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.05em;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }
    
    .actions { display: flex; gap: 0.75rem; }
    .btn-tool { 
        background: rgba(255, 255, 255, 0.05); 
        border: 1px solid rgba(255, 255, 255, 0.05); 
        color: #cbd5e1; 
        padding: 0.5rem 1rem; 
        border-radius: 8px; 
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        gap: 0.5rem; 
        font-size: 0.875rem; 
        font-weight: 500;
        transition: all 0.2s; 
    }
    .btn-tool:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; border-color: rgba(255, 255, 255, 0.1); }
    .btn-tool:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-tool.primary { background: #3b82f6; border-color: #2563eb; color: #fff; }
    .btn-tool.primary:hover:not(:disabled) { background: #2563eb; }

    .json-viewer { 
        flex: 1; 
        overflow: auto; 
        padding: 1.5rem; 
        background: #0b1121; /* Slightly darker for code */
    }
    
    .json-viewer pre { 
        font-family: 'JetBrains Mono', 'Fira Code', monospace; 
        color: #a5b4fc; 
        margin: 0; 
        font-size: 0.875rem; 
        line-height: 1.6; 
    }
    
    /* JSON Syntax Highlighting (if implemented in template) */
    .key { color: #94a3b8; }
    .string { color: #a5b4fc; }
    .number { color: #f472b6; }
    .boolean { color: #34d399; }
    .null { color: #64748b; font-style: italic; }

    .empty-state-view { 
        flex: 1; 
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        justify-content: center; 
        color: #64748b; 
        gap: 1.5rem; 
    }
    .empty-state-view p { font-size: 1.1rem; }
    .opacity-50 { opacity: 0.5; }
  `]
})
export class StateInspectorComponent {
    private registry = inject(StateRegistryService);

    services = this.registry.registeredServices;
    currentService = signal<string | null>(null);
    currentState = signal<any>(null);
    snapshots = signal<Snapshot[]>([]);

    selectService(name: string) {
        this.currentService.set(name);
        this.refresh();
    }

    refresh() {
        const name = this.currentService();
        if (name) {
            this.currentState.set(this.registry.get(name));
        }
    }

    deleteSnapshot(id: string) {
        if (confirm('Delete this snapshot?')) {
            this.snapshots.update(s => s.filter(x => x.id !== id));
        }
    }

    takeSnapshot() {
        const nameService = this.currentService();
        const data = this.currentState();
        if (nameService && data) {
            const userLabel = prompt('Snapshot Name:', `${nameService} State`);
            if (!userLabel) return;

            const snap: Snapshot = {
                id: crypto.randomUUID(),
                name: userLabel,
                timestamp: new Date(),
                data: JSON.parse(JSON.stringify(data)) // Deep copy
            };
            this.snapshots.update(s => [snap, ...s]);
        }
    }

    restoreSnapshot(snap: Snapshot) {
        // Warning: This restores state to the CURRENTLY selected service
        // Ideally we check if snap.serviceName matches currentService
        if (!confirm(`Restore state to "${this.currentService()}"? This will overwrite current memory.`)) return;

        const name = this.currentService();
        if (name) {
            this.registry.set(name, snap.data);
            this.refresh();
        }
    }

    exportState() {
        const data = this.currentState();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentService()}_state_${new Date().toISOString()}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    formatJson(json: any): string {
        if (!json) return '';
        let jsonStr = JSON.stringify(json, null, 2);

        // Basic Syntax Highlighting via Regex
        jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }
}
