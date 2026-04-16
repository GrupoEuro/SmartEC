import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Firestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from '@angular/fire/firestore';

// ─── MercadoLibre API Types ───────────────────────────────────────────────────

export interface MeliSearchResult {
    id: string;
    title: string;
    price: number;
    currency_id: string;
    available_quantity: number;
    sold_quantity: number;
    condition: 'new' | 'used';
    thumbnail: string;
    permalink: string;
    seller: { id: number; nickname: string };
    shipping: { free_shipping: boolean };
    attributes?: { id: string; value_name: string }[];
}

export interface MeliSearchResponse {
    site_id: string;
    results: MeliSearchResult[];
    paging: { total: number; offset: number; limit: number };
}

// ─── Internal Types ───────────────────────────────────────────────────────────

export interface CompetitorPrice {
    source: 'mercadolibre' | 'amazon' | 'walmart' | 'internal';
    title: string;
    price: number;
    url: string;
    freeShipping: boolean;
    soldQty?: number;
    availableQty?: number;
    seller?: string;
    thumbnail?: string;
    condition?: 'new' | 'used';
    fetchedAt: Date;
}

export interface PriceScan {
    query: string;
    normalizedSize: string;
    results: CompetitorPrice[];
    min: number;
    max: number;
    median: number;
    avg: number;
    fetchedAt: Date;
}

export interface MotoEntry {
    brand: string;
    model: string;
    segment: string;
    frontSize: string;
    rearSize: string;
    rimSize: number;
    popularity: 'muy alta' | 'alta' | 'media' | 'nueva';
    notes?: string;
}

// ─── Mexico Motorcycle Database ───────────────────────────────────────────────

export const MEXICO_MOTO_DB: MotoEntry[] = [
    { brand: 'Italika', model: 'AT110',    segment: 'Trabajo',   frontSize: '2.50-17',   rearSize: '2.75-17',   rimSize: 17, popularity: 'muy alta' },
    { brand: 'Italika', model: 'FT125',    segment: 'Trabajo',   frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'muy alta' },
    { brand: 'Italika', model: 'FT150',    segment: 'Trabajo',   frontSize: '2.75-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'muy alta', notes: 'Best-seller México' },
    { brand: 'Italika', model: 'FT200',    segment: 'Trabajo',   frontSize: '3.00-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'alta' },
    { brand: 'Honda',   model: 'CB125F',   segment: 'Commuter',  frontSize: '80/100-17', rearSize: '90/90-17',  rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'CB150 Invicta', segment: 'Commuter', frontSize: '80/100-17', rearSize: '110/80-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'XR150L',   segment: 'Dual Sport',frontSize: '80/100-17', rearSize: '100/80-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Honda',   model: 'CG150',    segment: 'Trabajo',   frontSize: '2.75-18',   rearSize: '3.00-18',   rimSize: 18, popularity: 'alta' },
    { brand: 'Yamaha',  model: 'FZ16 S',   segment: 'Sport',     frontSize: '100/80-17', rearSize: '130/70-17', rimSize: 17, popularity: 'alta' },
    { brand: 'Yamaha',  model: 'YBR125',   segment: 'Commuter',  frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'alta' },
    { brand: 'Yamaha',  model: 'SZ-RR',    segment: 'Trabajo',   frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'Suzuki',  model: 'GS150R',   segment: 'Commuter',  frontSize: '80/100-17', rearSize: '100/90-17', rimSize: 17, popularity: 'media' },
    { brand: 'TVS',     model: 'Sport 110',segment: 'Trabajo',   frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'TVS',     model: 'Apache 160',segment: 'Sport',    frontSize: '90/90-17',  rearSize: '110/80-17', rimSize: 17, popularity: 'media' },
    { brand: 'Bajaj',   model: 'Boxer CT100', segment: 'Trabajo',frontSize: '2.75-17',   rearSize: '3.00-17',   rimSize: 17, popularity: 'media' },
    { brand: 'Hero',    model: 'Hunk 150', segment: 'Sport',     frontSize: '80/100-17', rearSize: '100/90-17', rimSize: 17, popularity: 'media' },
    { brand: 'Honda',   model: 'CB190R',   segment: 'Sport',     frontSize: '100/80-17', rearSize: '130/70-17', rimSize: 17, popularity: 'nueva', notes: 'Segmento creciente' },
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PriceIntelligenceService {
    private http = inject(HttpClient);
    private firestore = inject(Firestore);

    private readonly MELI_BASE = 'https://api.mercadolibre.com';
    private readonly MELI_SITE = 'MLM'; // Mexico

    /** Normalize tire size string for search queries */
    normalizeTireSize(input: string): string {
        return input.trim()
            .replace(/\s+/g, '')
            .replace(/x/gi, '/')       // 120x80-17 → 120/80-17
            .replace(/R(\d+)/i, '-$1') // 120/80R17 → 120/80-17
            .toUpperCase();
    }

    /** Build MeLi search queries for a tire size */
    buildMeliQueries(size: string): string[] {
        const normalized = this.normalizeTireSize(size);
        return [
            `llanta moto ${normalized}`,
            `neumatico moto ${normalized}`,
            `tire motorcycle ${normalized}`,
        ];
    }

    /** Search MercadoLibre public API — no auth required */
    async searchMeli(query: string, limitResults = 50): Promise<CompetitorPrice[]> {
        try {
            const url = `${this.MELI_BASE}/sites/${this.MELI_SITE}/search?q=${encodeURIComponent(query)}&limit=${limitResults}`;
            const res = await firstValueFrom(this.http.get<MeliSearchResponse>(url));

            return res.results.map(item => ({
                source:       'mercadolibre' as const,
                title:        item.title,
                price:        item.price,
                url:          item.permalink,
                freeShipping: item.shipping?.free_shipping ?? false,
                soldQty:      item.sold_quantity,
                availableQty: item.available_quantity,
                seller:       item.seller?.nickname,
                thumbnail:    item.thumbnail,
                condition:    item.condition,
                fetchedAt:    new Date(),
            }));
        } catch (err) {
            console.error('[PriceIntel] MeLi search error:', err);
            return [];
        }
    }

    /** Main scan: run parallel MeLi queries, deduplicate, compute stats */
    async scanCompetitorPrices(tireSize: string): Promise<PriceScan> {
        const normalized = this.normalizeTireSize(tireSize);
        const queries = this.buildMeliQueries(normalized);

        // Run all queries in parallel (MeLi public API is very fast)
        const resultArrays = await Promise.all(queries.map(q => this.searchMeli(q, 30)));

        // Deduplicate by listing ID using URL as key
        const seen = new Set<string>();
        const allResults: CompetitorPrice[] = [];
        for (const arr of resultArrays) {
            for (const r of arr) {
                if (!seen.has(r.url)) {
                    seen.add(r.url);
                    allResults.push(r);
                }
            }
        }

        // Filter: price must be > $0 and < $5000 (sanity check)
        const validPrices = allResults.filter(r => r.price > 0 && r.price < 5000);
        const prices = validPrices.map(r => r.price).sort((a, b) => a - b);

        const min    = prices.length ? prices[0] : 0;
        const max    = prices.length ? prices[prices.length - 1] : 0;
        const avg    = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
        const median = prices.length
            ? prices.length % 2 === 0
                ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
                : prices[Math.floor(prices.length / 2)]
            : 0;

        // Sort by sold_quantity desc (most popular first)
        allResults.sort((a, b) => (b.soldQty ?? 0) - (a.soldQty ?? 0));

        return {
            query: tireSize,
            normalizedSize: normalized,
            results: allResults,
            min, max, median,
            avg: Math.round(avg),
            fetchedAt: new Date(),
        };
    }

    /** Get all unique rim sizes for a given brand from the DB */
    getMotosForSize(size: string): MotoEntry[] {
        const normalized = this.normalizeTireSize(size);
        return MEXICO_MOTO_DB.filter(m =>
            this.normalizeTireSize(m.frontSize) === normalized ||
            this.normalizeTireSize(m.rearSize)  === normalized
        );
    }

    /** Statistics helpers */
    formatCurrencyMXN(value: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value);
    }
}
