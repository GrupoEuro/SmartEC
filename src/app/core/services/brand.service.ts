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
    Timestamp
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, map, firstValueFrom } from 'rxjs';
import { Brand } from '../models/catalog.model';

@Injectable({
    providedIn: 'root'
})
export class BrandService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);
    private brandsCollection = collection(this.firestore, 'brands');

    /**
     * Get all brands
     */
    getBrands(): Observable<Brand[]> {
        return new Observable(observer => {
            getDocs(this.brandsCollection as any).then(snapshot => {
                const brands: Brand[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data() as any;
                    brands.push({
                        ...data,
                        id: doc.id,
                        createdAt: data.createdAt?.toDate() || new Date(),
                        updatedAt: data.updatedAt?.toDate() || new Date()
                    } as Brand);
                });
                observer.next(brands);
                observer.complete();
            }).catch(error => {
                console.error('Error getting brands:', error);
                observer.error(error);
            });
        });
    }

    /**
     * Get active brands only
     */
    getActiveBrands(): Observable<Brand[]> {
        const q = query(
            this.brandsCollection,
            where('active', '==', true)
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((brands: any[]) => brands.map(brand => this.convertTimestamps(brand)))
        );
    }

    /**
     * Get featured brands
     */
    getFeaturedBrands(): Observable<Brand[]> {
        const q = query(
            this.brandsCollection,
            where('featured', '==', true),
            where('active', '==', true)
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((brands: any[]) => brands.map(brand => this.convertTimestamps(brand)))
        );
    }

    /**
     * Get brand by ID
     */
    /**
     * Get brand by ID
     */
    getBrandById(id: string): Observable<Brand | undefined> {
        return new Observable(observer => {
            getDocs(query(this.brandsCollection, where('__name__', '==', id))).then(snapshot => {
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    const data = doc.data() as any;
                    observer.next(this.convertTimestamps({ ...data, id: doc.id }));
                } else {
                    observer.next(undefined);
                }
                observer.complete();
            }).catch(error => {
                console.error('Error getting brand:', error);
                observer.error(error);
            });
        });
    }

    /**
     * Get brand by slug
     */
    getBrandBySlug(slug: string): Observable<Brand | undefined> {
        const q = query(this.brandsCollection, where('slug', '==', slug));
        return collectionData(q, { idField: 'id' }).pipe(
            map((brands: any[]) => {
                if (brands.length > 0) {
                    return this.convertTimestamps(brands[0]);
                }
                return undefined;
            })
        );
    }

    /**
     * Get brand by name
     */
    getBrandByName(name: string): Observable<Brand | undefined> {
        const q = query(this.brandsCollection, where('name', '==', name));
        return collectionData(q, { idField: 'id' }).pipe(
            map((brands: any[]) => {
                if (brands.length > 0) {
                    return this.convertTimestamps(brands[0]);
                }
                return undefined;
            })
        );
    }

    /**
     * Create a new brand
     */
    async createBrand(brand: Omit<Brand, 'id'>, logoFile?: File): Promise<string> {
        try {
            let logoUrl = '';
            let logoPath = '';

            // Upload logo if provided
            if (logoFile) {
                const uploadResult = await this.uploadBrandLogo(logoFile);
                logoUrl = uploadResult.url;
                logoPath = uploadResult.path;
            }

            const brandData = this.cleanData({
                ...brand,
                logoUrl,
                logoPath,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });

            const docRef = await addDoc(this.brandsCollection, brandData);
            return docRef.id;
        } catch (error) {
            console.error('Error creating brand:', error);
            throw error;
        }
    }

    /**
     * Update an existing brand
     */
    async updateBrand(id: string, brand: Partial<Brand>, logoFile?: File): Promise<void> {
        try {
            const brandDoc = doc(this.firestore, `brands/${id}`);

            // 1. Prepare base update data
            let updateData: any = {
                ...brand,
                updatedAt: Timestamp.now()
            };

            // 2. Upload new logo if provided
            if (logoFile) {
                // Delete old logo if exists
                // Use firstValueFrom instead of toPromise
                const currentBrand = await firstValueFrom(this.getBrandById(id));
                if (currentBrand?.logoPath) {
                    await this.deleteLogo(currentBrand.logoPath);
                }

                const uploadResult = await this.uploadBrandLogo(logoFile);
                updateData.logoUrl = uploadResult.url;
                updateData.logoPath = uploadResult.path;
            }

            // 3. Clean undefined values to prevent Firestore errors
            updateData = this.cleanData(updateData);

            await updateDoc(brandDoc, updateData);
        } catch (error) {
            console.error('Error updating brand:', error);
            throw error;
        }
    }

    /**
     * Delete a brand
     */
    async deleteBrand(id: string): Promise<void> {
        try {
            // Get brand to delete its logo
            const brand = await firstValueFrom(this.getBrandById(id));

            // Delete logo if exists
            if (brand?.logoPath) {
                await this.deleteLogo(brand.logoPath);
            }

            const brandDoc = doc(this.firestore, `brands/${id}`);
            await deleteDoc(brandDoc);
        } catch (error) {
            console.error('Error deleting brand:', error);
            throw error;
        }
    }

    /**
     * Upload brand logo to Firebase Storage
     */
    private async uploadBrandLogo(file: File): Promise<{ url: string; path: string }> {
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.name}`;
        const filePath = `brands/${fileName}`;
        const storageRef = ref(this.storage, filePath);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        return { url, path: filePath };
    }

    /**
     * Delete logo from Firebase Storage
     */
    private async deleteLogo(path: string): Promise<void> {
        try {
            const storageRef = ref(this.storage, path);
            await deleteObject(storageRef);
        } catch (error) {
            console.error('Error deleting logo:', error);
            // Don't throw - logo might already be deleted
        }
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(brand: any): Brand {
        return {
            ...brand,
            createdAt: brand.createdAt?.toDate() || new Date(),
            updatedAt: brand.updatedAt?.toDate() || new Date()
        };
    }

    /**
     * Helper to remove undefined fields from an object
     * Firestore throws if you try to save 'undefined'
     */
    private cleanData(data: any): any {
        const clean: any = {};
        Object.keys(data).forEach(key => {
            if (data[key] !== undefined) {
                clean[key] = data[key];
            }
        });
        return clean;
    }
}
