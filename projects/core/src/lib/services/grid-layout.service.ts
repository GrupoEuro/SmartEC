import { Injectable } from '@angular/core';

/**
 * Grid Layout Configuration
 */
export interface GridConfig {
    cellSize: number;       // Size of each grid cell (px)
    padding: number;        // Padding between cells (px)
    rows: number;          // Number of rows
    cols: number;          // Number of columns
    offsetX: number;       // Starting X offset
    offsetY: number;       // Starting Y offset
}

/**
 * Grid Position
 */
export interface GridPosition {
    row: number;
    col: number;
    spanRows?: number;     // Multi-cell spanning (default: 1)
    spanCols?: number;     // Multi-cell spanning (default: 1)
}

/**
 * Pixel Coordinates
 */
export interface PixelCoordinates {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Grid Layout Service
 * 
 * Provides utilities for converting between grid positions and pixel coordinates
 * Ensures consistent, professional warehouse layouts
 */
@Injectable({
    providedIn: 'root'
})
export class GridLayoutService {

    /**
     * Default grid configuration for warehouses
     */
    private readonly DEFAULT_CONFIG: GridConfig = {
        cellSize: 60,      // 60px per cell
        padding: 10,       // 10px gap between racks
        rows: 8,           // 8 rows
        cols: 12,          // 12 columns
        offsetX: 50,       // 50px from left edge
        offsetY: 50        // 50px from top edge
    };

    /**
     * Convert grid position to pixel coordinates
     */
    gridToPixels(
        position: GridPosition,
        config: GridConfig = this.DEFAULT_CONFIG
    ): PixelCoordinates {
        const { row, col, spanRows = 1, spanCols = 1 } = position;
        const { cellSize, padding, offsetX, offsetY } = config;

        const cellWithPadding = cellSize + padding;

        return {
            x: offsetX + (col * cellWithPadding),
            y: offsetY + (row * cellWithPadding),
            width: (cellSize * spanCols) + (padding * (spanCols - 1)),
            height: (cellSize * spanRows) + (padding * (spanRows - 1))
        };
    }

    /**
     * Convert pixel coordinates to nearest grid position
     */
    pixelsToGrid(
        x: number,
        y: number,
        config: GridConfig = this.DEFAULT_CONFIG
    ): GridPosition {
        const { cellSize, padding, offsetX, offsetY } = config;
        const cellWithPadding = cellSize + padding;

        const col = Math.round((x - offsetX) / cellWithPadding);
        const row = Math.round((y - offsetY) / cellWithPadding);

        return {
            row: Math.max(0, Math.min(row, config.rows - 1)),
            col: Math.max(0, Math.min(col, config.cols - 1))
        };
    }

    /**
     * Snap pixel coordinates to nearest grid cell
     */
    snapToGrid(
        x: number,
        y: number,
        config: GridConfig = this.DEFAULT_CONFIG
    ): PixelCoordinates {
        const gridPos = this.pixelsToGrid(x, y, config);
        return this.gridToPixels(gridPos, config);
    }

    /**
     * Check if grid position is within bounds
     */
    isValidPosition(
        position: GridPosition,
        config: GridConfig = this.DEFAULT_CONFIG
    ): boolean {
        const { row, col, spanRows = 1, spanCols = 1 } = position;

        return row >= 0 &&
            col >= 0 &&
            (row + spanRows) <= config.rows &&
            (col + spanCols) <= config.cols;
    }

    /**
     * Check if two grid positions overlap
     */
    positionsOverlap(pos1: GridPosition, pos2: GridPosition): boolean {
        const span1Rows = pos1.spanRows || 1;
        const span1Cols = pos1.spanCols || 1;
        const span2Rows = pos2.spanRows || 1;
        const span2Cols = pos2.spanCols || 1;

        const rowOverlap = !(
            pos1.row + span1Rows <= pos2.row ||
            pos2.row + span2Rows <= pos1.row
        );

        const colOverlap = !(
            pos1.col + span1Cols <= pos2.col ||
            pos2.col + span2Cols <= pos1.col
        );

        return rowOverlap && colOverlap;
    }

    /**
     * Find next available grid position (left-to-right, top-to-bottom)
     */
    findNextAvailablePosition(
        occupiedPositions: GridPosition[],
        spanRows: number = 1,
        spanCols: number = 1,
        config: GridConfig = this.DEFAULT_CONFIG
    ): GridPosition | null {
        for (let row = 0; row < config.rows; row++) {
            for (let col = 0; col < config.cols; col++) {
                const candidate: GridPosition = { row, col, spanRows, spanCols };

                // Check if valid
                if (!this.isValidPosition(candidate, config)) continue;

                // Check if overlaps with any occupied position
                const overlaps = occupiedPositions.some(pos =>
                    this.positionsOverlap(candidate, pos)
                );

                if (!overlaps) return candidate;
            }
        }

        return null; // Grid is full
    }

    /**
     * Generate grid layout for a zone
     * Auto-arranges racks in a neat grid pattern
     */
    autoLayoutZone(
        rackCount: number,
        racksPerRow: number = 4,
        rackSpanRows: number = 1,
        rackSpanCols: number = 1,
        config: GridConfig = this.DEFAULT_CONFIG
    ): GridPosition[] {
        const positions: GridPosition[] = [];

        for (let i = 0; i < rackCount; i++) {
            const row = Math.floor(i / racksPerRow) * (rackSpanRows + 0.5); // Add 0.5 for visual gap between rows
            const col = (i % racksPerRow) * (rackSpanCols + 0.5);

            const position: GridPosition = {
                row: Math.floor(row),
                col: Math.floor(col),
                spanRows: rackSpanRows,
                spanCols: rackSpanCols
            };

            if (this.isValidPosition(position, config)) {
                positions.push(position);
            }
        }

        return positions;
    }

    /**
     * Get default grid configuration
     */
    getDefaultConfig(): GridConfig {
        return { ...this.DEFAULT_CONFIG };
    }

    /**
     * Create custom grid configuration
     */
    createConfig(overrides: Partial<GridConfig>): GridConfig {
        return { ...this.DEFAULT_CONFIG, ...overrides };
    }
}
