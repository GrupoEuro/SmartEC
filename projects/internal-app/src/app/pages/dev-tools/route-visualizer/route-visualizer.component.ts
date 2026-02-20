import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { APP_MAP, RouteNode } from './route-map.data';

@Component({
    selector: 'app-route-visualizer',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="visualizer-container">
      <div class="header">
        <div>
            <h1 class="page-title">Route Visualizer</h1>
            <p class="page-subtitle">Interactive map of the application architecture.</p>
        </div>
        <div class="controls">
            <div class="search-box">
                <app-icon name="search" [size]="16" class="search-icon"></app-icon>
                <input type="text" placeholder="Find page..." [ngModel]="searchTerm()" (ngModelChange)="searchTerm.set($event)">
            </div>
            <button class="btn-toggle" (click)="toggleAll()">
                {{ allExpanded() ? 'Collapse All' : 'Expand All' }}
            </button>
        </div>
      </div>

      <div class="map-surface">
         <div class="tree-root">
             <ng-container *ngTemplateOutlet="nodeTemplate; context: { nodes: filteredMap(), level: 0 }"></ng-container>
         </div>
      </div>

      <!-- Recursive Node Template -->
      <ng-template #nodeTemplate let-nodes="nodes" let-level="level">
        <div class="node-group" *ngFor="let node of nodes">
            <div class="node-wrapper" [style.padding-left.rem]="level * 2">
                <!-- Connector Lines -->
                <div class="connector-elbow" *ngIf="level > 0"></div>

                <div class="node-card" 
                     [class.has-children]="node.children?.length"
                     [ngClass]="node.type"
                     (click)="toggle(node)">
                    
                    <div class="node-icon">
                        <app-icon [name]="node.icon || 'circle'" [size]="16"></app-icon>
                    </div>
                    
                    <div class="node-info">
                        <span class="node-label">{{ node.label }}</span>
                        <span class="node-path">{{ node.path }}</span>
                    </div>

                    <div class="node-chevron" *ngIf="node.children?.length">
                        <app-icon [name]="isExpanded(node) ? 'chevron-down' : 'chevron-right'" [size]="14"></app-icon>
                    </div>
                </div>
            </div>

            <!-- Children Container -->
             <div class="children-container" *ngIf="node.children?.length && isExpanded(node)" [class.expanded]="isExpanded(node)">
                 <ng-container *ngTemplateOutlet="nodeTemplate; context: { nodes: node.children, level: level + 1 }"></ng-container>
             </div>
        </div>
      </ng-template>

    </div>
  `,
    styles: [`
    .visualizer-container { padding: 2rem; color: #e2e8f0; max-width: 1200px; margin: 0 auto; height: calc(100vh - 80px); display: flex; flex-direction: column; }
    
    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2rem; flex-shrink: 0; }
    .page-title { font-size: 1.8rem; font-weight: 700; color: #fff; margin: 0 0 0.5rem 0; }
    .page-subtitle { color: #94a3b8; margin: 0; }

    .controls { display: flex; gap: 1rem; }
    .search-box { position: relative; }
    .search-box input { background: #1e293b; border: 1px solid #334155; padding: 0.6rem 1rem 0.6rem 2.2rem; border-radius: 0.5rem; color: #fff; font-size: 0.9rem; width: 200px; transition: all 0.2s; }
    .search-box input:focus { border-color: #60a5fa; outline: none; width: 250px; }
    .search-icon { position: absolute; left: 0.8rem; top: 50%; transform: translateY(-50%); color: #94a3b8; }
    
    .btn-toggle { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 0 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; }
    .btn-toggle:hover { background: #334155; color: #fff; }

    /* Map Surface */
    .map-surface { flex: 1; overflow-y: auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 1rem; padding: 2rem; position: relative; }
    
    /* Tree Structure */
    .node-wrapper { position: relative; margin-bottom: 0.5rem; display: flex; align-items: center; }
    
    /* Connectors */
    .connector-elbow { position: absolute; left: calc(100% - 2rem - 18px); top: -0.75rem; width: 18px; height: calc(100% + 0.25rem); border-left: 2px solid #334155; border-bottom: 2px solid #334155; border-bottom-left-radius: 8px; pointer-events: none; opacity: 0.5; }

    .children-container { margin-left: 1rem; border-left: 1px dashed #334155; }

    /* Node Card */
    .node-card { background: #1e293b; border: 1px solid #334155; border-left-width: 4px; padding: 0.75rem 1rem; border-radius: 0.5rem; display: flex; align-items: center; gap: 1rem; width: fit-content; min-width: 250px; cursor: pointer; transition: all 0.2s; position: relative; user-select: none; }
    .node-card:hover { transform: translateX(5px); filter: brightness(1.2); }
    
    /* Node Types (Colors) */
    .node-card.public { border-left-color: #3b82f6; } /* Blue */
    .node-card.public .node-icon { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    
    .node-card.ops { border-left-color: #10b981; } /* Emerald */
    .node-card.ops .node-icon { color: #10b981; background: rgba(16, 185, 129, 0.1); }
    
    .node-card.system { border-left-color: #a855f7; } /* Purple */
    .node-card.system .node-icon { color: #a855f7; background: rgba(168, 85, 247, 0.1); }
    
    .node-card.admin { border-left-color: #ef4444; } /* Red */
    .node-card.admin .node-icon { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
    
    .node-card.dev { border-left-color: #64748b; } /* Slate */
    .node-card.dev .node-icon { color: #94a3b8; background: rgba(148, 163, 184, 0.1); }

    .node-icon { width: 32px; height: 32px; border-radius: 0.4rem; display: flex; align-items: center; justify-content: center; }
    .node-info { display: flex; flex-direction: column; }
    .node-label { font-weight: 600; color: #fff; font-size: 0.95rem; }
    .node-path { font-family: monospace; color: #94a3b8; font-size: 0.75rem; }
    .node-chevron { margin-left: auto; color: #64748b; }
  `]
})
export class RouteVisualizerComponent {
    searchTerm = signal('');
    expandedNodes = signal<Set<string>>(new Set(['/'])); // Initial expand root
    allExpanded = signal(false);

    // Original Data
    rawMap = APP_MAP;

    filteredMap = computed(() => {
        const term = this.searchTerm().toLowerCase();
        if (!term) return this.rawMap;

        // Deep filter function
        const filterNode = (node: RouteNode): RouteNode | null => {
            const matches = node.label.toLowerCase().includes(term) || node.path.toLowerCase().includes(term);
            const filteredChildren = node.children?.map(filterNode).filter(n => n !== null) as RouteNode[];

            if (matches || (filteredChildren && filteredChildren.length > 0)) {
                // If children matched, auto-expand this node
                if (filteredChildren && filteredChildren.length > 0) {
                    this.autoExpand(node);
                }
                return { ...node, children: filteredChildren };
            }
            return null;
        };

        return this.rawMap.map(filterNode).filter(n => n !== null) as RouteNode[];
    });

    isExpanded(node: RouteNode): boolean {
        if (this.searchTerm()) return true; // Always expand on search
        if (this.allExpanded()) return true;
        return this.expandedNodes().has(this.getNodeId(node));
    }

    toggle(node: RouteNode) {
        if (!node.children?.length) return;

        const id = this.getNodeId(node);
        this.expandedNodes.update(set => {
            const newSet = new Set(set);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }

    toggleAll() {
        this.allExpanded.update(v => !v);
    }

    private getNodeId(node: RouteNode): string {
        return `${node.type}-${node.path}-${node.label}`;
    }

    private autoExpand(node: RouteNode) {
        // Hacky side-effect inside computed, but works for search UX
        const id = this.getNodeId(node);
        // We can't update signal inside computed easily without allowSignalWrites.
        // For now, let's rely on the "if (this.searchTerm()) return true" check in isExpanded.
    }
}
