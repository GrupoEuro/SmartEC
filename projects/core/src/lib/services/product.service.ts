import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    Timestamp,
    QueryConstraint,
    QueryDocumentSnapshot,
    DocumentData
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, map, from } from 'rxjs';
import { Product, ProductFilters, ProductSortBy } from '../models/catalog.model';

@Injectable({
    providedIn: 'root'
})
export class ProductService {
    private firestore = inject('FIRESTORE' as any) as Firestore;
    private storage = inject('STORAGE' as any) as Storage;
    private productsCollection = collection(this.firestore, 'products');

    /**
     * Get all products with optional filters
     */
    /**
     * Get products with SERVER-SIDE filtering and pagination
     * This replaces the old client-side filtering method for performance
     */
    async getProductsPage(
        filters: ProductFilters = {},
        sortBy: ProductSortBy = 'featured',
        pageSize: number = 20,
        lastDoc?: QueryDocumentSnapshot<DocumentData>
    ): Promise<{ products: Product[], lastDoc: QueryDocumentSnapshot<DocumentData> | null, total: number }> {
        try {
            console.log('ProductService: getProductsPage called', { filters, sortBy, pageSize });

            // Build Query Constraints
            const constraints: QueryConstraint[] = [];

            // 1. Basic Status Filters
            // REMOVED STRICT ACTIVE CHECK to match legacy behavior and show all products
            // constraints.push(where('active', '==', true));

            // 2. Category Filter
            if (filters.categoryId) {
                constraints.push(where('categoryId', '==', filters.categoryId));
            }

            // 3. Brand Filter (Single selection for now to retain index simplicity)
            // If multiple brands are selected, we might need 'in' query or client-side filter fallback
            if (filters.brands && filters.brands.length === 1) {
                constraints.push(where('brand', '==', filters.brands[0]));
            } else if (filters.brands && filters.brands.length > 1) {
                constraints.push(where('brand', 'in', filters.brands.slice(0, 10))); // 'in' supports max 10
            }

            // 4. Featured / New / Bestseller
            if (filters.featured) constraints.push(where('featured', '==', true));
            if (filters.newArrival) constraints.push(where('newArrival', '==', true));
            if (filters.bestSeller) constraints.push(where('bestSeller', '==', true));

            // 5. Price Range (Requires Index with Sort)
            if (filters.minPrice !== undefined && filters.minPrice > 0) {
                constraints.push(where('price', '>=', filters.minPrice));
            }
            if (filters.maxPrice !== undefined && filters.maxPrice < 100000) { // arbitrary safe max
                constraints.push(where('price', '<=', filters.maxPrice));
            }

            // 6. Sorting
            // Firestore requires the first orderBy field to range filter field if using range filter
            // So if we filter by price, we MUST sort by price first.
            if ((filters.minPrice !== undefined && filters.minPrice > 0) || (filters.maxPrice !== undefined && filters.maxPrice < 100000)) {
                // We are filtering by price, so we must sort by price
                if (sortBy === 'price-desc') {
                    constraints.push(orderBy('price', 'desc'));
                } else {
                    constraints.push(orderBy('price', 'asc'));
                }
            } else {
                // Standard Sorting
                switch (sortBy) {
                    case 'price-asc':
                        constraints.push(orderBy('price', 'asc'));
                        break;
                    case 'price-desc':
                        constraints.push(orderBy('price', 'desc'));
                        break;
                    case 'name-asc':
                        constraints.push(orderBy('name.en', 'asc'));
                        break;
                    case 'name-desc':
                        constraints.push(orderBy('name.en', 'desc'));
                        break;
                    case 'newest':
                        constraints.push(orderBy('createdAt', 'desc'));
                        break;
                    case 'featured':
                    default:
                        // Default sort: Featured then Date
                        constraints.push(orderBy('featured', 'desc'));
                        constraints.push(orderBy('createdAt', 'desc'));
                        break;
                }
            }

            // 7. Pagination
            if (lastDoc) {
                constraints.push(startAfter(lastDoc));
            }

            // 8. Limit
            constraints.push(limit(pageSize));

            // Execute Query
            const q = query(this.productsCollection, ...constraints);
            const snapshot = await getDocs(q);

            const products: Product[] = [];
            snapshot.forEach(doc => {
                const data = doc.data() as any;
                products.push(this.mapProduct(doc.id, data));
            });

            // Get last doc for next page
            const lastVisible = snapshot.docs[snapshot.docs.length - 1] || null;

            // Handle Search Query Client-Side (Hybrid approach)
            // If search query exists, we might need to filter the results 
            // OR use a separate "search" index.
            // For now, if there is a search query, we return filtered results
            // Note: This is imperfect for pagination (might return empty page if all filtered out)
            // Ideally, search should be a separate Algolia/Typesense call.
            let resultProducts = products;
            if (filters.searchQuery) {
                const qLower = filters.searchQuery.toLowerCase();
                resultProducts = products.filter(p =>
                    p.name.en.toLowerCase().includes(qLower) ||
                    p.name.es.toLowerCase().includes(qLower) ||
                    p.sku.toLowerCase().includes(qLower) ||
                    p.brand.toLowerCase().includes(qLower)
                );
            }

            return {
                products: resultProducts,
                lastDoc: lastVisible,
                total: snapshot.size // This is just page size, logic in component handles "no more items"
            };

        } catch (error) {
            console.error('Error in getProductsPage:', error);
            throw error;
        }
    }

    /**
     * Map raw firestore data to Product model
     */
    private mapProduct(id: string, data: any): Product {
        return {
            ...data,
            id: id,
            name: data.name || { en: 'Unknown', es: 'Desconocido' },
            description: data.description || { en: '', es: '' },
            specifications: data.specifications || {},
            price: data.price || 0,
            stockQuantity: data.stockQuantity || 0,
            features: data.features || { en: [], es: [] },
            images: data.images || { main: '', gallery: [] },
            tags: data.tags || [],
            seo: data.seo || {},
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date()
        } as Product;
    }

    /**
     * Legacy getProducts - Kept for Admin compatibility but redirects to optimized query if possible
     * @deprecated Use getProductsPage for extensive lists
     */
    getProducts(filters?: ProductFilters, sortBy: ProductSortBy = 'featured', limitCount?: number): Observable<Product[]> {
        // If we have simple filters, we can try to optimize even this observable call
        // But for full backward compatibility, we'll keep the "fetch all" behavior 
        // ONLY if no specific optimization constraints are passed.

        // For Admin use-cases (no filters usually), we still fetch all.
        // But we should really warn about this.

        return new Observable(observer => {
            let q = query(this.productsCollection);

            // Apply basic limits if provided to prevent full DB dump
            if (limitCount) {
                q = query(this.productsCollection, limit(limitCount));
            }

            getDocs(q).then(snapshot => {
                const products: Product[] = [];
                snapshot.forEach(doc => {
                    products.push(this.mapProduct(doc.id, doc.data()));
                });

                // Client-side filtering logic (Copy-pasted from original for compatibility)
                let filtered = products;
                if (filters) {
                    if (filters.categoryId) filtered = filtered.filter(p => p.categoryId === filters.categoryId);
                    if (filters.brands) filtered = filtered.filter(p => filters.brands!.includes(p.brand));
                    if (filters.minPrice) filtered = filtered.filter(p => p.price >= filters.minPrice!);
                    if (filters.maxPrice) filtered = filtered.filter(p => p.price <= filters.maxPrice!);
                    if (filters.searchQuery) {
                        const q = filters.searchQuery.toLowerCase();
                        filtered = filtered.filter(p =>
                            p.name.en.toLowerCase().includes(q) ||
                            p.brand.toLowerCase().includes(q)
                        );
                    }
                }

                // Sort
                switch (sortBy) {
                    case 'price-asc': filtered.sort((a, b) => a.price - b.price); break;
                    case 'price-desc': filtered.sort((a, b) => b.price - a.price); break;
                    case 'name-asc': filtered.sort((a, b) => (a.name.es || a.name.en).localeCompare(b.name.es || b.name.en)); break;
                    case 'name-desc': filtered.sort((a, b) => (b.name.es || b.name.en).localeCompare(a.name.es || a.name.en)); break;
                    case 'newest': filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); break;
                    default: // 'featured' — featured first, then newest
                        filtered.sort((a, b) => {
                            const featuredDiff = (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
                            if (featuredDiff !== 0) return featuredDiff;
                            return b.createdAt.getTime() - a.createdAt.getTime();
                        });
                }

                observer.next(filtered);
                observer.complete();
            });
        });
    }

    /**
     * Get active products only
     */
    getActiveProducts(filters?: ProductFilters, sortBy?: ProductSortBy): Observable<Product[]> {
        const activeFilters = { ...filters, inStock: true };
        return this.getProducts(activeFilters, sortBy);
    }

    /**
     * Get product by ID
     */
    getProductById(id: string): Observable<Product | undefined> {
        // Use getProducts and filter client-side to avoid SDK issues
        return this.getProducts().pipe(
            map(products => products.find(p => p.id === id))
        );
    }

    /**
     * Get product by SKU (Direct Firestore Query)
     * Used for Import validations to check existence
     */
    async getProductBySku(sku: string): Promise<Product | null> {
        try {
            const q = query(this.productsCollection, where('sku', '==', sku), limit(1));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                return null;
            }

            const doc = snapshot.docs[0];
            const data = doc.data() as any;

            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date()
            } as Product;
        } catch (error) {
            console.error('Error fetching product by SKU:', error);
            return null;
        }
    }

    /**
     * Get product by slug
     */
    getProductBySlug(slug: string): Observable<Product | undefined> {
        // Use getProducts and filter client-side to avoid SDK issues
        return this.getProducts().pipe(
            map(products => products.find(p => p.slug === slug))
        );
    }

    /**
     * Get products by category
     */
    getProductsByCategory(categoryId: string, includeSubcategories: boolean = false): Observable<Product[]> {
        if (includeSubcategories) {
            // Get all products in category or its subcategories
            return this.getProducts({ categoryId });
        } else {
            // Get only direct products in this category
            const q = query(
                this.productsCollection,
                where('categoryId', '==', categoryId),
                where('subcategoryId', '==', null),
                where('active', '==', true)
            );
            return collectionData(q, { idField: 'id' }).pipe(
                map((products: any[]) => products.map(p => this.convertTimestamps(p)))
            );
        }
    }

    /**
     * Search products by query
     */
    searchProducts(searchQuery: string): Observable<Product[]> {
        return this.getProducts({ searchQuery });
    }

    /**
     * Get featured products
     */
    getFeaturedProducts(limitCount: number = 8): Observable<Product[]> {
        return this.getProducts({ featured: true, inStock: true }, 'featured', limitCount);
    }

    /**
     * Get new arrival products
     */
    getNewArrivals(limitCount: number = 8): Observable<Product[]> {
        return this.getProducts({ newArrival: true, inStock: true }, 'newest', limitCount);
    }

    /**
     * Get best seller products
     */
    getBestSellers(limitCount: number = 8): Observable<Product[]> {
        return this.getProducts({ bestSeller: true, inStock: true }, 'featured', limitCount);
    }

    /**
     * Create a new product
     */
    async createProduct(product: Omit<Product, 'id'>, mainImage?: File, galleryImages?: File[]): Promise<string> {
        try {
            let mainImageUrl = product.images?.main || '';
            let mainImagePath = product.images?.mainPath || '';
            let galleryUrls: string[] = product.images?.gallery || [];
            let galleryPaths: string[] = product.images?.galleryPaths || [];

            // Upload main image if provided
            if (mainImage) {
                const mainImageResult = await this.uploadProductImage(mainImage, 'main');
                mainImageUrl = mainImageResult.url;
                mainImagePath = mainImageResult.path;
            }

            // Upload gallery images if provided
            if (galleryImages && galleryImages.length > 0) {
                const galleryResults = await Promise.all(
                    galleryImages.map((file, index) => this.uploadProductImage(file, `gallery_${index}`))
                );
                galleryUrls = galleryResults.map(r => r.url);
                galleryPaths = galleryResults.map(r => r.path);
            }

            let productData = {
                ...product,
                images: {
                    main: mainImageUrl,
                    mainPath: mainImagePath,
                    gallery: galleryUrls,
                    galleryPaths: galleryPaths
                },
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            // Deep cleanup: Remove undefined and null values recursively
            const cleanData = (obj: any): any => {
                if (obj === undefined) return undefined; // Keep null, remove undefined
                if (Array.isArray(obj)) return obj.map(item => cleanData(item)).filter(item => item !== undefined);
                if (typeof obj === 'object' && obj !== null && obj.constructor === Object) {
                    const cleaned: any = {};
                    Object.keys(obj).forEach(key => {
                        const cleanedValue = cleanData(obj[key]);
                        if (cleanedValue !== undefined) {
                            cleaned[key] = cleanedValue;
                        }
                    });
                    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
                }
                return obj;
            };

            productData = cleanData(productData);

            const docRef = await addDoc(this.productsCollection, productData);
            return docRef.id;
        } catch (error) {
            console.error('Error creating product:', error);
            throw error;
        }
    }

    /**
     * Create a lightweight STUB product from Supplier Data
     * Used in procurement for "Quick Create"
     */
    async createStub(supplierSku: string, description: string, unitCost: number, supplierId: string): Promise<string> {
        // 1. Collision Check (Fast)
        const q = query(this.productsCollection, where('sku', '==', supplierSku), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            return snap.docs[0].id;
        }

        // 2. Create Stub
        const stub: Product = {
            productType: 'tire', // Default to tire for legacy compatibility
            type: 'simple',
            active: true,
            name: { es: description, en: description },
            description: { es: description, en: description },
            sku: supplierSku,
            slug: supplierSku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            brand: 'GENERIC', // Placeholder
            categoryId: 'uncategorized',
            price: unitCost * 1.5, // Dummy margin
            costPrice: unitCost,
            inStock: true,
            stockQuantity: 0,
            images: { main: '', gallery: [] }, // No images
            specifications: {
                width: 0,
                aspectRatio: 0,
                diameter: 0,
                loadIndex: '',
                speedRating: '',
                tubeless: true,
                construction: 'radial'
            },
            features: { es: [], en: [] },
            applications: [],
            tags: ['stub', 'new-import'],
            featured: false,
            newArrival: false,
            bestSeller: false,
            publishStatus: 'draft', // Important: Hidden
            visibility: 'private',
            supplierId: supplierId,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await addDoc(this.productsCollection, stub);
        return result.id;
    }

    /**
     * Update an existing product
     */
    async updateProduct(
        id: string,
        product: Partial<Product>,
        mainImage?: File,
        galleryImages?: File[]
    ): Promise<void> {
        try {
            const productDoc = doc(this.firestore, `products/${id}`);
            let updateData: any = {
                ...product,
                updatedAt: Timestamp.now()
            };

            // Deep cleanup: Remove undefined and null values recursively
            const cleanData = (obj: any): any => {
                if (obj === null || obj === undefined) return undefined;
                if (Array.isArray(obj)) return obj.map(item => cleanData(item)).filter(item => item !== undefined);
                if (typeof obj === 'object' && obj.constructor === Object) {
                    const cleaned: any = {};
                    Object.keys(obj).forEach(key => {
                        const cleanedValue = cleanData(obj[key]);
                        if (cleanedValue !== undefined && cleanedValue !== null) {
                            cleaned[key] = cleanedValue;
                        }
                    });
                    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
                }
                return obj;
            };

            updateData = cleanData(updateData) || {};

            // Get current product for image cleanup
            const currentProduct = await this.getProductById(id).pipe(map(p => p)).toPromise();

            // Update main image if provided
            if (mainImage && currentProduct) {
                // Delete old main image
                if (currentProduct.images.mainPath) {
                    await this.deleteImage(currentProduct.images.mainPath);
                }

                const mainImageResult = await this.uploadProductImage(mainImage, 'main');
                updateData['images.main'] = mainImageResult.url;
                updateData['images.mainPath'] = mainImageResult.path;
            }

            // Update gallery images if provided
            if (galleryImages && galleryImages.length > 0 && currentProduct) {
                // Delete old gallery images
                if (currentProduct.images.galleryPaths) {
                    await Promise.all(
                        currentProduct.images.galleryPaths.map(path => this.deleteImage(path))
                    );
                }

                const galleryResults = await Promise.all(
                    galleryImages.map((file, index) => this.uploadProductImage(file, `gallery_${index}`))
                );
                updateData['images.gallery'] = galleryResults.map(r => r.url);
                updateData['images.galleryPaths'] = galleryResults.map(r => r.path);
            }

            await updateDoc(productDoc, updateData);
        } catch (error) {
            console.error('Error updating product:', error);
            throw error;
        }
    }

    /**
     * Delete a product
     */
    async deleteProduct(id: string): Promise<void> {
        try {
            // Get product to delete its images
            const product = await this.getProductById(id).pipe(map(p => p)).toPromise();

            if (product) {
                // Delete main image
                if (product.images.mainPath) {
                    await this.deleteImage(product.images.mainPath);
                }

                // Delete gallery images
                if (product.images.galleryPaths) {
                    await Promise.all(
                        product.images.galleryPaths.map(path => this.deleteImage(path))
                    );
                }
            }

            const productDoc = doc(this.firestore, `products/${id}`);
            await deleteDoc(productDoc);
        } catch (error) {
            console.error('Error deleting product:', error);
            throw error;
        }
    }

    /**
     * Upload product image to Firebase Storage
     */
    async uploadProductImage(file: File, prefix: string): Promise<{ url: string; path: string }> {
        const timestamp = Date.now();
        const fileName = `${prefix}_${timestamp}_${file.name}`;
        const filePath = `products/${fileName}`;
        const storageRef = ref(this.storage, filePath);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        return { url, path: filePath };
    }

    /**
     * Delete image from Firebase Storage
     */
    private async deleteImage(path: string): Promise<void> {
        try {
            const storageRef = ref(this.storage, path);
            await deleteObject(storageRef);
        } catch (error) {
            console.error('Error deleting image:', error);
            // Don't throw - image might already be deleted
        }
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(product: any): Product {
        return {
            ...product,
            createdAt: product.createdAt?.toDate() || new Date(),
            updatedAt: product.updatedAt?.toDate() || new Date()
        };
    }

    /**
     * Generate SKU
     */
    generateSKU(brand: string, width: number, aspectRatio: number, diameter: number): string {
        const brandCode = brand.substring(0, 2).toUpperCase();
        return `${brandCode}-${width}${aspectRatio}-${diameter}`;
    }
}
