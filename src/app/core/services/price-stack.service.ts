import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { PriceBlock } from '../models/price-constructor.model';
import { FINANCIAL_CONSTANTS } from '../constants/financial.constants';

@Injectable({
    providedIn: 'root'
})
export class PriceStackService {
    private firestore = inject(Firestore);

    /**
     * FORWARD CALCULATION (Cost Plus)
     * Start: COG
     * End: Retail Price
     */
    calculateForward(startValue: number, blocks: PriceBlock[]): PriceBlock[] {
        let currentTotal = startValue; // Running Subtotal
        const activeBlocks = blocks.filter(b => b.active);

        let estimatedTotal = startValue * 1.5; // Initial guess
        let previousTotal = 0;
        let iterations = 0;

        // Clone blocks to avoid mutating original array immediately
        const calculatedBlocks = JSON.parse(JSON.stringify(activeBlocks)) as PriceBlock[];

        while (Math.abs(estimatedTotal - previousTotal) > 0.01 && iterations < 20) {
            previousTotal = estimatedTotal;

            // Running sum for this iteration
            let runningSum = startValue;

            calculatedBlocks.forEach(block => {
                let amount = 0;

                if (block.basis === 'FIXED') {
                    amount = block.value;
                } else if (block.basis === 'PERCENT_OF_BASE') {
                    amount = runningSum * (block.value / 100);
                } else if (block.basis === 'PERCENT_OF_TOTAL') {
                    // Calculating based on our current "estimate" of the total
                    // Simplify: Assume % of Final Gross Price 
                    amount = estimatedTotal * (block.value / 100);
                }

                block.calculatedAmount = amount;

                if (block.type === 'DISCOUNT') {
                    runningSum -= amount; // Paradox: Discount reduces total?
                } else {
                    runningSum += amount;
                }

                block.subtotalAfter = runningSum;
            });

            estimatedTotal = runningSum;
            iterations++;
        }

        return calculatedBlocks;
    }

    /**
     * INVERSE CALCULATION (Net Back)
     * Start: Target Retail Price
     * End: Net Margin / Profit
     */
    calculateInverse(targetPrice: number, blocks: PriceBlock[]): PriceBlock[] {
        let remaining = targetPrice;
        const activeBlocks = blocks.filter(b => b.active);

        // Clone
        const calculatedBlocks = JSON.parse(JSON.stringify(activeBlocks)) as PriceBlock[];

        calculatedBlocks.forEach(block => {
            // Calculate the amount this block REPRESENTS
            let amount = 0;

            if (block.basis === 'PERCENT_OF_TOTAL') {
                // % of the Target Price
                amount = targetPrice * (block.value / 100);
            } else if (block.basis === 'FIXED') {
                amount = block.value;
            } else if (block.basis === 'PERCENT_OF_BASE') {
                amount = targetPrice * (block.value / 100); // Fallback
            }

            // Special Tax Logic: If it's IVA, we usually strip it.
            if (block.type === 'TAX' && block.label.includes('IVA')) {
                // Amount is the TAX part. 
                // Price = Net * 1.16. Tax = Price - (Price/1.16)
                amount = targetPrice - (targetPrice / (1 + (block.value / 100)));
            }

            block.calculatedAmount = amount;
            remaining -= amount;
            block.subtotalAfter = remaining;
        });

        return calculatedBlocks;
    }

    /**
     * Generate blocks for a channel (Async from Firestore)
     */
    async getChannelTemplates(channel: string): Promise<PriceBlock[]> {
        const internalColor = 'teal';
        const taxColor = 'rose';
        let channelColor = 'blue'; // Default for WEB/POS
        if (channel.includes('AMAZON')) channelColor = 'orange';
        if (channel.includes('MELI')) channelColor = 'yellow';

        const baseBlocks: PriceBlock[] = [
            { id: 'cog', type: 'COST', label: 'Landed COG', value: 0, basis: 'FIXED', color: internalColor, active: true, isLocked: true, icon: 'inventory' },
        ];

        if (channel === 'MANUAL') return baseBlocks;

        try {
            const q = query(
                collection(this.firestore, 'channel_commission_rules'),
                where('channel', '==', channel),
                where('active', '==', true)
            );
            const snap = await getDocs(q);

            if (snap.empty) {
                console.warn(`No rules found for ${channel}, using fallback.`);
                return this.getFallbackTemplates(channel);
            }

            const rule = snap.docs[0].data() as any;
            const blocks = [...baseBlocks];

            // 2. Margin (Internal) - Moved to Position 2 (Next to COG)
            blocks.push({
                id: 'margin',
                type: 'MARGIN',
                label: 'Net Margin',
                value: 20,
                basis: 'PERCENT_OF_TOTAL',
                color: internalColor,
                active: true,
                icon: 'trending_up'
            });

            // 3. Referral Fee
            if (rule.referralFeePercent > 0) {
                blocks.push({
                    id: 'referral',
                    type: 'FEE',
                    label: `Referral Fee (${rule.referralFeePercent}%)`,
                    value: rule.referralFeePercent,
                    basis: 'PERCENT_OF_TOTAL',
                    color: channelColor,
                    active: true,
                    icon: 'handshake'
                });
            }

            // 4. Payment Processing
            if (rule.paymentProcessingPercent > 0) {
                blocks.push({
                    id: 'pay_pct',
                    type: 'FEE',
                    label: `Payment Fee (${rule.paymentProcessingPercent}%)`,
                    value: rule.paymentProcessingPercent,
                    basis: 'PERCENT_OF_TOTAL',
                    color: channelColor,
                    active: true,
                    icon: 'credit_card'
                });
            }
            if (rule.paymentProcessingFixed > 0) {
                blocks.push({
                    id: 'pay_fix',
                    type: 'FEE',
                    label: `Payment Fixed ($${rule.paymentProcessingFixed})`,
                    value: rule.paymentProcessingFixed,
                    basis: 'FIXED',
                    color: channelColor,
                    active: true,
                    icon: 'payments'
                });
            }

            // 5. Fulfillment
            if (rule.fulfillmentType === 'FBA' || rule.fulfillmentType === 'FULL') {
                blocks.push({
                    id: 'fulfillment',
                    type: 'FEE',
                    label: `${rule.channel.split('_')[1]} Fee (Est.)`,
                    value: 85,
                    basis: 'FIXED',
                    color: channelColor,
                    active: true,
                    icon: 'local_shipping',
                    description: 'Estimated for standard item. Adjust as needed.'
                });
            }

            // 6. Taxes (Gov) - Moved to END
            blocks.push({
                id: 'iva',
                type: 'TAX',
                label: 'IVA (16%)',
                value: 16,
                basis: 'PERCENT_OF_BASE',
                color: taxColor,
                active: true,
                icon: 'account_balance'
            });

            return blocks;

        } catch (e) {
            console.error('Error fetching rules:', e);
            return this.getFallbackTemplates(channel);
        }
    }

    private getFallbackTemplates(channel: string): PriceBlock[] {
        const internalColor = 'teal';
        const taxColor = 'rose';
        let channelColor = 'blue';
        if (channel.includes('AMAZON')) channelColor = 'orange';

        const baseBlocks: PriceBlock[] = [
            { id: 'cog', type: 'COST', label: 'Landed COG', value: 0, basis: 'FIXED', color: internalColor, active: true, isLocked: true, icon: 'inventory' },
        ];

        switch (channel) {
            case 'AMAZON_FBA':
                return [
                    ...baseBlocks,
                    { id: 'margin', type: 'MARGIN', label: 'Net Margin', value: 20, basis: 'PERCENT_OF_TOTAL', color: internalColor, active: true, icon: 'trending_up' },
                    { id: 'referral', type: 'FEE', label: 'Referral Fee', value: 15, basis: 'PERCENT_OF_TOTAL', color: channelColor, active: true, icon: 'handshake' },
                    { id: 'fba', type: 'FEE', label: 'FBA Fulfillment', value: 85, basis: 'FIXED', color: channelColor, active: true, icon: 'local_shipping' },
                    { id: 'iva', type: 'TAX', label: 'IVA (16%)', value: 16, basis: 'PERCENT_OF_BASE', color: taxColor, active: true, icon: 'account_balance' }
                ];
            case 'POS':
                return [
                    ...baseBlocks,
                    { id: 'margin', type: 'MARGIN', label: 'Net Margin', value: 30, basis: 'PERCENT_OF_TOTAL', color: internalColor, active: true, icon: 'trending_up' },
                    { id: 'bank', type: 'FEE', label: 'Bank Commission', value: FINANCIAL_CONSTANTS.POS_COMMISSION_RATE * 100, basis: 'PERCENT_OF_TOTAL', color: channelColor, active: true, icon: 'credit_card' },
                    { id: 'iva', type: 'TAX', label: 'IVA (16%)', value: 16, basis: 'PERCENT_OF_BASE', color: taxColor, active: true, icon: 'account_balance' }
                ];
            default: return baseBlocks;
        }
    }
}
