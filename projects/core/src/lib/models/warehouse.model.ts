import { Timestamp } from '@angular/fire/firestore';

export type WarehouseType = 'physical' | 'virtual';

/**
 * Zone types with predefined color schemes for visual consistency
 */
export enum ZoneType {
    PICKING = 'PICKING',           // High-traffic, fast-moving items
    RESERVE = 'RESERVE',           // Medium-turnover inventory
    BULK = 'BULK',                 // Pallets, slow-moving items
    QUARANTINE = 'QUARANTINE',     // Defective, hold items
    RECEIVING = 'RECEIVING',       // Incoming shipments
    PACKING = 'PACKING',           // Order preparation
    RETURNS = 'RETURNS',           // Customer returns processing
    CROSS_DOCK = 'CROSS_DOCK'      // Direct transfer without storage
}

/**
 * Color palette for zone types
 */
export const ZONE_COLORS: Record<ZoneType, string> = {
    [ZoneType.PICKING]: '#10b981',      // Green
    [ZoneType.RESERVE]: '#3b82f6',      // Blue
    [ZoneType.BULK]: '#a855f7',         // Purple
    [ZoneType.QUARANTINE]: '#ef4444',   // Red
    [ZoneType.RECEIVING]: '#eab308',    // Yellow
    [ZoneType.PACKING]: '#06b6d4',      // Cyan
    [ZoneType.RETURNS]: '#f97316',      // Orange
    [ZoneType.CROSS_DOCK]: '#8b5cf6'    // Violet
};

/**
 * Represents a physical level/floor in a warehouse
 * Enables multi-story or vertically-stacked warehouse visualization
 */
export interface WarehouseLevel {
    id: string;
    warehouseId: string;
    levelNumber: number;            // 0 = ground floor, 1 = mezzanine, 2 = second floor, etc.
    name: string;                   // "Ground Floor", "Mezzanine", "Overhead Storage"
    heightMeters?: number;          // Physical height above ground level (optional)
    zones: WarehouseZone[];
    structures: StorageStructure[];
    obstacles: Obstacle[];
    doors: Door[];
}

export interface Warehouse {
    id: string;
    name: string;
    code: string;
    type: WarehouseType;
    address?: string; // Only for physical
    isActive: boolean;
    totalArea?: number; // Square meters
    createdAt: Timestamp;
    updatedAt: Timestamp;

    // Multi-Level Support (v2.0)
    levels?: WarehouseLevel[];      // Array of warehouse levels/floors
    defaultLevel?: number;          // Which level to display on load (usually 0)

    // Virtual Warehouse Specifics
    processType?: 'returns' | 'damaged' | 'in-transit' | 'quality-control' | 'fba-reserved' | 'cross-docking' | 'general';
}

export interface WarehouseZone {
    id: string;
    warehouseId: string;
    levelId?: string;               // NEW: Which level this zone belongs to
    name: string; // e.g., "Zone A", "Receiving"
    code: string;
    color: string; // For visual editor (e.g., '#10b981')
    zoneType?: ZoneType;            // NEW: Standardized zone classification
    type: 'racking' | 'bulk-stack' | 'packing' | 'receiving' | 'shipping' | 'staging';

    // Visual Editor Coordinates (normalized 0-1 or grid)
    x: number;
    y: number;
    width: number;
    height: number;

    properties?: {
        temperature?: 'ambient' | 'cold' | 'frozen';
        isSecure?: boolean;
    };
}

export type StorageStructureType = 'standard-rack' | 'flow-rack' | 'cantilever' | 'floor-stack' | 'shelf';

export interface StorageStructure {
    id: string;
    zoneId: string;
    warehouseId: string;
    levelId?: string;               // NEW: Which level this rack belongs to
    name: string; // e.g., "Rack 01"
    code: string;
    type: StorageStructureType;
    verticalPosition?: number;      // NEW: For stacked racks on same level (0, 1, 2...)

    // Dimensions
    levels: number; // Vertical height
    bays: number;   // Horizontal sections
    totalLocations?: number; // Pre-calculated bin capacity

    // Visual Editor Coordinates relative to Zone
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number; // 0, 90, 180, 270
}

export interface Obstacle {
    id: string;
    warehouseId: string;
    levelId?: string;               // NEW: Which level this obstacle belongs to
    type: 'pillar' | 'wall' | 'office' | 'equipment';
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    color?: string; // Optional custom color
}

export interface Door {
    id: string;
    warehouseId: string;
    levelId?: string;               // NEW: Which level this door belongs to
    type: 'inbound' | 'outbound' | 'emergency' | 'dock';
    name: string; // "Dock 1"
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}

export interface StorageLocation { // The "Bin"
    id: string;
    warehouseId: string;
    zoneId: string;
    structureId: string;
    levelId?: string;               // NEW: Which level this bin belongs to

    code: string; // e.g., "A-01-01-01" (Zone-Rack-Bay-Level)
    barcode: string;

    // Position
    bay: number;
    level: number;
    position: number; // Sub-division of a shelf (optional)

    // Dimensions
    width?: number;
    height?: number;
    depth?: number;
    maxWeight?: number;
    maxVolume?: number;

    // State
    status: 'empty' | 'partial' | 'full' | 'blocked' | 'maintenance';
    currentUtilization: number; // % volume filled

    // Inventory Content
    productId?: string;
    productSku?: string;
    productName?: string;
    quantity?: number;

    // Inventory is linked via InventoryRecord collection, not embedded here
}
