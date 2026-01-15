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
import { FINANCIAL_CONSTANTS } from '../constants/financial.constants';

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
        customCosts?: Partial<CostBreakdown>,
        offerFreeShipping: boolean = false
    ): Promise<ChannelPrice> {

        // Get commission rules for this channel
        const rules = await this.getCommissionRule(channel, product.category || 'general');

        if (!rules) {
            // If no rules, use defaults based on constants for POS/WEB
            if (channel === 'POS' || channel === 'WEB') {
                // Proceed with dummy rule
            } else {
                console.warn(`No commission rules for ${channel}, using defaults.`);
            }
        }

        // Start with base costs (COG is Landed, so no extra inbound unless specified)
        const baseCost = product.cog || 0;
        const extraInbound = customCosts?.inboundShipping || 0;
        const outboundPackaging = customCosts?.packagingLabeling || 0;

        // Iterative calculation since commission depends on selling price
        // Net Margin = (NetRevenue - TotalCost) / NetRevenue
        // or (NetProfit / SellingPrice)? User convention typically Profit / Price. 
        // Standard Financial: Net Margin = Net Profit / Net Revenue.
        // Retail: Often Net Profit / Gross Revenue. 
        // Let's stick to: Net Profit (Real $) / Gross Selling Price (What customer pays) * 100 for 'Margin %' on grid.
        // Actually, to protect cashflow, usually (NetProfit / SellingPrice) * 100.

        let sellingPrice = this.estimateInitialPrice(baseCost, margins.targetNetMargin);
        let iterations = 0;
        const maxIterations = 10;

        const effectiveRules = rules || this.createDefaultRules(channel);

        // Iterate to find price that meets target margin
        while (iterations < maxIterations) {
            const breakdown = await this.calculateCostBreakdown(
                sellingPrice,
                baseCost,
                extraInbound,
                outboundPackaging,
                product.weight || 0,
                product.dimensions || { length: 0, width: 0, height: 0 },
                effectiveRules,
                channel,
                offerFreeShipping
            );

            // TAX AWARE PROFIT CALCULATION
            // Net Revenue = Price / 1.16
            const netRevenue = sellingPrice / (1 + FINANCIAL_CONSTANTS.IVA_RATE);
            const netProfit = netRevenue - breakdown.totalCost;

            // Margin based on Selling Price (Gross) or Net Revenue?
            // To be conservative and standard: Net Profit / Selling Price (Gross)
            const netMargin = (netProfit / sellingPrice) * 100;

            // Check if we're within 0.1% of target margin
            if (Math.abs(netMargin - margins.targetNetMargin) < 0.1) {
                return this.buildChannelPrice(sellingPrice, breakdown);
            }

            // Adjust price
            if (netMargin < margins.targetNetMargin) {
                sellingPrice *= 1.02;
            } else {
                sellingPrice *= 0.99;
            }
            iterations++;
        }

        // Final calculation
        const finalBreakdown = await this.calculateCostBreakdown(
            sellingPrice,
            baseCost,
            extraInbound,
            outboundPackaging,
            product.weight || 0,
            product.dimensions || { length: 0, width: 0, height: 0 },
            effectiveRules,
            channel,
            offerFreeShipping
        );

        return this.buildChannelPrice(sellingPrice, finalBreakdown);
    }

    /**
     * Create default rules for channels if missing from DB
     */
    private createDefaultRules(channel: SalesChannel): ChannelCommissionRule {
        return {
            id: 'default',
            channel,
            country: 'MX',
            referralFeePercent: channel === 'POS' ? 0 : (channel === 'WEB' ? 0 : 15),
            fulfillmentType: 'SELF',
            paymentProcessingPercent: channel === 'POS' ? (FINANCIAL_CONSTANTS.POS_COMMISSION_RATE * 100) : (channel === 'WEB' ? (FINANCIAL_CONSTANTS.WEB_GATEWAY_RATE * 100) : 0),
            paymentProcessingFixed: channel === 'WEB' ? FINANCIAL_CONSTANTS.WEB_GATEWAY_FIXED : 0,
            active: true,
            effectiveDate: serverTimestamp() as any,
            createdAt: serverTimestamp() as any,
            updatedAt: serverTimestamp() as any,
            source: 'System Defaults'
        };
    }

    // ... calculateFixedChannelPrice ...
    async calculateFixedChannelPrice(
        product: Product,
        channel: SalesChannel,
        sellingPrice: number,
        customCosts?: Partial<CostBreakdown>,
        offerFreeShipping: boolean = false
    ): Promise<ChannelPrice> {
        const rules = await this.getCommissionRule(channel, product.category || 'general');
        const effectiveRules = rules || this.createDefaultRules(channel);

        const breakdown = await this.calculateCostBreakdown(
            sellingPrice,
            product.cog || 0,
            customCosts?.inboundShipping || 0,
            customCosts?.packagingLabeling || 0,
            product.weight || 0,
            product.dimensions || { length: 0, width: 0, height: 0 },
            effectiveRules,
            channel,
            offerFreeShipping
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
        rules: ChannelCommissionRule,
        channel: SalesChannel,
        offerFreeShipping: boolean
    ): Promise<CostBreakdown> {

        const breakdown: CostBreakdown = {
            cog, // Only the Landed COG
            commission: 0,
            fulfillmentShipping: 0,
            storageFees: 0,
            paymentProcessing: 0,
            packagingLabeling: packagingCost,
            inboundShipping, // Extra inbound if specified
            totalCost: 0
        };

        // 1. Commission (On Gross Price) + IVA on Fee
        let rawCommission = this.calculateCommission(sellingPrice, rules);
        // Add 16% VAT to commission (Marketplaces charge tax on fees)
        breakdown.commission = rawCommission * (1 + FINANCIAL_CONSTANTS.IVA_RATE);

        // 2. Fulfillment / Shipping
        // MELI Logic: Free Shipping for > 299 mandatory (Classic/Premium)
        // If channel is Meli and price > 299, assume we pay shipping unless Full (where it's handling fee)
        let paysShipping = offerFreeShipping;

        if (channel.includes('MELI') && sellingPrice >= 299 && !channel.includes('FULL')) {
            paysShipping = true; // Mandatory Free Shipping
        }

        if (rules.fulfillmentType === 'FBA' || rules.fulfillmentType === 'FULL') {
            // Marketplace Fulfillment (FBA/Full)
            breakdown.fulfillmentShipping = this.calculateFulfillmentFee(weight, dimensions, rules);
            // Storage
            breakdown.storageFees = this.calculateStorageFee(dimensions, rules) / 30;
        } else {
            // Self Fulfillment (Web/POS/FBM/MeliClassic)
            if (paysShipping) {
                breakdown.fulfillmentShipping = this.estimateSelfShippingCost(weight, dimensions);
            } else {
                // Customer pays, cost to us is 0 (pass-through or collected separate)
                breakdown.fulfillmentShipping = 0;
            }
        }

        // 3. Payment Processing (On Gross Price) + IVA on Fee
        // POS / Web usually have payment fees + Tax
        // Marketplaces (Amz/Meli) usually bundle pay-fee into commission or it's separate but VAT applied.
        // Our rule default includes the rate. We apply tax on top.
        let rawPayment = this.calculatePaymentFees(
            sellingPrice,
            rules.paymentProcessingPercent,
            rules.paymentProcessingFixed
        );
        breakdown.paymentProcessing = rawPayment * (1 + FINANCIAL_CONSTANTS.IVA_RATE);


        // 4. Additional per-unit fees
        if (rules.perUnitFee) {
            // Simplified generic threshold check usually needed
            // For now just add if exists
            breakdown.commission += (rules.perUnitFee * (1 + FINANCIAL_CONSTANTS.IVA_RATE));
        }

        // 5. Sum Total Cost
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
        // TAX AWARE CALCULATION
        const netRevenue = sellingPrice / (1 + FINANCIAL_CONSTANTS.IVA_RATE);

        const netProfit = netRevenue - breakdown.totalCost;
        // Margin on Gross Sales (Standard Retail)
        const netMargin = (netProfit / sellingPrice) * 100;

        const grossProfit = netRevenue - breakdown.cog; // Gross Profit from Net Revenue
        const grossMargin = (grossProfit / sellingPrice) * 100;

        // ROI Calculation: (Net Profit / Total Investment) * 100
        const roi = breakdown.totalCost > 0 ? (netProfit / breakdown.totalCost) * 100 : 0;

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
                // Default Free Shipping assumptions?
                // Usually Web/POS default to NOT free unless promotion.
                const freeShipping = false;
                prices[channel] = await this.calculateChannelPrice(product, channel, margins, undefined, freeShipping);
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
    /**
     * REVERSE CALCULATION: Calculate profit/margin given a fixed selling price
     * Used for "What-If" Simulator
     */
    async calculateProfitFromPrice(
        product: Product,
        channel: SalesChannel,
        sellingPrice: number,
        customCosts?: Partial<CostBreakdown>,
        offerFreeShipping: boolean = false
    ): Promise<ChannelPrice> {
        return this.calculateFixedChannelPrice(product, channel, sellingPrice, customCosts, offerFreeShipping);
    }
}
