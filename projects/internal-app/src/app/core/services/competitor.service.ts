import { Injectable } from '@angular/core';
import { delay, Observable, of } from 'rxjs';
import { CompetitorPrice } from '../models/competitor.model';

@Injectable({
    providedIn: 'root'
})
export class CompetitorService {

    constructor() { }

    /**
     * Mock method to simulate fetching competitor prices
     */
    getCompetitorPrices(productId: string): Observable<CompetitorPrice[]> {
        // Simulate API latency
        const mockPrices: CompetitorPrice[] = [
            {
                competitorId: 'meli',
                competitorName: 'MercadoLibre',
                price: 1299.00,
                lastUpdated: new Date(),
                url: 'https://mercadolibre.com.mx',
                isPromo: true
            },
            {
                competitorId: 'amazon',
                competitorName: 'Amazon MX',
                price: 1350.50,
                lastUpdated: new Date(),
                url: 'https://amazon.com.mx'
            },
            {
                competitorId: 'walmart',
                competitorName: 'Walmart',
                price: 1400.00,
                lastUpdated: new Date(),
                url: 'https://walmart.com.mx'
            }
        ];

        return of(mockPrices).pipe(delay(800));
    }
}
