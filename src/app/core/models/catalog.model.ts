/**
 * Category Model
 * Represents a product category or subcategory in the catalog
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
    icon?: string; // Emoji or icon name
    imageUrl?: string;
    imagePath?: string;
    parentId?: string; // For subcategories, null for top-level categories
    order: number; // Display order
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Brand Model
 * Represents a tire brand (e.g., Praxis, Michelin, Pirelli)
 */
export interface Brand {
    id?: string;
    name: string;
    slug: string;
    description?: {
        es: string;
        en: string;
    };
    logoUrl?: string;
    logoPath?: string;
    website?: string;
    countryOfOrigin?: string;
    featured: boolean; // Show on homepage
    order: number; // Display order
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Product Specifications
 * Tire-specific technical specifications
 */
export interface ProductSpecifications {
    width: number; // mm, e.g., 120
    aspectRatio: number; // %, e.g., 70
    diameter: number; // inches, e.g., 17
    loadIndex: string; // e.g., "58"
    speedRating: string; // e.g., "W"
    tubeless: boolean;
    construction: 'radial' | 'bias';
}

/**
 * Product Model
 * Represents a motorcycle tire product
 */
export interface Product {
    id?: string;
    name: {
        es: string;
        en: string;
    };
    slug: string;
    sku: string; // Unique product code
    brand: string; // Praxis, Michelin, etc.
    categoryId: string;
    subcategoryId?: string;

    // Tire specifications
    specifications: ProductSpecifications;

    // Product details
    description: {
        es: string;
        en: string;
    };
    features: {
        es: string[];
        en: string[];
    };
    applications: string[]; // Compatible motorcycle models

    // Media
    images: {
        main: string;
        mainPath?: string;
        gallery: string[];
        galleryPaths?: string[];
    };

    // Pricing & Stock
    price: number;
    compareAtPrice?: number; // Original price for discounts
    inStock: boolean;

    // [AGGREGATE] Total Physical Count across ALL locations
    stockQuantity: number;

    // [AGGREGATE] Total Available (Physical - Reserved) across ALL locations
    availableStock?: number;

    // [NEW] Multi-Location Inventory Breakdown
    // Key = Location ID (e.g., 'MAIN', 'AMAZON_FBA')
    inventory?: {
        [locationId: string]: {
            stock: number;
            reserved: number;
            available: number;
        }
    };

    // Kit / Bundle Support
    type: 'simple' | 'kit';
    kitComponents?: {
        productId: string;
        quantity: number;
        sku?: string;
        name?: string;
    }[];

    // Cost Tracking (Financial Intelligence)
    costPrice?: number; // Last Purchase Price
    averageCost?: number; // Weighted Average Cost
    totalInventoryValue?: number; // stockQuantity * averageCost

    currency?: string; // Default: 'MXN'
    supplierId?: string;
    supplierName?: string;
    lastCostUpdate?: Date;

    // SEO & Marketing
    tags: string[];
    featured: boolean;
    newArrival: boolean;
    bestSeller: boolean;

    // SEO Optimization
    seo?: {
        metaTitle?: string;
        metaDescription?: string;
        focusKeywords?: string[];
    };

    // Status & Publishing
    publishStatus?: 'draft' | 'published' | 'archived';
    visibility?: 'public' | 'private';
    scheduledPublishDate?: Date;

    // Metadata
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Product Filter Options
 * Used for filtering products in catalog
 */
export interface ProductFilters {
    categoryId?: string;
    subcategoryId?: string;
    brands?: string[];
    minPrice?: number;
    maxPrice?: number;
    width?: number;
    aspectRatio?: number;
    diameter?: number;
    tubeless?: boolean;
    construction?: 'radial' | 'bias';
    featured?: boolean;
    newArrival?: boolean;
    bestSeller?: boolean;
    inStock?: boolean;
    tags?: string[];
    searchQuery?: string;
}

/**
 * Product Sort Options
 */
export type ProductSortBy =
    | 'featured'
    | 'price-asc'
    | 'price-desc'
    | 'name-asc'
    | 'name-desc'
    | 'newest';
