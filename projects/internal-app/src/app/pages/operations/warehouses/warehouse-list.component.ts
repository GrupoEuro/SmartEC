import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, getDocs, query } from '@angular/fire/firestore';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';

interface WarehouseMetrics {
    totalProducts: number;
    totalUnits: number;
    lowStockCount: number;
    activeTransfers: number;
}

interface Warehouse {
    id: string;
    name: string;
    type: 'PHYSICAL' | 'VIRTUAL';
    code: string;
    status: 'ACTIVE' | 'INACTIVE';
    metrics?: WarehouseMetrics;
}

@Component({
    selector: 'app-warehouse-list',
    standalone: true,
    imports: [CommonModule, RouterLink, AppIconComponent, AdminPageHeaderComponent],
    templateUrl: './warehouse-list.component.html',
    styleUrl: './warehouse-list.component.css'
})
export class WarehouseListComponent implements OnInit {
    private firestore = inject(Firestore);

    warehouses = signal<Warehouse[]>([]);
    isLoading = signal(true);

    async ngOnInit() {
        await this.loadWarehouses();
    }

    async loadWarehouses() {
        this.isLoading.set(true);

        try {
            // Get locations (warehouses)
            const locationsSnapshot = await getDocs(collection(this.firestore, 'locations'));
            const warehouses: Warehouse[] = [];

            for (const doc of locationsSnapshot.docs) {
                const data = doc.data();
                const warehouse: Warehouse = {
                    id: doc.id,
                    name: data['name'] || 'Unknown',
                    type: doc.id === 'loc_main' ? 'PHYSICAL' : 'VIRTUAL',
                    code: data['code'] || doc.id,
                    status: 'ACTIVE'
                };

                // Load metrics
                warehouse.metrics = await this.loadWarehouseMetrics(doc.id);
                warehouses.push(warehouse);
            }

            this.warehouses.set(warehouses);
        } catch (error) {
            console.error('Error loading warehouses:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    async loadWarehouseMetrics(locationId: string): Promise<WarehouseMetrics> {
        try {
            // Get inventory balances for this location
            const balancesSnapshot = await getDocs(
                query(collection(this.firestore, 'inventory_balances'))
            );

            let totalProducts = 0;
            let totalUnits = 0;
            let lowStockCount = 0;

            for (const doc of balancesSnapshot.docs) {
                const data = doc.data();
                if (data['locationId'] === locationId) {
                    totalProducts++;
                    totalUnits += data['available'] || 0;

                    if (data['available'] <= data['reorderPoint']) {
                        lowStockCount++;
                    }
                }
            }

            return {
                totalProducts,
                totalUnits,
                lowStockCount,
                activeTransfers: 0 // TODO: Calculate from transfers collection
            };
        } catch (error) {
            console.error('Error loading metrics:', error);
            return {
                totalProducts: 0,
                totalUnits: 0,
                lowStockCount: 0,
                activeTransfers: 0
            };
        }
    }

    getTypeBadgeClass(type: string): string {
        return type === 'PHYSICAL' ? 'badge-physical' : 'badge-virtual';
    }

    getStatusBadgeClass(status: string): string {
        return status === 'ACTIVE' ? 'badge-active' : 'badge-inactive';
    }
}
