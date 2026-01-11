import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { Warehouse } from '../../../../core/models/warehouse.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-warehouse-list',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent],
    templateUrl: './warehouse-list.component.html',
    styleUrls: ['./warehouse-list.component.css']
})
export class WarehouseListComponent {
    private warehouseService = inject(WarehouseService);
    private router = inject(Router);

    warehouses = toSignal(this.warehouseService.getWarehouses(), { initialValue: [] });

    // Warehouse statistics (would be better to fetch from service, but for now computed)
    getWarehouseStats(warehouseId: string) {
        // Placeholder - in real app, fetch from WarehouseService
        return {
            zones: 3,
            racks: 20,
            capacity: 66
        };
    }

    navigateToCreate() {
        this.router.navigate(['/admin/warehouses/new']);
    }

    viewLocator(warehouseId: string) {
        this.router.navigate(['/operations/inventory/locator'], { queryParams: { warehouse: warehouseId } });
    }

    editLayout(warehouseId: string) {
        this.router.navigate(['/admin/warehouses', warehouseId]);
    }

    async deleteWarehouse(warehouseId: string) {
        if (confirm('Are you sure you want to delete this warehouse? This action cannot be undone.')) {
            try {
                await this.warehouseService.deleteWarehouse(warehouseId);
                // List will auto-update via signal
            } catch (error) {
                console.error('Error deleting warehouse:', error);
                alert('Failed to delete warehouse');
            }
        }
    }
}
