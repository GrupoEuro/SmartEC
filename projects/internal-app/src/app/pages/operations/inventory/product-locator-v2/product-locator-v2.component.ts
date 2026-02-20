import { Component, OnInit, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseLevelService } from '../../../../core/services/warehouse-level.service';
import { PathfindingService, Point } from '../../../../core/services/pathfinding.service';
import { AreaSelectionService } from '../../../../core/services/area-selection.service';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { ProductService } from '../../../../core/services/product.service';
import { Warehouse, StorageLocation, ZONE_COLORS } from '../../../../core/models/warehouse.model';

/**
 * ProductLocatorV2Component
 * 
 * Complete rewrite of the warehouse product locator with:
 * - Multi-level warehouse support
 * - Color-coded zones
 * - Enhanced A* pathfinding
 * - Area selection tools
 * - Clean architecture with Angular Signals
 */
@Component({
    selector: 'app-product-locator-v2',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, RouterModule],
    templateUrl: './product-locator-v2.component.html',
    styleUrl: './product-locator-v2.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProductLocatorV2Component implements OnInit {

    // ========================================
    // Services (Injected)
    // ========================================

    public levelService = inject(WarehouseLevelService);
    private pathfinder = inject(PathfindingService);
    public areaSelector = inject(AreaSelectionService);
    private warehouseService = inject(WarehouseService);
    private productService = inject(ProductService);

    // ========================================
    // State (Signals)
    // ========================================

    // UI State
    private zoomLevel = signal(1.0);
    public panX = signal(0);
    public panY = signal(0);
    private isDragging = signal(false);
    private lastMouseX = 0;
    private lastMouseY = 0;

    public viewMode = signal<'2d' | '3d' | '3d-shelves'>('2d');
    public showGrid = signal(false);

    // Search
    public searchQuery = signal('');
    private isSearching = signal(false);
    public foundProduct = signal<any | null>(null);
    public foundLocation = signal<StorageLocation | null>(null);
    public selectedRack = signal<any | null>(null);

    // Warehouses
    public availableWarehouses = signal<Warehouse[]>([]);
    public selectedWarehouseId = signal<string>('MAIN');

    // Path visualization
    public showPath = signal(false);
    protected pathCoordinates = signal<Point[]>([]);

    // Occupied bins (browse mode)
    public occupiedBins = signal<StorageLocation[]>([]);

    // Notifications
    public notification = signal<{ message: string, type: 'info' | 'error' | 'success' } | null>(null);

    // Exploded View State (Controlled by Toggle)
    public explodedView = signal(false);

    // ========================================
    // Computed Values
    // ========================================

    public scale = computed(() => this.zoomLevel());

    public transform = computed(() => {
        return `translate3d(${this.panX()}px, ${this.panY()}px, 0) scale(${this.scale()})`;
    });

    public pathString = computed(() => {
        return this.pathfinder.pathToSVGString(this.pathCoordinates());
    });

    public occupiedBinsCount = computed(() => this.occupiedBins().length);

    public totalBinsCount = computed(() => {
        return this.levelService.totalBinCapacity();
    });

    public occupancyRate = computed(() => {
        const total = this.totalBinsCount();
        return total > 0 ? Math.round((this.occupiedBinsCount() / total) * 100) : 0;
    });

    // Smart Bin Visibility: Only show bins when searching for a product
    public visibleBins = computed(() => {
        const foundLocation = this.foundLocation();

        // If no search active, hide all bins (clean warehouse view)
        if (!foundLocation) {
            return [];
        }

        // Show all bins for the found product (handles multiple locations)
        return this.occupiedBins().filter(bin =>
            bin.productId === foundLocation.productId
        );
    });

    // Zone color palette (accessible from template)
    public readonly ZONE_COLORS = ZONE_COLORS;

    // Rack Capacity Map (structureId -> 'empty' | 'low' | 'medium' | 'high')
    public rackStatusMap = computed(() => {
        const bins = this.occupiedBins();
        const structures = this.levelService.visibleStructures();
        const map = new Map<string, string>();

        structures.forEach(rack => {
            const rackBins = bins.filter(b => b.structureId === rack.id);
            const count = rackBins.length;
            const capacity = rack.totalLocations || 15; // Default to 15 if missing
            const pct = count / capacity;

            if (count === 0) map.set(rack.id, 'empty');
            else if (pct < 0.5) map.set(rack.id, 'low');
            else if (pct < 0.8) map.set(rack.id, 'medium');
            else map.set(rack.id, 'high');
        });

        return map;
    });

    public selectedRackUtilization = computed(() => {
        const rack = this.selectedRack();
        if (!rack) return 0;

        const status = this.rackStatusMap().get(rack.id);
        if (status === 'empty') return 0;

        // Calculate exact %
        const count = this.occupiedBins().filter(b => b.structureId === rack.id).length;
        const capacity = rack.totalLocations || 15;
        return Math.round((count / capacity) * 100);
    });

    // ========================================
    // Lifecycle
    // ========================================

    async ngOnInit() {
        console.log('[ProductLocatorV2] initialized. Subscribing to warehouses...');

        // Timeout check for database connection
        setTimeout(() => {
            if (this.availableWarehouses().length === 0) {
                console.error('[ProductLocatorV2] CRITICAL: Warehouse fetch timed out (5s). Firestore connection is likely hanging due to IndexedDB lock. Please clear site data.');
            }
        }, 5000);

        // Load warehouses
        this.warehouseService.getWarehouses().subscribe(warehouses => {
            console.log('[ProductLocatorV2] Warehouses fetched:', warehouses.length);
            this.availableWarehouses.set(warehouses);

            if (warehouses.length > 0) {
                const main = warehouses.find(w => w.id === 'MAIN') || warehouses[0];
                this.selectedWarehouseId.set(main.id!);
                this.loadWarehouse(main.id!);
            }
        });
    }

    // ========================================
    // Warehouse Loading
    // ========================================

    async loadWarehouse(warehouseId: string) {
        // Load levels (with auto-migration for v1.0 warehouses)
        await this.levelService.loadLevels(warehouseId);

        // Load occupied bins for the warehouse
        // Load occupied bins for the warehouse
        console.log(`[ProductLocatorV2] Fetching occupied bins for warehouseId: "${warehouseId}"`);
        this.warehouseService.getOccupiedLocations(warehouseId).subscribe(bins => {
            console.log(`[ProductLocatorV2] RAW LOCATIONS FETCHED: ${bins.length}`);
            const fullBins = bins.filter(b => b.status === 'full'); // Double check filtering
            console.log(`[ProductLocatorV2] FULL BINS (status='full'): ${fullBins.length}`);

            // Log first bin for inspection
            if (bins.length > 0) {
                console.log('[ProductLocatorV2] SAMPLE BIN (JSON):', JSON.stringify(bins[0], null, 2));
            }

            this.occupiedBins.set(fullBins); // Use fullBins
            if (fullBins.length === 0) {
                console.warn('[ProductLocatorV2] No occupied bins found (0% Capacity).');
                console.warn('Possible causes: 1. Seeder failed to set status="full". 2. WarehouseId mismatch. 3. Firestore permissions.');
                console.warn('ACTION REQUIRED: Please RUN THE DATA SEEDER ("Seed Multi-Level Warehouse") to populate "warehouse_locations".');
            }
        });


        // Play intro animation if needed
        // REMOVED: Animation should only happen on explicit toggle
        // if (this.shouldPlayIntro()) {
        //     setTimeout(() => this.playIntroAnimation(), 300);
        // }
    }

    // ========================================
    // Helpers
    // ========================================



    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    switchWarehouse(warehouseId: string) {
        this.selectedWarehouseId.set(warehouseId);
        this.clearSelection();
        this.loadWarehouse(warehouseId);
    }

    // ========================================
    // Search
    // ========================================

    async search() {
        if (!this.searchQuery()) return;

        this.isSearching.set(true);
        this.clearSelection();

        try {
            // Find product
            const products = await this.productService.getProducts().toPromise();
            const match = products?.find(p =>
                p.name?.es?.toLowerCase().includes(this.searchQuery().toLowerCase()) ||
                p.sku?.includes(this.searchQuery())
            );

            if (match) {
                this.foundProduct.set(match);

                // Find location
                const location = await this.warehouseService.getProductLocation(
                    this.selectedWarehouseId(),
                    match.id!
                );

                if (location) {
                    this.foundLocation.set(location);

                    // Switch to correct level if needed
                    if (location.levelId) {
                        const levelNumber = this.levelService.levels()
                            .find(l => l.id === location.levelId)?.levelNumber || 0;
                        this.levelService.switchLevel(levelNumber);
                    }

                    this.calculatePath(location);
                } else {
                    this.showNotification('Product found but not in stock at this warehouse', 'info');
                }
            } else {
                this.showNotification('Product not found', 'error');
            }
        } catch (error) {
            console.error('[ProductLocatorV2] Search error:', error);
            this.showNotification('Search failed', 'error');
        } finally {
            this.isSearching.set(false);
        }
    }

    // ========================================
    // Pathfinding
    // ========================================

    calculatePath(targetLocation: StorageLocation) {
        const structures = this.levelService.visibleStructures();
        const struct = structures.find(s => s.id === targetLocation.structureId);

        if (!struct) {
            console.warn('[ProductLocatorV2] Structure not found for location');
            return;
        }

        // Target is center of structure
        const targetX = struct.x + (struct.width / 2);
        const targetY = struct.y + (struct.height / 2);

        // Start is first door or default position
        const doors = this.levelService.visibleDoors();
        const entrance = doors.find(d => d.type === 'inbound') || doors[0];

        const startX = entrance ? entrance.x + (entrance.width / 2) : 50;
        const startY = entrance ? entrance.y + (entrance.height / 2) : 50;

        // Calculate path with smoothing
        const path = this.pathfinder.findPath(
            { x: startX, y: startY },
            { x: targetX, y: targetY },
            this.levelService.visibleObstacles(),
            true // smooth
        );

        this.pathCoordinates.set(path);
        this.showPath.set(true);
    }

    // ========================================
    // UI Actions
    // ========================================

    clearSelection() {
        this.foundProduct.set(null);
        this.foundLocation.set(null);
        this.selectedRack.set(null);
        this.showPath.set(false);
        this.areaSelector.clearSelection();
    }

    selectRack(rack: any, event?: MouseEvent) {
        if (event) event.stopPropagation();
        console.log('[ProductLocatorV2] Selected rack:', rack.code);
        this.selectedRack.set(rack);
        this.clearSelection(); // Clear other selections but keep rack? No, clear others then set.
        // Actually clearSelection clears selectedRack, so re-set it.
        this.foundProduct.set(null);
        this.foundLocation.set(null);
        this.showPath.set(false);
        this.selectedRack.set(rack);
    }

    showNotification(message: string, type: 'info' | 'error' | 'success') {
        this.notification.set({ message, type });
        setTimeout(() => {
            if (this.notification()?.message === message) {
                this.notification.set(null);
            }
        }, 5000);
    }

    // Zoom controls
    zoomIn() {
        this.zoomLevel.update(z => Math.min(3.0, z + 0.2));
    }

    zoomOut() {
        this.zoomLevel.update(z => Math.max(0.5, z - 0.2));
    }

    resetZoom() {
        this.zoomLevel.set(1.0);
    }

    toggleViewMode() {
        // Cycle through: 2D → 3D → 3D Shelves → 2D...
        this.viewMode.update(mode => {
            if (mode === '2d') {
                this.explodedView.set(true);
                return '3d';
            } else if (mode === '3d') {
                this.explodedView.set(true);
                return '3d-shelves';
            } else {
                this.explodedView.set(false);
                return '2d';
            }
        });
    }

    getBinX(bin: StorageLocation, index: number): number {
        // Find the structure (rack) this bin belongs to
        const structures = this.levelService.visibleStructures();
        const structure = structures.find(s => s.id === bin.structureId);

        if (structure) {
            // Calculate position within the structure based on bay and position
            // Note: bin.bay is 1-indexed (1, 2, 3), so subtract 1 for positioning
            const binWidth = structure.width / (structure.bays || 1);
            return structure.x + ((bin.bay - 1) * binWidth) + (binWidth / 2) - 5; // Center the bin
        }

        // Fallback: scatter bins if structure not found
        return 100 + (index * 5);
    }

    getBinY(bin: StorageLocation, index: number): number {
        // Find the structure (rack) this bin belongs to
        const structures = this.levelService.visibleStructures();
        const structure = structures.find(s => s.id === bin.structureId);

        if (structure) {
            // Calculate position within the structure based on level
            // Note: bin.level is 1-indexed (1, 2, 3, 4, 5), so subtract 1 for positioning
            const binHeight = structure.height / (structure.levels || 1);
            return structure.y + ((bin.level - 1) * binHeight) + (binHeight / 2) - 5; // Center the bin
        }

        // Fallback: scatter bins if structure not found
        return 100 + (index * 5);
    }

    toggleGrid() {
        this.showGrid.update(v => !v);
    }

    getRackStatus(rackId: string): string {
        return this.rackStatusMap().get(rackId) || 'empty';
    }

    // ========================================
    // Panning / Dragging
    // ========================================

    onMouseDown(event: MouseEvent) {
        if (event.button !== 0) return; // Left click only
        this.isDragging.set(true);
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
    }

    onMouseMove(event: MouseEvent) {
        if (!this.isDragging()) return;

        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;

        this.panX.update(x => x + deltaX);
        this.panY.update(y => y + deltaY);

        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
    }

    onMouseUp() {
        this.isDragging.set(false);
    }

    onMouseLeave() {
        this.isDragging.set(false);
    }

    // Helper method for shelf view rendering
    getShelfArray(levels: number): number[] {
        return Array.from({ length: levels }, (_, i) => i);
    }

    centerView() {
        this.panX.set(0);
        this.panY.set(0);
        this.zoomLevel.set(1.0);
    }
}
