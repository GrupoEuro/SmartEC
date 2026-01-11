import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    collectionData,
    Timestamp,
    where
} from '@angular/fire/firestore';
import { Observable, map, from } from 'rxjs';
import { BacklogItem } from '../models/backlog.model';

@Injectable({
    providedIn: 'root'
})
export class BacklogService {
    private firestore = inject(Firestore);
    private readonly collectionName = 'project_backlog';

    private get collectionRef() {
        return collection(this.firestore, this.collectionName);
    }

    /**
     * Get all backlog items ordered by creation date (newest first)
     */
    getBacklogItems(): Observable<BacklogItem[]> {
        const q = query(this.collectionRef, orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map(items => items.map(item => this.convertTimestamps(item as any)))
        );
    }

    /**
     * Create a new backlog item
     */
    async createItem(item: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const docRef = await addDoc(this.collectionRef, {
            ...item,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            status: item.status || 'backlog'
        });
        return docRef.id;
    }

    /**
     * Update an existing backlog item
     */
    async updateItem(id: string, data: Partial<BacklogItem>): Promise<void> {
        const docRef = doc(this.firestore, `${this.collectionName}/${id}`);
        await updateDoc(docRef, {
            ...data,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Delete a backlog item
     */
    async deleteItem(id: string): Promise<void> {
        const docRef = doc(this.firestore, `${this.collectionName}/${id}`);
        await deleteDoc(docRef);
    }

    /**
     * Convert Firestore Timestamps to Date objects
     */
    private convertTimestamps(item: any): BacklogItem {
        return {
            ...item,
            createdAt: item.createdAt?.toDate ? item.createdAt.toDate() : item.createdAt,
            updatedAt: item.updatedAt?.toDate ? item.updatedAt.toDate() : item.updatedAt
        };
    }
}
