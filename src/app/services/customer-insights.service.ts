import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

export interface CustomerProfile {
    uid: string;
    name: string;
    email: string;
    totalSpent: number;     // Monetary
    orderCount: number;     // Frequency
    lastOrderDate: Date;    // Recency
    firstOrderDate: Date;   // For Cohort
    averageOrderValue: number;
    churnRiskScore: number; // 0-100 (0=Safe, 100=Lost)
    segment: 'Champion' | 'Loyal' | 'Audio Potential' | 'At Risk' | 'Lost' | 'New';
}

export interface Cohort {
    month: string; // "2024-01"
    size: number;
    retention: number[]; // [100, 45, 30, 20...] percentages per month
}

export interface InsightsData {
    profiles: CustomerProfile[];
    cohorts: Cohort[];
    totalCLV: number;
    avgCLV: number;
    churnRate: number;
    atRiskValue: number; // Total potential lost revenue from At Risk customers
}

@Injectable({
    providedIn: 'root'
})
export class CustomerInsightsService {
    private firestore = inject(Firestore);

    getInsights(): Observable<InsightsData> {
        return from(this.calculateInsights());
    }

    private async calculateInsights(): Promise<InsightsData> {
        // 1. Fetch ALL completed orders
        // Note: In a real massive scale app, this would be a BigQuery job. 
        // For now, Firestore client-side aggregation is acceptable for < 10k orders.
        const ordersRef = collection(this.firestore, 'orders');
        const q = query(ordersRef, where('status', 'in', ['processing', 'shipped', 'delivered', 'completed']));
        const snapshot = await getDocs(q);

        const customerMap = new Map<string, {
            orders: any[],
            name: string,
            email: string
        }>();

        // 2. Group by Customer
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const uid = data['userId'] || data['customer']?.email || 'anonymous';

            // Skip anonymous/guest for deep CRM if they don't have tracking
            if (uid === 'anonymous' && !data['customer']?.email) return;

            const entry = customerMap.get(uid) || {
                orders: [] as any[],
                name: data['customer']?.name || 'Unknown',
                email: data['customer']?.email || 'No Email'
            };

            entry.orders.push({
                ...data,
                createdAt: data['createdAt']?.toDate() || new Date()
            });

            customerMap.set(uid, entry);
        });

        const profiles: CustomerProfile[] = [];
        const cohortsMap = new Map<string, Set<string>>(); // Month -> Set of UIDs

        const now = new Date();

        // 3. Process Each Customer (RFM & Churn)
        customerMap.forEach((entry, uid) => {
            const orders = entry.orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const firstOrder = orders[0];
            const lastOrder = orders[orders.length - 1];

            const totalSpent = orders.reduce((sum, o) => sum + (o.total || 0), 0);
            const orderCount = orders.length;
            const avgOrderValue = totalSpent / orderCount;

            const daysSinceLastOrder = (now.getTime() - lastOrder.createdAt.getTime()) / (1000 * 3600 * 24);
            const daysSinceFirstOrder = (now.getTime() - firstOrder.createdAt.getTime()) / (1000 * 3600 * 24);

            // Average days between orders (Frequency in days)
            let avgDaysBetweenOrders = 0;
            if (orderCount > 1) {
                avgDaysBetweenOrders = (lastOrder.createdAt.getTime() - firstOrder.createdAt.getTime()) / (1000 * 3600 * 24) / (orderCount - 1);
            } else {
                avgDaysBetweenOrders = 90; // Default assumption for single buyers
            }

            // Churn Risk Calculation
            // If it's been > 2.5x their average cycle, they are risky.
            let churnRisk = 0;
            if (orderCount === 1) {
                // Single purchase logic
                churnRisk = daysSinceLastOrder > 90 ? 80 : daysSinceLastOrder > 60 ? 50 : 20;
            } else {
                const ratio = daysSinceLastOrder / Math.max(avgDaysBetweenOrders, 30);
                churnRisk = Math.min(ratio * 33, 100);
            }

            // RFM Segmentation
            let segment: CustomerProfile['segment'] = 'New';

            if (churnRisk > 75) segment = 'Lost';
            else if (churnRisk > 50) segment = 'At Risk';
            else if (totalSpent > 10000 && orderCount > 5) segment = 'Champion'; // High Value
            else if (orderCount >= 3) segment = 'Loyal';
            else segment = 'New';

            profiles.push({
                uid,
                name: entry.name,
                email: entry.email,
                totalSpent,
                orderCount,
                lastOrderDate: lastOrder.createdAt,
                firstOrderDate: firstOrder.createdAt,
                averageOrderValue: avgOrderValue,
                churnRiskScore: Math.round(churnRisk),
                segment
            });

            // Cohort Pre-processing
            // For a cohort heatmap, we need to know:
            // "User X belongs to Cohort Jan-2024"
            // "User X bought in Month 0, Month 2, Month 5..."
        });

        // 4. Calculate Cohort Retention
        const cohorts: Cohort[] = this.buildCohorts(profiles, customerMap);

        // 5. Aggregates
        const totalCLV = profiles.reduce((sum, p) => sum + p.totalSpent, 0);
        const atRiskValue = profiles.filter(p => p.segment === 'At Risk').reduce((sum, p) => sum + (p.averageOrderValue * 2), 0); // Projected loss

        return {
            profiles: profiles.sort((a, b) => b.totalSpent - a.totalSpent),
            cohorts: cohorts.sort((a, b) => a.month.localeCompare(b.month)),
            totalCLV,
            avgCLV: profiles.length ? totalCLV / profiles.length : 0,
            churnRate: (profiles.filter(p => p.segment === 'Lost').length / profiles.length) * 100,
            atRiskValue
        };
    }

    private buildCohorts(profiles: CustomerProfile[], customerMap: Map<string, any>): Cohort[] {
        const cohortData = new Map<string, { size: number, activity: Map<number, Set<string>> }>();

        profiles.forEach(p => {
            const cohortMonth = this.getMonthKey(p.firstOrderDate);

            if (!cohortData.has(cohortMonth)) {
                cohortData.set(cohortMonth, { size: 0, activity: new Map() });
            }

            const cohort = cohortData.get(cohortMonth)!;
            cohort.size++;

            // Check activity in subsequent months
            const orders = customerMap.get(p.uid).orders;
            orders.forEach((o: any) => {
                const orderMonth = this.getMonthKey(o.createdAt);
                const monthDiff = this.monthDiff(p.firstOrderDate, o.createdAt);

                if (monthDiff >= 0) {
                    if (!cohort.activity.has(monthDiff)) {
                        cohort.activity.set(monthDiff, new Set());
                    }
                    cohort.activity.get(monthDiff)!.add(p.uid);
                }
            });
        });

        // Limit to last 12 cohorts for UI cleanliness
        const results: Cohort[] = [];
        const sortedMonths = Array.from(cohortData.keys()).sort();
        const last12 = sortedMonths.slice(-12);

        last12.forEach(m => {
            const c = cohortData.get(m)!;
            const retention: number[] = [];

            // Calculate retention for months 0 to 11
            for (let i = 0; i < 12; i++) {
                const activeCount = c.activity.get(i)?.size || 0;
                const pct = (activeCount / c.size) * 100;

                // Truncate future data (cannot have retention for months that haven't happened)
                const cohortDate = new Date(m + "-01");
                const targetDate = new Date(cohortDate);
                targetDate.setMonth(targetDate.getMonth() + i);

                if (targetDate <= new Date()) {
                    retention.push(parseFloat(pct.toFixed(1)));
                }
            }

            results.push({
                month: m,
                size: c.size,
                retention
            });
        });

        return results;
    }

    getAcquisitionStats(): Observable<any> {
        return this.getInsights().pipe(
            map(data => {
                const acquisitionByMonth = new Map<string, number>();
                data.profiles.forEach(p => {
                    const key = this.getMonthKey(p.firstOrderDate);
                    acquisitionByMonth.set(key, (acquisitionByMonth.get(key) || 0) + 1);
                });

                return Array.from(acquisitionByMonth.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([date, count]) => ({ date, count }));
            })
        );
    }

    private getMonthKey(date: Date): string {
        return date.toISOString().slice(0, 7); // "YYYY-MM"
    }

    private monthDiff(d1: Date, d2: Date): number {
        let months;
        months = (d2.getFullYear() - d1.getFullYear()) * 12;
        months -= d1.getMonth();
        months += d2.getMonth();
        return months <= 0 ? 0 : months;
    }
}
