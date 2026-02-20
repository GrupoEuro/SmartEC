import { Injectable, computed, inject, signal } from '@angular/core';
import { WarehouseService } from './warehouse.service';
import { WarehouseLevel, WarehouseZone, StorageStructure, Obstacle, Door } from '../models/warehouse.model';
import { first, map } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

/**
 * WarehouseLevelService
 * 
 * Manages multi-level warehouse state and provides filtered data
 * based on the active level selection.
 * 
 * Features:
 * - Level switching with animation support
 * - Filtered data (only show entities from active level)
 * - Occupancy statistics per level
 * - Backward compatibility (auto-creates Level 0 for v1.0 warehouses)
 */
@Injectable({
    providedIn: 'root'
})
export class WarehouseLevelService {
    private warehouseService = inject(WarehouseService);

    // ========================================
    // State (Private Signals)
    // ========================================

    private _levels = signal<WarehouseLevel[]>([]);
    private _activeLevel = signal<number>(0);
    private _warehouseId = signal<string | null>(null);

    // ========================================
    // Public Read-Only Signals
    // ========================================

    public readonly levels = this._levels.asReadonly();
    public readonly activeLevel = this._activeLevel.asReadonly();
    public readonly warehouseId = this._warehouseId.asReadonly();

    // ========================================
    // Computed Values (Derived State)
    // ========================================

    /**
     * Get the currently active level object
     */
    public readonly activeLevelData = computed(() => {
        const levelNum = this.activeLevel();
        return this.levels().find(l => l.levelNumber === levelNum) || null;
    });

    /**
     * Get zones for the active level only
     */
    public readonly visibleZones = computed(() => {
        const level = this.activeLevelData();
        return level?.zones || [];
    });

    /**
     * Get structures (racks) for the active level only
     */
    public readonly visibleStructures = computed(() => {
        const level = this.activeLevelData();
        return level?.structures || [];
    });

    /**
     * Get obstacles for the active level only
     */
    public readonly visibleObstacles = computed(() => {
        const level = this.activeLevelData();
        return level?.obstacles || [];
    });

    /**
     * Get doors for the active level only
     */
    public readonly visibleDoors = computed(() => {
        const level = this.activeLevelData();
        return level?.doors || [];
    });

    /**
     * Total bin capacity across all levels
     */
    public readonly totalBinCapacity = computed(() => {
        return this.levels().reduce((total, level) => {
            return total + level.structures.reduce((sum, rack) => {
                return sum + (rack.bays * rack.levels);
            }, 0);
        }, 0);
    });

    /**
     * Get occupancy statistics for each level
     */
    public readonly levelStatistics = computed(() => {
        return this.levels().map(level => ({
            levelNumber: level.levelNumber,
            name: level.name,
            rackCount: level.structures.length,
            zoneCount: level.zones.length,
            totalBins: level.structures.reduce((sum, rack) => sum + (rack.bays * rack.levels), 0)
        }));
    });

    // ========================================
    // Public Methods
    // ========================================

    /**
     * Load levels for a specific warehouse
     * Auto-migrates v1.0 warehouses to v2.0 structure
     */
    async loadLevels(warehouseId: string): Promise<void> {
        this._warehouseId.set(warehouseId);

        try {
            // Get warehouse data
            const warehouses = await firstValueFrom(this.warehouseService.getWarehouses().pipe(first()));
            const warehouse = warehouses?.find(w => w.id === warehouseId);

            if (!warehouse) {
                console.error('[WarehouseLevelService] Warehouse not found:', warehouseId);
                this._levels.set([]);
                return;
            }

            // Check if warehouse has multi-level support
            if (warehouse.levels && warehouse.levels.length > 0) {
                // v2.0 warehouse - hydrate levels with data from sub-collections
                console.log('[WarehouseLevelService] Hydrating v2.0 multi-level warehouse...');

                // Fetch all data for the warehouse in parallel
                const [allZones, allStructures, allObstacles, allDoors] = await Promise.all([
                    firstValueFrom(this.warehouseService.getZones(warehouseId).pipe(first())),
                    firstValueFrom(this.warehouseService.getStructures(warehouseId).pipe(first())),
                    firstValueFrom(this.warehouseService.getObstacles(warehouseId).pipe(first())),
                    firstValueFrom(this.warehouseService.getDoors(warehouseId).pipe(first()))
                ]);

                // Map data to each level
                const hydratedLevels: WarehouseLevel[] = warehouse.levels.map(meta => {
                    const levelId = meta.id;
                    return {
                        ...meta,
                        zones: (allZones || []).filter(z => z.levelId === levelId),
                        structures: (allStructures || []).filter(s => s.levelId === levelId),
                        obstacles: (allObstacles || []).filter(o => o.levelId === levelId),
                        doors: (allDoors || []).filter(d => d.levelId === levelId)
                    };
                });

                this._levels.set(hydratedLevels);
                this._activeLevel.set(warehouse.defaultLevel || 0);
                console.log('[WarehouseLevelService] Loaded', warehouse.levels.length, 'levels');
            } else {
                // v1.0 warehouse - migrate to single level
                console.log('[WarehouseLevelService] Auto-migrating v1.0 warehouse to Level 0');

                const zones = await firstValueFrom(this.warehouseService.getZones(warehouseId).pipe(first())) || [];
                const structures = await firstValueFrom(this.warehouseService.getStructures(warehouseId).pipe(first())) || [];
                const obstacles = await firstValueFrom(this.warehouseService.getObstacles(warehouseId).pipe(first())) || [];
                const doors = await firstValueFrom(this.warehouseService.getDoors(warehouseId).pipe(first())) || [];

                const groundLevel: WarehouseLevel = {
                    id: `${warehouseId}_LEVEL_0`,
                    warehouseId,
                    levelNumber: 0,
                    name: 'Ground Floor',
                    zones,
                    structures,
                    obstacles,
                    doors
                };

                this._levels.set([groundLevel]);
                this._activeLevel.set(0);
            }
        } catch (error) {
            console.error('[WarehouseLevelService] Error loading levels:', error);
            this._levels.set([]);
        }
    }

    /**
     * Switch to a different level
     */
    switchLevel(levelNumber: number): void {
        const maxLevel = this.levels().length - 1;

        if (levelNumber < 0 || levelNumber > maxLevel) {
            console.warn('[WarehouseLevelService] Invalid level:', levelNumber, 'Max:', maxLevel);
            return;
        }

        this._activeLevel.set(levelNumber);
        console.log('[WarehouseLevelService] Switched to level', levelNumber);

        // Analytics tracking (optional)
        // this.analytics.track('level_switched', { level: levelNumber });
    }

    /**
     * Switch to next level (up)
     */
    levelUp(): void {
        const next = this.activeLevel() + 1;
        if (next < this.levels().length) {
            this.switchLevel(next);
        }
    }

    /**
     * Switch to previous level (down)
     */
    levelDown(): void {
        const prev = this.activeLevel() - 1;
        if (prev >= 0) {
            this.switchLevel(prev);
        }
    }

    /**
     * Reset to default level (usually 0)
     */
    resetToDefaultLevel(): void {
        this.switchLevel(0);
    }

    /**
     * Check if a specific level exists
     */
    hasLevel(levelNumber: number): boolean {
        return this.levels().some(l => l.levelNumber === levelNumber);
    }

    /**
     * Get level by number
     */
    getLevelByNumber(levelNumber: number): WarehouseLevel | null {
        return this.levels().find(l => l.levelNumber === levelNumber) || null;
    }

    /**
     * Clear all levels (cleanup)
     */
    clear(): void {
        this._levels.set([]);
        this._activeLevel.set(0);
        this._warehouseId.set(null);
    }
}
