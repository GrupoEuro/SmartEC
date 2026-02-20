import { Injectable } from '@angular/core';

export interface DataPoint {
    x: number; // Time (timestamp or simple index)
    y: number; // Value (Sales, Quantity, etc.)
}

export interface RegressionResult {
    slope: number;
    intercept: number;
    r2: number; // Coefficient of determination (accuracy)
    predict: (x: number) => number;
    trend: 'UP' | 'DOWN' | 'FLAT';
}

@Injectable({
    providedIn: 'root'
})
export class SimpleLinearRegressionService {

    constructor() { }

    /**
     * Calculates the linear regression (y = mx + b) for a set of data points.
     * Uses the Least Squares Method.
     */
    calculate(data: DataPoint[]): RegressionResult {
        const n = data.length;
        if (n < 2) {
            return {
                slope: 0,
                intercept: 0,
                r2: 0,
                predict: () => 0,
                trend: 'FLAT'
            };
        }

        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;

        for (const point of data) {
            sumX += point.x;
            sumY += point.y;
            sumXY += (point.x * point.y);
            sumXX += (point.x * point.x);
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Calculate R-Squared
        const yMean = sumY / n;
        let ssRes = 0; // Sum of squares of residuals
        let ssTot = 0; // Total sum of squares

        for (const point of data) {
            const prediction = slope * point.x + intercept;
            ssRes += Math.pow(point.y - prediction, 2);
            ssTot += Math.pow(point.y - yMean, 2);
        }

        // Protection against division by zero (flat line)
        const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

        const trend = slope > 0.05 ? 'UP' : slope < -0.05 ? 'DOWN' : 'FLAT';

        return {
            slope,
            intercept,
            r2,
            predict: (x: number) => slope * x + intercept,
            trend
        };
    }

    /**
     * Helper to predict future values based on historical array
     * @param history Array of numbers (e.g. daily sales)
     * @param periodsToPredict Number of future periods to generate
     */
    predictFuture(history: number[], periodsToPredict: number): number[] {
        const dataPoints: DataPoint[] = history.map((val, idx) => ({ x: idx, y: val }));
        const regression = this.calculate(dataPoints);
        const futureValues: number[] = [];

        for (let i = 1; i <= periodsToPredict; i++) {
            const nextIndex = history.length - 1 + i;
            const prediction = regression.predict(nextIndex);
            futureValues.push(Math.max(0, prediction)); // Clamp to 0
        }

        return futureValues;
    }
}
