import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { PriceStackService } from '../../../../core/services/price-stack.service';
import { PricingRulesService } from '../../../../core/services/pricing-rules.service';
import { SalesSimulationService, SimulationResult } from '../../../../core/services/sales-simulation.service';
import { RoundingService, RoundingRuleType } from '../../../../core/services/rounding.service';
import { CompetitorService } from '../../../../core/services/competitor.service';
import { CompetitorPrice } from '../../../../core/models/competitor.model';
import { PriceBlock } from '../../../../core/models/price-constructor.model';
import { PricingTemplate, PriceBlockTemplate } from '../../../../core/models/pricing-template.model';
import { Product } from '../../../../core/models/product.model';
import { BatchSimulationModalComponent } from './components/batch-simulation-modal/batch-simulation-modal.component';

@Component({
  selector: 'app-smart-price-constructor',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, AppIconComponent, BatchSimulationModalComponent],
  templateUrl: './smart-price-constructor.component.html',
  styleUrls: ['./smart-price-constructor.component.css']
})
export class SmartPriceConstructorComponent {

  // Services
  private stackService = inject(PriceStackService);
  private simulationService = inject(SalesSimulationService);
  private rulesService = inject(PricingRulesService);
  private roundingService = inject(RoundingService);
  private competitorService = inject(CompetitorService);

  // Core State
  activeBlocks = signal<PriceBlock[]>([]);
  startValue = signal<number>(100); // Default COG
  channel = signal<string>('AMAZON_FBA');

  // Intelligence State
  roundingRulesOptions: RoundingRuleType[] = [
    'NONE',
    'MXN_RETAIL_90',
    'MXN_DISCOUNT_99',
    'MXN_CASH_50',
    'MXN_LUXURY_00',
    'NEAREST_5'
  ];
  roundingRule = signal<RoundingRuleType>('NONE');

  // Competitor Intelligence
  competitorPrices = signal<CompetitorPrice[]>([]);
  competitorPrice = computed(() => { // The reference price (lowest)
    const prices = this.competitorPrices();
    if (prices.length === 0) return null;
    return Math.min(...prices.map(p => p.price));
  });
  isLoadingCompetitors = signal(false);

  @ViewChild(BatchSimulationModalComponent) batchModal!: BatchSimulationModalComponent;

  // Simulation State
  isSimulationPanelOpen = signal(true);
  simPeriodMonths = signal(12);
  simMonthlyVolume = signal(100);
  simResult = signal<SimulationResult | null>(null);

  // Calculated State
  finalPrice = computed(() => {
    const blocks = this.activeBlocks();
    if (blocks.length === 0) return this.startValue();
    return blocks[blocks.length - 1].subtotalAfter || 0;
  });

  // --- MULTI-CHANNEL / SPLIT VIEW STATE ---
  isSplitView = signal(false);
  activeBlocksB = signal<PriceBlock[]>([]);
  channelB = signal<string>('SHOPIFY');

  // Stack B Metrics
  finalPriceB = computed(() => {
    const blocks = this.activeBlocksB();
    if (blocks.length === 0) return this.startValue(); // Assuming same start value (COG)
    return blocks[blocks.length - 1].subtotalAfter || 0;
  });

  netMarginB = computed(() => {
    const price = this.finalPriceB();
    if (price <= 0) return 0;
    // Simplified Profit B Logic
    const totalCosts = this.activeBlocksB().reduce((acc, b) => {
      if (['COST', 'FEE', 'TAX', 'SHIPPING'].includes(b.type)) return acc + (b.calculatedAmount || 0);
      return acc;
    }, 0);
    return (price - totalCosts) / price;
  });

  netProfitB = computed(() => {
    return this.finalPriceB() * this.netMarginB();
  });

  // DELTAS (A vs B)
  // Positive Delta = A is greater than B
  priceDelta = computed(() => this.finalPrice() - this.finalPriceB());
  profitDelta = computed(() => this.netProfit() - this.netProfitB());

  toggleSplitView() {
    this.isSplitView.update(v => !v);
    if (this.isSplitView() && this.activeBlocksB().length === 0) {
      // Auto-load secondary channel if empty
      this.loadTemplateB();
    }
  }

  async loadTemplateB() {
    try {
      // If we have simulation templates or just defaults?
      // Re-using stack service logic
      const templates = await this.stackService.getChannelTemplates(this.channelB());
      // Sync Start Value
      const updated = this.stackService.calculateForward(this.startValue(), templates);
      this.activeBlocksB.set(updated);
    } catch (e) {
      console.warn('Failed to load Stack B', e);
    }
  }

  async setChannelB(ch: string) {
    this.channelB.set(ch);
    await this.loadTemplateB();
  }

  copyStackToB() {
    // Deep copy Stack A -> Stack B
    const clone = JSON.parse(JSON.stringify(this.activeBlocks()));
    // Re-calculate to ensure B's context (if we had different start values, but we share them now)
    const recalculated = this.stackService.calculateForward(this.startValue(), clone);
    this.activeBlocksB.set(recalculated);
  }

  // Reverse Calculation State
  isPriceLocked = signal(false);
  targetPrice = signal<number | null>(null);

  togglePriceLock() {
    this.isPriceLocked.update(v => !v);
    if (this.isPriceLocked()) {
      // Initialize target with current price
      this.targetPrice.set(this.roundedPrice());
    }
  }

  updateTargetPrice(val: number) {
    this.targetPrice.set(val);
    this.recalculateFromTarget();
  }

  recalculateFromTarget() {
    const target = this.targetPrice();
    if (!target || !this.isPriceLocked()) return;

    // FIND MARGIN BLOCK (The variable we solve for)
    const marginIndex = this.activeBlocks().findIndex(b => b.type === 'MARGIN');
    if (marginIndex === -1) {
      console.warn('No Margin block found to adjust.');
      return;
    }

    // ALGEBRAIC SOLVER
    // Goal: Find Margin % such that CalculateForward(Margin %) ~= Target

    // 1. Estimate Taxes & Net Revenue
    // Assuming TAX is the last block and is % OF BAS (Standard VAT logic)
    const taxBlock = this.activeBlocks().find(b => b.type === 'TAX');
    let taxRate = 0;
    if (taxBlock) {
      taxRate = taxBlock.value / 100;
    }
    // Net Price (before Tax) = Target / (1 + Tax)
    const netPrice = target / (1 + taxRate);

    // 2. Sum Cost & Fees
    let totalHardCosts = 0;

    this.activeBlocks().forEach(b => {
      if (b.type === 'MARGIN' || b.type === 'TAX') return; // Skip Margin (solving for it) and Tax (handled above)

      let amount = 0;
      // Cost
      if (b.type === 'COST') amount = b.value;

      // Fees
      // Simplification: We assume Percentage Fees are based on TOTAL (Target)
      if (b.basis === 'FIXED') amount = b.value;
      if (b.basis === 'PERCENT_OF_TOTAL') amount = target * (b.value / 100);
      if (b.basis === 'PERCENT_OF_BASE') amount = netPrice * (b.value / 100); // Approximation

      // Tax on Fees (MX Logic)
      if (b.type === 'FEE') {
        amount = amount * 1.16; // Add IVA to the fee expense
      }

      totalHardCosts += amount;
    });

    // 3. Solve for Margin Amount
    // NetPrice = Costs + MarginAmount
    const requiredMarginAmount = netPrice - totalHardCosts;

    // 4. Convert to % OF TOTAL (Standard Basis)
    const newMarginPercent = (requiredMarginAmount / target) * 100;

    // 5. Update Block
    this.activeBlocks.update(blocks => {
      const newBlocks = [...blocks];
      newBlocks[marginIndex] = { ...newBlocks[marginIndex], value: newMarginPercent };
      return newBlocks;
    });

    // 6. Recalculate Forward to update all amounts exactly
    this.calculate();
  }

  roundedPrice = computed(() => {
    // If Locked, respect the Target Price exactly
    if (this.isPriceLocked()) {
      return this.targetPrice() || 0;
    }

    // Auto Mode: Apply Rounding
    const raw = this.finalPrice();
    return this.roundingService.applyRounding(raw, this.roundingRule());
  });

  roundingAdjustment = computed(() => {
    if (this.isPriceLocked()) return 0; // No ghost adjustment in manual mode
    return this.roundedPrice() - this.finalPrice();
  });

  isCompetitive = computed(() => {
    if (!this.competitorPrice()) return true; // No data = assume ok
    return this.roundedPrice() <= this.competitorPrice()!;
  });

  netMargin = computed(() => {
    const price = this.roundedPrice();
    if (price <= 0) return 0;

    // Total Cost = Sum of all blocks that are NOT Margin/Markup
    // Note: 'DISCOUNT' reduces the price, it's not a cost we pay out, but it reduces profit.
    // Actually, simpler: Profit = Price - (Sum of COST + FEE + TAX + SHIPPING)

    const totalCosts = this.activeBlocks().reduce((acc, b) => {
      if (['COST', 'FEE', 'TAX', 'SHIPPING'].includes(b.type)) {
        return acc + (b.calculatedAmount || 0);
      }
      return acc;
    }, 0);

    const profit = price - totalCosts;
    return profit / price;
  });

  netProfit = computed(() => {
    const price = this.roundedPrice();
    if (price <= 0) return 0;
    const margin = this.netMargin();
    return price * margin;
  });

  seasonalRules = signal<any[]>([]);

  constructor() {
    this.loadInitialTemplate();
    this.loadSeasonalRules();
  }

  async loadSeasonalRules() {
    const allRules = await this.rulesService.getRules();
    this.seasonalRules.set(allRules.filter(r => !!r.schedule));
  }

  trackBlockById(index: number, block: PriceBlock): string {
    return block.id;
  }

  async loadInitialTemplate() {
    // Load default template for the channel
    const templates = await this.stackService.getChannelTemplates(this.channel());
    // Safe-guard: Remove any 'cog' block if it exists (ref: User Request)
    this.activeBlocks.set(templates);
    this.calculate();
    // Auto-run simulation
    this.runSimulation();
  }

  calculate() {
    const blocks = this.stackService.calculateForward(this.startValue(), this.activeBlocks());
    this.activeBlocks.set(blocks);
    this.runSimulation();
  }

  updateStartValue(val: number) {
    this.startValue.set(val);

    // SYNC: Update the 'cog' block if present in the list
    this.activeBlocks.update(blocks => blocks.map(b => b.id === 'cog' ? { ...b, value: val } : b));

    // Propagate to Stack B
    if (this.isSplitView()) {
      this.activeBlocksB.update(blocks => blocks.map(b => b.id === 'cog' ? { ...b, value: val } : b));
      const pendingB = this.stackService.calculateForward(val, this.activeBlocksB());
      this.activeBlocksB.set(pendingB);
    }

    this.calculate();
  }

  setRoundingRule(rule: RoundingRuleType) {
    this.roundingRule.set(rule);
    // No recalculate activeBlocks, just computed property updates
  }

  fetchCompetitorPrices() {
    this.isLoadingCompetitors.set(true);
    // Mock product ID for now
    this.competitorService.getCompetitorPrices('prod_123').subscribe({
      next: (prices) => {
        this.competitorPrices.set(prices);
        this.isLoadingCompetitors.set(false);
      },
      error: () => this.isLoadingCompetitors.set(false)
    });
  }

  openBatchSimulation() {
    this.batchModal.open(this.activeBlocks(), this.roundingRule());
  }

  // --- ACTIONS ---

  runSimulation() {
    const mockProduct = {
      id: 'sim_prod', name: 'Smart Sim Product', costPrice: this.startValue(), price: this.roundedPrice()
    } as any;

    // Convert Blocks to Template format for service
    const currentBlocksAsTemplate: PriceBlockTemplate[] = this.activeBlocks().map(b => ({
      id: b.id, type: b.type, label: b.label, basis: b.basis, defaultValue: b.value, color: b.color
    } as any));

    // Add Rounding "Block" virtually?
    // The SimulationService doesn't know about rounding yet. 
    // We can simulate the RAW price for now, or hack a "Rounding Adjustment" block?
    // Let's stick to raw financials for now, maybe add rounding bias later.

    const tempTemplate: PricingTemplate = {
      name: 'Smart Draft', channel: 'GLOBAL', blocks: currentBlocksAsTemplate, isActive: true
    };

    const res = this.simulationService.simulate(
      mockProduct,
      tempTemplate,
      this.simPeriodMonths(),
      this.simMonthlyVolume(),
      this.startValue(),
      this.seasonalRules()
    );
    this.simResult.set(res);
  }

  // --- CONSTRUCTOR INTERACTION ---

  availableBlocks = signal<PriceBlock[]>([
    { id: 'discount', type: 'DISCOUNT', label: 'Discount', value: 10, basis: 'PERCENT_OF_TOTAL', color: 'purple', active: false, icon: 'percent' },
    { id: 'shipping', type: 'SHIPPING', label: 'Shipping', value: 150, basis: 'FIXED', color: 'blue', active: false, icon: 'local_shipping' },
    { id: 'warranty', type: 'FEE', label: 'Warranty Fee', value: 5, basis: 'PERCENT_OF_BASE', color: 'orange', active: false, icon: 'verified_user' },
    { id: 'packaging', type: 'COST', label: 'Packaging', value: 20, basis: 'FIXED', color: 'red', active: false, icon: 'inventory_2' }
  ]);

  showAddMenu = signal(false);

  toggleAddMenu() {
    this.showAddMenu.update(v => !v);
  }

  addBlock(template: PriceBlock) {
    const newBlock = {
      ...template,
      id: template.id + '_' + Date.now(), // Unique ID
      active: true
    };
    this.activeBlocks.update(blocks => [...blocks, newBlock]);
    this.showAddMenu.set(false);
    this.calculate();
  }

  removeBlock(index: number) {
    this.activeBlocks.update(blocks => blocks.filter((_, i) => i !== index));
    this.calculate();
  }

  drop(event: CdkDragDrop<PriceBlock[]>) {
    const currentBlocks = [...this.activeBlocks()];
    moveItemInArray(currentBlocks, event.previousIndex, event.currentIndex);
    this.activeBlocks.set(currentBlocks);
    this.calculate();
  }

  dropB(event: CdkDragDrop<PriceBlock[]>) {
    const currentBlocks = [...this.activeBlocksB()];
    moveItemInArray(currentBlocks, event.previousIndex, event.currentIndex);
    this.activeBlocksB.set(currentBlocks);
    const updated = this.stackService.calculateForward(this.startValue(), currentBlocks);
    this.activeBlocksB.set(updated);
  }

  updateBlockValueB(id: string, value: number) {
    this.activeBlocksB.update(blocks => blocks.map(b => b.id === id ? { ...b, value } : b));
    const updated = this.stackService.calculateForward(this.startValue(), this.activeBlocksB());
    this.activeBlocksB.set(updated);
  }

  addBlockB(template: PriceBlock) {
    const newBlock = { ...template, id: template.id + '_B_' + Date.now(), active: true };
    this.activeBlocksB.update(blocks => [...blocks, newBlock]);
    const updated = this.stackService.calculateForward(this.startValue(), this.activeBlocksB());
    this.activeBlocksB.set(updated);
  }

  removeBlockB(index: number) {
    this.activeBlocksB.update(blocks => blocks.filter((_, i) => i !== index));
    const updated = this.stackService.calculateForward(this.startValue(), this.activeBlocksB());
    this.activeBlocksB.set(updated);
  }

  updateBlockValue(id: string, value: number) {
    // SYNC: If user edits the 'cog' block in the list, update the sidebar startValue
    if (id === 'cog') {
      this.startValue.set(value);
    }
    this.activeBlocks.update(blocks => blocks.map(b => b.id === id ? { ...b, value } : b));
    this.calculate();
  }
}
