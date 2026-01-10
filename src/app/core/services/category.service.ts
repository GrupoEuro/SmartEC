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
import { Observable, map } from 'rxjs';
import { Category } from '../models/catalog.model';

@Injectable({
    providedIn: 'root'
})
export class CategoryService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);
    private categoriesCollection = collection(this.firestore, 'categories');

    /**
     * Get all categories
     */
    getCategories(): Observable<Category[]> {
        console.log('CategoryService: getCategories called');
        return new Observable(observer => {
            getDocs(this.categoriesCollection as any).then(snapshot => {
                console.log('CategoryService: Snapshot received:', snapshot.size, 'documents');
                const categories: Category[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data() as any;
                    categories.push({
                        ...data,
                        id: doc.id,
                        createdAt: data.createdAt?.toDate() || new Date(),
                        updatedAt: data.updatedAt?.toDate() || new Date()
                    } as Category);
                });
                console.log('CategoryService: Converted categories:', categories);
                observer.next(categories);
                observer.complete();
            }).catch(error => {
                console.error('CategoryService: Error getting categories:', error);
                observer.error(error);
            });
        });
    }

    /**
     * Get active categories only
     */
    getActiveCategories(): Observable<Category[]> {
        // Fetch all categories and filter client-side to avoid Firestore SDK issues
        return this.getCategories().pipe(
            map(categories => categories.filter(cat => cat.active))
        );
    }

    /**
     * Get category by ID
     */
    getCategoryById(id: string): Observable<Category | undefined> {
        const categoryDoc = doc(this.firestore, `categories/${id}`);
        return new Observable(observer => {
            getDocs(query(this.categoriesCollection, where('__name__', '==', id))).then(snapshot => {
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    const data = doc.data() as any;
                    observer.next(this.convertTimestamps({ ...data, id: doc.id }));
                } else {
                    observer.next(undefined);
                }
                observer.complete();
            }).catch(error => {
                console.error('Error getting category:', error);
                observer.error(error);
            });
        });
    }

    /**
     * Get category by slug
     */
    getCategoryBySlug(slug: string): Observable<Category | undefined> {
        const q = query(this.categoriesCollection, where('slug', '==', slug));
        return collectionData(q, { idField: 'id' }).pipe(
            map((categories: any[]) => {
                if (categories.length > 0) {
                    return this.convertTimestamps(categories[0]);
                }
                return undefined;
            })
        );
    }

    /**
     * Get subcategories of a parent category
     */
    getSubcategories(parentId: string): Observable<Category[]> {
        const q = query(
            this.categoriesCollection,
            where('parentId', '==', parentId),
            orderBy('order', 'asc')
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((categories: any[]) => categories.map(cat => this.convertTimestamps(cat)))
        );
    }

    /**
     * Get top-level categories (no parent)
     */
    getTopLevelCategories(): Observable<Category[]> {
        const q = query(
            this.categoriesCollection,
            where('parentId', '==', null),
            where('active', '==', true)
        );
        return collectionData(q, { idField: 'id' }).pipe(
            map((categories: any[]) => categories.map(cat => this.convertTimestamps(cat)))
        );
    }

    /**
     * Create a new category
     */
    async createCategory(category: Omit<Category, 'id'>, imageFile?: File): Promise<string> {
        try {
            let imageUrl = '';
            let imagePath = '';

            // Upload image if provided
            if (imageFile) {
                const uploadResult = await this.uploadCategoryImage(imageFile);
                imageUrl = uploadResult.url;
                imagePath = uploadResult.path;
            }

            const categoryData = {
                ...category,
                imageUrl,
                imagePath,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            const docRef = await addDoc(this.categoriesCollection, categoryData);
            return docRef.id;
        } catch (error) {
            console.error('Error creating category:', error);
            throw error;
        }
    }

    /**
     * Update an existing category
     */
    async updateCategory(id: string, category: Partial<Category>, imageFile?: File): Promise<void> {
        try {
            const categoryDoc = doc(this.firestore, `categories/${id}`);
            let updateData: any = {
                ...category,
                updatedAt: Timestamp.now()
            };

            // Upload new image if provided
            if (imageFile) {
                // Delete old image if exists
                const currentCategory = await this.getCategoryById(id).pipe(map(c => c)).toPromise();
                if (currentCategory?.imagePath) {
                    await this.deleteImage(currentCategory.imagePath);
                }

                const uploadResult = await this.uploadCategoryImage(imageFile);
                updateData.imageUrl = uploadResult.url;
                updateData.imagePath = uploadResult.path;
            }

            await updateDoc(categoryDoc, updateData);
        } catch (error) {
            console.error('Error updating category:', error);
            throw error;
        }
    }

    /**
     * Delete a category
     */
    async deleteCategory(id: string): Promise<void> {
        try {
            // Get category to delete its image
            const category = await this.getCategoryById(id).pipe(map(c => c)).toPromise();

            // Delete image if exists
            if (category?.imagePath) {
                await this.deleteImage(category.imagePath);
            }

            const categoryDoc = doc(this.firestore, `categories/${id}`);
            await deleteDoc(categoryDoc);
        } catch (error) {
            console.error('Error deleting category:', error);
            throw error;
        }
    }

    /**
     * Upload category image to Firebase Storage
     */
    private async uploadCategoryImage(file: File): Promise<{ url: string; path: string }> {
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.name}`;
        const filePath = `categories/${fileName}`;
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
     * Generate URL-friendly slug from text
     */
    generateSlug(text: string): string {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
            .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(category: any): Category {
        return {
            ...category,
            createdAt: category.createdAt?.toDate() || new Date(),
            updatedAt: category.updatedAt?.toDate() || new Date()
        };
    }
}
