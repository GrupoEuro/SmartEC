"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingService = void 0;
class PricingService {
    /**
     * Calculates the mandatory Floor Price for a SKU.
     * @param baseCost The base cost of the item.
     * @param minimumMarginMultiplier The multiplier config (e.g. 1.2 for 20% margin). Defaults to 1.2.
     * @returns The calculated floor price.
     */
    static calculateFloorPrice(baseCost, minimumMarginMultiplier = 1.2) {
        if (baseCost < 0)
            throw new Error("Base cost cannot be negative.");
        return Number((baseCost * minimumMarginMultiplier).toFixed(2));
    }
    /**
     * Calculates the Final List Price based on the channel parameters.
     * @param baseCost The master base cost.
     * @param floorMargin The absolute value of the minimum markup (e.g. baseCost * 0.2).
     * @param shippingCost The outbound shipping cost (or manual override for kits).
     * @param fixedFees Any fixed fees from the channel (e.g., listing fee).
     * @param channelCommission The commission percentage expressed as a decimal (e.g. 0.15 for 15%).
     * @param discounts The discount percentage expressed as a decimal (e.g. 0.05 for 5%).
     * @returns The dynamically calculated List Price.
     */
    static calculateFinalListPrice(baseCost, floorMargin, shippingCost, fixedFees, channelCommission, discounts = 0) {
        const numerator = baseCost + floorMargin + shippingCost + fixedFees;
        const denominator = 1 - (channelCommission + discounts);
        if (denominator <= 0) {
            throw new Error("Commission and discounts cannot exceed 100%.");
        }
        return Number((numerator / denominator).toFixed(2));
    }
    /**
     * Prorates an inbound freight cost across a set of items based on volume or weight.
     * @param freightCost Total inbound freight cost to distribute.
     * @param items Array of item metrics (weight or volume).
     * @param strategy 'volume' | 'weight' to determine how to allocate.
     * @returns An array of allocated costs corresponding to the items array.
     */
    static distributeInboundFreight(freightCost, items, strategy) {
        if (freightCost < 0)
            throw new Error("Freight cost cannot be negative.");
        if (items.length === 0)
            return [];
        const totalMetric = items.reduce((sum, item) => sum + (strategy === 'volume' ? item.volume : item.weight), 0);
        if (totalMetric === 0) {
            // Fallback to even distribution if no metrics
            const split = Number((freightCost / items.length).toFixed(2));
            return items.map(item => ({ id: item.id, allocatedCost: split }));
        }
        let allocatedTotal = 0;
        const allocations = items.map((item, index) => {
            const metric = strategy === 'volume' ? item.volume : item.weight;
            const percentage = metric / totalMetric;
            // For the last item, assign the remainder to prevent rounding missing cents
            if (index === items.length - 1) {
                const finalCost = Number((freightCost - allocatedTotal).toFixed(2));
                return { id: item.id, allocatedCost: finalCost };
            }
            const cost = Number((freightCost * percentage).toFixed(2));
            allocatedTotal += cost;
            return { id: item.id, allocatedCost: cost };
        });
        return allocations;
    }
}
exports.PricingService = PricingService;
//# sourceMappingURL=PricingService.js.map