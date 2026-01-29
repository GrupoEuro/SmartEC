/**
 * @deprecated
 * This file is deprecated. All Product types have been consolidated in catalog.model.ts
 * to support dynamic product types (tire, helmet, battery, parts, accessories, etc.)
 * 
 * Import from catalog.model.ts instead:
 * import { Product, ProductFilters, ProductSort } from './catalog.model';
 */

// Re-export everything from catalog.model.ts for backwards compatibility
export * from './catalog.model';

// Keep TireSpecifications for backwards compatibility only
export interface TireSpecifications {
    width: number;
    aspectRatio: number;
    diameter: number;
    loadIndex: string;
    speedRating: string;
    tubeless: boolean;
    construction: 'radial' | 'bias';
}
