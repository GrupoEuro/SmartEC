import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp
} from '@angular/fire/firestore';
import {
    SalesChannel,
    PricingStrategy,
    ChannelPrice,
    CostBreakdown,
    MarginTargets,
    ChannelCommissionRule,
    ProductDimensions,
    FulfillmentTier,
    WeightTier,
    PricingHistory
} from '../models/pricing.model';
import { Product } from '../models/product.model';

@Injectable({
    providedIn: 'root'
})
export class PricingCalculatorService {
    private firestore = inject(Firestore);

    /**
     * Calculate optimal selling price for a specific channel
     * Uses target net margin as primary driver
     */
    async calculateChannelPrice(
        product: Product,
        channel: SalesChannel,
        margins: MarginTargets,
        customCosts?: Partial<CostBreakdown>
    ): Promise<ChannelPrice> {

        // Get commission rules for this channel
        const rules = await this.getCommissionRule(channel, product.category || 'general');

        if (!rules) {
            throw new Error(`No commission rules found for channel: ${channel}`);
        }

        // Start with base costs
        const baseCost = product.cog || 0;
        const inboundShipping = customCosts?.inboundShipping || 0;
        const packagingCost = customCosts?.packagingLabeling || 0;

        // Iterative calculation since commission depends on selling price
        let sellingPrice = this.estimateInitialPrice(baseCost, margins.targetNetMargin);
        let iterations = 0;
        const maxIterations = 10;

        // Iterate to find price that meets target margin
        while (iterations < maxIterations) {
            const breakdown = await this.calculateCostBreakdown(
                sellingPrice,
                baseCost,
                inboundShipping,
                packagingCost,
                product.weight || 0,
                product.dimensions || { length: 0, width: 0, height: 0 },
                rules
            );

            const netProfit = sellingPrice - breakdown.totalCost;
            const netMargin = (netProfit / sellingPrice) * 100;

            // Check if we're within 0.5% of target margin
            if (Math.abs(netMargin - margins.targetNetMargin) < 0.5) {
                return this.buildChannelPrice(sellingPrice, breakdown);
            }

            // Adjust price for next iteration
            if (netMargin < margins.targetNetMargin) {
                sellingPrice *= 1.05; // Increase price by 5%
            } else {
                sellingPrice *= 0.98; // Decrease price by 2%
            }

            iterations++;
        }

        // Final calculation after iterations
        const finalBreakdown = await this.calculateCostBreakdown(
            sellingPrice,
            baseCost,
            inboundShipping,
            packagingCost,
            product.weight || 0,
            product.dimensions || { length: 0, width: 0, height: 0 },
            rules
        );

        return this.buildChannelPrice(sellingPrice, finalBreakdown);
    }

    /**
     * Calculate profit for a FIXED selling price (e.g. from Multiplier rule)
     */
    async calculateFixedChannelPrice(
        product: Product,
        channel: SalesChannel,
        sellingPrice: number,
        customCosts?: Partial<CostBreakdown>
    ): Promise<ChannelPrice> {
        const rules = await this.getCommissionRule(channel, product.category || 'general');
        if (!rules) throw new Error(`No commission rules found for channel: ${channel}`);

        const baseCost = product.cog || 0;
        const inboundShipping = customCosts?.inboundShipping || 0;
        const packagingCost = customCosts?.packagingLabeling || 0;

        const breakdown = await this.calculateCostBreakdown(
            sellingPrice,
            baseCost,
            inboundShipping,
            packagingCost,
            product.weight || 0,
            product.dimensions || { length: 0, width: 0, height: 0 },
            rules
        );

        return this.buildChannelPrice(sellingPrice, breakdown);
    }

    /**
     * Calculate all costs for a given selling price
     */
    private async calculateCostBreakdown(
        sellingPrice: number,
        cog: number,
        inboundShipping: number,
        packagingCost: number,
        weight: number,
        dimensions: ProductDimensions,
        rules: ChannelCommissionRule
    ): Promise<CostBreakdown> {

        const breakdown: CostBreakdown = {
            cog,
            commission: 0,
            fulfillmentShipping: 0,
            storageFees: 0,
            paymentProcessing: 0,
            packagingLabeling: packagingCost,
            inboundShipping,
            totalCost: 0
        };

        // Calculate commission (referral fee)
        breakdown.commission = this.calculateCommission(sellingPrice, rules);

        // Calculate fulfillment/shipping fees
        if (rules.fulfillmentType === 'FBA' || rules.fulfillmentType === 'FULL') {
            // Use marketplace fulfillment
            breakdown.fulfillmentShipping = this.calculateFulfillmentFee(
                weight,
                dimensions,
                rules
            );

            // Storage fees (monthly average allocated per day)
            breakdown.storageFees = this.calculateStorageFee(dimensions, rules) / 30;
        } else {
            // Self-fulfillment - estimate shipping cost
            breakdown.fulfillmentShipping = this.estimateSelfShippingCost(weight, dimensions);
        }

        // Payment processing fees
        breakdown.paymentProcessing = this.calculatePaymentFees(
            sellingPrice,
            rules.paymentProcessingPercent,
            rules.paymentProcessingFixed
        );

        // Additional per-unit fee (e.g., MercadoLibre low-price items)
        if (rules.perUnitFee && sellingPrice < 100) { // Threshold example
            breakdown.commission += rules.perUnitFee;
        }

        // Sum total cost
        breakdown.totalCost =
            breakdown.cog +
            breakdown.commission +
            breakdown.fulfillmentShipping +
            breakdown.storageFees +
            breakdown.paymentProcessing +
            breakdown.packagingLabeling +
            breakdown.inboundShipping;

        return breakdown;
    }

    /**
     * Calculate commission/referral fee
     */
    private calculateCommission(sellingPrice: number, rules: ChannelCommissionRule): number {
        const percentFee = (sellingPrice * rules.referralFeePercent) / 100;

        // Apply minimum referral fee if exists
        if (rules.minReferralFee && percentFee < rules.minReferralFee) {
            return rules.minReferralFee;
        }

        return percentFee;
    }

    /**
     * Calculate FBA/Full fulfillment fees based on size tier and weight
     */
    private calculateFulfillmentFee(
        weight: number,
        dimensions: ProductDimensions,
        rules: ChannelCommissionRule
    ): number {

        if (!rules.fulfillmentTiers || rules.fulfillmentTiers.length === 0) {
            // No fulfillment data, estimate
            return this.estimateSelfShippingCost(weight, dimensions);
        }

        // Determine size category
        const sizeCategory = this.determineSizeTier(weight, dimensions);

        // Find matching tier
        const tier = rules.fulfillmentTiers.find(t => t.sizeCategory === sizeCategory);

        if (!tier || !tier.weightTiers || tier.weightTiers.length === 0) {
            // Fallback to estimation
            return this.estimateSelfShippingCost(weight, dimensions);
        }

        // Find weight bracket
        const weightTier = tier.weightTiers.find(w => weight <= w.maxWeight)
            || tier.weightTiers[tier.weightTiers.length - 1]; // Use highest tier as fallback

        // Calculate fee
        const baseFee = weightTier.baseFee;
        const excessWeight = Math.max(0, weight - (tier.weightTiers[0]?.maxWeight || 0));
        const excessFee = excessWeight * weightTier.perKgOver;

        return baseFee + excessFee;
    }

    /**
     * Determine size tier based on dimensions and weight
     */
    private determineSizeTier(weight: number, dimensions: ProductDimensions): 'small' | 'standard' | 'large' | 'oversized' {
        const longestSide = Math.max(dimensions.length, dimensions.width, dimensions.height);
        const girth = (dimensions.length + dimensions.width + dimensions.height);

        // Amazon FBA size tier logic
        if (longestSide <= 33 && girth <= 60 && weight <= 1) {
            return 'small';
        } else if (longestSide <= 45 && girth <= 130 && weight <= 9) {
            return 'standard';
        } else if (weight <= 30) {
            return 'large';
        } else {
            return 'oversized';
        }
    }

    /**
     * Calculate monthly storage fees
     */
    private calculateStorageFee(dimensions: ProductDimensions, rules: ChannelCommissionRule): number {
        if (!rules.monthlyStoragePerCubicMeter) {
            return 0;
        }

        // Calculate cubic meters
        const volumeM3 = (dimensions.length * dimensions.width * dimensions.height) / 1000000; // cm³ to m³

        return volumeM3 * rules.monthlyStoragePerCubicMeter;
    }

    /**
     * Calculate payment processing fees
     */
    private calculatePaymentFees(price: number, percentFee: number, fixedFee?: number): number {
        const percent = (price * percentFee) / 100;
        const fixed = fixedFee || 0;
        return percent + fixed;
    }

    /**
     * Estimate self-shipping cost (simple heuristic)
     */
    private estimateSelfShippingCost(weight: number, dimensions: ProductDimensions): number {
        // Simple weight-based estimation
        // This should be replaced with actual shipping API integration
        const baseRate = 50; // MXN base rate
        const perKg = 15; // MXN per kg
        return baseRate + (weight * perKg);
    }

    /**
     * Initial price estimate (before iterations)
     */
    private estimateInitialPrice(cog: number, targetNetMargin: number): number {
        // Rough estimate: assume 30% total fees
        const estimatedFeePercent = 30;
        const totalMarginNeeded = targetNetMargin + estimatedFeePercent;
        return cog / (1 - (totalMarginNeeded / 100));
    }

    /**
     * Build ChannelPrice object from calculations
     */
    private buildChannelPrice(sellingPrice: number, breakdown: CostBreakdown): ChannelPrice {
        const netProfit = sellingPrice - breakdown.totalCost;
        const netMargin = (netProfit / sellingPrice) * 100;

        const grossProfit = sellingPrice - breakdown.cog;
        const grossMargin = (grossProfit / sellingPrice) * 100;

        // ROI Calculation: (Net Profit / Total Investment) * 100
        // Total Investment approximated by Total Cost (COG + Fees + Shipping)
        // Force Rebuild Trigger
        const roi = (netProfit / breakdown.totalCost) * 100;

        return {
            sellingPrice: Math.ceil(sellingPrice), // Round up to nearest peso
            breakdown,
            grossProfit,
            grossMargin,
            netProfit,
            netMargin,
            roi,
            competitive: false, // To be updated from scraper data
            lastUpdated: serverTimestamp() as any
        };
    }

    /**
     * Get commission rule for channel/category
     */
    private async getCommissionRule(
        channel: SalesChannel,
        category: string
    ): Promise<ChannelCommissionRule | null> {

        const rulesRef = collection(this.firestore, 'channel_commission_rules');

        // Try to find specific category rule first
        let q = query(
            rulesRef,
            where('channel', '==', channel),
            where('category', '==', category),
            where('active', '==', true)
        );

        let snapshot = await getDocs(q);

        if (snapshot.empty) {
            // Fallback to general rule for channel
            q = query(
                rulesRef,
                where('channel', '==', channel),
                where('active', '==', true)
            );
            snapshot = await getDocs(q);
        }

        if (snapshot.empty) {
            return null;
        }

        // Return first matching rule
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() } as ChannelCommissionRule;
    }

    /**
     * Generate prices for all channels
     */
    async generateMultiChannelPrices(
        product: Product,
        margins: MarginTargets
    ): Promise<Record<string, ChannelPrice>> {

        const channels: SalesChannel[] = [
            'AMAZON_FBA',
            'AMAZON_FBM',
            'MELI_CLASSIC',
            'MELI_PREMIUM',
            'MELI_FULL',
            'POS',
            'WEB'
        ];

        const prices: Record<string, ChannelPrice> = {};

        for (const channel of channels) {
            try {
                prices[channel] = await this.calculateChannelPrice(product, channel, margins);
            } catch (error) {
                console.error(`Error calculating price for ${channel}:`, error);
                // Continue with other channels
            }
        }

        return prices;
    }

    /**
     * Save pricing strategy to database
     */
    async savePricingStrategy(strategy: Omit<PricingStrategy, 'id'>): Promise<string> {
        const strategiesRef = collection(this.firestore, 'pricing_strategies');
        const docRef = await addDoc(strategiesRef, {
            ...strategy,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return docRef.id;
    }

    /**
     * Update existing pricing strategy
     */
    async updatePricingStrategy(id: string, updates: Partial<PricingStrategy>): Promise<void> {
        const docRef = doc(this.firestore, 'pricing_strategies', id);
        await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
    }

    /**
     * Get pricing strategy by product ID
     */
    async getPricingStrategy(productId: string): Promise<PricingStrategy | null> {
        const strategiesRef = collection(this.firestore, 'pricing_strategies');
        const q = query(
            strategiesRef,
            where('productId', '==', productId),
            // Optionally could sort by createdAt desc if multiple exist, 
            // but unique productId per strategy is implied or commonly assumed 1:1 active
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() } as PricingStrategy;
    }

    /**
     * Log price change to history
     */
    async logPriceChange(historyEntry: Omit<PricingHistory, 'id'>): Promise<void> {
        const historyRef = collection(this.firestore, 'pricing_history');
        await addDoc(historyRef, {
            ...historyEntry,
            timestamp: serverTimestamp()
        });
    }

    /**
     * Validate margins meet minimum thresholds
     */
    validateMargins(channelPrice: ChannelPrice, minMargin: number): {
        valid: boolean;
        warnings: string[];
    } {
        const warnings: string[] = [];

        if (channelPrice.netMargin < minMargin) {
            warnings.push(`Net margin (${channelPrice.netMargin.toFixed(1)}%) is below minimum threshold (${minMargin}%)`);
        }

        if (channelPrice.netMargin < 0) {
            warnings.push('CRITICAL: Negative net margin - selling at a loss!');
        }

        if (channelPrice.sellingPrice < channelPrice.breakdown.cog) {
            warnings.push('CRITICAL: Selling price is below cost of goods!');
        }

        return {
            valid: warnings.length === 0,
            warnings
        };
    }
}
