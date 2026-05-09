import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export interface CompetitorVelocityEntry {
    itemId:          string;
    title:           string;
    sellerId:        string;
    sellerNickname:  string;
    sellerLevel:     string;
    price:           number;
    soldQtyDelta:    number;
    soldQtyTotal:    number;
    revenueEstimate: number;
    keyword:         string;
    permalink:       string;
    thumbnail:       string;
    searchPosition:  number;
    lastScanned:     string;
}

export interface KeywordTrend {
    keyword:            string;
    listingCount:       number;
    uniqueSellers:      number;
    minPrice:           number;
    maxPrice:           number;
    avgPrice:           number;
    medianPrice:        number;
    totalSoldLifetime:  number;
    freeShippingPct:    number;
}

export interface TrackedSeller {
    sellerId:       string;
    sellerNickname: string;
    sellerLevel:    string;
    itemCount:      number;
    totalSold:      number;
    avgPrice:       number;
}

export interface CompetitorIntelligenceData {
    ok:              boolean;
    hasData:         boolean;
    latestSnapshot:  { date: string; priorDate: string; totalScanned: number; durationMs: number } | null;
    velocityRanking: CompetitorVelocityEntry[];
    trends:          KeywordTrend[];
    trackedSellers:  TrackedSeller[];
    periodDays:      number;
}

export interface CompetitorConfig {
    keywords:             string[];
    trackedSellers:       string[];
    ourSellerId:          string;
    maxResultsPerKeyword: number;
    enabled:              boolean;
}

@Injectable({ providedIn: 'root' })
export class CompetitorIntelligenceService {
    private fns = inject(Functions);

    async fetchIntelligence(days = 7): Promise<CompetitorIntelligenceData> {
        const fn = httpsCallable<{ days: number }, CompetitorIntelligenceData>(
            this.fns, 'getCompetitorIntelligence'
        );
        const result = await fn({ days });
        return result.data;
    }

    async triggerManualScan(): Promise<{ ok: boolean; totalScanned: number; durationMs: number }> {
        const fn = httpsCallable<void, { ok: boolean; totalScanned: number; durationMs: number }>(
            this.fns, 'meliCompetitorScanManual'
        );
        const result = await fn();
        return result.data;
    }

    async updateConfig(config: Partial<CompetitorConfig>): Promise<void> {
        const fn = httpsCallable<Partial<CompetitorConfig>, { ok: boolean }>(
            this.fns, 'updateCompetitorConfig'
        );
        await fn(config);
    }

    sellerLevelLabel(level: string): string {
        const map: Record<string, string> = {
            '5_green':       'Platinum',
            '4_light_green': 'Gold',
            '3_yellow':      'Silver',
            '2_orange':      'Bronze',
            '1_red':         'Nuevo',
        };
        return map[level] ?? level;
    }

    sellerLevelColor(level: string): string {
        const map: Record<string, string> = {
            '5_green':       '#10b981',
            '4_light_green': '#f59e0b',
            '3_yellow':      '#94a3b8',
            '2_orange':      '#f97316',
            '1_red':         '#ef4444',
        };
        return map[level] ?? '#64748b';
    }
}
