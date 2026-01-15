import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ColGroupDef, GridOptions, GridReadyEvent, ValueFormatterParams, CellClassParams, NewValueParams, GridApi } from 'ag-grid-community';
import { firstValueFrom } from 'rxjs';
// ... existing imports ...

// ... inside class ...

// ... existing imports ...
import { PricingCalculatorService } from '../../../../core/services/pricing-calculator.service';
import { ProductService } from '../../../../core/services/product.service';
import { CategoryService } from '../../../../core/services/category.service';
import { Product } from '../../../../core/models/product.model';
import { Category } from '../../../../core/models/catalog.model';
import { MarginTargets, ChannelPrice, SalesChannel, PricingStrategy } from '../../../../core/models/pricing.model';
import { PricingRulesManagerComponent } from '../pricing-rules-manager/pricing-rules-manager.component';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { PricingRule } from '../../../../core/models/pricing-rules.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { SparklineCellComponent } from './renderers/sparkline-cell/sparkline-cell.component'; // Import Sparkline

interface PriceGridRow {
    sku: string;
    name: string;
    brand: string;
    categoryName: string;
    categoryId?: string;
    weight: number;

    // Intelligence Data (New)
    velocity: number[]; // Array of daily sales numbers
    marketPrice: number;
    competitorName?: string;

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
    private categoryService = inject(CategoryService);

    // Grid State
    loading = signal(true);
    showRulesManager = signal(false);
    showColumnMenu = signal(false); // New: Toggle for Column Menu
    pagination = true;
    paginationPageSize = 20;

    private gridApi!: GridApi; // AG Grid API Reference

    // Column Visibility State (Default: All Visible)
    columnVisibility = signal({
        'market_intel': true,
        'base_costs': true,
        'strategy': true,
        'channels': true // Global toggle for channels? Or individual? Let's do individual in template
    });

    // Explicit list of togglable groups/columns for the UI
    togglableColumns = computed(() => [
        { id: 'velocity', label: '30d Trend', visible: true },
        { id: 'Market Intel', label: 'Market Intel', isGroup: true, visible: true },
        { id: 'Base Costs', label: 'Base Costs', isGroup: true, visible: true },
        { id: 'Strategy Targets', label: 'Strategy Targets', isGroup: true, visible: true },
        ...this.displayChannels.map(ch => ({
            id: ch.name, // Using Header Name as Group ID for channels
            label: ch.name,
            isGroup: true,
            visible: true
        }))
    ]);

    // Data Signals
    masterData = signal<PriceGridRow[]>([]);
    categories = signal<Category[]>([]);
    selectedCategory = signal<string>('all');

    // Derived State (Solves NG0600)
    rowData = computed(() => {
        const rows = this.masterData();
        const category = this.selectedCategory();

        if (category === 'all') return rows;
        return rows.filter(r => r.categoryId === category);
    });

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

    onGridReady(params: GridReadyEvent) {
        this.gridApi = params.api;
    }

    toggleColumnVisibility(id: string, isGroup: boolean) {
        if (!this.gridApi) return;

        if (isGroup) {
            // Toggle logic for groups (Base Costs, Strategy, etc.)
            const cols = this.gridApi.getColumns();
            if (cols) {
                const affectedCols = cols.filter(c => {
                    const parent = c.getParent();
                    return parent && parent.getColGroupDef()?.headerName === id;
                });

                const isVisible = affectedCols.length > 0 ? affectedCols[0].isVisible() : false;
                this.gridApi.setColumnsVisible(affectedCols, !isVisible);
            }
        } else {
            // Toggle Logic for Single Columns (Trend)
            const isVisible = this.gridApi.getColumn(id)?.isVisible();
            if (isVisible !== undefined) {
                this.gridApi.setColumnVisible(id, !isVisible);
            }
        }
    }

    generateColumnDefs(): (ColDef | ColGroupDef)[] {
        const cols: (ColDef | ColGroupDef)[] = [
            // Row Number
            {
                headerName: '#',
                valueGetter: 'node.rowIndex + 1',
                width: 50,
                pinned: 'left',
                sortable: false,
                filter: false
            },
            { field: 'sku', headerName: 'SKU', pinned: 'left', width: 120 },
            { field: 'name', headerName: 'Product', width: 250 },
            // Velocity Sparkline
            {
                field: 'velocity',
                headerName: '30d Trend',
                width: 120,
                cellRenderer: SparklineCellComponent,
                sortable: false
            },
            { field: 'categoryName', headerName: 'Category', width: 120 },

            // Market Intelligence Group
            {
                headerName: 'Market Intel',
                children: [
                    {
                        headerName: 'Comp. Price',
                        valueGetter: (params) => {
                            const row = params.data as PriceGridRow;
                            const delta = row.marketPrice - (row['WEB_price'] || 0); // Compare vs Web Price
                            return row.marketPrice;
                        },
                        width: 140, // Increased
                        cellRenderer: (params: any) => {
                            if (!params.value) return '-';
                            const row = params.data as PriceGridRow;
                            const myPrice = row['WEB_price'] || 0;
                            if (myPrice === 0) return `$${params.value.toFixed(2)}`;

                            const diff = params.value - myPrice;
                            const percent = (diff / myPrice) * 100;

                            // Logic: If Comp is HIGHER than us, we are cheaper (Good? Bad? depends on strategy).
                            // Usually: 
                            // Green = We are cheaper (Comp is higher)
                            // Red = We are more expensive (Comp is lower)
                            // Let's invert: Green = We are priced competitively (Equal or slightly lower). 
                            // Actually user spec says: "Competitor Delta"

                            const colorClass = diff > 0 ? 'text-emerald-400' : 'text-rose-400';
                            const sign = diff > 0 ? '+' : '';

                            // Added text-right alignment
                            return `<div class="flex flex-col leading-tight text-right w-full">
                                        <span>$${params.value.toFixed(2)}</span>
                                        <span class="text-xs ${colorClass} font-bold">${sign}${percent.toFixed(1)}%</span>
                                     </div>`;
                        }
                    }
                ]
            },

            // Base Costs Group
            {
                headerName: 'Base Costs',
                children: [
                    {
                        field: 'cog',
                        headerName: 'COG',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right'
                    },
                    {
                        field: 'inboundShipping',
                        headerName: 'Inbound',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right'
                    },
                    {
                        field: 'packaging',
                        headerName: 'Pack/Label',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right'
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
                        width: 110, // Increased
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        // MARGIN HEATMAP LOGIC
                        cellStyle: params => {
                            const val = params.value || 0;
                            // Add right-align to default style
                            const base = { textAlign: 'right', borderRight: '1px solid #334155' };
                            if (val < 15) return { ...base, backgroundColor: 'rgba(244, 63, 94, 0.15)', color: '#fda4af' }; // Red
                            if (val < 25) return { ...base, backgroundColor: 'rgba(251, 191, 36, 0.15)', color: '#fcd34d' }; // Amber
                            return { ...base, backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#86efac' }; // Green
                        }
                    },
                    {
                        field: 'minAcceptableMargin',
                        headerName: 'Min %',
                        width: 110, // Increased
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right'
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
                        width: 110,
                        valueFormatter: p => p.value ? '$' + p.value.toFixed(2) : '-',
                        cellStyle: { 'background-color': 'rgba(167, 139, 250, 0.05)', 'text-align': 'right' }
                    },
                    {
                        field: `${ch.id}_margin`,
                        headerName: 'Margin',
                        width: 90,
                        valueFormatter: p => p.value ? p.value.toFixed(1) + '%' : '-',
                        cellClassRules: {
                            'text-green-400 font-bold text-right': params => (params.value || 0) >= 20,
                            'text-amber-400 text-right': params => (params.value || 0) < 20 && (params.value || 0) > 10,
                            'text-rose-400 font-bold text-right': params => (params.value || 0) <= 10
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
            // Load Dependencies
            const [rules, products, categories] = await Promise.all([
                this.rulesService.getRules(),
                firstValueFrom(this.productService.getProducts()),
                firstValueFrom(this.categoryService.getCategories())
            ]) as [PricingRule[], Product[], Category[]];

            this.categories.set(categories);

            // Map Categories for lookup
            const catMap = new Map<string, string>(categories.map(c => [c.id!, c.name.es]));

            // Process Rows
            const rows = await Promise.all(products.map(async (p: Product) => {
                // Fetch existing strategy
                const strategy = await this.pricingCalculator.getPricingStrategy(p.id!);

                // Prioritize Strategy > Product > Default
                const cog = strategy?.cog ?? p.cog ?? 0;
                const inbound = strategy?.inboundShipping ?? 0;
                const packaging = strategy?.packagingCost ?? 0;
                const targetMargin = strategy?.targetNetMargin ?? 20;
                const minMargin = strategy?.minAcceptableMargin ?? 12;

                // --- MOCK INTELLIGENCE DATA GENERATOR ---
                // Velocity: 30 data points (random 0-5 per day)
                const velocity = Array.from({ length: 30 }, () => Math.floor(Math.random() * 4));
                // Add some spikes for realism
                if (Math.random() > 0.7) velocity[25] = 12;

                // Market Price: Drift from our calculated price
                // We need a base price to drift from. Let's use rough COG * 1.4
                const estimatedPrice = cog * 1.5;
                const drift = (Math.random() - 0.5) * 0.2; // +/- 10%
                const marketPrice = estimatedPrice * (1 + drift);
                // ----------------------------------------

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
                    categoryName: p.categoryId ? (catMap.get(p.categoryId) || 'Unknown') : 'Uncategorized',
                    categoryId: p.categoryId,
                    weight: p.weight || 0,
                    productId: p.id!,
                    dimensions: p.dimensions,
                    strategyId: strategy?.id,

                    // Intelligence
                    velocity,
                    marketPrice,
                    competitorName: Math.random() > 0.5 ? 'Amazon' : 'MercadoLibre',

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

            this.masterData.set(rows); // Update signal

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
