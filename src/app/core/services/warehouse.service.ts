import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, Timestamp, limit } from '@angular/fire/firestore';
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

    // ✅ One-time read — warehouses are static config, real-time not needed
    getWarehouses(): Observable<Warehouse[]> {
        return from(getDocs(query(this.warehousesColl, where('isActive', '==', true)))).pipe(
            map(snap => snap.docs.map(d => this.convertTimestamps({ id: d.id, ...d.data() }) as Warehouse))
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
        const ref = doc(this.firestore, `warehouses/${id}`);
        await updateDoc(ref, {
            isActive: false,
            updatedAt: Timestamp.now()
        });
    }

    // --- Zones ---

    // ✅ One-time read — zones don't change while user views the page
    getZones(warehouseId: string): Observable<WarehouseZone[]> {
        const q = query(this.zonesColl, where('warehouseId', '==', warehouseId));
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => this.convertTimestamps({ id: d.id, ...d.data() }) as WarehouseZone))
        );
    }

    async createZone(zone: Partial<WarehouseZone>): Promise<string> {
        if (zone.id) {
            const ref = doc(this.firestore, `warehouse_zones/${zone.id}`);
            await setDoc(ref, zone);
            return zone.id;
        }
        const ref = await addDoc(this.zonesColl, zone);
        return ref.id;
    }

    async updateZone(id: string, updates: Partial<WarehouseZone>): Promise<void> {
        const ref = doc(this.firestore, `warehouse_zones/${id}`);
        await updateDoc(ref, updates);
    }

    async deleteZone(id: string): Promise<void> {
        const ref = doc(this.firestore, `warehouse_zones/${id}`);
        await deleteDoc(ref);
    }

    // --- Obstacles ---

    // ✅ One-time read — obstacles are layout data
    getObstacles(warehouseId: string): Observable<any[]> {
        const q = query(this.obstaclesColl, where('warehouseId', '==', warehouseId));
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => this.convertTimestamps({ id: d.id, ...d.data() })))
        );
    }

    async createObstacle(obstacle: any): Promise<string> {
        if (obstacle.id) {
            const ref = doc(this.firestore, `warehouse_obstacles/${obstacle.id}`);
            await setDoc(ref, obstacle);
            return obstacle.id;
        }
        const ref = await addDoc(this.obstaclesColl, obstacle);
        return ref.id;
    }

    async updateObstacle(id: string, updates: any): Promise<void> {
        const ref = doc(this.firestore, `warehouse_obstacles/${id}`);
        await updateDoc(ref, updates);
    }

    async deleteObstacle(id: string): Promise<void> {
        const ref = doc(this.firestore, `warehouse_obstacles/${id}`);
        await deleteDoc(ref);
    }

    // --- Doors ---

    // ✅ One-time read — doors are layout data
    getDoors(warehouseId: string): Observable<any[]> {
        const q = query(this.doorsColl, where('warehouseId', '==', warehouseId));
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => this.convertTimestamps({ id: d.id, ...d.data() })))
        );
    }

    async createDoor(door: any): Promise<string> {
        if (door.id) {
            const ref = doc(this.firestore, `warehouse_doors/${door.id}`);
            await setDoc(ref, door);
            return door.id;
        }
        const ref = await addDoc(this.doorsColl, door);
        return ref.id;
    }

    async updateDoor(id: string, updates: any): Promise<void> {
        const ref = doc(this.firestore, `warehouse_doors/${id}`);
        await updateDoc(ref, updates);
    }

    async deleteDoor(id: string): Promise<void> {
        const ref = doc(this.firestore, `warehouse_doors/${id}`);
        await deleteDoc(ref);
    }

    // --- Structures (Racks) ---

    // ✅ One-time read — structures are layout config
    getStructures(warehouseId: string, zoneId?: string): Observable<StorageStructure[]> {
        let q = query(this.structuresColl, where('warehouseId', '==', warehouseId));
        if (zoneId) {
            q = query(q, where('zoneId', '==', zoneId));
        }
        return from(getDocs(q)).pipe(
            map(snap => snap.docs.map(d => this.convertTimestamps({ id: d.id, ...d.data() }) as StorageStructure))
        );
    }

    async createStructure(structure: Partial<StorageStructure>): Promise<string> {
        if (structure.id) {
            const ref = doc(this.firestore, `warehouse_structures/${structure.id}`);
            await setDoc(ref, structure);
            return structure.id;
        }
        const ref = await addDoc(this.structuresColl, structure);
        return ref.id;
    }

    async updateStructure(id: string, updates: Partial<StorageStructure>): Promise<void> {
        const ref = doc(this.firestore, `warehouse_structures/${id}`);
        await updateDoc(ref, updates);
    }

    async deleteStructure(id: string): Promise<void> {
        const ref = doc(this.firestore, `warehouse_structures/${id}`);
        await deleteDoc(ref);
    }

    // --- Locations (Bins) ---

    // NOTE: Can return thousands of docs. Use with caution/limits.
    async getLocations(structureId: string): Promise<StorageLocation[]> {
        const q = query(this.locationsColl, where('structureId', '==', structureId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as StorageLocation));
    }

    // ✅ One-time read — filter occupied in memory (avoids composite index requirement)
    getOccupiedLocations(warehouseId: string): Observable<StorageLocation[]> {
        const q = query(this.locationsColl, where('warehouseId', '==', warehouseId));
        return from(getDocs(q)).pipe(
            map(snap => (snap.docs.map(d => ({ id: d.id, ...d.data() } as StorageLocation))).filter(l => l.status === 'full'))
        );
    }

    async getProductLocation(warehouseId: string, productId: string): Promise<StorageLocation | null> {
        const q = query(this.locationsColl, where('warehouseId', '==', warehouseId), where('productId', '==', productId), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0];
        return { id: d.id, ...d.data() } as StorageLocation;
    }

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
