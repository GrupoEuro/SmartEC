import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ColGroupDef, GridOptions, GridReadyEvent, ValueFormatterParams, CellClassParams, NewValueParams } from 'ag-grid-community';
import { firstValueFrom } from 'rxjs';
import { PricingCalculatorService } from '../../../../core/services/pricing-calculator.service';
import { ProductService } from '../../../../core/services/product.service';
import { Product } from '../../../../core/models/product.model';
import { MarginTargets, ChannelPrice, SalesChannel, PricingStrategy } from '../../../../core/models/pricing.model';
import { PricingRulesManagerComponent } from '../pricing-rules-manager/pricing-rules-manager.component';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { PricingRule } from '../../../../core/models/pricing-rules.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';

interface PriceGridRow {
    sku: string;
    name: string;
    brand: string;
    weight: number;

    // Costs (Editable)
    cog: number;
    inboundShipping: number;
    packaging: number;

    // Margins (Editable)
    targetNetMargin: number;
    minAcceptableMargin: number;

    // Calculated Prices per Channel
    [key: string]: any; // Allow dynamic channel properties like 'AMAZON_FBA_price'

    // Metadata
    productId: string;
    dimensions: any;
    ruleApplied?: string;
    strategyId?: string; // ID of existing strategy document if any
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
    showRulesManager = signal(false);
    rowData = signal<PriceGridRow[]>([]);

    // Default Margins
    defaultMargins: MarginTargets = {
        targetGrossMargin: 50,
        targetNetMargin: 20,
        minAcceptableMargin: 12
    };

    // Sales Channels to Display
    displayChannels: { id: SalesChannel, name: string }[] = [
        { id: 'AMAZON_FBA', name: 'Amazon FBA' },
        { id: 'AMAZON_FBM', name: 'Amazon FBM' },
        { id: 'MELI_CLASSIC', name: 'MELI Classic' },
        { id: 'MELI_FULL', name: 'MELI Full' },
        { id: 'MELI_PREMIUM', name: 'MELI Premium' },
        { id: 'POS', name: 'POS' },
        { id: 'WEB', name: 'Web Store' }
    ];

    // AG Grid Configuration
    defaultColDef: ColDef = {
        sortable: true,
        resizable: true,
        filter: true
    };

    columnDefs = computed(() => this.generateColumnDefs());

    async ngOnInit() {
        await this.loadProducts();
    }

    generateColumnDefs(): (ColDef | ColGroupDef)[] {
        const cols: (ColDef | ColGroupDef)[] = [
            { field: 'sku', headerName: 'SKU', pinned: 'left', width: 120 },
            { field: 'name', headerName: 'Product', width: 250 },
            { field: 'brand', headerName: 'Brand', width: 100 },

            // Base Costs Group
            {
                headerName: 'Base Costs',
                children: [
                    {
                        field: 'cog',
                        headerName: 'COG',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell'
                    },
                    {
                        field: 'inboundShipping',
                        headerName: 'Inbound',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell'
                    },
                    {
                        field: 'packaging',
                        headerName: 'Pack/Label',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell'
                    }
                ]
            },

            // Strategy Group
            {
                headerName: 'Strategy Targets',
                children: [
                    {
                        field: 'targetNetMargin',
                        headerName: 'Target %',
                        width: 90,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell'
                    },
                    {
                        field: 'minAcceptableMargin',
                        headerName: 'Min %',
                        width: 90,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell'
                    }
                ]
            }
        ];

        // Dynamic Channel Columns
        this.displayChannels.forEach(ch => {
            cols.push({
                headerName: ch.name,
                children: [
                    {
                        field: `${ch.id}_price`,
                        headerName: 'Price',
                        width: 100,
                        valueFormatter: p => p.value ? '$' + p.value.toFixed(2) : '-',
                        cellStyle: { 'background-color': 'rgba(167, 139, 250, 0.05)' }
                    },
                    {
                        field: `${ch.id}_margin`,
                        headerName: 'Margin',
                        width: 80,
                        valueFormatter: p => p.value ? p.value.toFixed(1) + '%' : '-',
                        cellClassRules: {
                            'text-green-500': params => (params.value || 0) >= 20,
                            'text-yellow-500': params => (params.value || 0) < 20 && (params.value || 0) > 10,
                            'text-red-500': params => (params.value || 0) <= 10
                        }
                    }
                ]
            });
        });

        return cols;
    }

    async loadProducts() {
        this.loading.set(true);
        try {
            const rules = await this.rulesService.getRules();
            const products = await firstValueFrom(this.productService.getProducts());

            // Parallel fetch strategies for all items is expensive if direct one-by-one
            // But for now, let's do parallel as per plan
            const rows = await Promise.all(products.map(async (p: Product) => {
                // Fetch existing strategy
                const strategy = await this.pricingCalculator.getPricingStrategy(p.id!);

                // Prioritize Strategy > Product > Default
                const cog = strategy?.cog ?? p.cog ?? 0;
                const inbound = strategy?.inboundShipping ?? 0;
                const packaging = strategy?.packagingCost ?? 0;
                const targetMargin = strategy?.targetNetMargin ?? 20;
                const minMargin = strategy?.minAcceptableMargin ?? 12;

                // Calculate Prices
                const margins: MarginTargets = {
                    targetGrossMargin: 50, // Default fixed for now
                    targetNetMargin: targetMargin,
                    minAcceptableMargin: minMargin
                };

                const prices = await this.pricingCalculator.generateMultiChannelPrices({
                    ...p, cog, // Use overridden COG
                    weight: p.weight || 0,
                    dimensions: p.dimensions || { length: 0, width: 0, height: 0 }
                } as Product, margins);

                // Build Row
                const row: PriceGridRow = {
                    sku: p.sku,
                    name: p.name.es,
                    brand: p.brand || 'Generic',
                    weight: p.weight || 0,
                    productId: p.id!,
                    dimensions: p.dimensions,
                    strategyId: strategy?.id,

                    cog,
                    inboundShipping: inbound,
                    packaging,
                    targetNetMargin: targetMargin,
                    minAcceptableMargin: minMargin,
                };

                // Flatten prices into row
                this.displayChannels.forEach(ch => {
                    const priceData = prices[ch.id];
                    if (priceData) {
                        row[`${ch.id}_price`] = priceData.sellingPrice;
                        row[`${ch.id}_margin`] = priceData.netMargin;
                        row[`${ch.id}_profit`] = priceData.netProfit;
                    }
                });

                return row;
            }));

            this.rowData.set(rows);

        } catch (error) {
            console.error('Error loading pricing grid:', error);
        } finally {
            this.loading.set(false);
        }
    }

    async onCellValueChanged(event: any) {
        const row = event.data as PriceGridRow;
        const colId = event.colDef.field;
        const newValue = Number(event.newValue);

        // Fields that trigger recalculation
        const costFields = ['cog', 'inboundShipping', 'packaging'];
        const marginFields = ['targetNetMargin', 'minAcceptableMargin'];

        if (costFields.includes(colId) || marginFields.includes(colId)) {

            // 1. Recalculate Logic
            const tempProduct: any = {
                id: row.productId,
                sku: row.sku,
                brand: row.brand,
                cog: row.cog, // Uses update value from grid (event.data is already updated by grid)
                weight: row.weight,
                dimensions: row.dimensions,
                category: 'general' // Default
            };

            const margins: MarginTargets = {
                targetGrossMargin: 50,
                targetNetMargin: row.targetNetMargin,
                minAcceptableMargin: row.minAcceptableMargin
            };

            // Note: generateMultiChannelPrices currently relies on Product COG.
            // But we need to pass Inbound/Packaging. The service calculates breakdown inside.
            // Wait, calculateChannelPrice takes customCosts? Yes.
            // But generateMultiChannelPrices does NOT expose customCosts arg in its current signature.
            // We need to fix that or call individual calculations. 
            // Workaround: We will update logic to call calculateChannelPrice in loop here, 
            // OR update the service. (Updating service is out of scope for strict 'grid' task unless blocked).
            // Actually, looking at service: calculateChannelPrice takes customCosts.
            // generateMultiChannelPrices does NOT.
            // I will manually loop here to support custom costs.

            const customCosts = {
                inboundShipping: row.inboundShipping,
                packagingLabeling: row.packaging
            };

            const updatedRow = { ...row };

            // Start Optimistic Update
            event.api.showLoadingOverlay();

            try {
                // Recalculate all channels
                for (const ch of this.displayChannels) {
                    const price = await this.pricingCalculator.calculateChannelPrice(
                        tempProduct,
                        ch.id,
                        margins,
                        customCosts
                    );

                    updatedRow[`${ch.id}_price`] = price.sellingPrice;
                    updatedRow[`${ch.id}_margin`] = price.netMargin;
                    updatedRow[`${ch.id}_profit`] = price.netProfit;
                }

                // Update Grid
                event.node.setData(updatedRow);

                // 2. Persist to Backend (Pricing Strategy)
                const strategyData: Partial<PricingStrategy> = {
                    productId: row.productId,
                    sku: row.sku,
                    cog: row.cog,
                    inboundShipping: row.inboundShipping,
                    packagingCost: row.packaging,
                    targetNetMargin: row.targetNetMargin,
                    minAcceptableMargin: row.minAcceptableMargin,
                    // We should also save the calculated prices? 
                    // PricingStrategy model usually just stores inputs.
                    // PricingHistory stores calc snapshots.
                };

                if (row.strategyId) {
                    await this.pricingCalculator.updatePricingStrategy(row.strategyId, strategyData);
                } else {
                    const newId = await this.pricingCalculator.savePricingStrategy(strategyData as any);
                    updatedRow.strategyId = newId;
                    event.node.setData(updatedRow);
                }

                // Also update Product COG for consistency everywhere
                if (colId === 'cog') {
                    await this.productService.updateProduct(row.productId, { cog: row.cog } as any);
                }

                console.log('Strategy saved successfully');

            } catch (error) {
                console.error('Error recalculating/saving:', error);
            } finally {
                event.api.hideOverlay();
            }
        }
    }

    openRulesManager() {
        this.showRulesManager.set(true);
    }
}
