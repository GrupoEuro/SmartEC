import { Injectable, signal, computed, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { StateRegistryService } from '../../../core/services/state-registry.service';

export type PeriodType = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom' | 'ytd' | 'lastYear';

@Injectable({
    providedIn: 'root'
})
export class CommandCenterContextService {
    // State - Initialize with default period to prevent null dateRange
    selectedPeriod = signal<string>('thisMonth'); // CRITICAL: Must start with value, not null
    selectedChannels = signal<string[]>([]); // Empty array = All Channels
    customDateRange = signal<{ start: Date; end: Date } | null>(null);
    refreshSignal = signal<number>(0);
    isInitialized = signal(true); // Already initialized since we have default period

    // Available Channels (Hardcoded for now, could be dynamic)
    availableChannels = [
        { id: 'WEB', label: 'Web Store', icon: 'globe' },
        { id: 'POS', label: 'Point of Sale', icon: 'monitor' },
        { id: 'AMAZON_MFN', label: 'Amazon MFN', icon: 'shopping-bag' },
        { id: 'AMAZON_FBA', label: 'Amazon FBA', icon: 'box' },
        { id: 'MELI_CLASSIC', label: 'MercadoLibre', icon: 'shopping_cart' }, // Snake case matches registry
        { id: 'MELI_FULL', label: 'MercadoLibre Full', icon: 'zap' },
        { id: 'ON_BEHALF', label: 'On Behalf (B2B)', icon: 'phone' }
    ];

    constructor() {
        const registry = inject(StateRegistryService);

        // Register State for DevTools
        registry.register({
            name: 'CommandCenterContext',
            get: () => ({
                selectedPeriod: this.selectedPeriod(),
                selectedChannels: this.selectedChannels(),
                customDateRange: this.customDateRange(),
                dateRange: this.dateRange() // computed, included for view only
            }),
            set: (state: any) => {
                if (state.selectedPeriod) this.selectedPeriod.set(state.selectedPeriod);
                if (state.selectedChannels) this.selectedChannels.set(state.selectedChannels);
                if (state.customDateRange) this.customDateRange.set(state.customDateRange);
            }
        });

        // Initialize with default period
    }

    // Helper to check initialization
    get isReady() {
        return this.isInitialized();
    }

    // Dynamic month options (last 18 months)
    get monthOptions() {
        const options: { value: string, label: string, year: number, date: Date }[] = [];
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        for (let i = 0; i < 18; i++) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const year = date.getFullYear();
            const month = date.getMonth();

            options.push({
                value: `${year}-${String(month + 1).padStart(2, '0')}`,
                label: date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
                year: year,
                date: date
            });
        }
        return options;
    }

    // Group months by year
    get groupedMonthOptions() {
        const months = this.monthOptions;
        const grouped: { [year: number]: typeof months } = {};

        months.forEach(month => {
            if (!grouped[month.year]) {
                grouped[month.year] = [];
            }
            grouped[month.year].push(month);
        });
        return grouped;
    }

    descendingOrder = (a: any, b: any) => {
        return b.key - a.key;
    };

    /**
     * Calculate date range for a given period (extracted from computed)
     */
    private calculateDateRangeForPeriod(period: string): { start: Date, end: Date } | null {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let start: Date;
        let end: Date = new Date(now);

        // Handle YYYY-MM format
        if (period.match(/^\d{4}-\d{2}$/)) {
            const [year, month] = period.split('-').map(Number);
            start = new Date(year, month - 1, 1);
            end = new Date(year, month, 0, 23, 59, 59);
            return { start, end };
        }

        switch (period) {
            case 'today':
                start = new Date(today);
                end = new Date(now);
                break;
            case 'yesterday':
                start = new Date(today);
                start.setDate(today.getDate() - 1);
                end = new Date(today);
                end.setMilliseconds(-1);
                break;
            case 'last7days':
                start = new Date(today);
                start.setDate(today.getDate() - 7);
                break;
            case 'last30days':
                start = new Date(today);
                start.setDate(today.getDate() - 30);
                break;
            case 'thisMonth':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'lastMonth':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'ytd':
                start = new Date(now.getFullYear(), 0, 1);
                break;
            case 'lastYear':
                start = new Date(now.getFullYear() - 1, 0, 1);
                end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
                break;
            case 'custom':
                if (this.customDateRange()) {
                    return this.customDateRange()!;
                }
                start = new Date(today);
                break;
            default:
                start = new Date(today);
        }

        return { start, end };
    }

    // Computed Date Range - Always returns a valid range since selectedPeriod is always defined
    dateRange = computed<{ start: Date, end: Date }>(() => {
        const period = this.selectedPeriod();
        return this.calculateDateRangeForPeriod(period)!; // Safe to use ! since period is always defined
    });

    setPeriod(period: string) {
        console.log(`📅 [ContextService] Setting period to: ${period}`);
        this.selectedPeriod.set(period);
    }

    toggleChannel(channelId: string | null) {
        if (!channelId) {
            // Clear all
            console.log(`📡 [ContextService] Clearing channel selection (All)`);
            this.selectedChannels.set([]);
            return;
        }

        this.selectedChannels.update(current => {
            if (current.includes(channelId)) {
                return current.filter(c => c !== channelId);
            } else {
                return [...current, channelId];
            }
        });
        console.log(`📡 [ContextService] Selected channels:`, this.selectedChannels());
    }

    setCustomRange(start: Date, end: Date) {
        this.customDateRange.set({ start, end });
        this.selectedPeriod.set('custom');
    }

    triggerRefresh() {
        console.log('🔄 [ContextService] Triggering manual refresh');
        this.refreshSignal.update(n => n + 1);
    }
}
