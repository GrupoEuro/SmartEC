import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
    CollectionReference
} from '@angular/fire/firestore';
import { Observable, from, map, switchMap, combineLatest } from 'rxjs';
import { ProductKit, ProductKitInput, ProductKitUpdate, KitAvailability } from '../models/product-kit.model';
import { ProductService } from './product.service';

@Injectable({
    providedIn: 'root'
})
export class KitService {
    private firestore = inject(Firestore);
    private productService = inject(ProductService);
    private kitsCollection: CollectionReference;

    constructor() {
        this.kitsCollection = collection(this.firestore, 'productKits');
    }

    /**
     * Get all kits
     */
    getAllKits(): Observable<ProductKit[]> {
        const q = query(this.kitsCollection, orderBy('createdAt', 'desc'));
        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as ProductKit)))
        );
    }

    /**
     * Get active kits only (for public catalog)
     */
    getActiveKits(): Observable<ProductKit[]> {
        const q = query(
            this.kitsCollection,
            where('active', '==', true),
            where('publishStatus', '==', 'published'),
            orderBy('createdAt', 'desc')
        );
        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as ProductKit)))
        );
    }

    /**
     * Get kit by ID
     */
    getKitById(id: string): Observable<ProductKit | null> {
        const docRef = doc(this.firestore, 'productKits', id);
        return from(getDoc(docRef)).pipe(
            map(docSnap => {
                if (docSnap.exists()) {
                    return { id: docSnap.id, ...docSnap.data() } as ProductKit;
                }
                return null;
            })
        );
    }

    /**
     * Get kit by slug
     */
    getKitBySlug(slug: string): Observable<ProductKit | null> {
        const q = query(this.kitsCollection, where('slug', '==', slug));
        return from(getDocs(q)).pipe(
            map(snapshot => {
                if (snapshot.empty) return null;
                const doc = snapshot.docs[0];
                return { id: doc.id, ...doc.data() } as ProductKit;
            })
        );
    }

    /**
     * Create new kit
     */
    createKit(kitData: ProductKitInput): Observable<string> {
        const newKit = {
            ...kitData,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        };
        return from(addDoc(this.kitsCollection, newKit)).pipe(
            map(docRef => docRef.id)
        );
    }

    /**
     * Update existing kit
     */
    updateKit(id: string, updates: Partial<ProductKitUpdate>): Observable<void> {
        const docRef = doc(this.firestore, 'productKits', id);
        const updateData = {
            ...updates,
            updatedAt: Timestamp.now()
        };
        return from(updateDoc(docRef, updateData));
    }

    /**
     * Update kit publish status
     */
    updateKitStatus(id: string, publishStatus: 'draft' | 'published' | 'archived'): Promise<void> {
        const docRef = doc(this.firestore, 'productKits', id);
        return updateDoc(docRef, {
            publishStatus,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Delete kit
     */
    deleteKit(id: string): Observable<void> {
        const docRef = doc(this.firestore, 'productKits', id);
        return from(deleteDoc(docRef));
    }

    /**
     * Calculate kit availability based on component stock
     */
    getKitAvailability(kit: ProductKit): Observable<KitAvailability> {
        // Get all component products
        const componentObservables = kit.components.map(comp =>
            this.productService.getProductById(comp.productId)
        );

        return combineLatest(componentObservables).pipe(
            map(products => {
                let maxQuantity = Infinity;
                let limitingComponent: KitAvailability['limitingComponent'];

                // Check each component's stock
                kit.components.forEach((comp, index) => {
                    const product = products[index];
                    if (!product) {
                        maxQuantity = 0;
                        return;
                    }

                    const availableStock = product.stockQuantity;
                    const possibleKits = Math.floor(availableStock / comp.quantity);

                    if (possibleKits < maxQuantity) {
                        maxQuantity = possibleKits;
                        limitingComponent = {
                            productId: comp.productId,
                            productName: comp.productName,
                            availableStock,
                            requiredPerKit: comp.quantity
                        };
                    }
                });

                return {
                    kitId: kit.id!,
                    isAvailable: maxQuantity > 0,
                    maxQuantity: maxQuantity === Infinity ? 0 : maxQuantity,
                    limitingComponent
                };
            })
        );
    }

    /**
     * Calculate savings for a kit
     */
    calculateSavings(components: { unitPrice: number; quantity: number }[], kitPrice: number): {
        savingsAmount: number;
        savingsPercentage: number;
    } {
        const totalComponentPrice = components.reduce(
            (sum, comp) => sum + (comp.unitPrice * comp.quantity),
            0
        );
        const savingsAmount = totalComponentPrice - kitPrice;
        const savingsPercentage = totalComponentPrice > 0
            ? Math.round((savingsAmount / totalComponentPrice) * 100)
            : 0;

        return { savingsAmount, savingsPercentage };
    }

    /**
     * Generate unique slug from name
     */
    generateSlug(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}
