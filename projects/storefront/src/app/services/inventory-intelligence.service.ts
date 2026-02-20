import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import { ProductService } from '../core/services/product.service';
import { OrderService } from '../core/services/order.service';
import { SmartRestockService, RestockSuggestion } from '../core/services/ai/smart-restock.service';

export interface StockoutPrediction {
    productId: string;
    productName: string;
    sku: string;
    currentStock: number;
    velocity: number; // Avg units sold per day
    daysRemaining: number;
    stockoutDate: Date | null;
    status: 'critical' | 'warning' | 'healthy' | 'overstock';
    suggestedReorder: number;
}

@Injectable({
    providedIn: 'root'
})
export class InventoryIntelligenceService {
    private productService = inject(ProductService);
    private orderService = inject(OrderService);
    private smartRestockService = inject(SmartRestockService);

    /**
     * Get products at risk of stockout using AI analysis
     */
    getStockoutPredictions(thresholdDays = 30): Observable<StockoutPrediction[]> {
        return combineLatest([
            this.productService.getProducts(),
            this.orderService.getOrders()
        ]).pipe(
            map(([products, orders]) => {
                // 1. Build Daily Sales History (Last 30 Days)
                const historyLength = 30;
                const now = new Date();
                const startDate = new Date(now);
                startDate.setDate(now.getDate() - historyLength);

                // Map<productId, number[]> - Index 0 is 30 days ago, Index 29 is yesterday/today
                const productHistory = new Map<string, number[]>();

                // Initialize history arrays
                products.forEach(p => {
                    if (p.id) productHistory.set(p.id, new Array(historyLength).fill(0));
                });

                // Populate history from orders
                orders.forEach(order => {
                    const orderDate = this.getDate(order.createdAt);
                    if (orderDate >= startDate && orderDate <= now) {
                        // Calculate day index (0 to 29)
                        const dayIndex = Math.floor((orderDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

                        if (dayIndex >= 0 && dayIndex < historyLength) {
                            order.items.forEach((item: any) => {
                                const pid = item.productId || item.id;
                                const history = productHistory.get(pid);
                                if (history) {
                                    history[dayIndex] += (item.quantity || 0);
                                }
                            });
                        }
                    }
                });

                // 2. Analyze each product with SmartRestockService
                const predictions: StockoutPrediction[] = products.map(p => {
                    const history = productHistory.get(p.id!) || new Array(historyLength).fill(0);

                    const analysis = this.smartRestockService.analyzeProduct(
                        p.id!,
                        p.name.es,
                        p.stockQuantity,
                        history
                    );

                    // Map AI result to UI model
                    let status: StockoutPrediction['status'] = 'healthy';
                    if (analysis.priority === 'CRITICAL' || analysis.priority === 'HIGH') status = 'critical';
                    else if (analysis.priority === 'MEDIUM') status = 'warning';
                    else if (analysis.priority === 'OK' && analysis.daysRemaining > 90) status = 'overstock';

                    return {
                        productId: p.id!,
                        productName: p.name.es,
                        sku: p.sku,
                        currentStock: p.stockQuantity,
                        velocity: analysis.dailyVelocity,
                        daysRemaining: analysis.daysRemaining,
                        stockoutDate: analysis.stockoutDate,
                        status: status,
                        suggestedReorder: analysis.suggestedReorderQuantity
                    };
                });

                // Filter and sort
                return predictions
                    .filter(p => p.status === 'critical' || p.status === 'warning')
                    .sort((a, b) => a.daysRemaining - b.daysRemaining);
            })
        );
    }

    private getDate(val: any): Date {
        if (!val) return new Date();
        if (val.toDate) return val.toDate();
        return new Date(val);
    }
}
