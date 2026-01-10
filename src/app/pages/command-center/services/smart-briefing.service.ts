import { Injectable, inject } from '@angular/core';
import { CommandCenterDataService } from './command-center-data.service';
import {
    RevenueTrend, TopProduct, CategorySales, BrandSales,
    InventoryMetrics, ProductPerformance
} from '../../../services/analytics.service';
import {
    OrderMetrics, SLAMetrics, StaffPerformance
} from '../../../services/operational-metrics.service';
import { TranslateService } from '@ngx-translate/core';

// Define shapes matching DataService output
export interface SalesAnalyticsData {
    revenueTrends: RevenueTrend[];
    topProducts: TopProduct[];
    categorySales: CategorySales[];
    brandSales: BrandSales[];
}

export interface InventoryData {
    metrics: InventoryMetrics;
    performance: ProductPerformance[];
}

export interface OperationalData {
    orderMetrics: OrderMetrics;
    slaMetrics: SLAMetrics;
    staffPerformance: StaffPerformance[];
    fulfillmentTrend: any[]; // trend data
    slaTrend: any[]; // trend data
}

export interface Insight {
    type: 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'INFO';
    title: string;
    message: string;
    impact?: string; // e.g. "-$1,200 Revenue" or "+5% Margin"
    category: 'SALES' | 'INVENTORY' | 'OPERATIONS' | 'FINANCIAL';
}

export interface ExecutiveBriefing {
    headline: string;
    tone: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
    score: number; // 0-100 Health Score
    insights: Insight[];
    generatedAt: Date;
}

@Injectable({
    providedIn: 'root'
})
@Injectable({
    providedIn: 'root'
})
export class SmartBriefingService {
    private dataService = inject(CommandCenterDataService);
    private translate = inject(TranslateService);

    // Signals from Data Service
    private salesData = this.dataService.salesAnalyticsData$;
    private inventoryData = this.dataService.inventoryData$;
    private operationalData = this.dataService.operationalData$;

    generateBriefing(
        sales: SalesAnalyticsData | null,
        inventory: InventoryData | null,
        ops: OperationalData | null
    ): ExecutiveBriefing {
        const insights: Insight[] = [];
        let score = 85; // Baseline healthy score

        if (!sales || !inventory || !ops) {
            return this.getLoadingState();
        }

        // --- 1. Sales Analysis (The "What") ---
        const totalRevenue = sales.revenueTrends.reduce((acc: number, curr: RevenueTrend) => acc + curr.revenue, 0);
        // Mock Target (In real app, fetch from config)
        const dailyTarget = 5000 * sales.revenueTrends.length;
        const revenueDiff = totalRevenue - dailyTarget;
        const revenueP_change = (revenueDiff / dailyTarget) * 100;

        if (revenueP_change < -10) {
            score -= 15;
            insights.push({
                type: 'CRITICAL',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.REVENUE_MISS.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.REVENUE_MISS.MESSAGE', { percent: Math.abs(revenueP_change).toFixed(1) }),
                impact: `${this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.MISS')}: -${this.formatCurrency(revenueDiff)}`,
                category: 'SALES'
            });
        } else if (revenueP_change > 10) {
            score += 10;
            insights.push({
                type: 'SUCCESS',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.STRONG_SALES.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.STRONG_SALES.MESSAGE', { percent: revenueP_change.toFixed(1) }),
                impact: `${this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.LIFT')}: +${this.formatCurrency(revenueDiff)}`,
                category: 'SALES'
            });
        }

        // --- 2. Inventory Analysis (The "Why" - Stockouts) ---
        const stockouts = inventory.metrics.outOfStockProducts;
        const lowStock = inventory.metrics.lowStockProducts;

        // Advanced Heuristic: Did Stockouts cause the Revenue Miss?
        if (revenueP_change < 0 && stockouts > 5) {
            insights.push({
                type: 'WARNING',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.INVENTORY_DRAG.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.INVENTORY_DRAG.MESSAGE', { count: stockouts }),
                impact: this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.HIGH_CORRELATION'),
                category: 'INVENTORY'
            });
            score -= 10;
        } else if (stockouts > 10) {
            // Just generally bad
            insights.push({
                type: 'WARNING',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.SUPPLY_CHAIN_RISK.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.SUPPLY_CHAIN_RISK.MESSAGE', { oos: stockouts, low: lowStock }),
                category: 'INVENTORY'
            });
            score -= 5;
        }

        const pendingOrders = ops.orderMetrics?.pendingOrders || 0;
        const slaOverdue = ops.slaMetrics?.overdueOrders || 0;
        const slaCompliance = ops.slaMetrics?.complianceRate || 100;

        if (slaOverdue > 0 || slaCompliance < 90) {
            insights.push({
                type: 'CRITICAL',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.SLA_BREACH.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.SLA_BREACH.MESSAGE', { count: slaOverdue, rate: slaCompliance.toFixed(1) }),
                impact: this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.SLA_RISK'),
                category: 'OPERATIONS'
            });
            score -= 15;
        }

        if (pendingOrders > 20) {
            insights.push({
                type: 'WARNING',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.FULFILLMENT_BOTTLENECK.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.FULFILLMENT_BOTTLENECK.MESSAGE', { count: pendingOrders }),
                category: 'OPERATIONS'
            });
            score -= 10;
        }

        // --- 4. Portfolio Analysis (The "Hidden Risks") ---

        // Hero Product Risk
        if (sales.topProducts.length > 0) {
            const topProduct = sales.topProducts[0];
            const topProductPerf = inventory.performance.find(p => p.productId === topProduct.productId);

            if (topProductPerf && (topProductPerf.stockLevel === 'low' || topProductPerf.stockLevel === 'out_of_stock')) {
                insights.push({
                    type: 'CRITICAL',
                    title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.HERO_PRODUCT_RISK.TITLE'),
                    message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.HERO_PRODUCT_RISK.MESSAGE', { product: topProduct.productName }),
                    impact: this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.OPPORTUNITY_COST'),
                    category: 'INVENTORY'
                });
                score -= 20; // Critical hit for hero product stockout
            }
        }

        // Dead Stock Warning
        if (inventory.metrics.deadStockCount > 10) {
            insights.push({
                type: 'INFO',
                title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.DEAD_STOCK.TITLE'),
                message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.DEAD_STOCK.MESSAGE', { count: inventory.metrics.deadStockCount }),
                category: 'INVENTORY'
            });
            // Score impact is minor for dead stock, it's more of an FYI
        }

        // Category Concentration Risk
        if (sales.categorySales.length > 0) {
            const topCategory = sales.categorySales[0];
            if (topCategory.percentage > 60) {
                insights.push({
                    type: 'INFO',
                    title: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.CATEGORY_DOMINANCE.TITLE'),
                    message: this.translate.instant('COMMAND_CENTER.AI_ANALYST.INSIGHTS.CATEGORY_DOMINANCE.MESSAGE', { category: topCategory.category, percent: topCategory.percentage.toFixed(0) }),
                    impact: this.translate.instant('COMMAND_CENTER.AI_ANALYST.IMPACT.CONCENTRATION'),
                    category: 'SALES'
                });
            }
        }

        // --- 4. Synthesis (Headline) ---
        let headline = this.translate.instant('COMMAND_CENTER.AI_ANALYST.HEADLINE.NEUTRAL');
        let tone: ExecutiveBriefing['tone'] = 'NEUTRAL';

        if (score >= 90) {
            headline = this.translate.instant('COMMAND_CENTER.AI_ANALYST.HEADLINE.POSITIVE');
            tone = 'POSITIVE';
        } else if (score < 70) {
            headline = this.translate.instant('COMMAND_CENTER.AI_ANALYST.HEADLINE.NEGATIVE');
            tone = 'NEGATIVE';
        } else if (revenueP_change > 0 && stockouts > 5) {
            headline = this.translate.instant('COMMAND_CENTER.AI_ANALYST.HEADLINE.MIXED_GROWTH_PAIN');
            tone = 'MIXED';
        } else if (revenueP_change < 0) {
            headline = this.translate.instant('COMMAND_CENTER.AI_ANALYST.HEADLINE.MIXED_SOFT_REVENUE');
            tone = 'MIXED';
        }

        return {
            headline,
            tone,
            score: Math.max(0, Math.min(100, score)),
            insights,
            generatedAt: new Date()
        };
    }

    private getLoadingState(): ExecutiveBriefing {
        return {
            headline: "Analyzing latest data...", // Keeping this one simple fallback or translate if possible
            tone: 'NEUTRAL',
            score: 0,
            insights: [],
            generatedAt: new Date()
        };
    }

    private formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(Math.abs(value));
    }
}
