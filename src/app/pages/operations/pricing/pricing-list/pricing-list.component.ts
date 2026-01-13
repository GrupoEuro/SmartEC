import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ColGroupDef, GridOptions, GridReadyEvent, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { firstValueFrom } from 'rxjs';
import { PricingCalculatorService } from '../../../../core/services/pricing-calculator.service';
import { ProductService } from '../../../../core/services/product.service';
import { Product } from '../../../../core/models/product.model';
import { MarginTargets, ChannelPrice } from '../../../../core/models/pricing.model';
import { PricingRulesManagerComponent } from '../pricing-rules-manager/pricing-rules-manager.component';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { PricingRule } from '../../../../core/models/pricing-rules.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';

interface PriceGridRow {
    sku: string;
    name: string;
    brand: string;
    cog: number;
    weight: number;

    // Calculated
    targetNetMargin: number;
    amazonPrice: number;
    amazonProfit: number;
    meliPrice: number;
    meliProfit: number;

    // Metadata for references
    productId: string;
    dimensions: any;
    ruleApplied?: string; // Name of the rule applied, if any
}

@Component({
    selector: 'app-pricing-list',
    standalone: true,
    imports: [CommonModule, AgGridAngular, PricingRulesManagerComponent, AppIconComponent, TranslateModule],
    templateUrl: './pricing-list.component.html',
    styleUrls: ['./pricing-list.component.css']
})
export class PricingListComponent {
    private pricingCalculator = inject(PricingCalculatorService);
    private rulesService = inject(PricingRulesService);
    private productService = inject(ProductService);

    // Grid State
    loading = signal(true);
    showRulesManager = signal(false); // Modal state
    rowData = signal<PriceGridRow[]>([]);

    // Default Margins for Calculation (can be global defaults)
    defaultMargins: MarginTargets = {
        targetGrossMargin: 50,
        targetNetMargin: 20,
        minAcceptableMargin: 12
    };

    // AG Grid Configuration
    columnDefs: (ColDef | ColGroupDef)[] = [
        { field: 'sku', headerName: 'SKU', pinned: 'left', width: 120, filter: true },
        { field: 'name', headerName: 'Product Name', width: 250, filter: true },
        { field: 'brand', headerName: 'Brand', width: 120, filter: true },

        // Costs
        {
            field: 'cog',
            headerName: 'COG',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => '$' + (params.value as number).toFixed(2),
            editable: true,
            cellEditor: 'agNumberCellEditor'
        },
        { field: 'weight', headerName: 'Weight (kg)', width: 100 },

        // Amazon FBA
        {
            headerName: 'Amazon FBA',
            children: [
                {
                    field: 'amazonPrice',
                    headerName: 'Price',
                    width: 110,
                    cellStyle: { 'background-color': 'rgba(167, 139, 250, 0.1)' },
                    valueFormatter: (params: ValueFormatterParams) => '$' + (params.value as number).toFixed(2)
                },
                {
                    field: 'amazonProfit',
                    headerName: 'Net Profit',
                    width: 110,
                    valueFormatter: (params: ValueFormatterParams) => '$' + (params.value as number).toFixed(2),
                    cellClassRules: {
                        'text-green-500': (params: CellClassParams) => (params.value as number) > 0,
                        'text-red-500': (params: CellClassParams) => (params.value as number) <= 0
                    }
                }
            ]
        },

        // MercadoLibre
        {
            headerName: 'MercadoLibre',
            children: [
                {
                    field: 'meliPrice',
                    headerName: 'Price',
                    width: 110,
                    cellStyle: { 'background-color': 'rgba(251, 191, 36, 0.1)' },
                    valueFormatter: (params: ValueFormatterParams) => '$' + (params.value as number).toFixed(2)
                },
                {
                    field: 'meliProfit',
                    headerName: 'Net Profit',
                    width: 110,
                    valueFormatter: (params: ValueFormatterParams) => '$' + (params.value as number).toFixed(2),
                    cellClassRules: {
                        'text-green-500': (params: CellClassParams) => (params.value as number) > 0,
                        'text-red-500': (params: CellClassParams) => (params.value as number) <= 0
                    }
                }
            ]
        }
    ];

    defaultColDef: ColDef = {
        sortable: true,
        resizable: true
    };

    async ngOnInit() {
        await this.loadProducts();
    }

    async loadProducts() {
        this.loading.set(true);
        try {
            // 0. Fetch Rules (sorted by priority)
            const rules = await this.rulesService.getRules();

            // 1. Fetch all products (Convert Observable to Promise)
            const products = await firstValueFrom(this.productService.getProducts());

            // 2. Calculate prices for each (Parallelized)
            const rows = await Promise.all(products.map(async (p: Product) => {

                // --- Rule Engine Logic ---
                const applicableRule = this.rulesService.getApplicableRule(p, rules);
                let prices: { [key: string]: ChannelPrice } = {};

                if (applicableRule) {
                    // Apply Rule
                    if (applicableRule.action === 'MULTIPLIER') {
                        // Multiplier Logic (Price = Cost * Value)
                        const targetPrice = (p.cog || 0) * applicableRule.value;
                        const amazonPrice = await this.pricingCalculator.calculateFixedChannelPrice(p, 'AMAZON_FBA', targetPrice);
                        const meliPrice = await this.pricingCalculator.calculateFixedChannelPrice(p, 'MELI_FULL', targetPrice);
                        prices = { 'AMAZON_FBA': amazonPrice, 'MELI_FULL': meliPrice };
                    } else {
                        // SET_MARGIN Logic
                        const customMargins: MarginTargets = {
                            ...this.defaultMargins,
                            targetNetMargin: applicableRule.value
                        };
                        prices = await this.pricingCalculator.generateMultiChannelPrices(p, customMargins);
                    }
                } else {
                    // Default Logic
                    prices = await this.pricingCalculator.generateMultiChannelPrices(p, this.defaultMargins);
                }
                // -------------------------

                return {
                    sku: p.sku,
                    name: p.name.en || p.name.es || 'Unknown',
                    brand: p.brand || 'Generic',
                    cog: p.cog || 0,
                    weight: p.weight || 0,
                    targetNetMargin: applicableRule ? applicableRule.value : this.defaultMargins.targetNetMargin,
                    productId: p.id!,
                    dimensions: p.dimensions,
                    ruleApplied: applicableRule ? applicableRule.name : undefined, // Track rule name

                    // Extracted Channel Data
                    amazonPrice: prices['AMAZON_FBA']?.sellingPrice || 0,
                    amazonProfit: prices['AMAZON_FBA']?.netProfit || 0,
                    meliPrice: prices['MELI_FULL']?.sellingPrice || 0,
                    meliProfit: prices['MELI_FULL']?.netProfit || 0
                } as PriceGridRow;
            }));

            this.rowData.set(rows);

        } catch (error) {
            console.error('Error loading pricing grid:', error);
        } finally {
            this.loading.set(false);
        }
    }

    async onCellValueChanged(event: any) {
        if (event.colDef.field === 'cog') {
            const newCog = Number(event.newValue);
            const productRow = event.data as PriceGridRow;

            // 1. Optimistic Update (Calculate immediately)
            // Create a temporary product object with the new COG
            const tempProduct: Product = {
                id: productRow.productId,
                sku: productRow.sku,
                name: { en: productRow.name, es: productRow.name }, // Mock name for calculator
                brand: productRow.brand,
                cog: newCog,
                weight: productRow.weight,
                dimensions: productRow.dimensions,
                // Add other required fields with defaults if necessary
            } as any;

            try {
                // Returns { AMAZON_FBA: ..., MELI_FULL: ... }
                const prices = await this.pricingCalculator.generateMultiChannelPrices(tempProduct, this.defaultMargins);

                // Update the row data with new calculated values
                const updatedRow: PriceGridRow = {
                    ...productRow,
                    cog: newCog,
                    amazonPrice: prices['AMAZON_FBA']?.sellingPrice || 0,
                    amazonProfit: prices['AMAZON_FBA']?.netProfit || 0,
                    meliPrice: prices['MELI_FULL']?.sellingPrice || 0,
                    meliProfit: prices['MELI_FULL']?.netProfit || 0
                };

                // Apply update to grid
                event.node.setData(updatedRow);

                // 2. Persist to Backend
                await this.productService.updateProduct(productRow.productId, { cog: newCog } as any);
                console.log(`Updated product ${productRow.sku} COG to ${newCog}`);

            } catch (error) {
                console.error('Error updating product COG:', error);
                // Revert change if failed (optional, but good UX)
                event.node.setData(productRow);
            }
        }
    }

    openRulesManager() {
        this.showRulesManager.set(true);
    }
}
