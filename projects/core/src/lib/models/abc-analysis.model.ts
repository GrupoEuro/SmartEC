import { Timestamp } from '@angular/fire/firestore';

export interface ABCClassification {
    productId: string;
    class: 'A' | 'B' | 'C' | 'D'; // D = Dead stock
    revenue: number;
    unitsSold: number;
    cumulativeRevenuePercent: number;
    lastCalculated: Timestamp;
}
