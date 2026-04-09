import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, collectionData, Timestamp, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { Warehouse, WarehouseZone, StorageStructure, StorageLocation } from '../models/warehouse.model';

@Injectable({
    providedIn: 'root'
})
export class WarehouseService {
    private firestore = inject('FIRESTORE' as any) as Firestore;

    // --- helpers: subcollection paths under warehouses/{warehouseId} ---
    private warehousesColl = collection(this.firestore, 'warehouses');

    private zonesColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/zones`);
    }
    private structuresColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/structures`);
    }
    private locationsColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/locations`);
    }
    private obstaclesColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/obstacles`);
    }
    private doorsColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/doors`);
    }
    private scaleMarkersColl(warehouseId: string) {
        return collection(this.firestore, `warehouses/${warehouseId}/scaleMarkers`);
    }

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
        const ref = doc(this.firestore, `warehouses/${id}`);
        await updateDoc(ref, {
            isActive: false,
            updatedAt: Timestamp.now()
        });
    }

    // --- Zones ---

    getZones(warehouseId: string): Observable<WarehouseZone[]> {
        return collectionData(this.zonesColl(warehouseId), { idField: 'id' }).pipe(
            map(data => data.map(item => this.convertTimestamps(item) as WarehouseZone))
        );
    }

    async createZone(zone: Partial<WarehouseZone> & { warehouseId: string }): Promise<string> {
        if (zone.id) {
            const ref = doc(this.firestore, `warehouses/${zone.warehouseId}/zones/${zone.id}`);
            await setDoc(ref, zone);
            return zone.id;
        }
        const ref = await addDoc(this.zonesColl(zone.warehouseId), zone);
        return ref.id;
    }

    async updateZone(warehouseId: string, zoneId: string, updates: Partial<WarehouseZone>): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/zones/${zoneId}`);
        await updateDoc(ref, updates);
    }

    async deleteZone(warehouseId: string, zoneId: string): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/zones/${zoneId}`);
        await deleteDoc(ref);
    }

    // --- Obstacles ---

    getObstacles(warehouseId: string): Observable<any[]> {
        return collectionData(this.obstaclesColl(warehouseId), { idField: 'id' }).pipe(
            map(data => data.map(item => this.convertTimestamps(item)))
        );
    }

    async createObstacle(obstacle: any & { warehouseId: string }): Promise<string> {
        if (obstacle.id) {
            const ref = doc(this.firestore, `warehouses/${obstacle.warehouseId}/obstacles/${obstacle.id}`);
            await setDoc(ref, obstacle);
            return obstacle.id;
        }
        const ref = await addDoc(this.obstaclesColl(obstacle.warehouseId), obstacle);
        return ref.id;
    }

    async updateObstacle(warehouseId: string, obstacleId: string, updates: any): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/obstacles/${obstacleId}`);
        await updateDoc(ref, updates);
    }

    async deleteObstacle(warehouseId: string, obstacleId: string): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/obstacles/${obstacleId}`);
        await deleteDoc(ref);
    }

    // --- Doors ---

    getDoors(warehouseId: string): Observable<any[]> {
        return collectionData(this.doorsColl(warehouseId), { idField: 'id' }).pipe(
            map(data => data.map(item => this.convertTimestamps(item)))
        );
    }

    async createDoor(door: any & { warehouseId: string }): Promise<string> {
        if (door.id) {
            const ref = doc(this.firestore, `warehouses/${door.warehouseId}/doors/${door.id}`);
            await setDoc(ref, door);
            return door.id;
        }
        const ref = await addDoc(this.doorsColl(door.warehouseId), door);
        return ref.id;
    }

    async updateDoor(warehouseId: string, doorId: string, updates: any): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/doors/${doorId}`);
        await updateDoc(ref, updates);
    }

    async deleteDoor(warehouseId: string, doorId: string): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/doors/${doorId}`);
        await deleteDoc(ref);
    }

    // --- Structures (Racks) ---

    getStructures(warehouseId: string, zoneId?: string): Observable<StorageStructure[]> {
        let coll = this.structuresColl(warehouseId);
        let q = zoneId
            ? query(coll, where('zoneId', '==', zoneId))
            : query(coll);
        return collectionData(q, { idField: 'id' }).pipe(
            map(data => data.map(item => this.convertTimestamps(item) as StorageStructure))
        );
    }

    async createStructure(structure: Partial<StorageStructure> & { warehouseId: string }): Promise<string> {
        if (structure.id) {
            const ref = doc(this.firestore, `warehouses/${structure.warehouseId}/structures/${structure.id}`);
            await setDoc(ref, structure);
            return structure.id;
        }
        const ref = await addDoc(this.structuresColl(structure.warehouseId), structure);
        return ref.id;
    }

    async updateStructure(warehouseId: string, structureId: string, updates: Partial<StorageStructure>): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/structures/${structureId}`);
        await updateDoc(ref, updates);
    }

    async deleteStructure(warehouseId: string, structureId: string): Promise<void> {
        const ref = doc(this.firestore, `warehouses/${warehouseId}/structures/${structureId}`);
        await deleteDoc(ref);
    }

    // --- Locations (Bins) ---

    // NOTE: This can return thousands of docs. Use with caution/limits.
    async getLocations(warehouseId: string, structureId: string): Promise<StorageLocation[]> {
        const q = query(this.locationsColl(warehouseId), where('structureId', '==', structureId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as StorageLocation));
    }

    getOccupiedLocations(warehouseId: string): Observable<StorageLocation[]> {
        return collectionData(this.locationsColl(warehouseId), { idField: 'id' }).pipe(
            map(locs => (locs as StorageLocation[]).filter(l => l.status === 'full'))
        );
    }

    async getProductLocation(warehouseId: string, productId: string): Promise<StorageLocation | null> {
        const q = query(
            this.locationsColl(warehouseId),
            where('productId', '==', productId),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0];
        return { id: d.id, ...d.data() } as StorageLocation;
    }

    async createLocation(warehouseId: string, location: Partial<StorageLocation>): Promise<string> {
        const ref = await addDoc(this.locationsColl(warehouseId), location);
        return ref.id;
    }

    // --- Scale Markers ---

    getScaleMarkers(warehouseId: string): Observable<any[]> {
        return collectionData(this.scaleMarkersColl(warehouseId), { idField: 'id' });
    }

    async createScaleMarker(marker: any & { warehouseId: string }): Promise<string> {
        if (marker.id) {
            const ref = doc(this.firestore, `warehouses/${marker.warehouseId}/scaleMarkers/${marker.id}`);
            await setDoc(ref, marker);
            return marker.id;
        }
        const ref = await addDoc(this.scaleMarkersColl(marker.warehouseId), marker);
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
