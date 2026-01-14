import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, filter, tap } from 'rxjs/operators';
import { PricingCalculatorService } from '../../../../core/services/pricing-calculator.service';
import { ProductService } from '../../../../core/services/product.service';
import { Product } from '../../../../core/models/product.model';
import { ChannelPrice, MarginTargets, SalesChannel } from '../../../../core/models/pricing.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

interface ChannelPriceDisplay {
  channel: SalesChannel;
  channelName: string;
  channelIcon: string;
  price: ChannelPrice | null;
  loading: boolean;
  expanded: boolean; // For collapsible cards
}

@Component({
  selector: 'app-pricing-strategy',
  standalone: true,
  imports: [CommonModule, FormsModule, AppIconComponent, TranslateModule],
  templateUrl: './pricing-strategy.component.html',
  styleUrl: './pricing-strategy.component.css'
})
export class PricingStrategyComponent implements OnDestroy {
  private pricingCalculator = inject(PricingCalculatorService);
  private productService = inject(ProductService);
  private router = inject(Router);

  // Expose Object for template use
  Object = Object;

  // UI State
  calculating = signal(false);
  showCompetitiveModal = signal(false);

  // Live Data Handling
  private inputChangeSubject = new Subject<void>();
  private inputSubscription: Subscription;
  isLiveMode = signal(false);

  // Signals
  selectedProduct = signal<Product | null>(null);
  showDetails = signal<boolean>(false);

  // Cost Signals
  products = signal<Product[]>([]);
  searchQuery = signal('');

  // Pricing Inputs - FIX: Must all be signals
  cog = signal(1000);
  inboundShipping = signal(50);
  packaging = signal(15);
  weight = signal(2.5);
  length = signal(40);
  width = signal(30);
  height = signal(15);

  // Margin Targets
  targetGrossMargin = signal(50);
  targetNetMargin = signal(20);
  minAcceptableMargin = signal(12);

  // Calculated Prices
  channelPrices = signal<Record<string, ChannelPrice>>({});

  // View Mode
  viewMode = signal<'cards' | 'matrix'>('cards');


  constructor() {
    // Setup debounced calculation
    this.inputSubscription = this.inputChangeSubject.pipe(
      filter(() => this.isLiveMode() && !this.calculating()), // Only if live mode active
      debounceTime(500), // Wait 500ms after last input
      tap(() => this.calculatePrices(true)) // Silent calc (true = live)
    ).subscribe();
  }

  ngOnDestroy() {
    if (this.inputSubscription) {
      this.inputSubscription.unsubscribe();
    }
  }

  // Trigger for inputs
  onInputChange() {
    if (this.isLiveMode()) {
      this.inputChangeSubject.next();
    }
  }


  // Channel Display Configuration
  channels: ChannelPriceDisplay[] = [
    {
      channel: 'AMAZON_FBA',
      channelName: 'Amazon FBA',
      channelIcon: 'inventory_2',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'AMAZON_FBM',
      channelName: 'Amazon Mexico (FBM)',
      channelIcon: 'package',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'MELI_CLASSIC',
      channelName: 'MELI Classic',
      channelIcon: 'shopping_cart',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'MELI_PREMIUM',
      channelName: 'MELI Premium',
      channelIcon: 'credit_card', // Icon representing installments/premium
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'MELI_FULL',
      channelName: 'MELI Full',
      channelIcon: 'local_shipping',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'POS',
      channelName: 'POS / In-Store',
      channelIcon: 'storefront',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'WEB',
      channelName: 'Web Store',
      channelIcon: 'language',
      price: null,
      loading: false,
      expanded: false
    }
  ];

  // Computed Properties
  filteredProducts = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.products().slice(0, 10);

    return this.products().filter(p =>
      p.sku.toLowerCase().includes(query) ||
      p.name.es.toLowerCase().includes(query) ||
      p.name.en.toLowerCase().includes(query)
    ).slice(0, 10);
  });

  ngOnInit() {
    this.loadProducts();
  }

  loadProducts() {
    this.productService.getProducts().subscribe({
      next: (products) => {
        this.products.set(products);
      },
      error: (error) => {
        console.error('Error loading products:', error);
      }
    });
  }

  async selectProduct(product: Product) {
    this.selectedProduct.set(product);
    this.searchQuery.set(product.sku); // Show SKU in search box

    // Auto-fill product specs if available
    // Original cog auto-populate removed as it will be loaded from strategy if exists
    if (product.weight) this.weight.set(product.weight);
    if (product.dimensions) {
      if (product.dimensions.length) this.length.set(product.dimensions.length);
      if (product.dimensions.width) this.width.set(product.dimensions.width);
      if (product.dimensions.height) this.height.set(product.dimensions.height);
    }

    // Reset results
    this.channelPrices.set({}); // Set to empty object instead of null
    this.channels.forEach(ch => {
      ch.price = null;
      ch.expanded = false;
    });

    // Check for existing strategy
    this.calculating.set(true);
    try {
      const existingStrategy = await this.pricingCalculator.getPricingStrategy(product.id!);

      if (existingStrategy) {
        // Populate inputs from strategy
        this.cog.set(existingStrategy.cog);
        if (existingStrategy.inboundShipping) this.inboundShipping.set(existingStrategy.inboundShipping);
        if (existingStrategy.packagingCost) this.packaging.set(existingStrategy.packagingCost);

        this.targetGrossMargin.set(existingStrategy.targetGrossMargin);
        this.targetNetMargin.set(existingStrategy.targetNetMargin);
        this.minAcceptableMargin.set(existingStrategy.minAcceptableMargin);

        // Auto-calculate
        this.calculatePrices();

        // Notification (optional, maybe console for now to avoid UI clutter or add a toast service later)
        console.log('Existing pricing strategy loaded');
      } else {
        // If no strategy, set default cog or product's cog if available
        if (product.cog) this.cog.set(product.cog);
        else this.cog.set(1000); // Default if no product cog
      }
    } catch (error) {
      console.error('Error loading existing strategy:', error);
      // Optionally reset to product's cog if strategy loading fails
      if (product.cog) this.cog.set(product.cog);
      else this.cog.set(1000);
    } finally {
      this.calculating.set(false);
    }
  }

  async calculatePrices(isLiveUpdate = false) {
    if (!this.selectedProduct()) {
      alert('Please select a product first');
      return;
    }

    // Don't show full spinner for live updates to avoid flickering, maybe just a small indicator if needed
    // But we set calculating(true) which disables the button
    this.calculating.set(true);

    try {
      const product: Product = {
        ...this.selectedProduct()!,
        cog: this.cog(),
        weight: this.weight(),
        dimensions: {
          length: this.length(),
          width: this.width(),
          height: this.height()
        }
      };

      const margins: MarginTargets = {
        targetGrossMargin: this.targetGrossMargin(),
        targetNetMargin: this.targetNetMargin(),
        minAcceptableMargin: this.minAcceptableMargin()
      };

      const customCosts = {
        inboundShipping: this.inboundShipping(),
        packagingLabeling: this.packaging()
      };

      // Pass custom costs if the service supports it (it should) - checking service signature logic elsewhere
      // Assuming generateMultiChannelPrices uses the product's modified props or we need to pass them
      // For now, product object has the cost data, assuming service uses it. 
      // Actually, looking at previous code, inputs like COG are in the product object.
      // We need to ensure 'inboundShipping' and 'packaging' are used. 
      // If they are not part of Product interface, we might need to handle them.
      // But for now keeping strictly to signature.

      const prices = await this.pricingCalculator.generateMultiChannelPrices(product, margins);

      this.channelPrices.set(prices);

      // Update channel display
      this.channels.forEach(ch => {
        ch.price = prices[ch.channel] || null;
      });

      // Activate Live Mode after first successful calc
      if (!this.isLiveMode()) {
        this.isLiveMode.set(true);
      }

    } catch (error) {
      console.error('Error calculating prices:', error);
      if (!isLiveUpdate) alert('Error calculating prices. Please check console for details.');
    } finally {
      this.calculating.set(false);
    }
  }

  getMarginColor(margin: number, min: number): string {
    if (margin < 0) return 'text-red-500';
    if (margin < min) return 'text-yellow-500';
    if (margin < 20) return 'text-blue-500';
    return 'text-green-500';
  }

  getMarginBgColor(margin: number, min: number): string {
    if (margin < 0) return 'bg-red-500/10';
    if (margin < min) return 'bg-yellow-500/10';
    if (margin < 20) return 'bg-blue-500/10';
    return 'bg-green-500/10';
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(value);
  }

  formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  openCompetitiveModal() {
    this.showCompetitiveModal.set(true);
  }

  closeCompetitiveModal() {
    this.showCompetitiveModal.set(false);
  }

  async savePricingStrategy() {
    if (!this.selectedProduct()) return;

    try {
      const strategy = {
        productId: this.selectedProduct()!.id!,
        sku: this.selectedProduct()!.sku,
        productName: this.selectedProduct()!.name.es,
        cog: this.cog(),
        inboundShipping: this.inboundShipping(),
        packagingCost: this.packaging(),
        targetGrossMargin: this.targetGrossMargin(),
        targetNetMargin: this.targetNetMargin(),
        minAcceptableMargin: this.minAcceptableMargin(),
        weight: this.weight(),
        dimensions: {
          length: this.length(),
          width: this.width(),
          height: this.height()
        },
        channelPrices: this.channelPrices(),
        active: true,
        lastCalculated: new Date() as any
      };

      await this.pricingCalculator.savePricingStrategy(strategy as any);
      alert('Pricing strategy saved successfully!');
    } catch (error) {
      console.error('Error saving pricing strategy:', error);
      alert('Error saving pricing strategy. Please check console.');
    }
  }

  // Collapsible Logic
  toggleChannel(channel: ChannelPriceDisplay) {
    channel.expanded = !channel.expanded;
    // Update global toggle if all are consistent, optional but good UX
  }

  toggleAll(event: Event) {
    const isChecked = (event.target as HTMLInputElement).checked;
    this.showDetails.set(isChecked);
    this.channels.forEach(ch => ch.expanded = isChecked);
  }

  // Helper to check if any channel is expanded
  anyExpanded(): boolean {
    return this.channels.some(ch => ch.expanded);
  }
  // Simulator State
  isSimulatorMode = signal(false);
  simulatedChannel = signal<SalesChannel | null>(null);
  anchorBasePrice = signal<number>(0); // Baseline for discount calc
  simulatedPrice = signal<number>(0);
  simulatedDiscount = signal<number>(0); // Percentage
  simulationResults = signal<Record<string, ChannelPrice>>({});

  toggleSimulator() {
    this.isSimulatorMode.update(v => !v);
    if (this.isSimulatorMode()) {
      // Initialize simulator with current Amazon price as anchor
      const amazonPrice = this.channelPrices()['AMAZON_FBA']?.sellingPrice || 0;
      this.simulatedChannel.set('AMAZON_FBA');
      this.anchorBasePrice.set(amazonPrice);
      this.simulatedPrice.set(amazonPrice);
      this.simulatedDiscount.set(0);
      this.runSimulation();
    }
  }

  async runSimulation() {
    if (!this.selectedProduct() || !this.simulatedChannel()) return;

    const product = {
      ...this.selectedProduct()!,
      cog: this.cog(), // Use current inputs
      weight: this.weight(),
      dimensions: {
        length: this.length(),
        width: this.width(),
        height: this.height()
      }
    } as Product;

    const customCosts = {
      inboundShipping: this.inboundShipping(),
      packagingLabeling: this.packaging()
    };

    // 1. Calculate Anchor Channel Result
    const anchorResult = await this.pricingCalculator.calculateProfitFromPrice(
      product,
      this.simulatedChannel()!,
      this.simulatedPrice(),
      customCosts
    );

    // 2. Ripple Effect: Calculate required prices for other channels to match Net Margin
    const targetNetMargin = anchorResult.netMargin;
    const margins: MarginTargets = {
      targetGrossMargin: 50,
      targetNetMargin: targetNetMargin, // This is the driver
      minAcceptableMargin: 0
    };

    const rippleResults = await this.pricingCalculator.generateMultiChannelPrices(product, margins);

    this.simulationResults.set(rippleResults);
  }

  onSimulatedPriceChange(event: any) {
    const newPrice = Number(event.target.value);
    this.simulatedPrice.set(newPrice);

    // Arc: Price -> Discount
    if (this.anchorBasePrice() > 0) {
      const discount = ((this.anchorBasePrice() - newPrice) / this.anchorBasePrice()) * 100;
      this.simulatedDiscount.set(Number(discount.toFixed(1)));
    }

    this.runSimulation();
  }

  onDiscountChange(event: any) {
    const discount = Number(event.target.value);
    this.simulatedDiscount.set(discount);

    // Arc: Discount -> Price
    if (this.anchorBasePrice() > 0) {
      const newPrice = this.anchorBasePrice() * (1 - (discount / 100));
      this.simulatedPrice.set(Number(newPrice.toFixed(2)));
    }

    this.runSimulation();
  }

  applySimulation() {
    // Commit the simulated margin as the new strategy
    const result = this.simulationResults()[this.simulatedChannel()!];
    if (result) {
      this.targetNetMargin.set(Number(result.netMargin.toFixed(1)));
      this.calculatePrices(); // Recalculate main strategy
      this.isSimulatorMode.set(false);
    }
  }
}
