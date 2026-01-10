import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, getCountFromServer } from '@angular/fire/firestore';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { FirestoreTrackerService } from '../services/firestore-tracker.service';

interface StatItem {
    name: string;
    count: number | null;
    color: string;
    icon: string;
    collection: string;
}

interface StatGroup {
    title: string;
    items: StatItem[];
}

@Component({
    selector: 'app-database-outlook',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="db-container">
      <div class="db-header">
        <h1 class="page-title">Database Outlook</h1>
        <p class="page-subtitle">Real-time stats and live entity relationship schema.</p>
      </div>

      <!-- Stats Groups -->
      <div class="stats-groups">
          <div *ngFor="let group of groups()" class="stat-group glass-panel">
            <h3 class="group-title">{{group.title}}</h3>
            <div class="stats-grid">
                <div class="stat-card" *ngFor="let stat of group.items">
                    <div class="stat-icon" [ngClass]="stat.color">
                        <app-icon [name]="stat.icon" [size]="24"></app-icon>
                    </div>
                    <div class="stat-info">
                        <div class="stat-value">{{ stat.count !== null ? stat.count : '...' }}</div>
                        <div class="stat-label">{{ stat.name }}</div>
                    </div>
                </div>
            </div>
          </div>
      </div>

      <!-- Schema Diagram -->
      <div class="schema-container glass-panel">
        <div class="section-title">
            <app-icon name="share-2" [size]="20"></app-icon>
            <h2>Live Schema Engine</h2>
            <span class="badge-live">Active</span>
        </div>
        
        <div class="diagram-wrapper">
            <svg width="100%" height="600" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#475569" />
                    </marker>
                    <marker id="arrow-active" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
                    </marker>
                </defs>

                <!-- Links (Edges) -->
                <g *ngFor="let link of links">
                    <line 
                        [attr.x1]="getNode(link.source).x + 60" 
                        [attr.y1]="getNode(link.source).y + 30" 
                        [attr.x2]="getNode(link.target).x + 60" 
                        [attr.y2]="getNode(link.target).y + 30" 
                        class="edge"
                        [class.dashed]="link.type === 'weak'"
                        [class.active]="isLinkActive(link)"
                        [class.dimmed]="hoveredNode() && !isLinkActive(link)"
                        [attr.marker-end]="isLinkActive(link) ? 'url(#arrow-active)' : 'url(#arrow)'"
                    />
                </g>

                <!-- Nodes -->
                <g *ngFor="let node of nodes" 
                   [attr.transform]="'translate(' + node.x + ',' + node.y + ')'" 
                   class="node-group"
                   (mouseenter)="hoveredNode.set(node.id)"
                   (mouseleave)="hoveredNode.set(null)"
                   [class.dimmed]="hoveredNode() && hoveredNode() !== node.id && !isActiveNode(node.id)">
                    
                    <rect width="120" height="60" rx="8" 
                          class="node-rect" 
                          [class.highlight]="node.id === 'orders'" 
                          [class.active]="hoveredNode() === node.id || isActiveNode(node.id)" />
                          
                    <text x="60" y="35" text-anchor="middle" class="node-text">{{node.label}}</text>
                    
                    <!-- Connection Count Badge (Optional) -->
                   <!-- <circle cx="115" cy="5" r="5" fill="#ef4444" *ngIf="false" /> -->
                </g>
            </svg>
            
            <div class="legend">
                <div class="legend-item"><span class="line-sample solid"></span> Strong Relation (FK)</div>
                <div class="legend-item"><span class="line-sample dashed"></span> Soft / Optional</div>
            </div>
        </div>
      </div>
    </div>
  `,
    styleUrls: ['./database-outlook.component.css']
})
export class DatabaseOutlookComponent implements OnInit {
    private firestore = inject(Firestore);
    private tracker = inject(FirestoreTrackerService);

    hoveredNode = signal<string | null>(null);

    // Schema Engine Data
    nodes = [
        // Core
        { id: 'users', label: 'Users', x: 50, y: 50 },
        { id: 'customers', label: 'Customers', x: 250, y: 50 },

        // Catalog
        { id: 'categories', label: 'Categories', x: 50, y: 200 },
        { id: 'brands', label: 'Brands', x: 50, y: 350 },
        { id: 'products', label: 'Products', x: 250, y: 200 },
        { id: 'kits', label: 'Kits', x: 250, y: 350 },
        { id: 'distributors', label: 'Distributors', x: 250, y: 500 },

        // Operations
        { id: 'orders', label: 'Orders', x: 500, y: 200 },
        { id: 'notifications', label: 'Notifications', x: 500, y: 50 },
        { id: 'assignments', label: 'Assignments', x: 500, y: 350 },
        { id: 'logs', label: 'Logs', x: 500, y: 500 },

        // Content
        { id: 'banners', label: 'Banners', x: 750, y: 50 },
        { id: 'blog', label: 'Blog', x: 750, y: 200 },
        { id: 'approvals', label: 'Approvals', x: 750, y: 350 },
    ];

    links = [
        // Catalog
        { source: 'categories', target: 'products', type: 'strong' },
        { source: 'brands', target: 'products', type: 'strong' },
        { source: 'distributors', target: 'products', type: 'weak' },
        { source: 'products', target: 'kits', type: 'strong' },

        // Sales / Ops
        { source: 'products', target: 'orders', type: 'strong' },
        { source: 'customers', target: 'orders', type: 'strong' },
        { source: 'orders', target: 'assignments', type: 'strong' },
        { source: 'orders', target: 'notifications', type: 'weak' },
        { source: 'users', target: 'notifications', type: 'weak' },

        // System
        { source: 'assignments', target: 'logs', type: 'weak' },
        { source: 'users', target: 'logs', type: 'weak' },

        // Misc
        { source: 'users', target: 'approvals', type: 'strong' }, // Requested by
    ];

    groups = signal<StatGroup[]>([
        {
            title: 'Core & Catalog',
            items: [
                { name: 'Categories', count: null, color: 'yellow', icon: 'tag', collection: 'categories' },
                { name: 'Brands', count: null, color: 'yellow', icon: 'award', collection: 'brands' },
                { name: 'Products', count: null, color: 'blue', icon: 'box', collection: 'products' },
                { name: 'Kits', count: null, color: 'blue', icon: 'layers', collection: 'productKits' },
            ]
        },
        {
            title: 'Operations',
            items: [
                { name: 'Orders', count: null, color: 'green', icon: 'shopping-cart', collection: 'orders' },
                { name: 'Customers', count: null, color: 'purple', icon: 'users', collection: 'customers' },
                { name: 'Expenses', count: null, color: 'orange', icon: 'dollar-sign', collection: 'expenses' },
                { name: 'Distributors', count: null, color: 'cyan', icon: 'truck', collection: 'distributors' },
            ]
        },
        {
            title: 'System & Logs',
            items: [
                { name: 'Users', count: null, color: 'pink', icon: 'lock', collection: 'users' },
                { name: 'Logs', count: null, color: 'slate', icon: 'file-text', collection: 'admin_logs' },
                { name: 'Notifications', count: null, color: 'red', icon: 'bell', collection: 'notifications' },
                { name: 'Approvals', count: null, color: 'indigo', icon: 'check-circle', collection: 'approval_requests' },
            ]
        },
        {
            title: 'Content Management',
            items: [
                { name: 'Banners', count: null, color: 'cyan', icon: 'image', collection: 'banners' },
                { name: 'Blog Posts', count: null, color: 'cyan', icon: 'file-text', collection: 'blog_posts' },
                { name: 'Newsletter', count: null, color: 'cyan', icon: 'mail', collection: 'newsletter' },
                { name: 'PDFs', count: null, color: 'cyan', icon: 'file', collection: 'pdfs' },
            ]
        }
    ]);

    ngOnInit() {
        this.fetchCounts();
    }

    async fetchCounts() {
        // Deep copy signals to avoid mutation issues
        const currentGroups = JSON.parse(JSON.stringify(this.groups()));

        // Flatten all items to iterate
        const allItems: { groupIndex: number, itemIndex: number, item: StatItem }[] = [];
        currentGroups.forEach((group: StatGroup, gIdx: number) => {
            group.items.forEach((item: StatItem, iIdx: number) => {
                allItems.push({ groupIndex: gIdx, itemIndex: iIdx, item });
            });
        });

        await Promise.all(allItems.map(async (entry) => {
            try {
                const coll = collection(this.firestore, entry.item.collection);
                const snapshot = await getCountFromServer(coll);
                currentGroups[entry.groupIndex].items[entry.itemIndex].count = snapshot.data().count;
                this.tracker.trackRead(1); // Count metadata read
            } catch (e) {
                console.warn(`Error counting ${entry.item.name}:`, e);
                currentGroups[entry.groupIndex].items[entry.itemIndex].count = 0;
            }
        }));

        this.groups.set(currentGroups);
    }

    // Engine Helpers
    getNode(id: string) {
        return this.nodes.find(n => n.id === id) || { x: 0, y: 0 };
    }

    isLinkActive(link: any): boolean {
        const hovered = this.hoveredNode();
        if (!hovered) return false;
        return link.source === hovered || link.target === hovered;
    }

    isActiveNode(id: string): boolean {
        const hovered = this.hoveredNode();
        if (!hovered) return false;

        // Find links connected to hovered node
        const connectedIds = this.links
            .filter(l => l.source === hovered || l.target === hovered)
            .map(l => l.source === hovered ? l.target : l.source);

        return connectedIds.includes(id);
    }
}
