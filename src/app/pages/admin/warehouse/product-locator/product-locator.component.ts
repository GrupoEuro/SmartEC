import { Component, ElementRef, ViewChild, inject, signal, effect, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { ProductService } from '../../../../core/services/product.service';
import { Warehouse, WarehouseZone, StorageStructure, StorageLocation, Obstacle, Door } from '../../../../core/models/warehouse.model';

@Component({
    selector: 'app-product-locator',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent],
    templateUrl: './product-locator.component.html',
    styleUrls: ['./product-locator.component.css']
})
export class ProductLocatorComponent {
    private warehouseService = inject(WarehouseService);
    private productService = inject(ProductService);

    searchQuery = signal('');
    isSearching = signal(false);

    // Results
    foundProduct = signal<any | null>(null);
    foundLocation = signal<StorageLocation | null>(null);

    // Browse Mode
    occupiedBins = signal<StorageLocation[]>([]);
    selectedBin = signal<StorageLocation | null>(null); // For click interaction

    // UI Feedback
    notification = signal<{ message: string, type: 'info' | 'error' | 'success' } | null>(null);

    // Warehouse Context
    availableWarehouses = signal<Warehouse[]>([]);
    selectedWarehouseId = signal<string>('MAIN'); // Default or select
    zones = signal<WarehouseZone[]>([]);
    structures = signal<StorageStructure[]>([]);
    obstacles = signal<Obstacle[]>([]);
    doors = signal<Door[]>([]);

    // Animation State
    showPath = signal(false);
    pathCoordinates = signal<{ x: number, y: number }[]>([]);

    // Zoom & Pan
    zoomLevel = signal(1.0);

    // Hover State
    hoveredRack = signal<string | null>(null);

    // Selected Rack for Sidebar
    selectedRack = signal<StorageStructure | null>(null);
    binsInSelectedRack = computed(() => {
        const rack = this.selectedRack();
        if (!rack) return [];
        return this.occupiedBins().filter(bin => bin.structureId === rack.id);
    });
    rackOccupancy = computed(() => {
        const rack = this.selectedRack();
        if (!rack) return { occupied: 0, total: 0, percentage: 0 };
        const total = rack.bays * rack.levels;
        const occupied = this.binsInSelectedRack().length;
        return { occupied, total, percentage: total > 0 ? Math.round((occupied / total) * 100) : 0 };
    });

    // View Mode (Top / Isometric)
    viewMode = signal<'top' | 'isometric'>('top');

    // Camera angle controls for isometric view
    cameraAngle = signal({ rotateX: 60, rotateZ: -45 });

    // Statistics (computed)
    occupiedBinsCount = computed(() => this.occupiedBins().length);
    totalBinsCount = computed(() => this.structures().reduce((acc, s) => acc + (s.bays * s.levels), 0));
    occupancyRate = computed(() => {
        const total = this.totalBinsCount();
        return total > 0 ? Math.round((this.occupiedBinsCount() / total) * 100) : 0;
    });
    uniqueProductsCount = computed(() => new Set(this.occupiedBins().map(b => b.productId)).size);

    // Scale (Dynamic based on zoom)
    scale = computed(() => 0.8 * this.zoomLevel());

    async ngOnInit() {
        // Load Warehouse context blindly for now (assuming 1 main WH)
        // In real app, we'd select WH first or search across all.
        // Let's assume user picks 'Main' or we fetch first.
        this.warehouseService.getWarehouses().subscribe(list => {
            this.availableWarehouses.set(list);
            if (list.length > 0) {
                // If seeded 'MAIN' exists, prefer it
                const main = list.find(w => w.id === 'MAIN') || list[0];
                this.selectedWarehouseId.set(main.id!);
                this.loadMapData(main.id!);
            } else {
                // No warehouses found - show helpful message
                this.showNotification('No warehouse found. Please seed warehouse data first.', 'error');
            }
        });
    }

    switchWarehouse(warehouseId: string) {
        this.selectedWarehouseId.set(warehouseId);
        this.clearSelection();
        this.loadMapData(warehouseId);
    }

    loadMapData(id: string) {
        this.warehouseService.getZones(id).subscribe(z => this.zones.set(z));
        this.warehouseService.getStructures(id).subscribe(s => this.structures.set(s));
        this.warehouseService.getObstacles(id).subscribe(o => this.obstacles.set(o as Obstacle[]));
        this.warehouseService.getDoors(id).subscribe(d => this.doors.set(d as Door[]));

        // BROWSE MODE: Load all occupied bins to show "hotspots"
        this.warehouseService.getOccupiedLocations(id).subscribe(bins => {
            this.occupiedBins.set(bins);
        });
    }

    async search() {
        if (!this.searchQuery()) return;
        this.isSearching.set(true);
        this.clearSelection();
        this.notification.set(null);

        try {
            // 1. Find Product (Simulate search or assume valid ID if strict)
            const products = await this.productService.getProducts().toPromise(); // Ideally search API
            const match = products?.find(p => p.name?.es?.toLowerCase().includes(this.searchQuery().toLowerCase()) || p.sku?.includes(this.searchQuery()));

            if (match) {
                this.foundProduct.set(match);
                // 2. Find Location
                let loc: StorageLocation | null = null;
                if (match.id) {
                    loc = await this.warehouseService.getProductLocation(this.selectedWarehouseId(), match.id);
                }

                if (loc) {
                    this.foundLocation.set(loc);
                    this.calculatePath(loc);
                } else {
                    // Product found in catalog but not in a bin
                    this.showNotification('Product found in catalog but 0 stock in this warehouse.', 'info');
                }
            } else {
                this.showNotification('Product not found in catalog.', 'error');
            }

        } catch (err) {
            console.error(err);
            this.showNotification('Search failed. Please try again.', 'error');
        } finally {
            this.isSearching.set(false);
        }
    }

    calculatePath(targetLoc: StorageLocation) {
        // 1. Get Target Coordinates
        // The location belongs to a structure.
        const struct = this.structures().find(s => s.id === targetLoc.structureId);
        if (!struct) return;

        // Center of the structure
        const targetX = struct.x + (struct.width / 2);
        const targetY = struct.y + (struct.height / 2);

        // 2. Start Point (Entrance)
        // Find a door marked as 'entrance' or just the first door
        // We look for a door. If multiple, maybe find closest? Or just first.
        let startX = 50;
        let startY = 800; // Default fallback

        const entrance = this.doors().find(d => d.type === 'inbound') || this.doors()[0];
        if (entrance) {
            startX = entrance.x + (entrance.width / 2);
            startY = entrance.y + (entrance.height / 2);
        }

        // 3. Pathfinding (Simple L-shape or direct for MVP)
        // Let's do Manhattan: Start -> (StartX, TargetY) -> Target
        // This makes 90 degree turns which look cleaner in a warehouse grid.

        // We can add intermediate points to avoid obstacles if we want to be fancy.
        // For now, simple L-shape:

        // Go Vertical first if entrance is at top/bottom?
        // Go Horizontal first if entrance is at side?
        // Let's heuristics: if |StartY - TargetY| > |StartX - TargetX|, go Y first.

        const deltaX = Math.abs(targetX - startX);
        const deltaY = Math.abs(targetY - startY);

        const path = [{ x: startX, y: startY }];

        if (deltaY > deltaX) {
            // Move vertically first to align Y
            path.push({ x: startX, y: targetY });
        } else {
            // Move horizontally first to align X
            path.push({ x: targetX, y: startY });
        }

        path.push({ x: targetX, y: targetY });

        this.pathCoordinates.set(path);
        setTimeout(() => this.showPath.set(true), 100);
    }

    onBinClick(bin: StorageLocation) {
        // Simulate "found" state for this bin
        this.clearSelection();
        this.selectedBin.set(bin);
        // We might not have full product details if we just have access to the bin data
        // But the bin has `productName` and `quantity`.

        // Mock a "found product" object from bin data for display
        this.foundProduct.set({
            sku: 'SKU-???', // Location table doesn't have SKU, just name/ID. 
            name: { es: bin.productName || 'Unknown Product' },
            id: bin.productId
        });

        this.foundLocation.set(bin);
        this.calculatePath(bin);
    }

    clearSelection() {
        this.foundProduct.set(null);
        this.foundLocation.set(null);
        this.selectedBin.set(null);
        this.showPath.set(false);
        this.notification.set(null);
    }

    showNotification(msg: string, type: 'info' | 'error' | 'success') {
        this.notification.set({ message: msg, type });
        // Auto dismiss after 5s
        setTimeout(() => {
            if (this.notification()?.message === msg) {
                this.notification.set(null);
            }
        }, 5000);
    }

    get pathString(): string {
        const coords = this.pathCoordinates();
        if (coords.length === 0) return '';
        return coords.reduce((acc, curr, i) => {
            return i === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
        }, '');
    }

    // Helper to find visual Rack for a bin (for template connection)
    getStructureForBin(bin: StorageLocation) {
        return this.structures().find(s => s.id === bin.structureId);
    }

    // Zoom Controls
    private readonly MIN_ZOOM = 0.5;
    private readonly MAX_ZOOM = 3.0;
    private readonly ZOOM_STEP = 0.2;

    zoomIn() {
        this.zoomLevel.update(level => Math.min(this.MAX_ZOOM, level + this.ZOOM_STEP));
    }

    zoomOut() {
        this.zoomLevel.update(level => Math.max(this.MIN_ZOOM, level - this.ZOOM_STEP));
    }

    resetZoom() {
        this.zoomLevel.set(1.0);
    }

    // Mouse wheel zoom support (Ctrl/Cmd + wheel)
    @HostListener('wheel', ['$event'])
    onMouseWheel(event: WheelEvent) {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            this.zoomLevel.update(level =>
                Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, level + delta))
            );
        }
    }

    // Rack Hover
    onRackHover(rackId: string) {
        this.hoveredRack.set(rackId);
    }

    onRackLeave() {
        this.hoveredRack.set(null);
    }

    // Calculate rack capacity for color-coding
    getRackOccupancy(rackId: string): number {
        const totalBins = this.structures().find(s => s.id === rackId);
        if (!totalBins) return 0;
        const total = totalBins.bays * totalBins.levels;
        const occupied = this.occupiedBins().filter(bin => bin.structureId === rackId).length;
        return total > 0 ? Math.round((occupied / total) * 100) : 0;
    }

    // Get color class based on occupancy
    getRackCapacityColor(rackId: string): string {
        const occupancy = this.getRackOccupancy(rackId);
        if (occupancy >= 67) return 'high'; // 67-100% = High (Red)
        if (occupancy >= 34) return 'medium'; // 34-66% = Medium (Yellow)
        return 'low'; // 0-33% = Low (Green)
    }

    // Rack Click for Sidebar
    onRackClick(rack: StorageStructure) {
        console.log('[Locator] Rack clicked:', rack.code, rack.name);
        this.selectedRack.set(rack);
        console.log('[Locator] Selected rack set:', this.selectedRack());
    }

    closeSidebar() {
        this.selectedRack.set(null);
    }

    // Navigate to bin from sidebar
    navigateToBin(bin: StorageLocation) {
        this.onBinClick(bin);
        this.closeSidebar();
    }

    // View Mode Controls
    toggleViewMode() {
        this.viewMode.update(mode => mode === 'top' ? 'isometric' : 'top');
    }

    // Enhanced view transform with dynamic camera angles
    getViewTransform(): string {
        if (this.viewMode() === 'isometric') {
            const angle = this.cameraAngle();
            return `scale(0.85) rotateX(${angle.rotateX}deg) rotateZ(${angle.rotateZ}deg) translateZ(20px)`;
        }
        return '';
    }

    // Camera angle controls
    rotateCamera(axis: 'x' | 'z', delta: number) {
        this.cameraAngle.update(angle => ({
            ...angle,
            [axis === 'x' ? 'rotateX' : 'rotateZ']: angle[axis === 'x' ? 'rotateX' : 'rotateZ'] + delta
        }));
    }

    resetCamera() {
        this.cameraAngle.set({ rotateX: 60, rotateZ: -45 });
    }

    // Calculate rack depth for z-index layering
    getRackDepth(rack: StorageStructure): number {
        // Items further back (higher y) and left (lower x) render first
        return (rack.y * 1000) + (1200 - rack.x);
    }

    // Enhanced multi-layer shadow calculation
    getRackShadow(rack: StorageStructure): string {
        const baseOpacity = 0.3;
        const depth = this.getRackDepth(rack);
        const opacity = Math.min(0.65, baseOpacity + (depth / 10000) * 0.25);
        const height = rack.levels || 4;

        // Multi-layer shadow: drop shadow + ground shadow for realism
        const dropShadow = `drop-shadow(0 ${height * 2}px ${height * 5}px rgba(0,0,0,${opacity}))`;
        const groundShadow = `drop-shadow(${height * 3}px ${height * 3}px ${height * 2}px rgba(0,0,0,${opacity * 0.5}))`;

        return `${dropShadow} ${groundShadow}`;
    }

    // Atmospheric depth - calculate opacity based on distance
    getRackAtmosphericOpacity(rack: StorageStructure): number {
        const depth = this.getRackDepth(rack);
        const maxDepth = 2100000; // Max possible depth in our warehouse
        const fadeAmount = (depth / maxDepth) * 0.25; // Fade up to 25%
        return Math.max(0.75, 1 - fadeAmount); // Min opacity 0.75
    }
}
