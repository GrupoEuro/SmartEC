import { Component, inject, signal, effect, computed } from '@angular/core';
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
  imports: [CommonModule, DragDropModule, FormsModule, AppIconComponent, TranslateModule],
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

  updateMarginFromAbsolute(block: PriceBlock, event: Event) {
    const input = event.target as HTMLInputElement;
    const amount = parseFloat(input.value);
    if (isNaN(amount) || amount < 0) return;

    // Calculate Context
    let fixedCosts = this.startValue();
    let variableRate = 0; // Sum of % fees (of Total)
    let taxRate = 0;      // Sum of % taxes (of Base)

    this.activeBlocks().forEach(b => {
      // Must match by ID because 'block' might be a computed copy
      if (b.id === block.id || !b.active) return;

      if (b.basis === 'FIXED' || b.type === 'COST' || b.type === 'SHIPPING') {
        fixedCosts += b.value;
      } else if (b.basis === 'PERCENT_OF_TOTAL' && b.type !== 'MARGIN') {
        variableRate += (b.value / 100);
      } else if (b.type === 'TAX' && b.basis === 'PERCENT_OF_BASE') {
        taxRate += (b.value / 100);
      }
    });

    // Formula: Price = (FixedCost + Profit) / ( (1/(1+Tax)) - VariableRate )
    const denominator = (1 / (1 + taxRate)) - variableRate;

    // Guard against divide by zero or negative
    if (denominator <= 0) return;

    const estimatedGrossPrice = (fixedCosts + amount) / denominator;

    // New Margin % = Profit / GrossPrice
    const newPercent = (amount / estimatedGrossPrice) * 100;

    // Update Source Signal
    this.updateBlockValue(block.id, parseFloat(newPercent.toFixed(2)));
  }

  removeBlock(index: number) {
    this.activeBlocks.update(blocks => blocks.filter((_, i) => i !== index));
  }
}
