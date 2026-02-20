import { Timestamp } from '@angular/fire/firestore';

/**
 * Category interface for organizing products
 * Supports hierarchical structure with parent/child relationships
 */
export interface Category {
    id?: string;
    name: {
        es: string;
        en: string;
    };
    slug: string;
    description?: {
        es: string;
        en: string;
    };
    icon?: string; // emoji or icon name
    imageUrl?: string;
    parentId?: string; // For subcategories
    order: number;
    active: boolean;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

/**
 * Helper type for creating new categories (without id and timestamps)
 */
export type CategoryInput = Omit<Category, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Helper type for updating categories (all fields optional except id)
 */
export type CategoryUpdate = Partial<Omit<Category, 'id' | 'createdAt'>> & {
    updatedAt: Timestamp | Date;
};
