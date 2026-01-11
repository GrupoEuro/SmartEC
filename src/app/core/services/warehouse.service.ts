import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, addDoc, updateDoc, deleteDoc, query, where, getDocs, collectionData, Timestamp, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { Warehouse, WarehouseZone, StorageStructure, StorageLocation } from '../models/warehouse.model';

@Injectable({
    providedIn: 'root'
})
export class WarehouseService {
    private firestore = inject(Firestore);

    // Collections
    private warehousesColl = collection(this.firestore, 'warehouses');
    private zonesColl = collection(this.firestore, 'warehouse_zones');
    private structuresColl = collection(this.firestore, 'warehouse_structures');
    private locationsColl = collection(this.firestore, 'warehouse_locations');
    private obstaclesColl = collection(this.firestore, 'warehouse_obstacles');
    private doorsColl = collection(this.firestore, 'warehouse_doors');

    // --- Warehouses ---

    getWarehouses(): Observable<Warehouse[]> {
        return collectionData(query(this.warehousesColl, where('isActive', '==', true)), { idField: 'id' }).pipe(
            map(data => data.map(item => this.convertTimestamps(item) as Warehouse))
        );
    }

    async createWarehouse(warehouse: Partial<Warehouse>): Promise<string> {
        const data = {
            ...warehouse,
            isActive: true,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        };
        const ref = await addDoc(this.warehousesColl, data);
        return ref.id;
    }

    async updateWarehouse(id: string, updates: Partial<Warehouse>): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${id}`);
        await updateDoc(ref, {
            ...updates,
            updatedAt: Timestamp.now()
        });
    }

    async deleteWarehouse(id: string): Promise<void> {
        // Soft delete usually, but here simple active flag update
        const ref = doc(this.firestore, `warehouses/${id}`);
        await updateDoc(ref, {
            isActive: false,
            updatedAt: Timestamp.now()
        });
    }

    // --- Zones ---

    getZones(warehouseId: string): Observable<WarehouseZone[]> {
        const q = query(this.zonesColl, where('warehouseId', '==', warehouseId));
        return collectionData(q, { idField: 'id' }) as Observable<WarehouseZone[]>;
    }

    async createZone(zone: Partial<WarehouseZone>): Promise<string> {
        const ref = await addDoc(this.zonesColl, zone);
        return ref.id;
    }

    async updateZone(id: string, updates: Partial<WarehouseZone>): Promise<void> {
        const ref = doc(this.firestore, `warehouse_zones/${id}`);
        await updateDoc(ref, updates);
    }

    // --- Obstacles ---

    getObstacles(warehouseId: string): Observable<any[]> {
        const q = query(this.obstaclesColl, where('warehouseId', '==', warehouseId));
        return collectionData(q, { idField: 'id' });
    }

    // --- Doors ---

    getDoors(warehouseId: string): Observable<any[]> {
        const q = query(this.doorsColl, where('warehouseId', '==', warehouseId));
        return collectionData(q, { idField: 'id' });
    }

    // --- Structures (Racks) ---

    getStructures(warehouseId: string, zoneId?: string): Observable<StorageStructure[]> {
        let q = query(this.structuresColl, where('warehouseId', '==', warehouseId));
        if (zoneId) {
            q = query(q, where('zoneId', '==', zoneId));
        }
        return collectionData(q, { idField: 'id' }) as Observable<StorageStructure[]>;
    }

    async createStructure(structure: Partial<StorageStructure>): Promise<string> {
        const ref = await addDoc(this.structuresColl, structure);
        return ref.id;
    }

    async updateStructure(id: string, updates: Partial<StorageStructure>): Promise<void> {
        const ref = doc(this.firestore, `warehouse_structures/${id}`);
        await updateDoc(ref, updates);
    }

    // --- Locations (Bins) ---

    // NOTE: This can return thousands of docs. Use with caution/limits.
    async getLocations(structureId: string): Promise<StorageLocation[]> {
        const q = query(this.locationsColl, where('structureId', '==', structureId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as StorageLocation));
    }

    getOccupiedLocations(warehouseId: string): Observable<StorageLocation[]> {
        const q = query(this.locationsColl, where('warehouseId', '==', warehouseId), where('status', '==', 'full'));
        return collectionData(q, { idField: 'id' }) as Observable<StorageLocation[]>;
    }

    async getProductLocation(warehouseId: string, productId: string): Promise<StorageLocation | null> {
        // Query across all locations in this warehouse (requires collection group index or root collection query usually)
        // But here locations are in root `warehouse_locations`.
        // So we filter by warehouseId AND productId.
        const q = query(this.locationsColl, where('warehouseId', '==', warehouseId), where('productId', '==', productId), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() } as StorageLocation;
    }

    // Bulk create locations (batching handled by implementation usually, here simple loop for MVP)
    async createLocation(location: Partial<StorageLocation>): Promise<string> {
        const ref = await addDoc(this.locationsColl, location);
        return ref.id;
    }


    // Helper
    private convertTimestamps(item: any): any {
        return {
            ...item,
            createdAt: item.createdAt?.toDate ? item.createdAt.toDate() : item.createdAt,
            updatedAt: item.updatedAt?.toDate ? item.updatedAt.toDate() : item.updatedAt
        };
    }
}
