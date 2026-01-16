import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    startAfter,
    Timestamp,
    serverTimestamp,
    writeBatch,
    increment,
    setDoc,
    getDoc,
    docData
} from '@angular/fire/firestore';
import {
    Storage,
    ref,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject,
    StorageReference,
    getMetadata
} from '@angular/fire/storage';
import { Observable, from, map, switchMap, of } from 'rxjs';
import { MediaAsset, MediaFilter } from '../models/media.model';

export interface StorageStats {
    totalBytes: number;
    count: number;
    maxCapacity: number; // e.g. 1GB = 1073741824
}

export interface PaginatedMediaResult {
    assets: MediaAsset[];
    lastDoc: any;
}

@Injectable({
    providedIn: 'root'
})
export class MediaService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);

    private readonly COLLECTION = 'media_assets';
    private readonly STATS_DOC = 'sys_counters/media';

    /**
     * Get Storage Stats
     */
    getStorageStats(): Observable<StorageStats> {
        const docRef = doc(this.firestore, this.STATS_DOC);
        return from(getDoc(docRef)).pipe(
            map(snap => {
                const data = snap.data() as any;
                return {
                    totalBytes: data?.totalBytes || 0,
                    count: data?.count || 0,
                    maxCapacity: 1073741824 // 1 GB Hard limit for now
                };
            })
        );
    }

    /**
     * Recalculate Stats (Maintenance)
     */
    async recalculateStorageStats(): Promise<void> {
        // 1. Get all assets
        const q = query(collection(this.firestore, this.COLLECTION));
        const snapshot = await getDocs(q);

        let totalBytes = 0;
        let count = 0;

        snapshot.forEach(d => {
            const data = d.data() as MediaAsset;
            if (data.size) totalBytes += data.size;
            count++;
        });

        // 2. Set stats doc
        await setDoc(doc(this.firestore, this.STATS_DOC), {
            totalBytes,
            count,
            updatedAt: serverTimestamp()
        });
    }

    /**
     * Upload a file to Storage and create a record in Firestore, reporting progress
     */
    uploadFile(file: File, category: string, tags: string[] = []): Observable<{ progress: number; asset?: MediaAsset }> {
        return new Observable(observer => {
            // 1. Create Storage Path
            const ext = file.name.split('.').pop();
            const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            const storagePath = `media/${category}/${uniqueName}`;
            const storageRef = ref(this.storage, storagePath);

            // 2. Start Upload
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    observer.next({ progress });
                },
                (error) => {
                    observer.error(error);
                },
                async () => {
                    // Upload complete, process metadata and save to Firestore
                    try {
                        const downloadUrl = await getDownloadURL(storageRef);

                        // 3. Get Image Dimensions (if image)
                        let dimensions = { width: 0, height: 0 };
                        if (file.type.startsWith('image/')) {
                            dimensions = await this.getImageDimensions(file);
                        }

                        // 4. Create Firestore Record
                        const asset: MediaAsset = {
                            storagePath,
                            publicUrl: downloadUrl,
                            filename: file.name,
                            contentType: file.type,
                            size: file.size,
                            metadata: {
                                width: dimensions.width,
                                height: dimensions.height,
                                altText: file.name.split('.')[0],
                                tags: tags,
                                category: category
                            },
                            createdAt: serverTimestamp() as Timestamp,
                            updatedAt: serverTimestamp() as Timestamp
                        };

                        const docRef = await addDoc(collection(this.firestore, this.COLLECTION), asset);

                        // 5. Update Stats
                        const statsRef = doc(this.firestore, this.STATS_DOC);
                        updateDoc(statsRef, {
                            totalBytes: increment(file.size),
                            count: increment(1)
                        }).catch(e => console.warn('Failed to update stats', e));

                        const finalAsset = { ...asset, id: docRef.id };

                        observer.next({ progress: 100, asset: finalAsset });
                        observer.complete();
                    } catch (err) {
                        observer.error(err);
                    }
                }
            );
        });
    }

    /**
     * Get filtered media assets (Paginated)
     */
    getAssets(filter: MediaFilter = {}, lastDoc: any = null): Observable<PaginatedMediaResult> {
        const colRef = collection(this.firestore, this.COLLECTION);

        const field = filter.sortField || 'createdAt';
        const dir = filter.sortDirection || 'desc';

        let q = query(colRef, orderBy(field, dir));

        if (filter.category) {
            q = query(q, where('metadata.category', '==', filter.category));
        }

        if (filter.tag) {
            q = query(q, where('metadata.tags', 'array-contains', filter.tag));
        }

        if (filter.limit) {
            q = query(q, limit(filter.limit));
        }

        if (lastDoc) {
            q = query(q, startAfter(lastDoc));
        }

        return from(getDocs(q)).pipe(
            map(snapshot => {
                const assets = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MediaAsset));
                const last = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
                return { assets, lastDoc: last };
            })
        );
    }

    /**
     * Bulk Update metadata
     */
    async bulkUpdateMetadata(assetIds: string[], updates: { tags?: string[], category?: string }): Promise<void> {
        const batch = writeBatch(this.firestore);

        assetIds.forEach(id => {
            const docRef = doc(this.firestore, this.COLLECTION, id);
            const data: any = { updatedAt: serverTimestamp() };
            if (updates.tags) data['metadata.tags'] = updates.tags;
            if (updates.category) data['metadata.category'] = updates.category;

            batch.update(docRef, data);
        });

        await batch.commit();
    }

    /**
     * Update Asset Metadata (Alt Text, Tags)
     */
    updateMetadata(id: string, metadata: Partial<MediaAsset['metadata']>): Promise<void> {
        const docRef = doc(this.firestore, this.COLLECTION, id);
        return updateDoc(docRef, {
            'metadata.altText': metadata.altText,
            'metadata.tags': metadata.tags,
            'metadata.category': metadata.category,
            updatedAt: serverTimestamp()
        });
    }

    /**
     * Delete Asset (Storage + Firestore)
     */
    async deleteAsset(asset: MediaAsset): Promise<void> {
        if (!asset.id) return;

        // 1. Delete from Storage
        const storageRef = ref(this.storage, asset.storagePath);
        try {
            await deleteObject(storageRef);
        } catch (error) {
            console.warn('File might explicitly not exist in storage, proceeding to delete DB record', error);
        }

        // 2. Delete from Firestore
        await deleteDoc(doc(this.firestore, this.COLLECTION, asset.id));

        // 3. Update Stats
        const statsRef = doc(this.firestore, this.STATS_DOC);
        updateDoc(statsRef, {
            totalBytes: increment(-asset.size),
            count: increment(-1)
        }).catch(e => console.warn('Failed to update stats', e));
    }

    private getImageDimensions(file: File): Promise<{ width: number, height: number }> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };
            img.src = URL.createObjectURL(file);
        });
    }
}
