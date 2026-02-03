import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { Warehouse } from '../../../../core/models/warehouse.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-warehouse-list',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent, FormsModule],
    templateUrl: './warehouse-list.component.html',
    styleUrls: ['./warehouse-list.component.css']
})
export class WarehouseListComponent {
    private warehouseService = inject(WarehouseService);
    private router = inject(Router);

    warehouses = toSignal(this.warehouseService.getWarehouses(), { initialValue: [] });

    // Filter State
    searchTerm = '';
    statusFilter = 'all';

    // Computed Filtered Warehouses
    filteredWarehouses = computed(() => {
        const all = this.warehouses();
        const search = this.searchTerm.toLowerCase();
        const status = this.statusFilter;

        return all.filter(w => {
            const matchesSearch =
                w.name.toLowerCase().includes(search) ||
                w.code.toLowerCase().includes(search) ||
                (w.address && w.address.toLowerCase().includes(search));

            const matchesStatus = status === 'all' ||
                (status === 'active' && w.isActive) ||
                (status === 'inactive' && !w.isActive);

            return matchesSearch && matchesStatus;
        });
    });

    // Trigger for template binding (though computed handles it automatically)
    filterWarehouses() {
        // No-op, signals handle reactivity
    }

    resetFilters() {
        this.searchTerm = '';
        this.statusFilter = 'all';
    }

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
