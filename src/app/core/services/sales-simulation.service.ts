import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';
import { PricingTemplate, PriceBlockTemplate } from '../models/pricing-template.model';
import { PriceBlock } from '../models/price-constructor.model';

export interface SimulationResult {
    periodMonths: number;
    monthlyVolume: number;

    // Totals
    totalRevenue: number;
    totalProfit: number;
    totalCosts: number;

    // Cashflow
    initialInvestment: number; // COG * Volume

    // Metrics
    roi: number; // Total Profit / Total Investment
    margin: number; // Total Profit / Total Revenue

    // Breakdown
    blockBreakdown: Record<string, number>; // { 'FBA Fee': 5000, 'Taxes': 12000 }
}

@Injectable({
    providedIn: 'root'
})
export class SalesSimulationService {

    constructor() { }

    /**
     * Run a simulation for a given product and pricing template
     */
    simulate(
        product: Product,
        template: PricingTemplate,
        months: number,
        monthlyVolume: number,
        startValue: number, // COG or Target Price
        seasonalRules: any[] = [] // Optional PricingRule[]
    ): SimulationResult {

        let totalRevenue = 0;
        let totalProfit = 0;
        let totalCosts = 0;
        const totalVolume = monthlyVolume * months;
        const initialInvestment = (product.cog || startValue) * monthlyVolume;

        const blockBreakdown: Record<string, number> = {};
        const startDate = new Date(); // Start simulation from "Now"

        // Iterate Month by Month
        for (let i = 0; i < months; i++) {
            const currentMonthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);

            // 1. Determine Effective Blocks for this Month
            // Clone the base template blocks
            let currentBlocks = JSON.parse(JSON.stringify(template.blocks));

            // 2. Apply Seasonal Rules
            // Filter rules active in this month
            const activeRules = seasonalRules.filter(r => this.isRuleActive(r, currentMonthDate));

            activeRules.forEach(rule => {
                if (rule.action === 'SET_MARGIN' && rule.value) {
                    // Find margin block and override
                    const marginBlock = currentBlocks.find((b: any) => b.type === 'MARGIN');
                    if (marginBlock) marginBlock.defaultValue = rule.value;
                }
                // TODO: Handle other actions like 'ADD_DISCOUNT' if we add them to the model
            });

            // 3. Hydrate & Calculate for this Month
            const unitBlocks = this.hydrateBlocks(currentBlocks, startValue);
            const unitEconomics = this.calculateUnitEconomics(unitBlocks, startValue);

            // 4. Accumulate
            const monthlyRevenue = unitEconomics.price * monthlyVolume;
            const monthlyCost = unitEconomics.cost * monthlyVolume;
            const monthlyProfit = unitEconomics.profit * monthlyVolume;

            totalRevenue += monthlyRevenue;
            totalCosts += monthlyCost;
            totalProfit += monthlyProfit;

            // Aggregate Breakdown
            unitBlocks.forEach(b => {
                const label = b.label || b.id;
                const amount = (b.calculatedAmount || 0) * monthlyVolume;
                blockBreakdown[label] = (blockBreakdown[label] || 0) + amount;
            });
        }

        return {
            periodMonths: months,
            monthlyVolume,
            totalRevenue,
            totalProfit,
            totalCosts,
            initialInvestment,
            roi: initialInvestment > 0 ? (totalProfit / (totalCosts)) * 100 : 0,
            margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
            blockBreakdown
        };
    }

    private isRuleActive(rule: any, date: Date): boolean {
        if (!rule.schedule) return false;

        const start = rule.schedule.startDate instanceof Date ? rule.schedule.startDate : (rule.schedule.startDate as any).toDate();
        // End date is optional (permanent rule?)
        const end = rule.schedule.endDate ? (rule.schedule.endDate instanceof Date ? rule.schedule.endDate : (rule.schedule.endDate as any).toDate()) : new Date(2099, 11, 31);

        // Check if date falls within range
        // Simple check
        if (date >= start && date <= end) return true;

        // Recurrence Check (Annual)
        if (rule.schedule.recurrence === 'ANNUAL') {
            const currentMonth = date.getMonth();
            const startMonth = start.getMonth();
            const endMonth = end.getMonth();

            // Handle simple case: start < end within same year
            if (currentMonth >= startMonth && currentMonth <= endMonth) return true;
        }

        return false;
    }

    private hydrateBlocks(templates: PriceBlockTemplate[], startValue: number): PriceBlock[] {
        // Simple Forward Calculation Logic (Duplicated slightly from PriceStackService but simplified for speed)
        // ideally we reuse PriceStackService, but for now we implement a lightweight calculator
        // or we can inject PriceStackService. Let's keep it pure math here to avoid circular dep if PriceStack assumes Firestore

        let runningTotal = startValue;
        const hydrated: PriceBlock[] = [];

        // Convert Template -> Block interface (partial)
        // We assume 'FORWARD' logic (Cost Plus)

        // Iterations for Percentage of Total?
        // Let's assume a simplified linear pass or 2-pass approximation
        let loopLimit = 0;
        let estimatedTotal = startValue * 1.5;
        let previousTotal = 0;

        // We need to return the Final hydrated blocks with correct .calculatedAmount
        // So we run the iterative solver

        while (Math.abs(estimatedTotal - previousTotal) > 0.05 && loopLimit < 10) {
            previousTotal = estimatedTotal;
            runningTotal = startValue;

            hydrated.length = 0; // Clear for re-run

            templates.forEach(t => {
                const block: PriceBlock = {
                    id: t.id,
                    type: t.type,
                    label: t.label,
                    value: t.defaultValue,
                    basis: t.basis as any,
                    color: t.color,
                    active: true,
                    calculatedAmount: 0,
                    subtotalAfter: 0
                } as any;

                let amount = 0;
                if (t.basis === 'FIXED') amount = t.defaultValue;
                if (t.basis === 'PERCENT_OF_BASE') amount = runningTotal * (t.defaultValue / 100);
                if (t.basis === 'PERCENT_OF_TOTAL') amount = estimatedTotal * (t.defaultValue / 100);

                // Tax Logic (Simplified: 16% on Fees)
                if (t.type === 'FEE') amount *= 1.16;
                if (t.type === 'TAX') amount = estimatedTotal * (0.16 / 1.16); // Extract Tax from total? No, if it's ADDED tax
                // If Basis is PERCENT_OF_BASE (e.g. IVA 16%), it is added.

                block.calculatedAmount = amount;
                runningTotal += amount;
                block.subtotalAfter = runningTotal;

                hydrated.push(block);
            });

            estimatedTotal = runningTotal;
            loopLimit++;
        }

        return hydrated;
    }

    private calculateUnitEconomics(blocks: PriceBlock[], startValue: number) {
        const price = blocks.length > 0 ? blocks[blocks.length - 1].subtotalAfter || 0 : startValue;

        // Profit is sum of MARGIN blocks - DISCOUNT blocks
        // Cost is everything else (COG + FEES + SHIPPING + TAX)

        let profit = 0;
        let cost = startValue; // COG

        blocks.forEach(b => {
            if (b.type === 'MARGIN') profit += b.calculatedAmount || 0;
            else if (b.type === 'DISCOUNT') profit -= b.calculatedAmount || 0; // Discount reduces profit
            else cost += b.calculatedAmount || 0; // Fee/Tax/Shipping increases cost
        });

        // Correction: if Cost + Profit != Price?
        // Price = 130. Cost = 100+10=110. Profit=20.
        // 110+20 = 130. Checks out.

        return { price, cost, profit };
    }
}
