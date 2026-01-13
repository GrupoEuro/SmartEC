import { Timestamp } from '@angular/fire/firestore';

/**
 * Tire-specific specifications
 */
export interface TireSpecifications {
    width: number; // e.g., 120 (mm)
    aspectRatio: number; // e.g., 70 (%)
    diameter: number; // e.g., 17 (inches)
    loadIndex: string; // e.g., "58"
    speedRating: string; // e.g., "W"
    tubeless: boolean;
    construction: 'radial' | 'bias';
}

/**
 * Product images structure
 */
export interface ProductImages {
    main: string; // Main product image URL
    gallery: string[]; // Additional images
}

/**
 * Product interface for motorcycle tires
 */
export interface Product {
    id?: string;
    name: {
        es: string;
        en: string;
    };
    slug: string;
    sku: string; // Unique product code
    brand: string; // Brand name (e.g., "Praxis", "Michelin")
    brandId?: string; // Reference to brands collection
    categoryId: string;
    subcategoryId?: string;

    // Tire-specific attributes
    specifications: TireSpecifications;

    // Product details
    description: {
        es: string;
        en: string;
    };
    features: {
        es: string[];
        en: string[];
    };
    applications: string[]; // Motorcycle models that can use this tire

    // Media
    images: ProductImages;

    // Pricing & Stock
    price: number;
    compareAtPrice?: number; // Original price for showing discounts
    // Stock & Inventory
    inStock: boolean;
    stockQuantity: number; // Physical Count
    availableStock?: number; // Physical - Reserved (Computed)

    // Kit / Bundle Support
    type: 'simple' | 'kit';
    kitComponents?: {
        productId: string;
        quantity: number; // Qty of component per kit
        sku?: string; // Denormalized for display
        name?: string; // Denormalized for display
    }[];

    // Pricing Calculator Fields
    cog?: number; // Cost of Goods (base for pricing calculator)
    category?: string; // Product category for commission rule lookup
    weight?: number; // kg - for shipping cost calculations
    dimensions?: {
        length: number; // cm
        width: number;  // cm
        height: number; // cm
    };

    // Cost Tracking (Financial Intelligence)
    costPrice?: number; // Cost per unit from supplier (Last Purchase Price)
    averageCost?: number; // Weighted Average Cost (Kardex)
    totalInventoryValue?: number; // stockQuantity * averageCost (Computed)

    currency?: string; // Default: 'MXN'
    supplierId?: string; // Reference to supplier
    supplierName?: string; // Supplier name for display
    lastCostUpdate?: Timestamp | Date; // When cost was last updated

    // Calculated Financial Fields (computed on read)
    margin?: number; // (price - costPrice) / price * 100
    profitPerUnit?: number; // price - costPrice

    // SEO & Marketing
    tags: string[];
    featured: boolean;
    newArrival: boolean;
    bestSeller: boolean;

    // SEO Optimization (optional fields)
    seo?: {
        metaTitle?: string;
        metaDescription?: string;
        focusKeywords?: string[];
    };

    // === Inventory Policy & Demand Forecasting ===
    inventoryPolicy?: {
        // Service Level
        targetServiceLevel: number; // 0.95 = 95%

        // Safety Stock
        safetyStock: number; // Calculated units
        safetyStockDays: number; // Days of supply

        // Reorder Point
        reorderPoint: number; // When to trigger replenishment

        // Order Quantity
        orderQuantity: number; // How much to order (EOQ or MOQ)
        maxStockLevel: number; // Maximum inventory level
        minStockLevel: number; // Minimum before emergency action

        // Lead Time
        leadTimeDays: number; // Supplier delivery time
        leadTimeVariability: number; // Std dev of lead time

        // Demand Stats
        avgDailyDemand?: number;
        demandVariability?: number; // Coefficient of variation
        demandClassification?: 'STABLE' | 'VARIABLE' | 'ERRATIC';

        // Review
        lastPolicyReview?: Timestamp | Date;
        reviewFrequencyDays: number; // How often to recalculate (30, 60, 90)

        // Forecasting
        forecastMethod?: 'SMA' | 'WMA' | 'EXP_SMOOTHING' | 'SEASONAL';
        seasonalityDetected?: boolean;

        // Flags
        autoReplenishmentEnabled: boolean; // Auto-generate POs?
        manualOverride?: boolean; // Prevent auto changes
    };

    // Status & Publishing
    publishStatus?: 'draft' | 'published' | 'archived';
    visibility?: 'public' | 'private';
    scheduledPublishDate?: Timestamp | Date;

    // Metadata
    active: boolean;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

/**
 * Helper type for creating new products (without id and timestamps)
 */
export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Helper type for updating products (all fields optional except id)
 */
export type ProductUpdate = Partial<Omit<Product, 'id' | 'createdAt'>> & {
    updatedAt: Timestamp | Date;
};

/**
 * Product filter options for catalog page
 */
export interface ProductFilters {
    categoryId?: string;
    subcategoryId?: string;
    brand?: string[];
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
    featured?: boolean;
    newArrival?: boolean;
    bestSeller?: boolean;
    tubeless?: boolean;
    construction?: 'radial' | 'bias';
    width?: number;
    aspectRatio?: number;
    diameter?: number;
    searchQuery?: string;
    tags?: string[];
}

/**
 * Product sort options
 */
export type ProductSortField = 'name' | 'price' | 'createdAt' | 'featured';
export type ProductSortDirection = 'asc' | 'desc';

export interface ProductSort {
    field: ProductSortField;
    direction: ProductSortDirection;
}
