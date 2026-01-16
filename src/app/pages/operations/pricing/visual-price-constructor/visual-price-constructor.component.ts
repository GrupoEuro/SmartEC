import { Component, inject, signal, effect, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { PriceStackService } from '../../../../core/services/price-stack.service';
import { PriceBlock } from '../../../../core/models/price-constructor.model';
import { FINANCIAL_CONSTANTS } from '../../../../core/constants/financial.constants';
import { ProductService } from '../../../../core/services/product.service';
import { Product } from '../../../../core/models/catalog.model';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatrixComparatorComponent } from './matrix-comparator/matrix-comparator.component';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';

/**
 * TAILWIND CLASS SAFELIST
 * Necessary because we use dynamic class construction (e.g. 'bg-' + color + '-500')
 * 
 * bg-teal-500 text-teal-400
 * bg-rose-500 text-rose-400
 * bg-blue-500 text-blue-400
 * bg-orange-500 text-orange-400
 * bg-yellow-500 text-yellow-400
 * bg-purple-500 text-purple-400
 * bg-red-500 text-red-400
 * bg-emerald-500 text-emerald-400
 * bg-cyan-500 text-cyan-400
 */

@Component({
  // Trigger Rebuild v3
  selector: 'app-visual-price-constructor',
  standalone: true,
  imports: [CommonModule, DragDropModule, FormsModule, AppIconComponent, TranslateModule, MatrixComparatorComponent, BaseChartDirective],
  templateUrl: './visual-price-constructor.component.html',
  styleUrls: ['./visual-price-constructor.component.css']
})
export class VisualPriceConstructorComponent {
  private stackService = inject(PriceStackService);
  private productService = inject(ProductService);
  private translate = inject(TranslateService);

  // Context & Search
  private searchTerms = new Subject<string>();
  searchResults = toSignal(
    this.searchTerms.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((term) => term.length >= 2 ? this.productService.searchProducts(term) : of([]))
    ),
    { initialValue: [] }
  );
  selectedProduct = signal<Product | null>(null);

  // State
  mode = signal<'FORWARD' | 'INVERSE'>('FORWARD');
  channel = signal<string>('MANUAL');
  showChart = signal<boolean>(false);

  // Core Values
  startValue = signal<number>(100); // COG or Target Price

  // Blocks
  activeBlocks = signal<PriceBlock[]>([]);

  // Available "Library" of blocks (Drag source or click to add)
  availableBlocks = signal<PriceBlock[]>([
    { id: 'discount', type: 'DISCOUNT', label: 'PRICING_STRATEGY.BLOCKS.DISCOUNT', value: 10, basis: 'PERCENT_OF_TOTAL', color: 'purple', active: false, icon: 'percent' },
    { id: 'shipping', type: 'SHIPPING', label: 'PRICING_STRATEGY.BLOCKS.SHIPPING', value: 150, basis: 'FIXED', color: 'blue', active: false, icon: 'local_shipping' },
    { id: 'warranty', type: 'FEE', label: 'PRICING_STRATEGY.BLOCKS.WARRANTY', value: 5, basis: 'PERCENT_OF_BASE', color: 'orange', active: false, icon: 'verified_user' },
    { id: 'packaging', type: 'COST', label: 'PRICING_STRATEGY.BLOCKS.PACKAGING', value: 20, basis: 'FIXED', color: 'red', active: false, icon: 'inventory_2' }
  ]);

  // Computed: Show all to allow toggling
  displayedBlocks = computed(() => this.availableBlocks());

  // Computed Result
  calculatedStack = computed(() => {
    if (this.mode() === 'FORWARD') {
      return this.stackService.calculateForward(this.startValue(), this.activeBlocks());
    } else {
      return this.stackService.calculateInverse(this.startValue(), this.activeBlocks());
    }
  });

  finalResult = computed(() => {
    const stack = this.calculatedStack();
    if (stack.length === 0) return this.startValue();
    return stack[stack.length - 1].subtotalAfter || 0;
  });

  // Margin Analysis
  effectiveMargin = computed(() => {
    const stack = this.calculatedStack();
    const sellingPrice = this.finalResult();
    const cog = this.mode() === 'FORWARD' ? this.startValue() : 0;

    if (sellingPrice <= 0) return 0;

    // Calculate Net Profit
    // Strategy: Revenue - COG - Total Fees/Taxes - Discounts
    // Or simpler: Just look at the "Margin" blocks? No, that relies on them being defined.
    // "Profit" is what's left.
    // Let's sum up all 'COST', 'FEE', 'TAX', 'SHIPPING', 'DISCOUNT' blocks
    // Note: DISCOUNT reduces value, effectively a 'cost' to revenue if we consider list price?
    // Actually, FinalResult IS the discounted price.
    // So Net Profit = FinalResult (Revenue) - StartValue (COG) - Sum(FEES/TAXES/SHIPPING)

    // Wait, let's iterate blocks to find non-profit subtractions
    // Actually, `calculatedAmount` is what is added/subtracted.

    let totalCosts = 0;

    // In Forward mode, startValue is COG.
    // We need to verify if COG is already a block. In 'getChannelTemplates', COG is block 0.
    // But in `calculatedStack`, the loop adds/subtracts.

    // Let's look at the blocks:
    // COST, FEE, TAX, SHIPPING -> Reductions from potential profit.
    // MARGIN -> This IS the profit.

    // If the model is correct, sum of all MARGIN blocks IS the Net Profit?
    // Let's verify: 
    // COG 100. Margin 20 (Total 120). Fee 10 (Total 130).
    // Final Price 130.
    // Profit = 130 - 100 (COG) - 10 (Fee) = 20.
    // Matches the Margin block.

    // What if we have a Discount?
    // COG 100. Margin 50. Price 150. Discount 50. Price 100.
    // Profit = 100 - 100 = 0.
    // Margin Block was 50. So sum of Margin blocks (50) - Discount (50) = 0.

    // Algorithm: Sum(MARGIN) - Sum(DISCOUNT).
    // Fees are pass-through? No, Fees are costs.
    // If I add a Fee, Price increases (Cost Plus). Profit stays same (20).
    // So `(20 / 130) * 100 = 15.3%`.
    // If I add Discount 10. Price 120.
    // Profit = 20 - 10 (Discount) = 10?
    // Or does Discount reduce the Margin block? No, it's a separate block.

    let netProfit = 0;

    stack.forEach(b => {
      if (b.type === 'MARGIN') {
        netProfit += b.calculatedAmount || 0;
      }
      if (b.type === 'DISCOUNT') {
        netProfit -= b.calculatedAmount || 0;
      }
      // What about 'COST' added later? e.g. Packing Material.
      // COG 100. Pack 10. Margin 20. Price 130.
      // Profit 20. Match.
      // So additional Costs are passed on to customer in Price, they don't eat margin unless they are NOT added to price (which is impossible in this Cost-Plus model).
      // Wait, if I add a Cost Block 10.
      // Price goes up by 10. Profit (Margin block) stays 20.
      // Margin % = 20 / 140 = 14.2% (Lower!).
      // So we just need to track the Net Profit Amount.
    });

    return (netProfit / sellingPrice) * 100;
  });

  marginAlert = computed(() => {
    // Logic: If margin < 15%
    return this.effectiveMargin() < FINANCIAL_CONSTANTS.MIN_MARGIN_PERCENT;
  });

  constructor() {
    // Force Load Translations
    if (!this.translate.currentLang) {
      this.translate.setDefaultLang('es');
      this.translate.use('es');
    }

    // Initialize with default
    this.setChannel('AMAZON_FBA');
  }

  async setChannel(ch: string) {
    this.channel.set(ch);
    try {
      const templates = await this.stackService.getChannelTemplates(ch);
      this.activeBlocks.set(templates);
    } catch (error) {
      console.error('Failed to load channel templates', error);
    }
  }

  toggleMode() {
    // Switch Logic
    const newMode = this.mode() === 'FORWARD' ? 'INVERSE' : 'FORWARD';
    this.mode.set(newMode);

    // When switching, usually we take the previous Result as the new Start
    // e.g. Forward resulted in $500 price. Switch to Inverse starting at $500.
    this.startValue.set(this.finalResult());
  }

  // Search Methods
  search(term: string): void {
    this.searchTerms.next(term);
  }

  selectProduct(product: Product) {
    this.selectedProduct.set(product);
    // Reset search results (hide dropdown)
    this.searchTerms.next('');

    // Auto-populate Start Value if in Forward mode (COG) or Target if we had a price
    if (this.mode() === 'FORWARD') {
      this.startValue.set(product.costPrice || 0);
    } else {
      this.startValue.set(product.price || 0);
    }
  }

  clearProduct() {
    this.selectedProduct.set(null);
    this.startValue.set(0);
  }

  drop(event: CdkDragDrop<PriceBlock[]>) {
    const currentBlocks = [...this.activeBlocks()];
    moveItemInArray(currentBlocks, event.previousIndex, event.currentIndex);
    this.activeBlocks.set(currentBlocks);
  }

  isBlockActive(baseId: string): boolean {
    return this.activeBlocks().some(b => b.id.startsWith(baseId));
  }

  toggleBlock(template: PriceBlock) {
    if (this.isBlockActive(template.id)) {
      // Remove existing
      this.activeBlocks.update(blocks => blocks.filter(b => !b.id.startsWith(template.id)));
    } else {
      // Add new
      // Resolve Translation Key to String so the input is user-readable and editable
      const localizedLabel = this.translate.instant(template.label);
      const newBlock = { ...template, label: localizedLabel, id: template.id + '_' + Date.now(), active: true };
      this.activeBlocks.update(blocks => [...blocks, newBlock]);
    }
  }

  updateBlockValue(id: string, value: number) {
    this.activeBlocks.update(blocks => blocks.map(b => b.id === id ? { ...b, value } : b));
  }

  updateBlockLabel(id: string, label: string) {
    this.activeBlocks.update(blocks => blocks.map(b => b.id === id ? { ...b, label } : b));
  }

  // --- 3-Way Margin Logic ---

  updateMarginStrategy(block: PriceBlock, strategy: 'MARGIN' | 'MARKUP' | 'PROFIT', value: number) {
    if (block.type !== 'MARGIN') return;

    // Mutate local block first to set intent
    const newBasis = strategy === 'MARGIN' ? 'PERCENT_OF_TOTAL' :
      strategy === 'MARKUP' ? 'PERCENT_OF_BASE' : 'FIXED';

    // Update Signal to trigger reactivity
    this.activeBlocks.update(blocks => blocks.map(b => {
      if (b.id === block.id) {
        return { ...b, basis: newBasis, value: value };
      }
      return b;
    }));
  }

  trackByBlock(index: number, block: PriceBlock): string {
    return block.id;
  }

  getEquivalentMargin(block: PriceBlock): number {
    if (block.type !== 'MARGIN') return 0;
    const stack = this.activeBlocks();
    if (!stack.length) return 0;

    // Last block Subtotal is Selling Price
    const total = stack[stack.length - 1].subtotalAfter || 0;
    const profit = block.calculatedAmount || 0;

    if (total <= 0) return 0;
    return parseFloat(((profit / total) * 100).toFixed(2));
  }

  getEquivalentMarkup(block: PriceBlock): number {
    if (block.type !== 'MARGIN') return 0;
    const cost = this.startValue();
    const profit = block.calculatedAmount || 0;

    if (cost <= 0) return 0;
    return parseFloat(((profit / cost) * 100).toFixed(2));
  }

  getEquivalentProfit(block: PriceBlock): number {
    return parseFloat((block.calculatedAmount || 0).toFixed(2));
  }
  removeBlock(index: number) {
    this.activeBlocks.update(blocks => blocks.filter((_, i) => i !== index));
  }

  // --- Chart Logic --- //

  toggleChart() {
    this.showChart.update(v => !v);
  }

  chartData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const stack = this.calculatedStack();
    const datasets: ChartConfiguration<'bar'>['data']['datasets'] = [];

    // We want to stack components.
    // X-Axis: "Breakdown"
    // Series: COG, Fees, Tax, Margin

    // Helper to map color names to hex
    const colorMap: Record<string, string> = {
      teal: '#14b8a6',   // COG
      rose: '#f43f5e',   // TAX/IVA
      blue: '#3b82f6',   // SHIPPING
      orange: '#f97316', // FEE
      yellow: '#eab308', // FEE
      purple: '#a855f7', // DISCOUNT
      red: '#ef4444',    // PACKAGING
      emerald: '#10b981',// MARGIN
      cyan: '#06b6d4',
    };

    // Create a dataset for each block
    // Reverse order so the bottom of stack is at bottom of chart
    [...stack].forEach(block => {
      let label = block.label;
      if (block.id === 'cog') label = 'Product Cost';
      if (block.id === 'margin') label = 'Net Margin';

      datasets.push({
        data: [block.calculatedAmount || 0],
        label: label,
        backgroundColor: colorMap[block.color] || '#cbd5e1',
        stack: 'a', // Stack Key
        barPercentage: 0.6
      });
    });

    return {
      labels: ['Price Composition'],
      datasets: datasets
    };
  });

  chartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // Too many blocks usually
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        display: false, // Cleaner look
        stacked: true
      },
      y: {
        stacked: true,
        grid: {
          color: '#334155'
        },
        ticks: {
          color: '#94a3b8',
          callback: function (value: any) {
            return '$' + value;
          }
        }
      }
    }
  };
}
