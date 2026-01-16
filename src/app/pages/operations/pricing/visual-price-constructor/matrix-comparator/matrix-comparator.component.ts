import { Component, computed, inject, input, OnInit, signal, effect, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PriceStackService } from '../../../../../core/services/price-stack.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-matrix-comparator',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './matrix-comparator.component.html',
    styleUrls: ['./matrix-comparator.component.css']
})
export class MatrixComparatorComponent {
    private priceStack = inject(PriceStackService);

    // Inputs
    cog = input.required<number>();
    activeChannel = input<string>('AMAZON_FBA');

    // State
    matrixResults = signal<any[]>([]);
    isLoading = signal<boolean>(false);

    constructor() {
        // React to COG changes
        effect(() => {
            const cost = this.cog();
            this.calculateAll(cost);
        }, { allowSignalWrites: true });
    }

    async calculateAll(cost: number) {
        if (cost <= 0) return;

        this.isLoading.set(true);
        try {
            const results = await this.priceStack.calculateMatrix(cost);
            this.matrixResults.set(results);
        } catch (e) {
            console.error('Matrix calculation failed', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    getChannelName(channel: string): string {
        const key = 'PRICING_STRATEGY.UI.CHANNELS.' + channel;
        // Fallback for now if translations missing
        if (channel === 'AMAZON_FBA') return 'Amazon FBA';
        if (channel === 'AMAZON_FBM') return 'Amazon Mexico (FBM)';
        if (channel === 'MELI_CLASSIC') return 'MELI Classic';
        if (channel === 'MELI_PREMIUM') return 'MELI Premium';
        if (channel === 'MELI_FULL') return 'MELI Full';
        if (channel === 'POS') return 'POS / In-Store';
        if (channel === 'WEB') return 'Web Store';
        return channel;
    }

    getChannelIcon(channel: string): string {
        if (channel.includes('AMAZON')) return 'deployed_code'; // Box
        if (channel.includes('MELI')) return 'shopping_bag'; // Bag
        if (channel === 'POS') return 'point_of_sale';
        if (channel === 'WEB') return 'language';
        return 'store';
    }

    // Helper to get specific cost from breakdown
    getCostComponent(result: any, type: string): number {
        if (!result.breakdown) return 0;

        if (type === 'COMMISSION') {
            // Sum of Referral and Payment fees
            return result.breakdown
                .filter((b: any) => b.type === 'FEE' && (b.label.includes('Referral') || b.label.includes('Payment') || b.label.includes('Bank')))
                .reduce((acc: number, b: any) => acc + (b.calculatedAmount || 0), 0);
        }

        if (type === 'FULFILLMENT') {
            return result.breakdown
                .filter((b: any) => b.type === 'FEE' && (b.label.includes('Fee (Est)') || b.label.includes('Fulfillment')))
                .reduce((acc: number, b: any) => acc + (b.calculatedAmount || 0), 0);
        }

        return 0;
    }
}
