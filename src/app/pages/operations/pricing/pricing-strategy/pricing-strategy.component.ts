import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
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
export class PricingStrategyComponent {
  private pricingCalculator = inject(PricingCalculatorService);
  private productService = inject(ProductService);
  private router = inject(Router);

  // Expose Object for template use
  Object = Object;

  // UI State
  calculating = signal(false);
  showCompetitiveModal = signal(false);

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


  // Channel Display Configuration
  channels: ChannelPriceDisplay[] = [
    {
      channel: 'AMAZON_FBA',
      channelName: 'Amazon FBA (Simulated)',
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
      channelName: 'MercadoLibre Classic',
      channelIcon: 'shopping_cart',
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'MELI_PREMIUM',
      channelName: 'MercadoLibre Premium',
      channelIcon: 'credit_card', // Icon representing installments/premium
      price: null,
      loading: false,
      expanded: false
    },
    {
      channel: 'MELI_FULL',
      channelName: 'MercadoLibre Full',
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

  async calculatePrices() {
    if (!this.selectedProduct()) {
      alert('Please select a product first');
      return;
    }

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

      const prices = await this.pricingCalculator.generateMultiChannelPrices(product, margins);

      this.channelPrices.set(prices);

      // Update channel display
      this.channels.forEach(ch => {
        ch.price = prices[ch.channel] || null;
      });

    } catch (error) {
      console.error('Error calculating prices:', error);
      alert('Error calculating prices. Please check console for details.');
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
}
