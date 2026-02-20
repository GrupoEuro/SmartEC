import { Timestamp } from '@angular/fire/firestore';

/**
 * Component within a product kit
 */
export interface KitComponent {
    productId: string;
    productName: string; // Snapshot for display
    productImage: string; // Snapshot for display
    sku: string;
    quantity: number; // How many of this product in the kit
    unitPrice: number; // Price at time of kit creation
}

/**
 * Product Kit - Bundle of products sold as a single unit
 */
export interface ProductKit {
    id?: string;

    // Basic Info
    name: {
        es: string;
        en: string;
    };
    slug: string;
    sku: string; // Unique kit SKU (e.g., "KIT-4TIRES-BAL")

    // Description
    description: {
        es: string;
        en: string;
    };

    // Components
    components: KitComponent[];

    // Pricing
    price: number; // Kit price (can be less than sum of components)
    compareAtPrice?: number; // Original price if discounted
    savingsAmount?: number; // Auto-calculated: sum(components) - price
    savingsPercentage?: number; // Auto-calculated

    // Media
    image: string; // Main kit image
    gallery?: string[]; // Additional images

    // Marketing
    featured: boolean;
    tags: string[];

    // SEO
    seo?: {
        metaTitle?: string;
        metaDescription?: string;
        focusKeywords?: string[];
    };

    // Status
    active: boolean;
    publishStatus?: 'draft' | 'published' | 'archived';

    // Metadata
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
    createdBy?: string; // Admin user ID
}

/**
 * Helper type for creating new kits
 */
export type ProductKitInput = Omit<ProductKit, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Helper type for updating kits
 */
export type ProductKitUpdate = Partial<Omit<ProductKit, 'id' | 'createdAt'>> & {
    updatedAt: Timestamp | Date;
};

/**
 * Kit availability info (calculated from component stock)
 */
export interface KitAvailability {
    kitId: string;
    isAvailable: boolean;
    maxQuantity: number; // Max kits that can be made from current stock
    limitingComponent?: {
        productId: string;
        productName: string;
        availableStock: number;
        requiredPerKit: number;
    };
}
