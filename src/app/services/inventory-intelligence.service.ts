import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import { ProductService } from '../core/services/product.service';
import { OrderService } from '../core/services/order.service';

export interface StockoutPrediction {
    productId: string;
    productName: string;
    sku: string;
    currentStock: number;
    velocity: number; // Avg units sold per day
    daysRemaining: number;
    stockoutDate: Date;
    status: 'critical' | 'warning' | 'healthy' | 'overstock';
    channel?: string; // Optional: velocity per channel
}

@Injectable({
    providedIn: 'root'
})
export class InventoryIntelligenceService {
    private productService = inject(ProductService);
    private orderService = inject(OrderService);

    /**
     * Get products at risk of stockout
     * @param thresholdDays Days of coverage to consider "Critical" (default 14)
     */
    getStockoutPredictions(thresholdDays = 30): Observable<StockoutPrediction[]> {
        return combineLatest([
            this.productService.getProducts(),
            this.orderService.getOrders()
        ]).pipe(
            map(([products, orders]) => {
                // 1. Calculate Velocity (Last 30 Days)
                const now = new Date();
                const thirtyDaysAgo = new Date(now);
                thirtyDaysAgo.setDate(now.getDate() - 30);

                const recentOrders = orders.filter(o => {
                    const d = this.getDate(o.createdAt);
                    return d >= thirtyDaysAgo;
                });

                // Map Product ID -> Units Sold
                const salesMap = new Map<string, number>();
                recentOrders.forEach(order => {
                    order.items.forEach((item: any) => {
                        const pid = item.productId || item.id;
                        salesMap.set(pid, (salesMap.get(pid) || 0) + item.quantity);
                    });
                });

                // 2. Predict Stockouts
                const predictions: StockoutPrediction[] = products.map(p => {
                    const soldLast30 = salesMap.get(p.id!) || 0;
                    const velocity = soldLast30 / 30; // units per day

                    let daysRemaining = 999;
                    if (velocity > 0) {
                        daysRemaining = p.stockQuantity / velocity;
                    }

                    const stockoutDate = new Date();
                    stockoutDate.setDate(stockoutDate.getDate() + daysRemaining);

                    let status: StockoutPrediction['status'] = 'healthy';
                    if (daysRemaining <= 7) status = 'critical';
                    else if (daysRemaining <= 21) status = 'warning';
                    else if (daysRemaining > 90) status = 'overstock';

                    return {
                        productId: p.id!,
                        productName: p.name.es, // Default to ES
                        sku: p.sku,
                        currentStock: p.stockQuantity,
                        velocity,
                        daysRemaining,
                        stockoutDate,
                        status
                    };
                });

                // Filter to show only relevant items (at risk or warning)
                // sort by most critical
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
