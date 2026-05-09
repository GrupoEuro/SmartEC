import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { getIdToken } from '@angular/fire/auth';

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

const FUNCTIONS_BASE = 'https://us-central1-tiendapraxis.cloudfunctions.net';

@Injectable({ providedIn: 'root' })
export class CompetitorIntelligenceService {
    private auth = inject(Auth);

    private async authHeader(): Promise<{ Authorization: string; 'Content-Type': string }> {
        const user = this.auth.currentUser;
        if (!user) throw new Error('Not authenticated');
        const token = await getIdToken(user);
        return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    async fetchIntelligence(days = 7): Promise<CompetitorIntelligenceData> {
        const headers = await this.authHeader();
        const res = await fetch(`${FUNCTIONS_BASE}/getCompetitorIntelligence`, {
            method:  'POST',
            headers,
            body:    JSON.stringify({ days }),
        });
        if (!res.ok) throw new Error(`getCompetitorIntelligence: HTTP ${res.status}`);
        return res.json();
    }

    async triggerManualScan(): Promise<{ ok: boolean; totalScanned: number; durationMs: number }> {
        const headers = await this.authHeader();
        const res = await fetch(`${FUNCTIONS_BASE}/meliCompetitorScanManual`, {
            method:  'POST',
            headers,
            body:    JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`meliCompetitorScanManual: HTTP ${res.status}`);
        return res.json();
    }

    async updateConfig(config: Partial<CompetitorConfig>): Promise<void> {
        const headers = await this.authHeader();
        const res = await fetch(`${FUNCTIONS_BASE}/updateCompetitorConfig`, {
            method:  'POST',
            headers,
            body:    JSON.stringify(config),
        });
        if (!res.ok) throw new Error(`updateCompetitorConfig: HTTP ${res.status}`);
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
