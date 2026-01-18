export interface Competitor {
    id: string;
    name: string;
    logo?: string; // URL or icon name
    website?: string;
}

export interface CompetitorPrice {
    competitorId: string;
    competitorName: string; // Denormalized for ease
    price: number;
    lastUpdated: Date;
    url?: string; // Direct link to product
    isPromo?: boolean;
}
