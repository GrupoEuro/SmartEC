import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../../../shared/components/app-icon/app-icon.component';
import { ProductService } from '../../../../../../core/services/product.service';
import { PriceStackService } from '../../../../../../core/services/price-stack.service';
import { RoundingService, RoundingRuleType } from '../../../../../../core/services/rounding.service';
import { PriceBlock } from '../../../../../../core/models/price-constructor.model';
import { Product } from '../../../../../../core/models/product.model';

interface SimulationReport {
    totalRevenueDelta: number;
    totalProfitDelta: number;
    productsAnalyzed: number;
    avgMarginDelta: number;
}

@Component({
    selector: 'app-batch-simulation-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './batch-simulation-modal.component.html',
    styles: [`
    :host { display: contents; }
  `]
})
export class BatchSimulationModalComponent {

    // Inputs
    isOpen = signal(false);

    // Dependencies
    private productService = inject(ProductService);
    private stackService = inject(PriceStackService);
    private roundingService = inject(RoundingService);

    // State
    activeBlocks = signal<PriceBlock[]>([]);
    roundingRule = signal<RoundingRuleType>('NONE');

    // Filters
    selectedBrand = signal<string>('ALL');
    selectedCategory = signal<string>('ALL');

    // Mock Data for filters (Real app would fetch these)
    brands = ['ALL', 'Michelin', 'Pirelli', 'Dunlop', 'Continental', 'Praxis'];
    categories = ['ALL', 'Sport', 'Touring', 'Off-Road', 'Scooter', 'Cruiser'];

    // Simulation State
    isSimulating = signal(false);
    progress = signal(0);
    report = signal<SimulationReport | null>(null);

    open(blocks: PriceBlock[], rule: RoundingRuleType) {
        this.activeBlocks.set(blocks);
        this.roundingRule.set(rule);
        this.isOpen.set(true);
        this.report.set(null);
        this.progress.set(0);
    }

    // Computed Summaries for UI
    summaryMargin = computed(() => {
        const marginBlock = this.activeBlocks().find(b => b.type === 'MARGIN');
        return marginBlock ? marginBlock.value : 0;
    });

    summaryFees = computed(() => {
        return this.activeBlocks()
            .filter(b => b.type === 'FEE' || b.type === 'SHIPPING')
            .map(b => `${b.label}: ${b.basis === 'FIXED' ? '$' + b.value : b.value + '%'}`)
            .join(', ');
    });

    summaryRounding = computed(() => {
        return this.roundingRule().replace(/_/g, ' ');
    });

    close() {
        this.isOpen.set(false);
    }

    async runBatchSimulation() {
        this.isSimulating.set(true);
        this.report.set(null);
        this.progress.set(10);

        // 1. Fetch Products (Mocking the query for now as we verify ProductService)
        // In real implementation: await this.productService.getProducts({ brand: this.selectedBrand() ... })
        // We'll simulate fetching 100 random products for the "Wow" factor demo

        await this.simulateDelay(1000); // Simulate network
        this.progress.set(30);

        const mockProducts = this.generateMockProducts(50);
        this.progress.set(50);

        let totalRevDelta = 0;
        let totalProfitDelta = 0;
        let totalMarginDelta = 0;

        // 2. Process each product
        mockProducts.forEach(prod => {
            // Calculate OLD price (current)
            const oldPrice = prod.price;
            const oldMargin = (prod.price - prod.costPrice!) / prod.price;

            // Calculate NEW price (using our stack)
            // Apply stack logic to product's COG
            const simulatedStack = this.stackService.calculateForward(prod.costPrice!, this.activeBlocks());
            const rawNewPrice = simulatedStack[simulatedStack.length - 1].subtotalAfter || 0;

            // Apply Rounding
            const roundedNewPrice = this.roundingService.applyRounding(rawNewPrice, this.roundingRule());

            const newMargin = (roundedNewPrice - prod.costPrice!) / roundedNewPrice;

            // Assume 1 unit sales per month for simplicity of "Impact"
            totalRevDelta += (roundedNewPrice - oldPrice);
            totalProfitDelta += ((roundedNewPrice - prod.costPrice!) - (oldPrice - prod.costPrice!));
            totalMarginDelta += (newMargin - oldMargin);
        });

        this.progress.set(100);
        await this.simulateDelay(500);

        this.report.set({
            productsAnalyzed: mockProducts.length,
            totalRevenueDelta: totalRevDelta * 12, // Annualized (assuming 1 unit/mo)
            totalProfitDelta: totalProfitDelta * 12,
            avgMarginDelta: (totalMarginDelta / mockProducts.length)
        });

        this.isSimulating.set(false);
    }

    private generateMockProducts(count: number): Product[] {
        return Array.from({ length: count }).map((_, i) => ({
            id: `p_${i}`,
            name: { es: `Product ${i}`, en: `Product ${i}` },
            price: 150 + Math.random() * 200, // Current Retail
            costPrice: 100 + Math.random() * 100, // COG
            brand: this.selectedBrand() === 'ALL' ? 'Michelin' : this.selectedBrand(),
            category: 'Sport'
        } as any));
    }

    private simulateDelay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
