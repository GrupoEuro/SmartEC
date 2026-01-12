import { Injectable, signal, computed } from '@angular/core';
import { StorageStructure } from '../models/warehouse.model';
import { Point } from './pathfinding.service';

/**
 * Area selection shape types
 */
export type SelectionShape = 'rectangle' | 'polygon' | 'freehand';

/**
 * Selected area data
 */
export interface AreaSelection {
    shape: SelectionShape;
    coordinates: Point[];
    selectedRacks: StorageStructure[];
    selectedRackIds: string[];
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

/**
 * AreaSelectionService
 * 
 * Manages interactive area selection tool for warehouse map
 * Features:
 * - Rectangle lasso selection
 * - Point-in-polygon detection
 * - Bulk operations on selected areas
 */
@Injectable({
    providedIn: 'root'
})
export class AreaSelectionService {

    // State
    private _selectionMode = signal<SelectionShape | 'none'>('none');
    private _selectedArea = signal<AreaSelection | null>(null);
    private _isSelecting = signal(false);

    // Read-only
    public readonly selectionMode = this._selectionMode.asReadonly();
    public readonly selectedArea = this._selectedArea.asReadonly();
    public readonly isSelecting = this._isSelecting.asReadonly();

    // Computed
    public readonly selectedRackCount = computed(() => {
        return this.selectedArea()?.selectedRacks.length || 0;
    });

    public readonly hasSelection = computed(() => {
        return this.selectedArea() !== null;
    });

    /**
     * Start selection mode
     */
    startSelection(shape: SelectionShape): void {
        this._selectionMode.set(shape);
        this._isSelecting.set(true);
        this._selectedArea.set(null);
        console.log('[AreaSelectionService] Started', shape, 'selection');
    }

    /**
     * Complete selection with coordinates
     */
    completeSelection(coordinates: Point[], allRacks: StorageStructure[]): void {
        if (coordinates.length < 2) {
            this.cancelSelection();
            return;
        }

        const selectedRacks = this.findRacksInArea(coordinates, allRacks);
        const boundingBox = this.calculateBoundingBox(coordinates);

        const selection: AreaSelection = {
            shape: this.selectionMode() as SelectionShape,
            coordinates,
            selectedRacks,
            selectedRackIds: selectedRacks.map(r => r.id!),
            boundingBox
        };

        this._selectedArea.set(selection);
        this._isSelecting.set(false);
        this._selectionMode.set('none');

        console.log('[AreaSelectionService] Selected', selectedRacks.length, 'racks');
    }

    /**
     * Cancel current selection
     */
    cancelSelection(): void {
        this._isSelecting.set(false);
        this._selectionMode.set('none');
        console.log('[AreaSelectionService] Selection cancelled');
    }

    /**
     * Clear selected area
     */
    clearSelection(): void {
        this._selectedArea.set(null);
        this._selectionMode.set('none');
        this._isSelecting.set(false);
        console.log('[AreaSelectionService] Selection cleared');
    }

    /**
     * Find racks within the selected area
     */
    private findRacksInArea(area: Point[], racks: StorageStructure[]): StorageStructure[] {
        if (area.length === 2) {
            // Rectangle selection (2 points: top-left and bottom-right)
            return this.findRacksInRectangle(area[0], area[1], racks);
        } else {
            // Polygon selection (3+ points)
            return this.findRacksInPolygon(area, racks);
        }
    }

    /**
     * Find racks inside a rectangle
     */
    private findRacksInRectangle(p1: Point, p2: Point, racks: StorageStructure[]): StorageStructure[] {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        return racks.filter(rack => {
            // Check if rack center is inside rectangle
            const centerX = rack.x + (rack.width / 2);
            const centerY = rack.y + (rack.height / 2);

            return (
                centerX >= minX &&
                centerX <= maxX &&
                centerY >= minY &&
                centerY <= maxY
            );
        });
    }

    /**
     * Find racks inside a polygon (point-in-polygon algorithm)
     */
    private findRacksInPolygon(polygon: Point[], racks: StorageStructure[]): StorageStructure[] {
        return racks.filter(rack => {
            const centerX = rack.x + (rack.width / 2);
            const centerY = rack.y + (rack.height / 2);
            return this.isPointInPolygon({ x: centerX, y: centerY }, polygon);
        });
    }

    /**
     * Ray-casting algorithm for point-in-polygon test
     * @returns true if point is inside polygon
     */
    private isPointInPolygon(point: Point, polygon: Point[]): boolean {
        let inside = false;
        const x = point.x;
        const y = point.y;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

            if (intersect) inside = !inside;
        }

        return inside;
    }

    /**
     * Calculate bounding box from points
     */
    private calculateBoundingBox(points: Point[]): { x: number, y: number, width: number, height: number } {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Check if a rack is currently selected
     */
    isRackSelected(rackId: string): boolean {
        return this.selectedArea()?.selectedRackIds.includes(rackId) || false;
    }
}
