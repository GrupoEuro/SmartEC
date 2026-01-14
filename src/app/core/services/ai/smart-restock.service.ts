import { Injectable } from '@angular/core';
import { SimpleLinearRegressionService } from './simple-linear-regression.service';

export interface RestockSuggestion {
    productId: string;
    productName: string;
    currentStock: number;
    dailyVelocity: number; // Avg units sold per day (based on regression trend)
    daysRemaining: number;
    suggestedReorderQuantity: number;
    stockoutDate: Date | null;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK';
}

@Injectable({
    providedIn: 'root'
})
export class SmartRestockService {

    // Configuration Constants
    private readonly SAFETY_STOCK_DAYS = 7; // Buffer
    private readonly LEAD_time_DAYS = 5; // Time to receive new stock
    private readonly ORDER_FREQUENCY_DAYS = 14; // How often we place orders

    constructor(private regressionService: SimpleLinearRegressionService) { }

    /**
     * Analyzes a single product to determine restock needs.
     * @param productId 
     * @param productName 
     * @param currentStock 
     * @param usageHistory Array of daily usage (last N days)
     */
    analyzeProduct(
        productId: string,
        productName: string,
        currentStock: number,
        usageHistory: number[]
    ): RestockSuggestion {

        // 1. Calculate Daily Velocit (Slope of usage)
        // We want the TREND, not just the average.
        // If usage is increasing, slope is positive (but in regression, "usage" is Y)
        // Wait - for depletion, we track "units sold". Slope > 0 means sales are increasing.
        // We can also just take the average of the last 7 days for a simpler velocity if history is erratic.

        const regression = this.regressionService.calculate(
            usageHistory.map((val, idx) => ({ x: idx, y: val }))
        );

        // Predict velocity for "tomorrow" (smoothing)
        const nextPeriodIndex = usageHistory.length;
        let predictedDailyUsage = regression.predict(nextPeriodIndex);

        // Fallback: If trend is negative (sales dropping to 0? or just random?), ensure we don't assume 0 usage unless history is 0.
        // Use a weighted average of (regression prediction) and (last 7 day average).
        const recentHistory = usageHistory.slice(-7);
        const avgRecent = recentHistory.reduce((a, b) => a + b, 0) / (recentHistory.length || 1);

        if (predictedDailyUsage < 0) predictedDailyUsage = avgRecent;

        // Blended Velocity (60% Trend, 40% Recent Avg) to be responsive but stable
        const velocity = (predictedDailyUsage * 0.6) + (avgRecent * 0.4);

        // 2. Days Remaining
        // If velocity is 0, we last forever.
        const daysRemaining = velocity > 0.1 ? (currentStock / velocity) : 999;

        // 3. Stockout Date
        let stockoutDate: Date | null = null;
        if (daysRemaining < 365) {
            stockoutDate = new Date();
            stockoutDate.setDate(stockoutDate.getDate() + Math.round(daysRemaining));
        }

        // 4. Suggested Reorder
        // We need to cover (Lead Time + Order Frequency) days of sales, plus Safety Stock.
        // Target Stock Level = Velocity * (LeadTime + Frequency + Safety)
        const targetDays = this.LEAD_time_DAYS + this.ORDER_FREQUENCY_DAYS + this.SAFETY_STOCK_DAYS;
        const targetStock = Math.ceil(velocity * targetDays);

        let suggestedReorderQuantity = 0;
        if (currentStock < targetStock) {
            suggestedReorderQuantity = targetStock - currentStock;
        }

        // 5. Priority
        let priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK' = 'OK';

        if (currentStock === 0) priority = 'CRITICAL';
        else if (daysRemaining <= this.LEAD_time_DAYS) priority = 'CRITICAL';
        else if (daysRemaining <= (this.LEAD_time_DAYS + 3)) priority = 'HIGH';
        else if (daysRemaining <= (this.LEAD_time_DAYS + 7)) priority = 'MEDIUM';
        else if (daysRemaining <= (this.LEAD_time_DAYS + 14)) priority = 'LOW';

        return {
            productId,
            productName,
            currentStock,
            dailyVelocity: parseFloat(velocity.toFixed(2)),
            daysRemaining: Math.round(daysRemaining),
            suggestedReorderQuantity,
            stockoutDate,
            priority
        };
    }
}
