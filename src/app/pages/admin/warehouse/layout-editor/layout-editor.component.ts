import { Component, ElementRef, HostListener, inject, signal, ViewChild, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { Warehouse, WarehouseZone, StorageStructure, Obstacle, Door } from '../../../../core/models/warehouse.model';
import { RackVisualizerComponent } from '../../../../shared/components/rack-visualizer/rack-visualizer.component';

type ElementType = 'zone' | 'structure' | 'obstacle' | 'door';

export interface AlignmentGuide {
    type: 'vertical' | 'horizontal';
    position: number; // The x or y coordinate
    start: number;    // Start of the line
    end: number;      // End of the line
}

// --- Command Pattern for Undo/Redo ---
export interface Command {
    execute(): void;
    undo(): void;
}

export class MoveCommand implements Command {
    constructor(
        private items: { id: string, type: ElementType, from: { x: number, y: number }, to: { x: number, y: number } }[],
        private service: WarehouseService,
        private component: LayoutEditorComponent
    ) { }

    execute() {
        this.apply(true);
    }

    undo() {
        this.apply(false);
    }

    private apply(isForward: boolean) {
        this.items.forEach(item => {
            const pos = isForward ? item.to : item.from;
            // Update Service (Persistence)
            if (item.type === 'zone') this.service.updateZone(item.id, pos);
            else if (item.type === 'structure') this.service.updateStructure(item.id, pos);
            // Obstacles/Doors etc.

            // Update Local State (via Component signals - brute force update)
            this.component.updateLocalPosition(item.id, item.type, pos.x, pos.y);
        });
    }
}

export class AddCommand implements Command {
    constructor(
        private items: { id: string, type: ElementType, model: any }[],
        private service: WarehouseService,
        private component: LayoutEditorComponent
    ) { }

    execute() {
        this.apply(true);
    }

    undo() {
        this.apply(false);
    }

    private apply(isForward: boolean) {
        if (isForward) {
            // Add Items
            this.items.forEach(item => {
                this.component.addLocalItem(item.id, item.type, item.model);
                // Service calls
                if (item.type === 'zone') this.service.createZone(item.model);
                else if (item.type === 'structure') this.service.createStructure(item.model);
                // etc (assuming service creates if not exists or updates)
            });
        } else {
            // Remove Items
            this.items.forEach(item => {
                this.component.removeLocalItem(item.id, item.type);
                // Service delete calls
                if (item.type === 'zone') { /* service delete unimplemented in this mockup? */ }
                // For now we rely on local state updates for visual undo
            });
        }
    }
}

export class DeleteCommand implements Command {
    constructor(
        private items: { id: string, type: ElementType, model: any }[],
        private service: WarehouseService,
        private component: LayoutEditorComponent
    ) { }

    execute() {
        this.apply(true);
    }

    undo() {
        this.apply(false);
    }

    private apply(isForward: boolean) {
        if (isForward) {
            // Remove Items (Forward Action)
            this.items.forEach(item => {
                this.component.removeLocalItem(item.id, item.type);
                // Service delete calls
                if (item.type === 'zone') this.service.deleteZone(item.id);
                else if (item.type === 'structure') this.service.deleteStructure(item.id);
                else if (item.type === 'obstacle') this.service.deleteObstacle(item.id);
                else if (item.type === 'door') this.service.deleteDoor(item.id);
            });
        } else {
            // Restore Items (Undo Action)
            this.items.forEach(item => {
                this.component.addLocalItem(item.id, item.type, item.model);
                // Service create/restore calls
                if (item.type === 'zone') this.service.createZone(item.model);
                else if (item.type === 'structure') this.service.createStructure(item.model);
                // etc.
            });
        }
    }
}

export class UpdateCommand implements Command {
    constructor(
        private item: { id: string, type: ElementType, property: string, oldValue: any, newValue: any },
        private component: LayoutEditorComponent
    ) { }

    execute() {
        this.component.updateLocalProperty(this.item.id, this.item.type, this.item.property, this.item.newValue);
    }

    undo() {
        this.component.updateLocalProperty(this.item.id, this.item.type, this.item.property, this.item.oldValue);
    }
}

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

    // Scene Graph Hierarchy
    hierarchy = computed(() => {
        const zoneMap = this.zones().map(z => ({
            ...z,
            racks: this.structures().filter(s => s.zoneId === z.id)
        }));

        const unassignedRacks = this.structures().filter(s => !s.zoneId);

        return {
            zones: zoneMap,
            orphans: unassignedRacks,
            obstacles: this.obstacles(),
            doors: this.doors()
        };
    });

    // Selection State
    selectedZoneId = signal<string | null>(null);
    selectedElementIds = signal<Set<string>>(new Set());

    // Legacy support (computed from set)
    selectedElementId = signal<string | null>(null); // Keeping for now to avoid breaking template immediately
    selectedElementType = signal<ElementType | null>(null);

    // Box Selection
    selectionBox = signal<{ x: number, y: number, width: number, height: number } | null>(null);

    // Alignment Guides
    alignmentGuides = signal<AlignmentGuide[]>([]);

    // Visualizer State
    showRackVisualizer = signal(false);
    visualizerRackId = signal<string | null>(null);

    // Editor Settings
    gridSize = signal(10);
    snapEnabled = signal(true);

    // Row Generator Wizard
    showRowWizard = signal(false);
    rowWizardConfig = {
        count: 5,
        orientation: 'horizontal' as 'horizontal' | 'vertical',
        spacing: 20,
        levels: 5,
        bays: 4
    };

    // Interaction State
    isDragging = false;
    dragStart = { x: 0, y: 0 };
    elementStart = { x: 0, y: 0 };
    activeDragId: string | null = null;
    activeDragType: ElementType | null = null;

    // Tools
    activeTool = signal<'select' | 'pan'>('select');

    // Panning State
    isSpacePressed = signal(false);
    isPanning = false;

    @HostListener('window:keydown.space', ['$event'])
    onSpaceDown(event: KeyboardEvent) {
        if (!this.isSpacePressed() && (event.target as HTMLElement).tagName !== 'INPUT') {
            // prevent blocking space in inputs
            this.isSpacePressed.set(true);
        }
    }

    @HostListener('window:keyup.space', ['$event'])
    onSpaceUp(event: KeyboardEvent) {
        this.isSpacePressed.set(false);
        this.isPanning = false;
    }

    scale = signal(1);

    // History State
    undoStack: Command[] = [];
    redoStack: Command[] = [];

    // Dirty State (For Property Edits)
    hasUnsavedChanges = signal(false);

    @HostListener('window:beforeunload', ['$event'])
    unloadNotification($event: any) {
        if (this.hasUnsavedChanges()) {
            $event.returnValue = true;
        }
    }

    async ngOnInit() {
        this.warehouseId = this.route.snapshot.paramMap.get('id');
        if (this.warehouseId) {
            this.loadData();
        }
    }

    // ... (loadData)

    executeCommand(command: Command) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // Clear redo stack on new action
    }

    undo() {
        const command = this.undoStack.pop();
        if (command) {
            command.undo();
            this.redoStack.push(command);
        }
    }

    redo() {
        const command = this.redoStack.pop();
        if (command) {
            command.execute();
            this.undoStack.push(command);
        }
    }

    @HostListener('window:keydown.control.z', ['$event'])
    @HostListener('window:keydown.meta.z', ['$event']) // Mac Command+Z
    onUndo(event: KeyboardEvent) {
        if (event.shiftKey) {
            this.redo();
        } else {
            this.undo();
        }
    }

    @HostListener('window:keydown.control.y', ['$event'])
    @HostListener('window:keydown.meta.shift.z', ['$event']) // Mac Shift+Cmd+Z
    onRedo(event: KeyboardEvent) {
        this.redo();
    }


    // Helper used by MoveCommand
    updateLocalPosition(id: string, type: ElementType, x: number, y: number) {
        if (type === 'zone') {
            this.zones.update(l => l.map(i => i.id === id ? { ...i, x, y } : i));
        } else if (type === 'structure') {
            this.structures.update(l => l.map(i => i.id === id ? { ...i, x, y } : i));
        } else if (type === 'obstacle') {
            this.obstacles.update(l => l.map(i => i.id === id ? { ...i, x, y } : i));
        } else if (type === 'door') {
            this.doors.update(l => l.map(i => i.id === id ? { ...i, x, y } : i));
        }
    }

    // Generic Property Update for Undo/Redo
    updateLocalProperty(id: string, type: ElementType, property: string, value: any) {
        // Flag as unsaved
        this.hasUnsavedChanges.set(true);

        const updater = (item: any) => item.id === id ? { ...item, [property]: value } : item;

        if (type === 'zone') this.zones.update(l => l.map(updater));
        else if (type === 'structure') this.structures.update(l => l.map(updater));
        else if (type === 'obstacle') this.obstacles.update(l => l.map(updater));
        else if (type === 'door') this.doors.update(l => l.map(updater));
    }

    // UI Trigger for Physical Updates (Meters -> Pixels)
    updateFromPhysical(id: string, type: ElementType, property: string, valueInMeters: number) {
        // Convert Meters to Pixels
        const pixelValue = Math.round(valueInMeters * 10);

        // Find current value for Undo
        let oldValue = 0;
        const findItem = (list: any[]) => list.find(i => i.id === id);
        let item: any;

        if (type === 'zone') item = findItem(this.zones());
        else if (type === 'structure') item = findItem(this.structures());

        if (!item) return;

        // Note: For Racks, the "Relative Position" logic is handled by the model itself assuming 
        // item.x IS relative to parent if it's nested. Our visualizer assumes this.

        oldValue = item[property];

        if (oldValue !== pixelValue) {
            const cmd = new UpdateCommand({ id, type, property, oldValue, newValue: pixelValue }, this);
            this.executeCommand(cmd);
        }
    }

    // Clipboard
    clipboard: { type: ElementType, model: any }[] = [];

    // ...

    @HostListener('window:keydown.control.c', ['$event'])
    @HostListener('window:keydown.meta.c', ['$event'])
    onCopy(event: KeyboardEvent) {
        // Ignore if input is focused
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        this.copy();
    }

    @HostListener('window:keydown.control.v', ['$event'])
    @HostListener('window:keydown.meta.v', ['$event'])
    onPaste(event: KeyboardEvent) {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        this.paste();
    }

    @HostListener('window:keydown.delete', ['$event'])
    @HostListener('window:keydown.backspace', ['$event'])
    onDeleteKey(event: KeyboardEvent) {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        // Don't prevent default for backspace globally (browser back), ONLY if we are deleting?
        // Actually, preventing default on backspace is risky if user wants to navigate back.
        // But in this "Editor" context, backspace is standard for delete.
        // We will prevent default ONLY if we have a selection to delete.
        if (this.selectedElementIds().size > 0) {
            event.preventDefault();
            this.deleteSelection();
        }
    }

    copy() {
        const selectedIds = this.selectedElementIds();
        if (selectedIds.size === 0) return;

        this.clipboard = [];

        selectedIds.forEach(id => {
            let item: any;
            let type: ElementType | null = null;

            const z = this.zones().find(i => i.id === id);
            if (z) { item = z; type = 'zone'; }

            const s = this.structures().find(i => i.id === id);
            if (s) { item = s; type = 'structure'; }

            const o = this.obstacles().find(i => i.id === id);
            if (o) { item = o; type = 'obstacle'; }

            const d = this.doors().find(i => i.id === id);
            if (d) { item = d; type = 'door'; }

            if (item && type) {
                // Deep copy
                this.clipboard.push({ type, model: JSON.parse(JSON.stringify(item)) });
            }
        });
        console.log('Copied items:', this.clipboard.length);
    }

    paste() {
        if (this.clipboard.length === 0) return;

        const pastedItems: { id: string, type: ElementType, model: any }[] = [];
        const newSelection = new Set<string>();

        this.clipboard.forEach(clip => {
            // Generate new ID
            const newId = crypto.randomUUID();
            const newModel = { ...clip.model, id: newId, x: clip.model.x + 20, y: clip.model.y + 20 };

            // Adjust name to indicate copy
            if (newModel.name) newModel.name += ' (Copy)';
            if (newModel.code) newModel.code += '-CP';

            pastedItems.push({ id: newId, type: clip.type, model: newModel });
            newSelection.add(newId);
        });

        // Execute Add Command
        const cmd = new AddCommand(pastedItems, this.warehouseService, this);
        this.executeCommand(cmd);

        // Select new items
        this.selectedElementIds.set(newSelection);
        this.syncLegacySelection();
    }

    // Helpers for AddCommand
    addLocalItem(id: string, type: ElementType, model: any) {
        // Prevent duplicates (Ghost Racks fix)
        // If item with same ID exists, do nothing or update? 
        // Ideally update, but for "Add" command, it should be new.
        // Let's safe-guard: if exists, replace. If not, add.

        const updateOrAdd = (list: any[], item: any) => {
            if (list.some(i => i.id === item.id)) {
                return list.map(i => i.id === item.id ? item : i);
            }
            return [...list, item];
        };

        if (type === 'zone') this.zones.update(l => updateOrAdd(l, model));
        else if (type === 'structure') this.structures.update(l => updateOrAdd(l, model));
        else if (type === 'obstacle') this.obstacles.update(l => updateOrAdd(l, model));
        else if (type === 'door') this.doors.update(l => updateOrAdd(l, model));
    }

    removeLocalItem(id: string, type: ElementType) {
        if (type === 'zone') this.zones.update(l => l.filter(i => i.id !== id));
        else if (type === 'structure') this.structures.update(l => l.filter(i => i.id !== id));
        else if (type === 'obstacle') this.obstacles.update(l => l.filter(i => i.id !== id));
        else if (type === 'door') this.doors.update(l => l.filter(i => i.id !== id));
    }

    // ...

    syncLegacySelection() {
        const set = this.selectedElementIds();
        if (set.size === 1) {
            const id = set.values().next().value!; // Fix: Added ! assertion
            this.selectedElementId.set(id);
            if (this.zones().some(z => z.id === id)) this.selectedElementType.set('zone');
            else if (this.structures().some(s => s.id === id)) this.selectedElementType.set('structure');
            else if (this.obstacles().some(s => s.id === id)) this.selectedElementType.set('obstacle');
            else if (this.doors().some(s => s.id === id)) this.selectedElementType.set('door');

            if (this.selectedElementType() === 'zone') this.selectedZoneId.set(id);
        } else {
            this.selectedElementId.set(null);
            this.selectedElementType.set(null);
        }
    }

    // ... (rest of file)

    // Updated MouseUp to use Command
    @HostListener('window:mouseup')
    onMouseUp() {
        // 1. Finalize Selection Box
        if (this.selectionBox()) {
            this.finalizeSelectionBox();
            this.selectionBox.set(null);
            return;
        }

        // 2. Finalize Drag
        if (this.isDragging) {
            this.isDragging = false;

            // Capture Move Command
            const moveItems: { id: string, type: ElementType, from: { x: number, y: number }, to: { x: number, y: number } }[] = [];

            this.elementStartPositions.forEach((startPos, id) => {
                const type = startPos.type;
                let currentItem: any;

                if (type === 'zone') currentItem = this.zones().find(i => i.id === id);
                else if (type === 'structure') currentItem = this.structures().find(i => i.id === id);
                else if (type === 'obstacle') currentItem = this.obstacles().find(i => i.id === id);
                else if (type === 'door') currentItem = this.doors().find(i => i.id === id);

                if (currentItem) {
                    // Only add if position changed
                    if (currentItem.x !== startPos.x || currentItem.y !== startPos.y) {
                        moveItems.push({
                            id,
                            type,
                            from: { x: startPos.x, y: startPos.y },
                            to: { x: currentItem.x, y: currentItem.y }
                        });
                    }
                }
            });

            if (moveItems.length > 0) {
                const cmd = new MoveCommand(moveItems, this.warehouseService, this);
                // Note: The move already happened in the UI via onMouseMove (optimistic).
                // We just need to register the command so it can be undone.
                // We DON'T call execute() again because it would be redundant/jittery.
                // We just push to stack and ensure persistence is handled.

                // Ideally: MoveCommand.execute() does the persistence call. 
                // So we SHOULD call execute() OR manually do the persistence here.
                // Consistency: Let's call execute(). It updates local signals (redundant but safe) and calls service.
                this.executeCommand(cmd);
            }

            this.activeDragId = null;
            this.activeDragType = null;
            this.elementStartPositions.clear();
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

    // --- Measurements Helper ---
    getRelativePosition(item: any, type: ElementType): { x: number, y: number, label: string } {
        if (type === 'structure') {
            const zone = this.zones().find(z => z.id === item.zoneId);
            if (zone) {
                // Relative to Zone
                // We assume item.x is GLOBAL. If item.x is already relative, we just return it.
                // Wait, in the current implementation, are Rack coordinates Global or Relative?
                // Looking at the template: [style.left.px]="struct.x". 
                // The Racks are rendered inside:
                // <div *ngFor="let zone of zones()"> ... <div *ngFor="let struct of structures()"> 
                // BUT the styles are [style.left.px]. 
                // If the Racks are nested in the DOM inside the Zone DIV...
                // <div class="element-zone"> acts as a container?
                // Let's check the CSS. .element-zone position is absolute.
                // If Racks are children of .element-zone, then their left/top IS relative to the Zone.
                // Let's verify the HTML nesting.
                return { x: item.x, y: item.y, label: `Relative to ${zone.name}` };
            }
        }
        // Default / Zone (Global)
        return { x: item.x, y: item.y, label: 'Global Position' };
    }

    // --- Tree Selection Helper ---
    // --- Tree Selection Helper ---
    selectFromTree(id: string, type: ElementType, event: MouseEvent) {
        event.stopPropagation();
        this.selectElement(id, type, event);

        // Auto-scroll to element
        setTimeout(() => {
            let item: any;
            if (type === 'zone') item = this.zones().find(z => z.id === id);
            else if (type === 'structure') item = this.structures().find(s => s.id === id);
            else if (type === 'obstacle') item = this.obstacles().find(o => o.id === id);
            else if (type === 'door') item = this.doors().find(d => d.id === id);

            if (item) {
                const container = document.querySelector('.editor-canvas-container .overflow-auto');
                if (container) {
                    const scale = this.scale();
                    // Basic centering calculation
                    // We need to account for the fact that the content is scaled
                    // The scroll coordinates are in the coordinate space of the content *after* scaling usually, or before?
                    // With CSS transform scale on children, the parent scrollHeight typically reflects the scaled size.

                    const centerX = (item.x + item.width / 2) * scale;
                    const centerY = (item.y + item.height / 2) * scale;

                    const containerWidth = container.clientWidth;
                    const containerHeight = container.clientHeight;

                    container.scrollTo({
                        left: centerX - containerWidth / 2 + 100, // +100 for padding/margin offset
                        top: centerY - containerHeight / 2 + 100,
                        behavior: 'smooth'
                    });
                }
            }
        }, 50);
    }

    // --- Helper Functions ---
    snapToGrid(value: number): number {
        if (!this.snapEnabled()) return value;
        const size = this.gridSize();
        return Math.round(value / size) * size;
    }

    calculateSnappingAndGuides(x: number, y: number, width: number, height: number, currentId: string, type: ElementType, isShiftPressed: boolean): { x: number, y: number } {
        this.alignmentGuides.set([]); // Reset guides
        if (isShiftPressed) return { x, y };

        const threshold = 10;
        let finalX = x;
        let finalY = y;
        const guides: AlignmentGuide[] = [];

        // Define Points of Interest on Active Element
        const activeCenter = { x: x + width / 2, y: y + height / 2 };
        const activeRight = x + width;
        const activeBottom = y + height;

        // Gather candidates
        const candidates: any[] = [];
        if (type === 'structure') candidates.push(...this.structures());
        candidates.push(...this.zones()); // Snap to zones too
        // Add others if needed

        const horizontalCandidates: number[] = [];
        const verticalCandidates: number[] = [];

        candidates.forEach(other => {
            if (other.id === currentId) return;

            // X-Axis Candidates (Vertical Lines)
            verticalCandidates.push(other.x);
            verticalCandidates.push(other.x + other.width);
            verticalCandidates.push(other.x + other.width / 2);

            // Y-Axis Candidates (Horizontal Lines)
            horizontalCandidates.push(other.y);
            horizontalCandidates.push(other.y + other.height);
            horizontalCandidates.push(other.y + other.height / 2);
        });

        // --- X Axis Snapping ---
        let snappedXVal = false;

        // 1. Left Edge to Candidate
        for (const cx of verticalCandidates) {
            if (Math.abs(x - cx) < threshold) {
                finalX = cx;
                snappedXVal = true;
                guides.push({ type: 'vertical', position: cx, start: Math.min(y, 0), end: Math.max(y + height, 2000) }); // Simplified infinite line for now
                break;
            }
        }
        // 2. Right Edge to Candidate
        if (!snappedXVal) {
            for (const cx of verticalCandidates) {
                if (Math.abs(activeRight - cx) < threshold) {
                    finalX = cx - width;
                    snappedXVal = true;
                    guides.push({ type: 'vertical', position: cx, start: Math.min(y, 0), end: Math.max(y + height, 2000) });
                    break;
                }
            }
        }
        // 3. Center to Candidate
        if (!snappedXVal) {
            for (const cx of verticalCandidates) {
                if (Math.abs(activeCenter.x - cx) < threshold) {
                    finalX = cx - width / 2;
                    snappedXVal = true;
                    guides.push({ type: 'vertical', position: cx, start: Math.min(y, 0), end: Math.max(y + height, 2000) });
                    break;
                }
            }
        }

        // --- Y Axis Snapping ---
        let snappedYVal = false;

        // 1. Top Edge
        for (const cy of horizontalCandidates) {
            if (Math.abs(y - cy) < threshold) {
                finalY = cy;
                snappedYVal = true;
                guides.push({ type: 'horizontal', position: cy, start: Math.min(x, 0), end: Math.max(x + width, 2000) });
                break;
            }
        }
        // 2. Bottom Edge
        if (!snappedYVal) {
            for (const cy of horizontalCandidates) {
                if (Math.abs(activeBottom - cy) < threshold) {
                    finalY = cy - height;
                    snappedYVal = true;
                    guides.push({ type: 'horizontal', position: cy, start: Math.min(x, 0), end: Math.max(x + width, 2000) });
                    break;
                }
            }
        }
        // 3. Center
        if (!snappedYVal) {
            for (const cy of horizontalCandidates) {
                if (Math.abs(activeCenter.y - cy) < threshold) {
                    finalY = cy - height / 2;
                    snappedYVal = true;
                    guides.push({ type: 'horizontal', position: cy, start: Math.min(x, 0), end: Math.max(x + width, 2000) });
                    break;
                }
            }
        }

        // Improve guide visual range (optional, for now infinite is okay or we calculate bounds)
        // Let's refine the guide length to just span between the objects for a cleaner look?
        // For now, "infinite" (large range) is fine for CAD feel.

        this.alignmentGuides.set(guides);
        return { x: finalX, y: finalY };
    }

    // --- Creation Actions ---

    // --- Creation Actions ---

    addZone(type: 'racking' | 'bulk-stack' | 'receiving' = 'racking') {
        if (!this.warehouseId) return;
        const newId = crypto.randomUUID();

        let name = `New Zone ${this.zones().length + 1}`;
        let color = '#3b82f6';

        if (type === 'bulk-stack') {
            name = `Bulk Area ${this.zones().length + 1}`;
            color = '#a855f7'; // Purple for bulk
        } else if (type === 'receiving') {
            name = 'Receiving Area';
            color = '#eab308'; // Yellow
        }

        const newZone: WarehouseZone = {
            id: newId,
            warehouseId: this.warehouseId,
            name: name,
            code: `Z${this.zones().length + 1}`,
            color: color,
            type: type,
            x: 100,
            y: 100,
            width: 200,
            height: 150
        };
        const cmd = new AddCommand([{ id: newId, type: 'zone', model: newZone }], this.warehouseService, this);
        this.executeCommand(cmd);
        // Select it
        this.selectedElementIds.set(new Set([newId]));
        this.syncLegacySelection();
    }

    addStructure() {
        const warehouseId = this.warehouseId;
        const zoneId = this.selectedZoneId();

        if (!warehouseId || !zoneId) return;

        const newId = crypto.randomUUID();
        const newStruct: StorageStructure = {
            id: newId,
            warehouseId: warehouseId,
            zoneId: zoneId,
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
        const cmd = new AddCommand([{ id: newId, type: 'structure', model: newStruct }], this.warehouseService, this);
        this.executeCommand(cmd);

        this.selectedElementIds.set(new Set([newId]));
        this.syncLegacySelection();
    }

    openRowWizard() {
        const zoneId = this.selectedZoneId();
        if (!this.warehouseId || !zoneId) {
            alert('Please select a Zone to add racks to.');
            return;
        }
        this.showRowWizard.set(true);
    }

    generateRow() {
        const warehouseId = this.warehouseId;
        const zoneId = this.selectedZoneId();

        if (!warehouseId || !zoneId) return;

        const config = this.rowWizardConfig;
        const startX = 50;
        const startY = 50;
        const rackWidth = 120;
        const rackHeight = 40;

        const itemsToAdd: { id: string, type: ElementType, model: any }[] = [];
        const newIds = new Set<string>();

        for (let i = 0; i < config.count; i++) {
            let x = startX;
            let y = startY;

            if (config.orientation === 'horizontal') {
                x = startX + (i * (rackWidth + config.spacing));
            } else {
                y = startY + (i * (rackHeight + config.spacing));
            }

            const newId = crypto.randomUUID();
            const newStruct: StorageStructure = {
                id: newId,
                warehouseId: warehouseId,
                zoneId: zoneId,
                name: `Rack Gen-${this.structures().length + 1 + i}`, // Improve naming to avoid conflicts
                code: `R${this.structures().length + 1 + i}`,
                type: 'standard-rack',
                levels: config.levels,
                bays: config.bays,
                x: this.snapToGrid(x),
                y: this.snapToGrid(y),
                width: rackWidth,
                height: rackHeight,
                rotation: config.orientation === 'vertical' ? 90 : 0
            };
            itemsToAdd.push({ id: newId, type: 'structure', model: newStruct });
            newIds.add(newId);
        }

        const cmd = new AddCommand(itemsToAdd, this.warehouseService, this);
        this.executeCommand(cmd);

        this.selectedElementIds.set(newIds);
        this.syncLegacySelection();

        this.showRowWizard.set(false);
    }

    addObstacle() {
        if (!this.warehouseId) return;
        const newId = crypto.randomUUID();
        const obs: Obstacle = {
            id: newId,
            warehouseId: this.warehouseId,
            type: 'pillar',
            x: this.snapToGrid(300),
            y: this.snapToGrid(300),
            width: 40,
            height: 40,
            rotation: 0,
            color: '#71717a'
        };
        const cmd = new AddCommand([{ id: newId, type: 'obstacle', model: obs }], this.warehouseService, this);
        this.executeCommand(cmd);

        this.selectedElementIds.set(new Set([newId]));
        this.syncLegacySelection();
    }

    addDoor() {
        if (!this.warehouseId) return;
        const newId = crypto.randomUUID();
        const door: Door = {
            id: newId,
            warehouseId: this.warehouseId,
            type: 'dock',
            name: `Dock ${this.doors().length + 1}`,
            x: this.snapToGrid(50),
            y: this.snapToGrid(500),
            width: 80,
            height: 60,
            rotation: 0
        };
        const cmd = new AddCommand([{ id: newId, type: 'door', model: door }], this.warehouseService, this);
        this.executeCommand(cmd);

        this.selectedElementIds.set(new Set([newId]));
        this.syncLegacySelection();
    }

    // --- Selection & Interaction ---

    // Updated to support Multi-Selection
    selectElement(id: string, type: ElementType, event: MouseEvent) {
        // If not dragging, we handle selection logic
        // (If dragging, we likely already handled selection in onMouseDown)

        // Prevent event bubbling
        if (event) event.stopPropagation();

        const currentSet = new Set(this.selectedElementIds());

        if (event.shiftKey) {
            // Toggle selection
            if (currentSet.has(id)) {
                currentSet.delete(id);
            } else {
                currentSet.add(id);
            }
        } else {
            // If clicking an unselected item without shift, clear others and select this one
            // BUT if dragging a group, we don't want to deselect others on mousedown. 
            // So this logic might move to Click vs MouseDown distinction.
            // For simple click:
            if (!currentSet.has(id)) {
                currentSet.clear();
                currentSet.add(id);
            }
        }

        this.selectedElementIds.set(currentSet);
        this.syncLegacySelection(); // Keep legacy signals in sync
    }



    onBackgroundClick() {
        // Only clear if not a drag-select operation (handled in mouseup)
        if (!this.selectionBox()) {
            this.selectedElementIds.set(new Set());
            this.syncLegacySelection();
        }
    }

    // New Background Mouse Down for Selection Box
    onBackgroundMouseDown(event: MouseEvent) {
        // Panning check
        if (this.isSpacePressed() || event.button === 1 || this.activeTool() === 'pan') {
            // Space+Drag OR Middle Click OR Pan Tool Active
            this.isPanning = true;
            this.dragStart = { x: event.clientX, y: event.clientY };
            event.preventDefault(); // Prevent default scroll/text select behavior
            return;
        }

        // Called from template (mousedown) on container
        if (event.button !== 0) return; // Only left click

        this.selectedElementIds.set(new Set()); // Clear selection on start of box drag
        this.syncLegacySelection();

        // Standard Selection Box Logic
        this.dragStart = { x: event.clientX, y: event.clientY };

        // Initialize 0-size box
        this.selectionBox.set({
            x: event.clientX,
            y: event.clientY,
            width: 0,
            height: 0
        });

        event.preventDefault(); // Prevent default text selection
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
        event.preventDefault();

        this.isDragging = true;
        this.activeDragId = id;
        this.activeDragType = type;

        // Multi-Selection Logic on MouseDown
        const currentSet = new Set(this.selectedElementIds());

        if (event.shiftKey) {
            if (currentSet.has(id)) {
                // Don't remove yet, might be a drag. 
                // If it's a click, we remove in 'click' handler? 
                // Actually we often separate Click and Drag.
                // For now, let's assume Shift+Down adds/keeps.
            } else {
                currentSet.add(id);
            }
        } else {
            // If clicking an item NOT in the set, it becomes the only selection
            if (!currentSet.has(id)) {
                currentSet.clear();
                currentSet.add(id);
            }
            // If clicking an item IN the set, we keep the set (to allow group dragging)
        }

        this.selectedElementIds.set(currentSet);
        this.syncLegacySelection();

        this.dragStart = { x: event.clientX, y: event.clientY };

        // Store initial positions for ALL selected items
        // We'll calculate deltas from this snapshot
        // Map<ElementId, {x, y}>
        this.elementStartPositions = new Map();

        // Helper to capture state
        const capture = (list: any[], t: ElementType) => {
            list.forEach(item => {
                if (currentSet.has(item.id)) {
                    this.elementStartPositions.set(item.id, { x: item.x, y: item.y, type: t });
                }
            });
        };

        capture(this.zones(), 'zone');
        capture(this.structures(), 'structure');
        capture(this.obstacles(), 'obstacle');
        capture(this.doors(), 'door');
    }

    // Helper to store start positions
    elementStartPositions = new Map<string, { x: number, y: number, type: ElementType }>();

    @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

    @HostListener('window:mousemove', ['$event'])
    onMouseMove(event: MouseEvent) {

        // 0. Handle Panning (Space + Drag)
        if (this.isPanning) {
            // Safety: If mouse button is not held, stop panning (e.g. released outside window)
            if (event.buttons === 0) {
                this.isPanning = false;
                return;
            }

            const dx = event.clientX - this.dragStart.x;
            const dy = event.clientY - this.dragStart.y;

            if (this.scrollContainer) {
                this.scrollContainer.nativeElement.scrollLeft -= dx;
                this.scrollContainer.nativeElement.scrollTop -= dy;
            }

            this.dragStart = { x: event.clientX, y: event.clientY }; // Reset for continuous delta
            return;
        }

        // 1. Handle Selection Box
        if (this.selectionBox()) {
            const startX = this.dragStart.x;
            const startY = this.dragStart.y;
            const currentX = event.clientX;
            const currentY = event.clientY;

            const x = Math.min(startX, currentX);
            const y = Math.min(startY, currentY);
            const w = Math.abs(currentX - startX);
            const h = Math.abs(currentY - startY);

            this.selectionBox.set({ x, y, width: w, height: h });

            // Real-time selection highlighting could go here
            return;
        }

        // 2. Handle Dragging
        if (!this.isDragging || this.selectedElementIds().size === 0) return;

        const dx = (event.clientX - this.dragStart.x) / this.scale();
        const dy = (event.clientY - this.dragStart.y) / this.scale();

        // Move ALL selected elements
        // We iterate our snapshot of start positions

        // Prepare bulk updates
        let newZones = [...this.zones()];
        let newStructs = [...this.structures()];
        let newObs = [...this.obstacles()];
        let newDoors = [...this.doors()];

        this.elementStartPositions.forEach((startPos, id) => {
            const rawX = startPos.x + dx;
            const rawY = startPos.y + dy;

            // Snap individually? Or Snap the "Leader" (activeDragId)?
            // Usually we snap the leader, and others follow strict delta.
            // OR we move freely and snap individually.
            // Let's snap the LEADER locally, calculate the finalized delta, and apply to others.

            // But doing that for every frame might be jittery if we don't have a clear leader.
            // We do have 'activeDragId'.

            let finalX = rawX;
            let finalY = rawY;

            // If this is the "Leader" (the one under mouse), apply snapping
            if (id === this.activeDragId) {
                finalX = this.snapToGrid(rawX);
                finalY = this.snapToGrid(rawY);

                // Magnetic Snap (Leader only for now)
                if (this.snapEnabled() && this.activeDragType) {
                    // Determine dimensions for advanced snapping
                    let width = 0;
                    let height = 0;
                    if (this.activeDragType === 'zone') {
                        const z = this.zones().find(i => i.id === id);
                        if (z) { width = z.width; height = z.height; }
                    } else if (this.activeDragType === 'structure') {
                        const s = this.structures().find(i => i.id === id);
                        if (s) { width = s.width; height = s.height; }
                    } else if (this.activeDragType === 'obstacle') {
                        const o = this.obstacles().find(i => i.id === id);
                        if (o) { width = o.width; height = o.height; }
                    } else if (this.activeDragType === 'door') {
                        const d = this.doors().find(i => i.id === id);
                        if (d) { width = d.width; height = d.height; }
                    }

                    const snap = this.calculateSnappingAndGuides(finalX, finalY, width, height, id, this.activeDragType, event.shiftKey);
                    finalX = snap.x;
                    finalY = snap.y;
                }
            } else {
                finalX = this.snapToGrid(rawX);
                finalY = this.snapToGrid(rawY);
            }

            // Update the specific list
            if (startPos.type === 'zone') {
                newZones = newZones.map(z => z.id === id ? { ...z, x: finalX, y: finalY } : z);
            } else if (startPos.type === 'structure') {
                // AUTO-PARENTING CHECK:
                // If the Rack's Parent Zone is ALSO selected, we MUST NOT move the Rack relative to the Zone.
                // The Rack moves *because* the Zone moves.
                // So we check if parent zone is in selectedElementIds.
                const struct = this.structures().find(s => s.id === id);
                const parentZoneSelected = struct && this.selectedElementIds().has(struct.zoneId);

                if (!parentZoneSelected) {
                    newStructs = newStructs.map(s => s.id === id ? { ...s, x: finalX, y: finalY } : s);
                }
            } else if (startPos.type === 'obstacle') {
                newObs = newObs.map(o => o.id === id ? { ...o, x: finalX, y: finalY } : o);
            } else if (startPos.type === 'door') {
                newDoors = newDoors.map(d => d.id === id ? { ...d, x: finalX, y: finalY } : d);
            }
        });

        // Apply updates
        this.zones.set(newZones);
        this.structures.set(newStructs);
        this.obstacles.set(newObs);
        this.doors.set(newDoors);
    }



    finalizeSelectionBox() {
        const box = this.selectionBox();
        if (!box) return;

        // Convert screen box to Canvas coordinates
        // We need to account for scroll and scale if possible, OR
        // we essentially just check intersection of Screen Rects if we want wysiwyg

        // Actually, simplest is: Get BoundingClientRect of every element and check intersection with Box
        const selectionRect = { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };

        const newSet = new Set<string>();



        // Given we don't have easy ref access to 1000 items, let's use Logic Logic.
        // LogicX to ScreenX
        // Box is in Screen Coords (ClientX/Y).
        // Transform Logic Coords to Screen Coords requires:
        // Container Rect + Scroll Offset + Scale.

        // Let's get container rect
        const container = document.querySelector('.transform-origin-top-left') as HTMLElement; // The scaled div
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const scale = this.scale();

        const checkIntersection = (item: any) => {
            // Item Logic Coords (Relative to Container Origin)
            const itemScreenLeft = containerRect.left + (item.x * scale);
            const itemScreenTop = containerRect.top + (item.y * scale);
            const itemScreenWidth = item.width * scale;
            const itemScreenHeight = item.height * scale;

            const itemRect = {
                left: itemScreenLeft,
                right: itemScreenLeft + itemScreenWidth,
                top: itemScreenTop,
                bottom: itemScreenTop + itemScreenHeight
            };

            // Check overlap
            return !(itemRect.left > selectionRect.right ||
                itemRect.right < selectionRect.left ||
                itemRect.top > selectionRect.bottom ||
                itemRect.bottom < selectionRect.top);
        };

        this.zones().forEach(z => { if (checkIntersection(z)) newSet.add(z.id); });
        this.structures().forEach(s => { if (checkIntersection(s)) newSet.add(s.id); });
        this.obstacles().forEach(o => { if (checkIntersection(o)) newSet.add(o.id); });
        this.doors().forEach(d => { if (checkIntersection(d)) newSet.add(d.id); });

        this.selectedElementIds.set(newSet);
        this.syncLegacySelection();
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
    }
        
        this.hasUnsavedChanges.set(false);
this.onBackgroundClick();
    }

    async deleteSelection() {
    if (!confirm('Delete selected elements?')) return;
    const selectedIds = this.selectedElementIds();
    if (selectedIds.size === 0) return;

    const itemsToDelete: { id: string, type: ElementType, model: any }[] = [];

    selectedIds.forEach(id => {
        const z = this.zones().find(i => i.id === id);
        if (z) itemsToDelete.push({ id, type: 'zone', model: { ...z } });

        const s = this.structures().find(i => i.id === id);
        if (s) itemsToDelete.push({ id, type: 'structure', model: { ...s } });

        const o = this.obstacles().find(i => i.id === id);
        if (o) itemsToDelete.push({ id, type: 'obstacle', model: { ...o } });

        const d = this.doors().find(i => i.id === id);
        if (d) itemsToDelete.push({ id, type: 'door', model: { ...d } });
    });

    if (itemsToDelete.length > 0) {
        const cmd = new DeleteCommand(itemsToDelete, this.warehouseService, this);
        this.executeCommand(cmd);

        this.selectedElementIds.set(new Set());
        this.syncLegacySelection();
    }
}
}
