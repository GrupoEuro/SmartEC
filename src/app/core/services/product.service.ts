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
    Timestamp,
    QueryConstraint
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, map } from 'rxjs';
import { Product, ProductFilters, ProductSortBy } from '../models/catalog.model';

@Injectable({
    providedIn: 'root'
})
export class ProductService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);
    private productsCollection = collection(this.firestore, 'products');

    /**
     * Get all products with optional filters
     */
    getProducts(filters?: ProductFilters, sortBy: ProductSortBy = 'featured', limitCount?: number): Observable<Product[]> {
        console.log('ProductService: getProducts called with filters:', filters, 'sortBy:', sortBy);
        // NOTE: ALL filtering done client-side to avoid Firestore SDK mismatch issues
        // Fetch all products without any server-side constraints

        return new Observable(observer => {
            console.log('ProductService: Fetching products from Firestore...');
            getDocs(this.productsCollection as any).then(snapshot => {
                console.log('ProductService: Snapshot received:', snapshot.size, 'documents');
                if (snapshot.size > 0) {
                    console.log('ProductService: Sample Doc ID:', snapshot.docs[0].id);
                    console.log('ProductService: Sample Doc Data:', snapshot.docs[0].data());
                } else {
                    console.warn('ProductService: No documents found in products collection!');
                }

                const products: Product[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data() as any;
                    // Log potential parsing issues
                    if (!data.name) console.warn('Product missing name:', doc.id);

                    // Robust mapping with defaults
                    products.push({
                        ...data,
                        id: doc.id,
                        name: data.name || { en: 'Unknown Product', es: 'Producto Desconocido' },
                        description: data.description || { en: '', es: '' },
                        specifications: data.specifications || {
                            width: 0, aspectRatio: 0, diameter: 0,
                            loadIndex: '', speedRating: '',
                            construction: 'radial', tubeless: true
                        },
                        price: data.price || 0,
                        stockQuantity: data.stockQuantity || 0,
                        features: data.features || { en: [], es: [] },
                        images: data.images || { main: '', gallery: [] },
                        tags: data.tags || [],
                        seo: data.seo || {},
                        createdAt: data.createdAt?.toDate() || new Date(),
                        updatedAt: data.updatedAt?.toDate() || new Date()
                    } as Product);
                });
                console.log('ProductService: Parsed products count:', products.length);

                // Client-side filters - ALL filtering happens here
                let filtered = products;

                if (filters) {
                    // Category filters
                    if (filters.categoryId) {
                        filtered = filtered.filter(p => p.categoryId === filters.categoryId);
                    }
                    if (filters.subcategoryId) {
                        filtered = filtered.filter(p => p.subcategoryId === filters.subcategoryId);
                    }

                    // Brand filter
                    if (filters.brands && filters.brands.length > 0) {
                        filtered = filtered.filter(p => filters.brands!.includes(p.brand));
                    }

                    // Boolean filters
                    if (filters.featured !== undefined) {
                        filtered = filtered.filter(p => p.featured === filters.featured);
                    }
                    if (filters.newArrival !== undefined) {
                        filtered = filtered.filter(p => p.newArrival === filters.newArrival);
                    }
                    if (filters.bestSeller !== undefined) {
                        filtered = filtered.filter(p => p.bestSeller === filters.bestSeller);
                    }
                    if (filters.inStock !== undefined) {
                        filtered = filtered.filter(p => p.inStock === filters.inStock);
                    }

                    // Specification filters
                    if (filters.tubeless !== undefined) {
                        filtered = filtered.filter(p => p.specifications['tubeless'] === filters.tubeless);
                    }
                    if (filters.construction) {
                        filtered = filtered.filter(p => p.specifications['construction'] === filters.construction);
                    }

                    // Price range
                    if (filters.minPrice !== undefined) {
                        filtered = filtered.filter(p => p.price >= filters.minPrice!);
                    }
                    if (filters.maxPrice !== undefined) {
                        filtered = filtered.filter(p => p.price <= filters.maxPrice!);
                    }

                    // Tire size filters
                    if (filters.width) {
                        filtered = filtered.filter(p => p.specifications['width'] === filters.width);
                    }
                    if (filters.aspectRatio) {
                        filtered = filtered.filter(p => p.specifications['aspectRatio'] === filters.aspectRatio);
                    }
                    if (filters.diameter) {
                        filtered = filtered.filter(p => p.specifications['diameter'] === filters.diameter);
                    }

                    // Tags filter
                    if (filters.tags && filters.tags.length > 0) {
                        filtered = filtered.filter(p =>
                            filters.tags!.some(tag => p.tags.includes(tag))
                        );
                    }

                    // Search query
                    if (filters.searchQuery) {
                        const searchLower = filters.searchQuery.toLowerCase();
                        filtered = filtered.filter(p =>
                            p.name.en.toLowerCase().includes(searchLower) ||
                            p.name.es.toLowerCase().includes(searchLower) ||
                            p.sku.toLowerCase().includes(searchLower) ||
                            p.brand.toLowerCase().includes(searchLower)
                        );
                    }
                }

                // Client-side sorting
                switch (sortBy) {
                    case 'price-asc':
                        filtered.sort((a, b) => a.price - b.price);
                        break;
                    case 'price-desc':
                        filtered.sort((a, b) => b.price - a.price);
                        break;
                    case 'name-asc':
                        filtered.sort((a, b) => a.name.en.localeCompare(b.name.en));
                        break;
                    case 'name-desc':
                        filtered.sort((a, b) => b.name.en.localeCompare(a.name.en));
                        break;
                    case 'newest':
                        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                        break;
                    case 'featured':
                    default:
                        filtered.sort((a, b) => {
                            if (a.featured !== b.featured) {
                                return b.featured ? 1 : -1;
                            }
                            return b.createdAt.getTime() - a.createdAt.getTime();
                        });
                        break;
                }

                // Apply limit if specified
                if (limitCount) {
                    filtered = filtered.slice(0, limitCount);
                }

                console.log('ProductService: Returning', filtered.length, 'products after filtering/sorting');
                if (filtered.length === 0 && products.length > 0) {
                    console.warn('ProductService: All products were filtered out! Check active filters:', filters);
                }
                observer.next(filtered);
                observer.complete();
            }).catch(error => {
                console.error('Error getting products:', error);
                observer.error(error);
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
    async createProduct(product: Omit<Product, 'id'>, mainImage: File, galleryImages?: File[]): Promise<string> {
        try {
            // Upload main image
            const mainImageResult = await this.uploadProductImage(mainImage, 'main');

            // Upload gallery images
            let galleryUrls: string[] = [];
            let galleryPaths: string[] = [];
            if (galleryImages && galleryImages.length > 0) {
                const galleryResults = await Promise.all(
                    galleryImages.map((file, index) => this.uploadProductImage(file, `gallery_${index}`))
                );
                galleryUrls = galleryResults.map(r => r.url);
                galleryPaths = galleryResults.map(r => r.path);
            }

            const productData = {
                ...product,
                images: {
                    main: mainImageResult.url,
                    mainPath: mainImageResult.path,
                    gallery: galleryUrls,
                    galleryPaths: galleryPaths
                },
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

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
