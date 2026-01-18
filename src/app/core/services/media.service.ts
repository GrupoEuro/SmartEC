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
    uploadBytes,
    getDownloadURL,
    deleteObject,
    StorageReference,
    getMetadata
} from '@angular/fire/storage';
import { getAuth } from '@angular/fire/auth';
import { Observable, from, map, switchMap, of } from 'rxjs';
import { MediaAsset, MediaFilter, MediaFolder } from '../models/media.model';

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
    private readonly FOLDERS_COLLECTION = 'media_folders';
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
    uploadFile(file: File, category: string, tags: string[] = [], folderId: string | null = null): Observable<{ progress: number; asset?: MediaAsset }> {
        return new Observable(observer => {
            // 1. Create Storage Path
            const ext = file.name.split('.').pop();
            const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            const storagePath = `media/${category}/${uniqueName}`; // Keep physical path simple for now
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
                                category: category,
                                folderId: folderId
                            },
                            createdAt: serverTimestamp() as Timestamp,
                            updatedAt: serverTimestamp() as Timestamp
                        };

                        const docRef = await addDoc(collection(this.firestore, this.COLLECTION), asset);

                        // 5. Update Stats
                        this.updateStats(file.size);

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

        if (filter.folderId !== undefined) {
            q = query(q, where('metadata.folderId', '==', filter.folderId));
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

    /**
     * Folder Management
     */
    async createFolder(name: string, parentId: string | null = null, path: string = ''): Promise<string> {
        const folder: MediaFolder = {
            name,
            parentId,
            path,
            createdAt: serverTimestamp() as Timestamp,
            updatedAt: serverTimestamp() as Timestamp
        };
        const docRef = await addDoc(collection(this.firestore, this.FOLDERS_COLLECTION), folder);
        return docRef.id;
    }

    getFoldersDisplay(parentId: string | null = null): Observable<MediaFolder[]> {
        const q = query(
            collection(this.firestore, this.FOLDERS_COLLECTION),
            where('parentId', '==', parentId),
            orderBy('name', 'asc')
        );
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as MediaFolder)))
        );
    }

    async moveAssets(assetIds: string[], targetFolderId: string | null): Promise<void> {
        const batch = writeBatch(this.firestore);
        assetIds.forEach(id => {
            const ref = doc(this.firestore, this.COLLECTION, id);
            batch.update(ref, {
                'metadata.folderId': targetFolderId,
                updatedAt: serverTimestamp()
            });
        });
        await batch.commit();
    }

    async getFolder(id: string): Promise<MediaFolder | null> {
        const snap = await getDoc(doc(this.firestore, this.FOLDERS_COLLECTION, id));
        return snap.exists() ? { id: snap.id, ...snap.data() } as MediaFolder : null;
    }

    /**
     * Migration Tool: Migrates legacy categories to root folders
     */
    async migrateLegacyCategories(categories: { id: string, label: string }[]): Promise<{ migrated: number, errors: number }> {
        let migratedCount = 0;
        let errorCount = 0;

        const auth = getAuth();
        console.log(`Starting Migration (Throttled Mode)... User: ${auth.currentUser?.uid}`);

        if (!auth.currentUser) {
            console.error('MIGRATION ABORTED: No authenticated user found. Please log in.');
            return { migrated: 0, errors: 1 };
        }

        for (const cat of categories) {
            console.log(`Migrating Category: ${cat.label}`);
            try {
                // 1. Check if folder exists or create it
                const qFolder = query(
                    collection(this.firestore, this.FOLDERS_COLLECTION),
                    where('name', '==', cat.label),
                    where('parentId', '==', null)
                );
                const folderSnap = await getDocs(qFolder);
                let folderId: string;

                if (folderSnap.empty) {
                    folderId = await this.createFolder(cat.label, null, cat.label);
                    console.log(`Created folder: ${cat.label}`);
                } else {
                    folderId = folderSnap.docs[0].id;
                }

                // 2. Process Assets in Small Batches (Pagination) to avoid network overload
                const BATCH_SIZE = 100; // conservative batch size
                let lastDoc: any = null;
                let hasMore = true;
                let categoryProcessed = 0;

                while (hasMore) {
                    // Use createdAt for stable sorting (assuming index exists from getAssets)
                    let qAssets = query(
                        collection(this.firestore, this.COLLECTION),
                        where('metadata.category', '==', cat.id),
                        orderBy('createdAt', 'asc'),
                        limit(BATCH_SIZE)
                    );

                    if (lastDoc) {
                        qAssets = query(qAssets, startAfter(lastDoc));
                    }

                    const assetsSnap = await getDocs(qAssets);

                    if (assetsSnap.empty) {
                        hasMore = false;
                        break;
                    }

                    const batch = writeBatch(this.firestore);
                    let opsInBatch = 0;

                    assetsSnap.forEach(docSnap => {
                        const data = docSnap.data() as MediaAsset;
                        // Only migrate if not already in a folder
                        if (!data.metadata.folderId) {
                            const ref = doc(this.firestore, this.COLLECTION, docSnap.id);
                            batch.update(ref, {
                                'metadata.folderId': folderId,
                                'updatedAt': serverTimestamp()
                            });
                            opsInBatch++;
                            migratedCount++;
                        }
                    });

                    if (opsInBatch > 0) {
                        await batch.commit();
                        console.log(`  Migrated batch of ${opsInBatch} assets for ${cat.label}`);
                        // Small delay to prevent request flooding
                        await new Promise(resolve => setTimeout(resolve, 250));
                    }

                    categoryProcessed += assetsSnap.docs.length;
                    lastDoc = assetsSnap.docs[assetsSnap.docs.length - 1];

                    if (assetsSnap.docs.length < BATCH_SIZE) {
                        hasMore = false;
                    }
                }

                console.log(`Completed Category: ${cat.label}. Processed ${categoryProcessed} assets.`);

            } catch (e) {
                console.error(`Error migrating category ${cat.id}`, e);
                errorCount++;
            }
        }

        return { migrated: migratedCount, errors: errorCount };
    }

    async duplicateAsset(assetId: string): Promise<MediaAsset> {
        // 1. Get original asset
        const assetSnap = await getDoc(doc(this.firestore, this.COLLECTION, assetId));
        if (!assetSnap.exists()) throw new Error('Asset not found');
        const original = assetSnap.data() as MediaAsset;

        // 2. Format new filename
        const ext = original.filename.split('.').pop();
        const namePart = original.filename.substring(0, original.filename.lastIndexOf('.'));
        const newFilename = `${namePart}_copy_${Date.now()}.${ext}`;

        // 3. Determine new path (same folder/path as original)
        // Original storagePath: media/category/filename
        // We want: media/category/filename_copy
        const pathParts = original.storagePath.split('/');
        pathParts.pop(); // remove filename
        const newStoragePath = `${pathParts.join('/')}/${newFilename}`;

        // 4. Copy in Storage
        // We can't directly "copy" in client SDK easily without download/upload or cloud functions.
        // But we can fetch the blob and re-upload.
        // Efficient way: get download URL -> fetch -> blob -> upload.
        const response = await fetch(original.publicUrl);
        const blob = await response.blob();

        // 5. Upload new file
        const storageRef = ref(this.storage, newStoragePath);
        const uploadResult = await uploadBytes(storageRef, blob, { contentType: original.contentType });
        const downloadUrl = await getDownloadURL(uploadResult.ref);

        // 6. Create Firestore Record
        const newAsset: MediaAsset = {
            ...original,
            id: undefined, // Let Firestore generate ID
            storagePath: newStoragePath,
            publicUrl: downloadUrl,
            filename: newFilename,
            createdAt: serverTimestamp() as Timestamp,
            updatedAt: serverTimestamp() as Timestamp,
            metadata: {
                ...original.metadata,
                altText: `${original.metadata.altText} (Copy)`
            }
        };

        const docRef = await addDoc(collection(this.firestore, this.COLLECTION), newAsset);
        this.updateStats(blob.size); // Update stats

        return { id: docRef.id, ...newAsset };
    }

    async uploadBlob(blob: Blob, filename: string, folderId: string | null = null, contentType: string): Promise<MediaAsset> {
        const storagePath = `media/edited/${Date.now()}_${filename}`;
        const storageRef = ref(this.storage, storagePath);

        const uploadResult = await uploadBytes(storageRef, blob, { contentType });
        const downloadUrl = await getDownloadURL(uploadResult.ref);

        // Get dimensions if image
        let width = 0;
        let height = 0;
        if (contentType.startsWith('image/')) {
            try {
                // Determine dimensions from blob
                const dims = await this.getImageDimensions(new File([blob], filename));
                width = dims.width;
                height = dims.height;
            } catch (e) { console.warn('Could not determine dimensions', e) }
        }

        const asset: MediaAsset = {
            storagePath,
            publicUrl: downloadUrl,
            filename,
            contentType,
            size: blob.size,
            metadata: {
                width,
                height,
                altText: filename,
                tags: [],
                category: 'edited',
                folderId,
            },
            createdAt: serverTimestamp() as Timestamp,
            updatedAt: serverTimestamp() as Timestamp
        };

        const docRef = await addDoc(collection(this.firestore, this.COLLECTION), asset);
        this.updateStats(blob.size);
        return { id: docRef.id, ...asset };
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
    private updateStats(sizeDelta: number, countDelta: number = 1) {
        const statsRef = doc(this.firestore, this.STATS_DOC);
        updateDoc(statsRef, {
            totalBytes: increment(sizeDelta),
            count: increment(countDelta)
        }).catch(e => console.warn('Failed to update stats', e));
    }
}
