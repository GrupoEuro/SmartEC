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
    description?: string;
}

type PerspectiveId = 'all' | 'storefront' | 'commerce' | 'logistics' | 'operations';

interface PerspectiveDef {
    id: PerspectiveId;
    label: string;
    icon: string;
    core: string[]; // Fully visible
    deps: string[]; // Ghosted/Dimmed
}

interface DomainGroup {
    id: string;
    title: string;
    description: string;
    color: string; // Taildwind-ish color name
    isExpanded: boolean;
    items: StatItem[];
}

@Component({
    selector: 'app-database-outlook',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="db-container">
      <div class="db-header">
        <h1 class="page-title">Mission Control <span class="version-badge">v3.0</span></h1>
        <p class="page-subtitle">Live Database Schema & Operational Metrics Control Tower.</p>
      </div>

      <!-- Domain Accordions -->
      <div class="domain-accordions">
          <div *ngFor="let group of groups(); let i = index" 
               class="domain-section glass-panel" 
               [class.expanded]="group.isExpanded">
            
            <!-- Accordion Header -->
            <div class="domain-header" (click)="toggleGroup(i)">
                <div class="domain-title-wrapper">
                    <div class="domain-icon" [ngClass]="group.color">
                        <app-icon [name]="getGroupIcon(group.id)" [size]="24"></app-icon>
                    </div>
                    <div class="domain-info">
                        <h3 class="domain-title">{{group.title}}</h3>
                        <p class="domain-desc">{{group.description}}</p>
                    </div>
                </div>
                
                <div class="domain-meta">
                    <span class="collection-count">{{group.items.length}} Collections</span>
                    <app-icon [name]="group.isExpanded ? 'chevron-up' : 'chevron-down'" [size]="20" class="chevron"></app-icon>
                </div>
            </div>

            <!-- Accordion Content -->
            <div class="domain-content" *ngIf="group.isExpanded">
                <div class="stats-grid">
                    <div class="stat-card" *ngFor="let stat of group.items">
                        <div class="stat-icon" [ngClass]="stat.color">
                            <app-icon [name]="stat.icon" [size]="24"></app-icon>
                        </div>
                        <div class="stat-info">
                            <div class="stat-value">{{ stat.count !== null ? (stat.count | number) : '...' }}</div>
                            <div class="stat-label">{{ stat.name }}</div>
                            <div class="stat-desc" *ngIf="stat.description">{{ stat.description }}</div>
                        </div>
                    </div>
                </div>
                
                <!-- Best Practices Tip -->
                <div class="domain-tip">
                    <app-icon name="info" [size]="16"></app-icon>
                    <span><strong>Pro Tip:</strong> {{getDomainTip(group.id)}}</span>
                </div>
            </div>
          </div>
      </div>

      <!-- Live Schema Diagram -->
      <div class="schema-container glass-panel">
        <div class="section-title">
            <div class="title-left">
                <app-icon name="share-2" [size]="20"></app-icon>
                <h2>Live Entity Relationship Diagram (ERD)</h2>
            </div>
            
            <!-- Focus Mode Pill Control -->
            <div class="focus-pills">
                <button *ngFor="let p of perspectives" 
                        (click)="setPerspective(p.id)"
                        [class.active]="viewMode() === p.id"
                        class="pill-btn">
                    <app-icon [name]="p.icon" [size]="14"></app-icon>
                    <span>{{p.label}}</span>
                </button>
            </div>

            <span class="badge-live"> <span class="dot"></span> Live Connection</span>
        </div>
        
        <div class="diagram-wrapper">
            <svg width="100%" height="800" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
                <defs>
                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#475569" />
                    </marker>
                    <marker id="arrow-active" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
                    </marker>
                    <!-- Domain Zones -->
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="5" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                    </filter>
                </defs>

                <!-- Background Zones (Optional, for visual grouping) -->
                <!-- Storefront Zone -->
                <rect x="20" y="20" width="1160" height="150" rx="10" fill="rgba(59, 130, 246, 0.03)" stroke="rgba(59, 130, 246, 0.1)" stroke-dasharray="5,5" />
                <text x="40" y="45" fill="#3b82f6" opacity="0.5" font-size="10" font-weight="bold">STOREFRONT & CATALOG</text>

                <!-- E-Commerce Zone -->
                <rect x="20" y="190" width="1160" height="150" rx="10" fill="rgba(16, 185, 129, 0.03)" stroke="rgba(16, 185, 129, 0.1)" stroke-dasharray="5,5" />
                <text x="40" y="215" fill="#10b981" opacity="0.5" font-size="10" font-weight="bold">E-COMMERCE & CRM</text>

                <!-- Logistics Zone -->
                <rect x="20" y="360" width="1160" height="240" rx="10" fill="rgba(249, 115, 22, 0.03)" stroke="rgba(249, 115, 22, 0.1)" stroke-dasharray="5,5" />
                <text x="40" y="385" fill="#f97316" opacity="0.5" font-size="10" font-weight="bold">LOGISTICS & INVENTORY</text>

                <!-- System Zone -->
                <rect x="20" y="620" width="1160" height="150" rx="10" fill="rgba(148, 163, 184, 0.03)" stroke="rgba(148, 163, 184, 0.1)" stroke-dasharray="5,5" />
                <text x="40" y="645" fill="#94a3b8" opacity="0.5" font-size="10" font-weight="bold">SYSTEM & OPS</text>

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
                        *ngIf="isLinkVisible(link)"
                    />
                </g>

                <!-- Nodes -->
                <ng-container *ngFor="let node of nodes">
                <g *ngIf="isNodeVisible(node.id)"
                   [attr.transform]="'translate(' + node.x + ',' + node.y + ')'" 
                   class="node-group"
                   (mouseenter)="hoveredNode.set(node.id)"
                   (mouseleave)="hoveredNode.set(null)"
                   [class.dimmed]="hoveredNode() && hoveredNode() !== node.id && !isActiveNode(node.id)">
                    
                    <rect width="120" height="60" rx="8" 
                          class="node-rect" 
                          [class.highlight]="node.highlight" 
                          [class.active]="hoveredNode() === node.id || isActiveNode(node.id)" 
                          [class.ghost]="isNodeGhost(node.id)" />
                          
                    <text x="60" y="35" text-anchor="middle" class="node-text">{{node.label}}</text>
                    
                    <!-- Type Badge -->
                    <circle cx="110" cy="10" r="4" [attr.fill]="getNodeColor(node.type)" />
                </g>
                </ng-container>
            </svg>
            
            <div class="legend">
                <div class="legend-item"><span class="dot blue"></span> Storefront</div>
                <div class="legend-item"><span class="dot green"></span> E-Commerce</div>
                <div class="legend-item"><span class="dot orange"></span> Logistics</div>
                <div class="legend-item"><span class="dot slate"></span> System</div>
                <div class="divider"></div>
                <div class="legend-item"><span class="line-sample solid"></span> Foreign Key</div>
                <div class="legend-item"><span class="line-sample dashed"></span> Loose Link</div>
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
    viewMode = signal<PerspectiveId>('all');

    perspectives: PerspectiveDef[] = [
        { id: 'all', label: 'All', icon: 'grid', core: [], deps: [] },
        {
            id: 'storefront', label: 'Store', icon: 'shopping-bag',
            core: ['brands', 'categories', 'products', 'kits', 'pricing', 'blog', 'commissions'],
            deps: ['balances', 'coupons'] // In stock? Discounts?
        },
        {
            id: 'commerce', label: 'Commerce', icon: 'credit-card',
            core: ['orders', 'customers', 'users', 'expenses', 'coupons', 'notifications', 'inbound'],
            deps: ['products', 'ledger', 'assignments'] // What did they buy? Cost basis? Who packed it?
        },
        {
            id: 'logistics', label: 'Logistics', icon: 'box',
            core: ['warehouses', 'zones', 'structures', 'locations', 'doors', 'obstacles', 'scale_markers', 'ledger', 'balances'],
            deps: ['products', 'inbound', 'orders'] // Dimensions? What's arriving? What's leaving?
        },
        {
            id: 'operations', label: 'Ops', icon: 'settings',
            core: ['staff', 'assignments', 'orderNotes', 'priorities', 'approvals', 'logs', 'config', 'backlog'],
            deps: ['orders', 'warehouses'] // Working on what? Where?
        }
    ];

    // Live Schema Engine Data
    nodes = [
        // --- 1. STOREFRONT (Blue) ---
        { id: 'brands', label: 'Brands', x: 50, y: 70, type: 'store', highlight: false },
        { id: 'categories', label: 'Categories', x: 250, y: 70, type: 'store', highlight: false },
        { id: 'products', label: 'Products', x: 450, y: 70, type: 'store', highlight: true },
        { id: 'kits', label: 'Product Kits', x: 650, y: 70, type: 'store', highlight: false },
        { id: 'pricing', label: 'Pricing Rules', x: 850, y: 70, type: 'store', highlight: false },
        { id: 'blog', label: 'Blog Posts', x: 1050, y: 70, type: 'store', highlight: false },
        { id: 'commissions', label: 'Commission Rules', x: 1050, y: 150, type: 'store', highlight: false },

        // --- 2. COMMERCE & FINANCE (Green) ---
        { id: 'orders', label: 'Orders', x: 250, y: 240, type: 'ecom', highlight: true },
        { id: 'customers', label: 'Customers', x: 50, y: 240, type: 'ecom', highlight: false },
        { id: 'users', label: 'Auth Users', x: 50, y: 320, type: 'ecom', highlight: false },
        { id: 'expenses', label: 'Expenses (P&L)', x: 450, y: 240, type: 'ecom', highlight: false },
        { id: 'coupons', label: 'Coupons', x: 650, y: 240, type: 'ecom', highlight: false },
        { id: 'notifications', label: 'Notifications', x: 850, y: 240, type: 'ecom', highlight: false },
        { id: 'inbound', label: 'Purchase Orders', x: 1050, y: 240, type: 'ecom', highlight: false },

        // --- 3. WAREHOUSE & INVENTORY (Orange) ---
        { id: 'warehouses', label: 'Warehouses', x: 50, y: 450, type: 'logistics', highlight: false },
        { id: 'zones', label: 'Zones', x: 250, y: 450, type: 'logistics', highlight: false },
        { id: 'structures', label: 'Racks', x: 450, y: 450, type: 'logistics', highlight: false },
        { id: 'locations', label: 'Bins (Locs)', x: 650, y: 450, type: 'logistics', highlight: true },
        { id: 'doors', label: 'Doors', x: 850, y: 450, type: 'logistics', highlight: false },
        { id: 'obstacles', label: 'Obstacles', x: 1050, y: 450, type: 'logistics', highlight: false },

        { id: 'balances', label: 'Balances (Cache)', x: 450, y: 530, type: 'logistics', highlight: false },
        { id: 'ledger', label: 'Inv. Ledger', x: 650, y: 530, type: 'logistics', highlight: true },

        // --- 4. OPERATIONS & SYSTEM (Slate) ---
        { id: 'staff', label: 'Staff Profiles', x: 50, y: 700, type: 'sys', highlight: false },
        { id: 'assignments', label: 'Allocations', x: 250, y: 700, type: 'sys', highlight: true },
        { id: 'logs', label: 'Admin Logs', x: 450, y: 700, type: 'sys', highlight: false },
        { id: 'approvals', label: 'Approvals', x: 650, y: 700, type: 'sys', highlight: false },
        { id: 'backlog', label: 'Backlog', x: 850, y: 700, type: 'sys', highlight: false },
        { id: 'config', label: 'Global Config', x: 1050, y: 700, type: 'sys', highlight: false },
        { id: 'priorities', label: 'Order Priorities', x: 850, y: 780, type: 'sys', highlight: false },
        { id: 'scale_markers', label: 'Scale Markers', x: 1050, y: 740, type: 'logistics', highlight: false },
    ];

    links = [
        // Storefront
        { source: 'brands', target: 'products', type: 'strong' },
        { source: 'categories', target: 'products', type: 'strong' },
        { source: 'products', target: 'kits', type: 'strong' },
        { source: 'pricing', target: 'products', type: 'weak' },
        { source: 'commissions', target: 'pricing', type: 'weak' },
        { source: 'blog', target: 'products', type: 'weak' },

        // Commerce & Finance
        { source: 'users', target: 'customers', type: 'strong' },
        { source: 'customers', target: 'orders', type: 'strong' },
        { source: 'orders', target: 'expenses', type: 'strong' }, // Expenses linked to Orders (P&L)
        { source: 'coupons', target: 'orders', type: 'weak' },
        { source: 'orders', target: 'notifications', type: 'weak' },

        // Logistics
        { source: 'warehouses', target: 'zones', type: 'strong' },
        { source: 'zones', target: 'structures', type: 'strong' },
        { source: 'structures', target: 'locations', type: 'strong' },
        { source: 'warehouses', target: 'doors', type: 'strong' },
        { source: 'warehouses', target: 'obstacles', type: 'strong' },
        { source: 'locations', target: 'balances', type: 'strong' },
        { source: 'locations', target: 'ledger', type: 'strong' },
        { source: 'products', target: 'balances', type: 'strong' }, // Cross-domain
        { source: 'products', target: 'ledger', type: 'strong' }, // Cross-domain
        { source: 'inbound', target: 'ledger', type: 'strong' }, // POs drive inventory

        // Operations & System
        { source: 'staff', target: 'assignments', type: 'strong' },
        { source: 'assignments', target: 'orders', type: 'strong' }, // Cross-domain
        { source: 'staff', target: 'approvals', type: 'strong' },
        { source: 'approvals', target: 'orders', type: 'weak' },
        { source: 'staff', target: 'logs', type: 'weak' },
    ];

    groups = signal<DomainGroup[]>([
        {
            id: 'storefront',
            title: 'Storefront & Catalog',
            description: 'Public-facing data visible to unauthenticated users.',
            color: 'blue',
            isExpanded: true,
            items: [
                { name: 'Products', count: null, color: 'blue', icon: 'box', collection: 'products', description: 'Master catalog of SKUs' },
                { name: 'Categories', count: null, color: 'blue', icon: 'grid', collection: 'categories' },
                { name: 'Brands', count: null, color: 'blue', icon: 'award', collection: 'brands' },
                { name: 'Price Rules', count: null, color: 'blue', icon: 'dollar-sign', collection: 'pricing_rules', description: 'Dynamic pricing logic' },
                { name: 'Commissions', count: null, color: 'blue', icon: 'percent', collection: 'channel_commission_rules', description: 'Marketplace Fees' },
                { name: 'Distributors', count: null, color: 'blue', icon: 'truck', collection: 'distributors' },
                { name: 'Banners', count: null, color: 'cyan', icon: 'image', collection: 'banners' },
                { name: 'Blog Posts', count: null, color: 'cyan', icon: 'file-text', collection: 'blog_posts' },
            ]
        },
        {
            id: 'commerce',
            title: 'Commerce & Finance',
            description: 'Customer transactions, financial records, and CRM.',
            color: 'green',
            isExpanded: false,
            items: [
                { name: 'Orders', count: null, color: 'green', icon: 'shopping-cart', collection: 'orders', description: 'Full order history' },
                { name: 'Internal POs', count: null, color: 'green', icon: 'anchor', collection: 'purchase_orders', description: 'Inbound Logistics' },
                { name: 'Expenses', count: null, color: 'rose', icon: 'credit-card', collection: 'expenses', description: 'OpEx for Command Center' },
                { name: 'Customers', count: null, color: 'green', icon: 'users', collection: 'customers', description: 'CRM profiles' },
                { name: 'Users', count: null, color: 'green', icon: 'lock', collection: 'users', description: 'Auth accounts' },
                { name: 'Coupons', count: null, color: 'emerald', icon: 'tag', collection: 'coupons' },
            ]
        },
        {
            id: 'logistics',
            title: 'Warehouse & Inventory',
            description: 'Physical warehouse constraints, bins, and stock ledger.',
            color: 'orange',
            isExpanded: false,
            items: [
                { name: 'Warehouses', count: null, color: 'orange', icon: 'home', collection: 'warehouses' },
                { name: 'Zones', count: null, color: 'orange', icon: 'map', collection: 'warehouse_zones' },
                { name: 'Structures', count: null, color: 'orange', icon: 'server', collection: 'warehouse_structures', description: 'Racks & Shelves' },
                { name: 'Bins (Primary)', count: null, color: 'orange', icon: 'target', collection: 'warehouse_locations', description: 'Main Bin Storage' },
                { name: 'Bins (Legacy)', count: null, color: 'red', icon: 'alert-circle', collection: 'locations', description: 'Old Location Data' },
                { name: 'Inv. Ledger', count: null, color: 'red', icon: 'book', collection: 'inventory_ledger', description: 'Immutable Kardex' },
                { name: 'Balances', count: null, color: 'amber', icon: 'database', collection: 'inventory_balances', description: 'Fast-read cache' },
                { name: 'Doors', count: null, color: 'orange', icon: 'maximize', collection: 'warehouse_doors' },
                { name: 'Obstacles', count: null, color: 'orange', icon: 'slash', collection: 'warehouse_obstacles' },
                { name: 'Scale Markers', count: null, color: 'orange', icon: 'ruler', collection: 'warehouse_scale_markers' },
            ]
        },
        {
            id: 'operations',
            title: 'Operations & System',
            description: 'Staff allocations, internal workflows, and logs.',
            color: 'slate',
            isExpanded: false,
            items: [
                { name: 'Staff', count: null, color: 'indigo', icon: 'shield', collection: 'staff_profiles', description: 'Powering /operations' },
                { name: 'Allocations', count: null, color: 'teal', icon: 'user-check', collection: 'orderAssignments', description: 'Staff Workload (Picking/Packing)' },
                { name: 'Order Notes', count: null, color: 'teal', icon: 'file-text', collection: 'orderNotes' },
                { name: 'Priorities', count: null, color: 'teal', icon: 'list', collection: 'orderPriorities' },
                { name: 'Approvals', count: null, color: 'violet', icon: 'check-circle', collection: 'approvals' },
                { name: 'Admin Logs', count: null, color: 'slate', icon: 'activity', collection: 'admin_logs' },
                { name: 'Global Config', count: null, color: 'slate', icon: 'settings', collection: 'full_settings' },
                { name: 'Backlog', count: null, color: 'slate', icon: 'list', collection: 'project_backlog' },
            ]
        }
    ]);

    ngOnInit() {
        this.fetchCounts();
    }

    toggleGroup(index: number) {
        this.groups.update(groups => {
            groups[index].isExpanded = !groups[index].isExpanded;
            return [...groups];
        });
    }

    setPerspective(id: PerspectiveId) {
        this.viewMode.set(id);
    }

    isNodeVisible(id: string): boolean {
        const mode = this.viewMode();
        if (mode === 'all') return true;

        const perspective = this.perspectives.find(p => p.id === mode);
        if (!perspective) return true;

        return perspective.core.includes(id) || perspective.deps.includes(id);
    }

    isNodeGhost(id: string): boolean {
        const mode = this.viewMode();
        if (mode === 'all') return false;

        const perspective = this.perspectives.find(p => p.id === mode);
        if (!perspective) return false;

        return perspective.deps.includes(id) && !perspective.core.includes(id);
    }

    isLinkVisible(link: any): boolean {
        return this.isNodeVisible(link.source) && this.isNodeVisible(link.target);
    }

    getGroupIcon(id: string): string {
        switch (id) {
            case 'storefront': return 'shopping-bag';
            case 'commerce': return 'credit-card';
            case 'logistics': return 'box';
            case 'operations': return 'settings';
            default: return 'database';
        }
    }

    getDomainTip(id: string): string {
        switch (id) {
            case 'storefront': return 'Products are the core entity. Categories and Brands allow filtering. Pricing Rules apply dynamic discounts on top of base Price.';
            case 'commerce': return 'Expenses are tracked here for P&L analysis. Orders drive revenue, while Expenses drive costs.';
            case 'logistics': return 'The Inventory Ledger is capable of rebuilding the state of any Bin at any point in time. Balances are just a cached projection.';
            case 'operations': return 'Allocations (Order Assignments) link Staff to Orders for picking/packing. Staff Profiles allow granular access control.';
            default: return 'Keep collections small and focused.';
        }
    }

    async fetchCounts() {
        const currentGroups = JSON.parse(JSON.stringify(this.groups()));

        const tasks: Promise<void>[] = [];

        currentGroups.forEach((group: DomainGroup, gIdx: number) => {
            group.items.forEach((item: StatItem, iIdx: number) => {
                tasks.push((async () => {
                    try {
                        const coll = collection(this.firestore, item.collection);
                        const snapshot = await getCountFromServer(coll);
                        currentGroups[gIdx].items[iIdx].count = snapshot.data().count;
                        this.tracker.trackRead(1);
                    } catch (e) {
                        console.warn(`[DatabaseOutlook] Failed to count ${item.collection}`, e);
                        currentGroups[gIdx].items[iIdx].count = 0;
                    }
                })());
            });
        });

        await Promise.all(tasks);
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
        // Check links
        const connectedIds = this.links
            .filter(l => l.source === hovered || l.target === hovered)
            .map(l => l.source === hovered ? l.target : l.source);
        return connectedIds.includes(id);
    }

    getNodeColor(type: string): string {
        switch (type) {
            case 'storefront': return '#3b82f6'; // Blue
            case 'ecom': return '#10b981'; // Green
            case 'logistics': return '#f97316'; // Orange
            case 'sys': return '#94a3b8'; // Slate
            default: return '#cbd5e1';
        }
    }
}
