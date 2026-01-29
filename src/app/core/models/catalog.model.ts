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
 * Product Type System
 */

// Product type enumeration
export type ProductType = 'tire' | 'helmet' | 'battery' | 'part' | 'accessory';

// Specification field definition for product type schemas
export interface SpecificationField {
    key: string;                          // Unique field identifier
    label: { es: string; en: string };    // Multilingual labels
    type: 'text' | 'number' | 'select' | 'boolean';
    required: boolean;
    unit?: string;                         // e.g., "mm", "V", "Ah", "g"
    options?: string[];                    // For select fields
    min?: number;                          // For number fields
    max?: number;                          // For number fields
    searchable: boolean;                   // Include in search index
    filterable: boolean;                   // Show as filter option in catalog
    displayOrder: number;                  // Order in form/display
}

// Product type definition with schema
export interface ProductTypeDefinition {
    id: ProductType;
    name: { es: string; en: string };
    icon: string;
    specificationSchema: SpecificationField[];
}

/**
 * Product Type Template (Database Model)
 * Stored in Firestore to allow dynamic creation of product types
 */
export interface ProductTypeTemplate {
    id: string;                           // Unique identifier (e.g., 'toy', 'clothing')
    name: {
        es: string;
        en: string;
    };
    icon: string;                         // Emoji icon (e.g., '🧸', '👕')
    description?: {
        es: string;
        en: string;
    };

    // Template metadata
    isSystem: boolean;                    // true for tire, helmet, battery, part, accessory (cannot delete)
    active: boolean;                      // Show/hide from product type selector
    version: number;                      // Schema version for future migrations

    // Specification schema
    schema: SpecificationFieldTemplate[];

    // Audit fields
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string;                   // User ID who created
    updatedBy?: string;                   // User ID who last updated
}

/**
 * Extended Specification Field with additional metadata for template builder
 */
export interface SpecificationFieldTemplate extends SpecificationField {
    id: string;                           // Unique field ID within template
    helpText?: {                          // Help tooltip text
        es: string;
        en: string;
    };
    placeholder?: {                       // Input placeholder text
        es: string;
        en: string;
    };
}

/**
 * Product Specifications (Legacy - kept for backward compatibility)
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
 * Represents any product (tires, helmets, batteries, parts, accessories)
 */
export interface Product {
    id?: string;

    // Product Type - determines which specifications apply
    productType: ProductType;

    name: {
        es: string;
        en: string;
    };
    slug: string;
    sku: string; // Unique product code
    brand: string; // Praxis, Michelin, etc.
    categoryId: string;
    subcategoryId?: string;

    // Dynamic specifications - structure varies by productType
    // For tires: { width: 120, aspectRatio: 70, diameter: 17, ... }
    // For helmets: { size: 'L', type: 'full-face', certifications: 'DOT, ECE', ... }
    // For batteries: { voltage: 12, capacity: 10, batteryType: 'AGM', ... }
    specifications: {
        [key: string]: string | number | boolean;
    };

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

    // Pricing Calculator Fields
    cog?: number; // Cost of Goods (base for pricing calculator)
    category?: string; // Product category for commission rule lookup
    weight?: number; // kg - for shipping cost calculations
    dimensions?: {
        length: number; // cm
        width: number;  // cm
        height: number; // cm
    };

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

/**
 * Helper types for product operations (backwards compatibility)
 */
export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;
export type ProductUpdate = Partial<Omit<Product, 'id' | 'createdAt'>> & {
    updatedAt: Date;
};

export type ProductSortField = 'name' | 'price' | 'createdAt' | 'featured';
export type ProductSortDirection = 'asc' | 'desc';

export interface ProductSort {
    field: ProductSortField;
    direction: ProductSortDirection;
}

/**
 * Product images structure
 */
export interface ProductImages {
    main: string;
    gallery: string[];
}

/**
 * Tire-specific specifications (backwards compatibility)
 */
export interface TireSpecifications {
    width: number;
    aspectRatio: number;
    diameter: number;
    loadIndex: string;
    speedRating: string;
    tubeless: boolean;
    construction: 'radial' | 'bias';
}
