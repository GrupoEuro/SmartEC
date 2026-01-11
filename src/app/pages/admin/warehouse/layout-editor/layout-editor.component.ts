import { Component, ElementRef, HostListener, inject, signal, ViewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { Warehouse, WarehouseZone, StorageStructure, Obstacle, Door } from '../../../../core/models/warehouse.model';
import { RackVisualizerComponent } from '../../../../shared/components/rack-visualizer/rack-visualizer.component';

type ElementType = 'zone' | 'structure' | 'obstacle' | 'door';

@Component({
    selector: 'app-layout-editor',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent, FormsModule, RackVisualizerComponent],
    templateUrl: './layout-editor.component.html',
    styleUrls: ['./layout-editor.component.css']
})
export class LayoutEditorComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private warehouseService = inject(WarehouseService);

    warehouseId: string | null = null;
    warehouse = signal<Warehouse | null>(null);
    zones = signal<WarehouseZone[]>([]);
    structures = signal<StorageStructure[]>([]);

    // New Elements
    obstacles = signal<Obstacle[]>([]);
    doors = signal<Door[]>([]);

    selectedZoneId = signal<string | null>(null);
    selectedElementId = signal<string | null>(null);
    selectedElementType = signal<ElementType | null>(null);

    // Visualizer State
    showRackVisualizer = signal(false);
    visualizerRackId = signal<string | null>(null);

    // Editor Settings
    gridSize = signal(20);
    snapEnabled = signal(true);

    // Interaction State
    isDragging = false;
    dragStart = { x: 0, y: 0 };
    elementStart = { x: 0, y: 0 };
    activeDragId: string | null = null;
    activeDragType: ElementType | null = null;

    scale = signal(1);

    async ngOnInit() {
        this.warehouseId = this.route.snapshot.paramMap.get('id');
        if (this.warehouseId) {
            this.loadData();
        }
    }

    async loadData() {
        this.warehouseService.getWarehouses().subscribe(list => {
            const found = list.find(w => w.id === this.warehouseId);
            if (found) this.warehouse.set(found);
        });

        if (this.warehouseId) {
            this.warehouseService.getZones(this.warehouseId).subscribe(zones => this.zones.set(zones));
            this.warehouseService.getStructures(this.warehouseId).subscribe(structs => this.structures.set(structs));
            // In a real app, logic to fetch obstacles/doors would go here
        }
    }

    // --- Helper Functions ---
    snapToGrid(value: number): number {
        if (!this.snapEnabled()) return value;
        const size = this.gridSize();
        return Math.round(value / size) * size;
    }

    // --- Creation Actions ---

    addZone() {
        if (!this.warehouseId) return;
        const newZone: Partial<WarehouseZone> = {
            warehouseId: this.warehouseId,
            name: `New Zone ${this.zones().length + 1}`,
            code: `Z${this.zones().length + 1}`,
            color: '#3b82f6',
            type: 'racking',
            x: 100,
            y: 100,
            width: 200,
            height: 150
        };
        this.warehouseService.createZone(newZone);
    }

    addStructure() {
        if (!this.warehouseId || !this.selectedZoneId()) return;

        const newStruct: Partial<StorageStructure> = {
            warehouseId: this.warehouseId,
            zoneId: this.selectedZoneId()!,
            name: `Rack ${this.structures().length + 1}`,
            code: `R${this.structures().length + 1}`,
            type: 'standard-rack',
            levels: 5,
            bays: 4,
            x: 20,
            y: 20,
            width: 120,
            height: 40,
            rotation: 0
        };
        this.warehouseService.createStructure(newStruct);
    }

    addObstacle() {
        if (!this.warehouseId) return;
        const obs: Obstacle = {
            id: crypto.randomUUID(), // Local ID for now until service updated
            warehouseId: this.warehouseId,
            type: 'pillar',
            x: this.snapToGrid(300),
            y: this.snapToGrid(300),
            width: 40,
            height: 40,
            rotation: 0,
            color: '#71717a'
        };
        this.obstacles.update(prev => [...prev, obs]);
    }

    addDoor() {
        if (!this.warehouseId) return;
        const door: Door = {
            id: crypto.randomUUID(),
            warehouseId: this.warehouseId,
            type: 'dock',
            name: `Dock ${this.doors().length + 1}`,
            x: this.snapToGrid(50),
            y: this.snapToGrid(500),
            width: 80,
            height: 60,
            rotation: 0
        };
        this.doors.update(prev => [...prev, door]);
    }

    // --- Selection & Interaction ---

    selectElement(id: string, type: ElementType, event: MouseEvent) {
        event.stopPropagation();
        this.selectedElementId.set(id);
        this.selectedElementType.set(type);

        if (type === 'zone') {
            this.selectedZoneId.set(id);
        }
    }

    onBackgroundClick() {
        this.selectedElementId.set(null);
        this.selectedElementType.set(null);
    }

    onElementDoubleClick(id: string, type: ElementType, event: MouseEvent) {
        event.stopPropagation();
        if (type === 'structure') {
            this.visualizerRackId.set(id);
            this.showRackVisualizer.set(true);
        }
    }

    closeVisualizer() {
        this.showRackVisualizer.set(false);
        this.visualizerRackId.set(null);
    }

    // --- Drag Logic ---

    onMouseDown(event: MouseEvent, id: string, type: ElementType, currentX: number, currentY: number) {
        event.stopPropagation();
        event.preventDefault(); // Prevent text selection

        this.isDragging = true;
        this.activeDragId = id;
        this.activeDragType = type;

        this.dragStart = { x: event.clientX, y: event.clientY };
        this.elementStart = { x: currentX, y: currentY };

        this.selectElement(id, type, event); // Ensure selected
    }

    @HostListener('window:mousemove', ['$event'])
    onMouseMove(event: MouseEvent) {
        if (!this.isDragging || !this.activeDragId || !this.activeDragType) return;

        const dx = (event.clientX - this.dragStart.x) / this.scale();
        const dy = (event.clientY - this.dragStart.y) / this.scale();

        const rawX = this.elementStart.x + dx;
        const rawY = this.elementStart.y + dy;

        // Apply Snapping
        const newX = this.snapToGrid(rawX);
        const newY = this.snapToGrid(rawY);

        // Optimistic UI Update
        if (this.activeDragType === 'zone') {
            this.zones.update(list => list.map(z => z.id === this.activeDragId ? { ...z, x: newX, y: newY } : z));
        } else if (this.activeDragType === 'structure') {
            this.structures.update(list => list.map(s => s.id === this.activeDragId ? { ...s, x: newX, y: newY } : s));
        } else if (this.activeDragType === 'obstacle') {
            this.obstacles.update(list => list.map(o => o.id === this.activeDragId ? { ...o, x: newX, y: newY } : o));
        } else if (this.activeDragType === 'door') {
            this.doors.update(list => list.map(d => d.id === this.activeDragId ? { ...d, x: newX, y: newY } : d));
        }
    }

    @HostListener('window:mouseup')
    onMouseUp() {
        if (this.isDragging && this.activeDragId && this.activeDragType) {
            this.isDragging = false;
            this.savePosition(this.activeDragId, this.activeDragType);
            this.activeDragId = null;
            this.activeDragType = null;
        }
    }

    savePosition(id: string, type: ElementType) {
        if (type === 'zone') {
            const z = this.zones().find(item => item.id === id);
            if (z) this.warehouseService.updateZone(id, { x: z.x, y: z.y });
        } else if (type === 'structure') {
            const s = this.structures().find(item => item.id === id);
            if (s) this.warehouseService.updateStructure(id, { x: s.x, y: s.y });
        }
        // Obstacles/Doors persistence would be here
    }

    async saveChanges() {
        // Generic save button logic for selected element properties
        const id = this.selectedElementId();
        const type = this.selectedElementType();
        if (!id || !type) return;

        if (type === 'zone') {
            const z = this.zones().find(i => i.id === id);
            if (z) await this.warehouseService.updateZone(id, z);
        } else if (type === 'structure') {
            const s = this.structures().find(i => i.id === id);
            if (s) await this.warehouseService.updateStructure(id, s);
        }
        this.onBackgroundClick();
    }

    async deleteSelection() {
        if (!confirm('Delete selected element?')) return;
        const id = this.selectedElementId();
        const type = this.selectedElementType();
        if (!id || !type) return;

        if (type === 'zone') {
            this.zones.update(l => l.filter(x => x.id !== id));
            // Service call...
        } else if (type === 'structure') {
            this.structures.update(l => l.filter(x => x.id !== id));
        } else if (type === 'obstacle') {
            this.obstacles.update(l => l.filter(x => x.id !== id));
        } else if (type === 'door') {
            this.doors.update(l => l.filter(x => x.id !== id));
        }
        this.onBackgroundClick();
    }
}
