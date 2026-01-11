import { Timestamp } from '@angular/fire/firestore';

export type WarehouseType = 'physical' | 'virtual';

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

    // Virtual Warehouse Specifics
    processType?: 'returns' | 'damaged' | 'in-transit' | 'quality-control' | 'fba-reserved' | 'cross-docking' | 'general';
}

export interface WarehouseZone {
    id: string;
    warehouseId: string;
    name: string; // e.g., "Zone A", "Receiving"
    code: string;
    color: string; // For visual editor
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
    name: string; // e.g., "Rack 01"
    code: string;
    type: StorageStructureType;

    // Dimensions
    levels: number; // Vertical height
    bays: number;   // Horizontal sections

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
