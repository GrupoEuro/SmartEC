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
import { AdminLogService } from '../../../../core/services/admin-log.service';
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
import { SettingsService } from '../../../../core/services/settings.service';
import { ApprovalWorkflowService } from '../../../../core/services/approval-workflow.service';
import { ToastService } from '../../../../core/services/toast.service';

interface PriceGridRow {
    sku: string;
    name: string;
    brand: string;
    categoryName: string;
    categoryId?: string;
    weight: number;

    // Baseline Costs (Editable)
    cog: number;
    inboundShipping: number;
    storageCost: number;
    packaging: number;

    // Strategy Margins (Editable)
    targetNetMargin: number;
    minAcceptableMargin: number;

    // Web Builder (Editable)
    webShipping: number;
    webCcFeePercent: number;
    webMaxDiscountPercent: number;

    // Meli Builder (Editable)
    meliCommissionPercent: number;
    meliShipping: number;
    meliFixedFee: number;

    // Amazon Builder (Editable)
    amazonReferralPercent: number;
    amazonFbaFee: number;

    // Calculated Prices per Channel
    calculatedWebPrice?: number;
    calculatedMeliPrice?: number;
    calculatedAmazonPrice?: number;
    [key: string]: any;

    // Metadata
    productId: string;
    dimensions: any;
    strategyId?: string;
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
    private settingsService = inject(SettingsService);
    private approvalWorkflow = inject(ApprovalWorkflowService);
    private adminLog = inject(AdminLogService);
    private toast = inject(ToastService);

    // Grid State
    loading = signal(true);
    showRulesManager = signal(false);
    showColumnMenu = signal(false); // Toggle for Column Menu
    showBulkEditModal = signal(false); // Toggle for Bulk Edit
    bulkEditField = signal<string>('meliCommissionPercent');
    bulkEditValue = signal<number>(0);
    bulkEditProcessing = signal(false);
    bulkEditProgress = signal(0);
    bulkEditTotal = signal(0);
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

    togglableColumns = computed(() => [
        { id: 'Base Costs', label: 'Base Costs', isGroup: true, visible: true },
        { id: 'Strategy Targets', label: 'Strategy Targets', isGroup: true, visible: true },
        { id: 'Web Builder', label: 'Web Store Builder', isGroup: true, visible: true },
        { id: 'Meli Builder', label: 'Mercado Libre Builder', isGroup: true, visible: true },
        { id: 'Amazon Builder', label: 'Amazon Builder', isGroup: true, visible: false } // Hidden by default
    ]);

    // Data Signals
    masterData = signal<PriceGridRow[]>([]);
    categories = signal<Category[]>([]);
    selectedCategory = signal<string>('all');

    // Bulk Edit Editable Fields
    editableFields = [
        { id: 'cog', label: 'COG (Base Cost)' },
        { id: 'inboundShipping', label: 'Inbound Freight' },
        { id: 'storageCost', label: 'Storage Cost' },
        { id: 'packaging', label: 'Packaging / Labeling' },
        { id: 'targetNetMargin', label: 'Target Net Margin %' },
        { id: 'minAcceptableMargin', label: 'Min Floor Margin %' },
        { id: 'webShipping', label: 'Web Outbound Shipping' },
        { id: 'webCcFeePercent', label: 'Web Gateway Fee %' },
        { id: 'webMaxDiscountPercent', label: 'Web Max Discount %' },
        { id: 'meliCommissionPercent', label: 'Meli Commission %' },
        { id: 'meliShipping', label: 'Meli Shipping' },
        { id: 'meliFixedFee', label: 'Meli Fixed Fee' },
        { id: 'amazonReferralPercent', label: 'Amazon Referral %' },
        { id: 'amazonFbaFee', label: 'Amazon FBA Fee' }
    ];

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
            { field: 'categoryName', headerName: 'Category', width: 120 },

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
                        cellClass: 'editable-cell text-right text-slate-300 font-mono'
                    },
                    {
                        field: 'inboundShipping',
                        headerName: 'Inbound',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-slate-400 font-mono'
                    },
                    {
                        field: 'storageCost',
                        headerName: 'Storage',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-slate-400 font-mono'
                    },
                    {
                        field: 'packaging',
                        headerName: 'Pack/Label',
                        width: 90,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-slate-400 font-mono'
                    },
                    {
                        headerName: 'Total Base Cost',
                        valueGetter: p => ((p.data.cog || 0) + (p.data.inboundShipping || 0) + (p.data.storageCost || 0) + (p.data.packaging || 0)),
                        width: 120,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'text-right font-bold text-white bg-slate-800/50 font-mono border-r border-slate-700'
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
                        width: 100,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right font-mono text-emerald-400'
                    },
                    {
                        field: 'minAcceptableMargin',
                        headerName: 'Min Floor %',
                        width: 100,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right font-mono text-amber-400 border-r border-slate-700'
                    }
                ]
            },

            // Web Store Builder
            {
                headerName: 'Web Builder',
                children: [
                    {
                        field: 'webShipping',
                        headerName: 'Outbound Ship',
                        width: 110,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-indigo-300 font-mono'
                    },
                    {
                        field: 'webCcFeePercent',
                        headerName: 'Gateway Fee %',
                        width: 110,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right text-indigo-300 font-mono'
                    },
                    {
                        field: 'webMaxDiscountPercent',
                        headerName: 'Max Discount %',
                        width: 120,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right text-indigo-300 font-mono'
                    },
                    {
                        field: 'calculatedWebPrice',
                        headerName: 'Web Price',
                        width: 120,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'text-right font-bold text-indigo-400 bg-indigo-900/20 font-mono border-r border-slate-700'
                    }
                ]
            },

            // Mercado Libre Builder
            {
                headerName: 'Meli Builder',
                children: [
                    {
                        field: 'meliCommissionPercent',
                        headerName: 'Commission %',
                        width: 110,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right text-yellow-300 font-mono'
                    },
                    {
                        field: 'meliShipping',
                        headerName: 'Meli Ship',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-yellow-300 font-mono'
                    },
                    {
                        field: 'meliFixedFee',
                        headerName: 'Fixed Fee',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-yellow-300 font-mono'
                    },
                    {
                        field: 'calculatedMeliPrice',
                        headerName: 'Meli Price',
                        width: 120,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'text-right font-bold text-yellow-400 bg-yellow-900/20 font-mono border-r border-slate-700'
                    }
                ]
            },

            // Amazon Builder
            {
                headerName: 'Amazon Builder',
                children: [
                    {
                        field: 'amazonReferralPercent',
                        headerName: 'Referral %',
                        width: 100,
                        editable: true,
                        valueFormatter: p => (p.value || 0) + '%',
                        cellClass: 'editable-cell text-right text-orange-300 font-mono'
                    },
                    {
                        field: 'amazonFbaFee',
                        headerName: 'FBA Fee',
                        width: 100,
                        editable: true,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'editable-cell text-right text-orange-300 font-mono'
                    },
                    {
                        field: 'calculatedAmazonPrice',
                        headerName: 'Amazon Price',
                        width: 120,
                        valueFormatter: p => '$' + (p.value || 0).toFixed(2),
                        cellClass: 'text-right font-bold text-orange-400 bg-orange-900/20 font-mono border-r border-slate-700'
                    }
                ]
            }
        ];

        return cols;
    }

    async loadProducts() {
        this.loading.set(true);
        try {
            // Ensure settings are loaded so settings$ emits
            await this.settingsService.loadSettings();

            // Load Dependencies
            const [rules, products, categories, globalSettings] = await Promise.all([
                this.rulesService.getRules(),
                firstValueFrom(this.productService.getProducts()),
                firstValueFrom(this.categoryService.getCategories()),
                firstValueFrom(this.settingsService.settings$)
            ]) as [PricingRule[], Product[], Category[], any];

            const globalDefaults = globalSettings?.pricing?.globalDefaults || {
                targetNetMargin: 20, minAcceptableMargin: 12,
                webShipping: 150, webCcFeePercent: 3.6, webMaxDiscountPercent: 10,
                meliCommissionPercent: 15, meliShipping: 200, meliFixedFee: 25,
                amazonReferralPercent: 15, amazonFbaFee: 180
            };

            this.categories.set(categories);

            // Map Categories for lookup
            const catMap = new Map<string, string>(categories.map(c => [c.id!, c.name.es]));

            // Process Rows
            const rows = await Promise.all(products.map(async (p: Product) => {
                // Fetch existing strategy
                const strategy = await this.pricingCalculator.getPricingStrategy(p.id!);
                const strat = strategy as any;

                // Prioritize Strategy > Product > Default
                const cog = strat?.cog ?? p.cog ?? 0;
                const inbound = strat?.inboundShipping ?? 0;
                const packaging = strat?.packagingCost ?? 0;

                // 1. Base Costs
                const storageCost = strat?.storageCost ?? 0; // assuming exists, or 0
                const targetMargin = strat?.targetNetMargin ?? globalDefaults.targetNetMargin;
                const minMargin = strat?.minAcceptableMargin ?? globalDefaults.minAcceptableMargin;

                const baseCost = cog + inbound + storageCost + packaging;

                // Global Defaults for Channel Modifiers
                const webShipping = strat?.webShipping ?? globalDefaults.webShipping;
                const webCcFeePercent = strat?.webCcFeePercent ?? globalDefaults.webCcFeePercent;
                const webMaxDiscountPercent = strat?.webMaxDiscountPercent ?? globalDefaults.webMaxDiscountPercent;

                const meliCommissionPercent = strat?.meliCommissionPercent ?? globalDefaults.meliCommissionPercent;
                const meliShipping = strat?.meliShipping ?? globalDefaults.meliShipping;
                const meliFixedFee = strat?.meliFixedFee ?? globalDefaults.meliFixedFee;

                const amazonReferralPercent = strat?.amazonReferralPercent ?? globalDefaults.amazonReferralPercent;
                const amazonFbaFee = strat?.amazonFbaFee ?? globalDefaults.amazonFbaFee;

                // The Price Construction Algorithm
                // Selling Price = (Total Base Cost + Fixed Fees + Outbound Shipping) / (1 - Target Net Margin % - Channel Commission % - Payment Gateway % - Max Allowed Discount %)
                
                // Helper to prevent division by zero or negative margin errors
                const safeDiv = (num: number, den: number) => den <= 0 ? 0 : num / den;

                const calculatedWebPrice = safeDiv(
                    (baseCost + webShipping),
                    (1 - (targetMargin / 100) - (webCcFeePercent / 100) - (webMaxDiscountPercent / 100))
                );

                const calculatedMeliPrice = safeDiv(
                    (baseCost + meliShipping + meliFixedFee),
                    (1 - (targetMargin / 100) - (meliCommissionPercent / 100))
                );

                const calculatedAmazonPrice = safeDiv(
                    (baseCost + amazonFbaFee),
                    (1 - (targetMargin / 100) - (amazonReferralPercent / 100))
                );

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

                    // Baseline
                    cog,
                    inboundShipping: inbound,
                    storageCost,
                    packaging,
                    targetNetMargin: targetMargin,
                    minAcceptableMargin: minMargin,

                    // Web Builder
                    webShipping,
                    webCcFeePercent,
                    webMaxDiscountPercent,
                    calculatedWebPrice,

                    // Meli Builder
                    meliCommissionPercent,
                    meliShipping,
                    meliFixedFee,
                    calculatedMeliPrice,

                    // Amazon Builder
                    amazonReferralPercent,
                    amazonFbaFee,
                    calculatedAmazonPrice
                };

                return row;
            }));

            this.masterData.set(rows); // Update signal

        } catch (error) {
            console.error('Error loading pricing grid:', error);
        } finally {
            this.loading.set(false);
        }
    }

    private isUpdatingCell = false;

    async onCellValueChanged(event: any) {
        if (this.isUpdatingCell) return;
        
        const row = event.data as PriceGridRow;
        const colId = event.colDef.field;

        // Start Optimistic Update
        this.isUpdatingCell = true;
        event.api.showLoadingOverlay();

        try {
            // 1. Recalculate Logic locally for instantaneous UI update
            const baseCost = (row.cog || 0) + (row.inboundShipping || 0) + (row.storageCost || 0) + (row.packaging || 0);
            const targetMargin = row.targetNetMargin || 0;
            
            const safeDiv = (num: number, den: number) => den <= 0 ? 0 : num / den;

            row.calculatedWebPrice = safeDiv(
                (baseCost + (row.webShipping || 0)),
                (1 - (targetMargin / 100) - ((row.webCcFeePercent || 0) / 100) - ((row.webMaxDiscountPercent || 0) / 100))
            );

            row.calculatedMeliPrice = safeDiv(
                (baseCost + (row.meliShipping || 0) + (row.meliFixedFee || 0)),
                (1 - (targetMargin / 100) - ((row.meliCommissionPercent || 0) / 100))
            );

            row.calculatedAmazonPrice = safeDiv(
                (baseCost + (row.amazonFbaFee || 0)),
                (1 - (targetMargin / 100) - ((row.amazonReferralPercent || 0) / 100))
            );

            // Update Grid Row
            event.node.setData({ ...row });

            // 2. Persist to Backend (Pricing Strategy)
            const strategyData = {
                productId: row.productId,
                sku: row.sku,
                
                // Baseline
                cog: row.cog,
                inboundShipping: row.inboundShipping,
                storageCost: row.storageCost,
                packagingCost: row.packaging,
                targetNetMargin: row.targetNetMargin,
                minAcceptableMargin: row.minAcceptableMargin,

                // Web
                webShipping: row.webShipping,
                webCcFeePercent: row.webCcFeePercent,
                webMaxDiscountPercent: row.webMaxDiscountPercent,

                // Meli
                meliCommissionPercent: row.meliCommissionPercent,
                meliShipping: row.meliShipping,
                meliFixedFee: row.meliFixedFee,

                // Amazon
                amazonReferralPercent: row.amazonReferralPercent,
                amazonFbaFee: row.amazonFbaFee
            };

            let requiresApproval = false;

            // Check COG change for approval
            if (colId === 'cog') {
                const oldCog = Number(event.oldValue) || 0;
                const newCog = Number(event.newValue) || 0;

                if (oldCog > 0 && newCog !== oldCog) {
                    const changePct = Math.abs(newCog - oldCog) / oldCog * 100;
                    const settings = await firstValueFrom(this.settingsService.settings$);
                    const threshold = settings?.approvals?.priceChangeThreshold || 15;

                    if (changePct >= threshold) {
                        requiresApproval = true;
                        
                        // Revert visually
                        event.node.setDataValue('cog', oldCog);
                        strategyData.cog = oldCog;

                        // Create approval request
                        await this.approvalWorkflow.createApprovalRequest(
                            'PRICE_CHANGE',
                            {
                                productId: row.productId,
                                productName: row.name,
                                sku: row.sku,
                                oldPrice: oldCog,
                                newPrice: newCog,
                                changePercentage: changePct,
                                field: 'cog'
                            },
                            `Cambio de COG de $${oldCog} a $${newCog} (${changePct.toFixed(2)}%) supera el umbral.`,
                            'HIGH'
                        );

                        this.toast.info('El cambio de costo supera el límite y fue enviado para aprobación.');
                    }
                }
            }

            if (row.strategyId) {
                await this.pricingCalculator.updatePricingStrategy(row.strategyId, strategyData);
            } else {
                const newId = await this.pricingCalculator.savePricingStrategy(strategyData as any);
                row.strategyId = newId;
                event.node.setData({ ...row });
            }

            // Also update Product COG for consistency everywhere
            if (colId === 'cog' && !requiresApproval) {
                await this.productService.updateProduct(row.productId, { cog: row.cog } as any);
            }

            // Write Audit Log
            if (!requiresApproval) {
                const oldValue = event.oldValue !== undefined && event.oldValue !== null ? event.oldValue : 'empty';
                const newValue = event.newValue;
                const fieldLabel = this.editableFields.find(f => f.id === colId)?.label || colId;
                
                await this.adminLog.log(
                    'UPDATE',
                    'PRICING',
                    `Cambio de ${fieldLabel} de ${oldValue} a ${newValue} en SKU ${row.sku}`,
                    row.productId
                );
            }

        } catch (error) {
            console.error('Error recalculating/saving:', error);
            this.toast.error('Error guardando los cambios.');
        } finally {
            this.isUpdatingCell = false;
            event.api.hideOverlay();
        }
    }

    async applyBulkEdit() {
        if (!this.gridApi) return;
        
        const field = this.bulkEditField();
        const value = Number(this.bulkEditValue());

        // Get all nodes currently visible after filtering
        const filteredNodes: any[] = [];
        this.gridApi.forEachNodeAfterFilter(node => {
            filteredNodes.push(node);
        });

        if (filteredNodes.length === 0) {
            this.toast.warning('No hay SKUs filtrados para actualizar.');
            return;
        }

        // Removed `confirm()` as it can block execution in some environments.
        // We will just proceed since there is a huge warning on the modal.
        this.bulkEditProcessing.set(true);
        this.bulkEditTotal.set(filteredNodes.length);
        this.bulkEditProgress.set(0);
        this.showBulkEditModal.set(false);

        // We process sequentially to prevent memory/firebase flooding, but we update UI instantly
        let i = 0;
        
        // Helper for math
        const safeDiv = (num: number, den: number) => den <= 0 ? 0 : num / den;

        // Analytics for Audit Log
        const oldValueFrequencies: Record<string, number> = {};

        for (const node of filteredNodes) {
            const row = { ...node.data } as PriceGridRow;
            
            // Track old value for logs
            const oldValRaw = (row as any)[field];
            const oldValString = oldValRaw !== undefined && oldValRaw !== null ? String(oldValRaw) : 'empty';
            oldValueFrequencies[oldValString] = (oldValueFrequencies[oldValString] || 0) + 1;

            // 1. Update the target field
            (row as any)[field] = value;

            // 2. Recalculate
            const baseCost = (row.cog || 0) + (row.inboundShipping || 0) + (row.storageCost || 0) + (row.packaging || 0);
            const targetMargin = row.targetNetMargin || 0;

            row.calculatedWebPrice = safeDiv(
                (baseCost + (row.webShipping || 0)),
                (1 - (targetMargin / 100) - ((row.webCcFeePercent || 0) / 100) - ((row.webMaxDiscountPercent || 0) / 100))
            );

            row.calculatedMeliPrice = safeDiv(
                (baseCost + (row.meliShipping || 0) + (row.meliFixedFee || 0)),
                (1 - (targetMargin / 100) - ((row.meliCommissionPercent || 0) / 100))
            );

            row.calculatedAmazonPrice = safeDiv(
                (baseCost + (row.amazonFbaFee || 0)),
                (1 - (targetMargin / 100) - ((row.amazonReferralPercent || 0) / 100))
            );

            // 3. Update Grid UI
            node.setData(row);

            // 4. Persist to DB (Awaited sequentially to prevent flooding)
            try {
                const strategyData = {
                    productId: row.productId,
                    sku: row.sku,
                    cog: row.cog,
                    inboundShipping: row.inboundShipping,
                    storageCost: row.storageCost,
                    packagingCost: row.packaging,
                    targetNetMargin: row.targetNetMargin,
                    minAcceptableMargin: row.minAcceptableMargin,
                    webShipping: row.webShipping,
                    webCcFeePercent: row.webCcFeePercent,
                    webMaxDiscountPercent: row.webMaxDiscountPercent,
                    meliCommissionPercent: row.meliCommissionPercent,
                    meliShipping: row.meliShipping,
                    meliFixedFee: row.meliFixedFee,
                    amazonReferralPercent: row.amazonReferralPercent,
                    amazonFbaFee: row.amazonFbaFee
                };

                if (row.strategyId) {
                    await this.pricingCalculator.updatePricingStrategy(row.strategyId, strategyData);
                } else {
                    const newId = await this.pricingCalculator.savePricingStrategy(strategyData as any);
                    row.strategyId = newId;
                    node.setData(row); // Update with new ID
                }

                // If COG was bulk edited, sync to Product catalog directly
                // (Intentionally skipping approval workflow for bulk edits to prevent 500 approval tickets)
                if (field === 'cog') {
                    await this.productService.updateProduct(row.productId, { cog: row.cog } as any);
                }

            } catch (err) {
                console.error(`Error saving bulk edit for ${row.sku}`, err);
            }
            
            i++;
            this.bulkEditProgress.set(i);
        }

        // Generate Old Value Analysis String
        const oldValuesSummary = Object.entries(oldValueFrequencies)
            .map(([val, count]) => `${val} (${count} SKUs)`)
            .join(', ');

        // Consolidated Bulk Audit Log
        const fieldLabel = this.editableFields.find(f => f.id === field)?.label || field;
        await this.adminLog.log(
            'UPDATE',
            'PRICING',
            `Aplicación masiva de valor ${value} a ${fieldLabel} en ${filteredNodes.length} SKUs. (Valores anteriores: ${oldValuesSummary})`
        );

        this.toast.success(`Se actualizaron ${filteredNodes.length} SKUs con éxito.`);
        this.bulkEditProcessing.set(false);
    }

    openRulesManager() {
        this.showRulesManager.set(true);
    }
}
