const fs = require('fs');
const file = '/Volumes/MacData/Projects/Eurollantas/Website/importadora-euro/projects/internal-app/src/app/core/services/financial.service.ts';
let content = fs.readFileSync(file, 'utf8');

const replacement = `    private bqService = inject(MetricsBigqueryService);

    private formatDate(d: Date): string {
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    }

    /**
     * Get all financial dashboard data in a single optimized pass using BigQuery
     */
    getFinancialDashboardData(startDate: Date, endDate: Date): Observable<{
        revenue: RevenueMetrics;
        margin: MarginMetrics;
        profitability: ProfitabilityAnalysis[];
        bostonMatrix: BostonMatrixData;
    }> {
        return from(Promise.all([
            new Promise<{ start: Date, end: Date }>(resolve => {
                const periodDuration = endDate.getTime() - startDate.getTime();
                const prevStart = new Date(startDate.getTime() - periodDuration);
                resolve({ start: prevStart, end: new Date(startDate.getTime() - 1) });
            })
        ])).pipe(
            switchMap(([prevRange]) => {
                return from(Promise.all([
                    this.bqService.querySummaryKpisBetween(this.formatDate(startDate), this.formatDate(endDate)),
                    this.bqService.querySummaryKpisBetween(this.formatDate(prevRange.start), this.formatDate(prevRange.end)),
                    this.bqService.queryProductRevenueBetween(this.formatDate(startDate), this.formatDate(endDate), 5000),
                    this.bqService.queryProductRevenueBetween(this.formatDate(prevRange.start), this.formatDate(prevRange.end), 5000),
                    this.analyticsService.fetchSharedProductData()
                ])).pipe(
                    map(([currentKpis, prevKpis, currentData, prevData]) => {
                        return { currentKpis, prevKpis, currentData, prevData, products: this.analyticsService.getSharedProducts() };
                    })
                );
            }),
            switchMap(({ currentKpis, prevKpis, currentData, prevData, products }) => {
                return new Observable<{
                    revenue: RevenueMetrics;
                    margin: MarginMetrics;
                    profitability: ProfitabilityAnalysis[];
                    bostonMatrix: BostonMatrixData;
                }>(observer => {
                    setTimeout(() => {
                        try {
                            const currentStart = startDate;
                            const currentEnd = endDate;

                            let totalRevenue = currentKpis.reduce((sum, row) => sum + row.revenue, 0);
                            let orderCount = currentKpis.reduce((sum, row) => sum + row.orders, 0);
                            let prevTotalRevenue = prevKpis.reduce((sum, row) => sum + row.revenue, 0);
                            
                            let totalCost = 0;

                            const categoryMap = new Map<string, { name: string; revenue: number; cost: number }>();
                            const brandMap = new Map<string, { name: string; revenue: number; cost: number }>();
                            const productMap = new Map<string, {
                                product: any;
                                unitsSold: number;
                                revenue: number;
                                cost: number
                            }>();

                            currentData.forEach(row => {
                                const pid = row.sku;
                                if (!pid) return;

                                const product = products.find(p => p['sku'] === pid || p['id'] === pid) || { name: { es: row.product_name }, categoryId: 'uncategorized', brand: row.brand || 'Unknown' };
                                const quantity = row.total_units;
                                const itemRevenue = row.total_revenue;
                                const costPrice = (product as any)?.costPrice || 0;
                                const itemCost = costPrice * quantity;

                                totalCost += itemCost;

                                let catId = product['categoryId'];
                                if (!catId || catId === 'undefined' || catId === 'null') catId = 'uncategorized';

                                const catEntry = categoryMap.get(catId) || { name: catId, revenue: 0, cost: 0 };
                                catEntry.revenue += itemRevenue;
                                catEntry.cost += itemCost;
                                categoryMap.set(catId, catEntry);

                                const brand = product['brand'] || row.brand || 'Unknown';
                                const brandEntry = brandMap.get(brand) || { name: brand, revenue: 0, cost: 0 };
                                brandEntry.revenue += itemRevenue;
                                brandEntry.cost += itemCost;
                                brandMap.set(brand, brandEntry);

                                const prodEntry = productMap.get(pid) || {
                                    product,
                                    unitsSold: 0,
                                    revenue: 0,
                                    cost: 0
                                };
                                prodEntry.unitsSold += quantity;
                                prodEntry.revenue += itemRevenue;
                                prodEntry.cost += itemCost;
                                productMap.set(pid, prodEntry);
                            });

                            const prevProductRev = new Map<string, number>();
                            prevData.forEach(row => {
                                prevProductRev.set(row.sku, row.total_revenue);
                            });

                            const growthAmount = totalRevenue - prevTotalRevenue;
                            const growthPercentage = prevTotalRevenue > 0 ? (growthAmount / prevTotalRevenue) * 100 : 0;

                            const revenueMetrics: RevenueMetrics = {
                                period: this.determinePeriod(startDate, endDate),
                                startDate,
                                endDate,
                                totalRevenue,
                                averageOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
                                orderCount,
                                previousPeriodRevenue: prevTotalRevenue,
                                growthAmount,
                                growthPercentage,
                                byCategory: Array.from(categoryMap.entries()).map(([id, d]) => ({
                                    categoryId: id,
                                    categoryName: d.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue),
                                byBrand: Array.from(brandMap.entries()).map(([id, d]) => ({
                                    brandId: id,
                                    brandName: d.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue),
                                byProduct: Array.from(productMap.entries()).map(([id, d]) => ({
                                    productId: id,
                                    productName: d.product.name?.es || d.product.name,
                                    revenue: d.revenue,
                                    percentage: totalRevenue > 0 ? (d.revenue / totalRevenue) * 100 : 0
                                })).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
                            };

                            const grossProfit = totalRevenue - totalCost;
                            const marginMetrics: MarginMetrics = {
                                period: this.determinePeriod(startDate, endDate),
                                startDate,
                                endDate,
                                totalCost,
                                totalRevenue,
                                grossProfit,
                                grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
                                byCategory: Array.from(categoryMap.entries()).map(([id, d]) => ({
                                    categoryId: id,
                                    categoryName: d.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin),
                                byBrand: Array.from(brandMap.entries()).map(([id, d]) => ({
                                    brandId: id,
                                    brandName: d.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin),
                                byProduct: Array.from(productMap.entries()).map(([id, d]) => ({
                                    productId: id,
                                    productName: d.product.name?.es || d.product.name,
                                    revenue: d.revenue,
                                    cost: d.cost,
                                    margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0
                                })).sort((a, b) => b.margin - a.margin).slice(0, 10)
                            };

                            const profitability: ProfitabilityAnalysis[] = [];
                            let totalProfit = 0;

                            productMap.forEach((data, pid) => {
                                const pProfit = data.revenue - data.cost;
                                totalProfit += pProfit;
                                profitability.push({
                                    productId: pid,
                                    productName: data.product.name?.es || data.product.name,
                                    sku: data.product.sku || pid,
                                    unitsSold: data.unitsSold,
                                    totalRevenue: data.revenue,
                                    averagePrice: data.unitsSold > 0 ? data.revenue / data.unitsSold : 0,
                                    unitCost: (data.product as any)?.costPrice || 0,
                                    totalCost: data.cost,
                                    grossProfit: pProfit,
                                    grossMargin: data.revenue > 0 ? (pProfit / data.revenue) * 100 : 0,
                                    profitPerUnit: data.unitsSold > 0 ? pProfit / data.unitsSold : 0,
                                    rank: 0,
                                    contribution: 0
                                });
                            });

                            profitability.forEach(p => {
                                p.contribution = totalProfit > 0 ? (p.grossProfit / totalProfit) * 100 : 0;
                            });
                            profitability.sort((a, b) => b.grossProfit - a.grossProfit);
                            profitability.forEach((p, i) => p.rank = i + 1);

                            const points: BostonMatrixPoint[] = [];
                            const categoryCounts = new Map<string, number>();
                            productMap.forEach((p, _) => {
                                let c = p.product.categoryId || 'uncategorized';
                                if (c === 'undefined' || c === 'null') c = 'uncategorized';
                                categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
                            });

                            productMap.forEach((data, pid) => {
                                const curRev = data.revenue;
                                if (curRev === 0) return;

                                const prevRev = prevProductRev.get(pid) || 0;
                                let growth = 0;
                                if (prevRev > 0) growth = ((curRev - prevRev) / prevRev) * 100;
                                else if (curRev > 0) growth = 100;

                                let catId = data.product.categoryId;
                                if (!catId || catId === 'undefined' || catId === 'null') catId = 'uncategorized';

                                const catTotal = categoryMap.get(catId)?.revenue || 0;
                                const catCount = categoryCounts.get(catId) || 1;
                                const avgRev = catTotal / catCount;

                                const share = avgRev > 0 ? (curRev / avgRev) : 0;

                                const isHighGrowth = growth >= 10;
                                const isHighShare = share >= 1.0;

                                let quadrant: 'stars' | 'cows' | 'questions' | 'dogs';
                                if (isHighGrowth && isHighShare) quadrant = 'stars';
                                else if (!isHighGrowth && isHighShare) quadrant = 'cows';
                                else if (isHighGrowth && !isHighShare) quadrant = 'questions';
                                else quadrant = 'dogs';

                                const r = Math.min(Math.max(Math.sqrt(curRev) / 5, 5), 40);

                                points.push({
                                    productId: pid,
                                    productName: data.product.name?.es || data.product.name,
                                    categoryName: categoryMap.get(catId)?.name || catId,
                                    x: share,
                                    y: growth,
                                    r,
                                    quadrant,
                                    revenue: curRev,
                                    growth,
                                    share
                                });
                            });

                            observer.next({
                                revenue: revenueMetrics,
                                margin: marginMetrics,
                                profitability: profitability.slice(0, 20),
                                bostonMatrix: { period: 'current', points, averageMargin: marginMetrics.grossMargin, averageGrowth: growthPercentage }
                            });
                            observer.complete();
                        } catch (err) {
                            observer.error(err);
                        }
                    }, 50); // Small delay to unblock UI
                });
            })
        );
    }`;

const startIndex = content.indexOf('    /**\n     * Get all financial dashboard data in a single optimized pass\n     */\n    getFinancialDashboardData');
const endIndex = content.indexOf('    /**\n     * Get profitability analysis\n     */\n    getProfitabilityAnalysis');

if (startIndex > -1 && endIndex > -1) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex);
    fs.writeFileSync(file, before + replacement + '\n\n' + after);
    console.log('Successfully updated getFinancialDashboardData');
} else {
    console.error('Could not find start or end index', startIndex, endIndex);
}
