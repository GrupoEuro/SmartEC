import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { ProductService } from '../../../core/services/product.service';
import { DemandForecastingService } from '../../../core/services/demand-forecasting.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';
import { firstValueFrom } from 'rxjs';

interface ReplenishmentItem {
    product: Product;
    currentStock: number;
    safetyStock: number;
    reorderPoint: number;
    onOrder: number; // In-transit from existing POs
    projectedStockout: number; // Days until stockout
    recommendedOrderQty: number;
    urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    estimatedCost: number;
}

@Component({
    selector: 'app-replenishment-planner',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, AppIconComponent, TranslateModule],
    templateUrl: './replenishment-planner.component.html',
    styleUrls: ['./replenishment-planner.component.css']
})
export class ReplenishmentPlannerComponent implements OnInit {
    private productService = inject(ProductService);
    private demandService = inject(DemandForecastingService);
    private toast = inject(ToastService);
    private router = inject(Router);

    isLoading = signal(false);
    replenishmentItems = signal<ReplenishmentItem[]>([]);
    selectedItems = signal<Set<string>>(new Set());

    // Filters
    urgencyFilter = signal<string>('ALL');
    searchQuery = signal<string>('');

    // Computed
    filteredItems = computed(() => {
        let items = this.replenishmentItems();

        // Urgency filter
        if (this.urgencyFilter() !== 'ALL') {
            items = items.filter(item => item.urgencyLevel === this.urgencyFilter());
        }

        // Search filter
        const query = this.searchQuery().toLowerCase();
        if (query) {
            items = items.filter(item =>
                item.product.name.es.toLowerCase().includes(query) ||
                item.product.sku.toLowerCase().includes(query)
            );
        }

        return items.sort((a, b) => {
            // Sort by urgency then by projected stockout
            const urgencyOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
            const aOrder = urgencyOrder[a.urgencyLevel];
            const bOrder = urgencyOrder[b.urgencyLevel];

            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.projectedStockout - b.projectedStockout;
        });
    });

    stats = computed(() => {
        const items = this.replenishmentItems();
        return {
            total: items.length,
            critical: items.filter(i => i.urgencyLevel === 'CRITICAL').length,
            high: items.filter(i => i.urgencyLevel === 'HIGH').length,
            selected: this.selectedItems().size,
            totalCost: Array.from(this.selectedItems())
                .map(id => items.find(i => i.product.id === id))
                .filter(i => i !== undefined)
                .reduce((sum, item) => sum + (item?.estimatedCost || 0), 0)
        };
    });

    ngOnInit() {
        this.analyzeReplenishment();
    }

    async analyzeReplenishment() {
        this.isLoading.set(true);

        try {
            // Fetch all active products
            const products = await firstValueFrom(this.productService.getProducts());

            const replenishmentItems: ReplenishmentItem[] = [];

            for (const product of products) {
                // Only analyze products with inventory policy or below reorder point
                if (!product.inventoryPolicy && product.stockQuantity > 10) continue;

                let policy = product.inventoryPolicy;

                // If no policy exists, generate one on-the-fly
                if (!policy) {
                    const generatedPolicy = await this.demandService.generateInventoryPolicy(
                        product.id!,
                        30, // Default 30-day lead time
                        0.95, // 95% service level
                        500, // $500 MXN order cost
                        0.20, // 20% holding cost
                        product.costPrice || product.price * 0.6 // Estimate cost if unknown
                    );

                    policy = {
                        targetServiceLevel: generatedPolicy.targetServiceLevel,
                        safetyStock: generatedPolicy.safetyStock,
                        safetyStockDays: Math.ceil(generatedPolicy.safetyStock / (generatedPolicy.safetyStock / 7)), // Estimate
                        reorderPoint: generatedPolicy.reorderPoint,
                        orderQuantity: generatedPolicy.orderQuantity,
                        maxStockLevel: generatedPolicy.maxStockLevel,
                        minStockLevel: generatedPolicy.safetyStock,
                        leadTimeDays: generatedPolicy.leadTimeDays,
                        leadTimeVariability: 0,
                        reviewFrequencyDays: 30,
                        autoReplenishmentEnabled: false
                    };
                }

                const currentStock = product.stockQuantity || 0;
                const onOrder = 0; // TODO: Fetch from pending POs
                const projectedStock = currentStock + onOrder;

                // Check if below reorder point
                if (projectedStock <= policy.reorderPoint) {
                    const avgDailyDemand = policy.avgDailyDemand || (product.stockQuantity / 90); // Estimate
                    const projectedStockout = avgDailyDemand > 0 ? Math.floor(currentStock / avgDailyDemand) : 999;

                    // Determine urgency
                    let urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
                    if (currentStock === 0) urgencyLevel = 'CRITICAL';
                    else if (projectedStockout < 3) urgencyLevel = 'CRITICAL';
                    else if (projectedStockout < 7) urgencyLevel = 'HIGH';
                    else if (projectedStockout < 14) urgencyLevel = 'MEDIUM';

                    const recommendedOrderQty = policy.orderQuantity || 10;
                    const unitCost = product.costPrice || product.price * 0.6;

                    replenishmentItems.push({
                        product,
                        currentStock,
                        safetyStock: policy.safetyStock,
                        reorderPoint: policy.reorderPoint,
                        onOrder,
                        projectedStockout,
                        recommendedOrderQty,
                        urgencyLevel,
                        estimatedCost: recommendedOrderQty * unitCost
                    });
                }
            }

            this.replenishmentItems.set(replenishmentItems);

            if (replenishmentItems.length === 0) {
                this.toast.success('✅ All products are well-stocked!');
            } else {
                this.toast.info(`Found ${replenishmentItems.length} products needing replenishment`);
            }

        } catch (error: any) {
            this.toast.error('Error analyzing replenishment: ' + error.message);
            console.error(error);
        } finally {
            this.isLoading.set(false);
        }
    }

    toggleSelection(productId: string) {
        const selected = new Set(this.selectedItems());
        if (selected.has(productId)) {
            selected.delete(productId);
        } else {
            selected.add(productId);
        }
        this.selectedItems.set(selected);
    }

    selectAll() {
        const allIds = this.filteredItems().map(item => item.product.id!);
        this.selectedItems.set(new Set(allIds));
    }

    clearSelection() {
        this.selectedItems.set(new Set());
    }

    async generatePurchaseOrders() {
        const selected = this.selectedItems();
        if (selected.size === 0) {
            this.toast.warning('Please select at least one product');
            return;
        }

        // Group by supplier
        const items = this.replenishmentItems();
        const selectedProducts = items.filter(item => selected.has(item.product.id!));

        const bySupplier = new Map<string, ReplenishmentItem[]>();

        selectedProducts.forEach(item => {
            const supplierId = item.product.supplierId || 'UNKNOWN';
            if (!bySupplier.has(supplierId)) {
                bySupplier.set(supplierId, []);
            }
            bySupplier.get(supplierId)!.push(item);
        });

        // TODO: Actually create POs in database
        // For now, just show summary
        const poCount = bySupplier.size;
        const totalItems = selected.size;
        const totalCost = this.stats().totalCost;

        this.toast.success(
            `✅ Ready to generate ${poCount} Purchase Order(s) for ${totalItems} products. Total: $${totalCost.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`
        );

        // Navigate to procurement (in real implementation, create draft POs)
        // this.router.navigate(['/operations/procurement']);
    }

    getUrgencyClass(level: string): string {
        const classes: Record<string, string> = {
            'CRITICAL': 'bg-red-900/30 text-red-400 border-red-500/30',
            'HIGH': 'bg-orange-900/30 text-orange-400 border-orange-500/30',
            'MEDIUM': 'bg-yellow-900/30 text-yellow-400 border-yellow-500/30',
            'LOW': 'bg-blue-900/30 text-blue-400 border-blue-500/30'
        };
        return classes[level] || '';
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 0
        }).format(amount);
    }
}
