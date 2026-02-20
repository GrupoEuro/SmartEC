import { Component, OnInit, inject, signal, ViewChild, computed, NgZone, effect } from '@angular/core';
// Force rebuild trigger
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ChartCardComponent, TableColumn } from '../../../shared/components/chart-card/chart-card.component';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';
import { Chart, ChartConfiguration, ChartData, registerables } from 'chart.js';
import { IncomeStatementService } from '../../../core/services/income-statement.service';
import { FinancialService } from '../../../core/services/financial.service';
import { IncomeStatement, IncomeStatementComparison } from '../../../core/models/income-statement.model';
import { CommandCenterContextService } from '../services/command-center-context.service';

interface ScenarioAction {
    key: string;
    params: any;
}

interface Scenario {
    name: string;
    icon: string;
    description: string;
    actions: ScenarioAction[];
    newScore: number;
    difficulty: string;
    timeframe: string;
}
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { take, finalize, switchMap, tap } from 'rxjs/operators';

// Register Chart.js components
Chart.register(...registerables);

@Component({
    selector: 'app-income-statement',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        TranslateModule,
        AppIconComponent,
        AppIconComponent,
        ChartCardComponent,
        DashboardDiagnosticsComponent
    ],
    templateUrl: './income-statement.component.html',
    styleUrls: ['./income-statement.component.css']
})
export class IncomeStatementComponent implements OnInit {
    private incomeStatementService = inject(IncomeStatementService);
    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);
    private translate = inject(TranslateService);

    // Convert observable to signal
    private incomeStatementData = toSignal(this.dataService.incomeStatementData$, {
        initialValue: null
    });

    constructor() {
        // Effects removed as charts are now fully reactive signals
    }

    isLoading = toSignal(this.dataService.isLoading$, {
        initialValue: false
    });

    // State
    showComparison = false;
    showHealthDetails = false;

    // Data - computed from service
    statement = computed(() => this.incomeStatementData());
    comparison = signal<IncomeStatementComparison | null>(null);

    // Charts
    // ViewChild removed as we use input bindings now

    // Table Configurations
    revenueTableColumns: TableColumn[] = [
        { key: 'label', label: 'Period', format: 'text' as any },
        { key: 'value', label: 'Net Sales', format: 'currency' }
    ];

    expenseTableColumns: TableColumn[] = [
        { key: 'label', label: 'Category', format: 'category' },
        { key: 'value', label: 'Amount', format: 'currency' }
    ];

    // Computed Table Data
    revenueTableData = computed<any[]>(() => {
        const stmt = this.statement();
        if (!stmt) return [];
        // Currently singular period, but logic ready for array
        return [{
            label: stmt.period,
            value: stmt.netSales
        }];
    });

    expenseTableData = computed<any[]>(() => {
        const stmt = this.statement();
        if (!stmt) return [];
        return stmt.operatingExpenses.map(exp => ({
            label: exp.categoryName,
            value: exp.amount
        }));
    });

    ngOnInit() {
        // Initial load trigger if needed, though data service typically usually handles this via subscription
    }

    // Helper methods restored
    // loadDailyRevenue removed - replaced by reactive signal below

    loadComparison(currentRange: { start: Date; end: Date }) {
        const periodLength = currentRange.end.getTime() - currentRange.start.getTime();
        const previousStart = new Date(currentRange.start.getTime() - periodLength);
        const previousEnd = currentRange.start;

        this.incomeStatementService.comparePeriods(currentRange.start, currentRange.end, previousStart, previousEnd)
            .pipe(take(1))
            .subscribe({
                next: (comparison) => {
                    this.comparison.set(comparison);
                    // Charts are reactive; setting comparison is enough if we use it, 
                    // though charts usually display current statement data which comes from dataService
                },
                error: (err) => console.error('Error loading comparison:', err)
            });
    }

    toggleComparison() {
        this.showComparison = !this.showComparison;
        this.dataService.refresh();
    }

    refreshData() {
        this.dataService.refresh();
    }

    // updateCharts removed - charts are reactive

    // Removed updateRevenueChartSafe as it's no longer needed with signals

    updateRevenueChart(statement: IncomeStatement) {
        // No-op: Revenue chart is now reactive via dailyRevenueSignal
        // Keeping method signature for compatibility if needed, but logic is handled by signals
    }

    // updateExpenseChart removed - replaced by computed signal

    // Revenue Trend Chart

    // Reactive Daily Revenue Source
    private dailyRevenueSignal = toSignal(
        toObservable(this.contextService.dateRange).pipe(
            tap(range => console.log('Date range changed in signal:', range)),
            switchMap(range =>
                this.incomeStatementService.getDailyRevenue(range.start, range.end).pipe(
                    tap(data => console.log('Daily revenue stream emitted:', data.labels.length, 'points'))
                )
            )
        ),
        { initialValue: { labels: [], data: [] } }
    );

    // Revenue Trend Chart - Computed
    revenueTrendData = computed<ChartData<'bar'>>(() => {
        const dailyData = this.dailyRevenueSignal();

        return {
            labels: dailyData?.labels || [],
            datasets: [{
                label: 'Revenue',
                data: dailyData?.data || [],
                backgroundColor: 'rgba(251, 191, 36, 0.8)',
                borderColor: '#fbbf24',
                borderWidth: 2
            }]
        };
    });

    // Diagnostics Data
    debugData = computed(() => {
        return {
            dateRange: this.contextService.dateRange(),
            dailyRevenuePoints: this.dailyRevenueSignal()?.data?.length || 0,
            dailyRevenueLabels: this.dailyRevenueSignal()?.labels?.length || 0,
            rawDailyRevenue: this.dailyRevenueSignal(),
            statementPeriod: this.statement()?.period,
            netSales: this.statement()?.netSales,
            isLoading: this.isLoading()
        };
    });

    revenueTrendOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#fbbf24',
                bodyColor: '#cbd5e1',
                borderColor: '#fbbf24',
                borderWidth: 1,
                callbacks: {
                    label: (context) => {
                        return 'Revenue: $' + (context.parsed.y || 0).toLocaleString();
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    color: '#94a3b8',
                    callback: (value) => '$' + value.toLocaleString()
                },
                grid: { color: 'rgba(148, 163, 184, 0.1)' }
            },
            x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' }
            }
        }
    };

    // Expense Breakdown Chart
    expenseChartData = computed<ChartData<'doughnut'>>(() => {
        const stmt = this.statement();
        if (!stmt || stmt.operatingExpenses.length === 0) {
            return {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [],
                    borderColor: '#0f172a',
                    borderWidth: 2
                }]
            };
        }

        return {
            labels: stmt.operatingExpenses.map(e => e.categoryName),
            datasets: [{
                data: stmt.operatingExpenses.map(e => e.amount),
                backgroundColor: [
                    '#ef4444', // Red - Salaries
                    '#f97316', // Orange - Rent
                    '#f59e0b', // Amber - Marketing
                    '#eab308', // Yellow - Insurance
                    '#84cc16', // Lime - Shipping
                    '#22c55e', // Green - Professional Services
                    '#14b8a6', // Teal - Utilities
                    '#06b6d4', // Cyan - Supplies
                    '#3b82f6'  // Blue - Maintenance
                ],
                borderColor: '#0f172a',
                borderWidth: 2
            }]
        };
    });

    expenseChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right',
                labels: {
                    color: '#cbd5e1',
                    padding: 10,
                    font: { size: 11 }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#fbbf24',
                bodyColor: '#cbd5e1',
                borderColor: '#fbbf24',
                borderWidth: 1,
                callbacks: {
                    label: (context) => {
                        const label = context.label || '';
                        const value = context.parsed || 0;
                        return `${label}: $${value.toLocaleString()}`;
                    }
                }
            }
        }
    };

    async exportPDF() {
        const stmt = this.statement();
        if (!stmt) return;

        try {
            const blob = await this.incomeStatementService.exportToPDF(stmt);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `income-statement-${stmt.period}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error exporting PDF:', err);
        }
    }

    exportToCSV() {
        const stmt = this.statement();
        if (!stmt) return;

        const csvData = [];

        // Header
        csvData.push(['Income Statement']);
        csvData.push([stmt.period]);
        csvData.push([]);

        // Revenue Section
        csvData.push(['REVENUE', '', '']);
        csvData.push(['Gross Sales', stmt.grossSales, '']);
        if (stmt.returns > 0) {
            csvData.push(['Less: Returns', -stmt.returns, '']);
        }
        if (stmt.discounts > 0) {
            csvData.push(['Less: Discounts', -stmt.discounts, '']);
        }
        csvData.push(['Net Sales', stmt.netSales, '100%']);
        csvData.push([]);

        // COGS
        csvData.push(['COST OF GOODS SOLD', '', '']);
        csvData.push(['Product Costs', stmt.cogs, `${((stmt.cogs / stmt.netSales) * 100).toFixed(1)}%`]);
        csvData.push([]);

        // Gross Profit
        csvData.push(['GROSS PROFIT', stmt.grossProfit, `${stmt.grossMargin.toFixed(1)}%`]);
        csvData.push([]);

        // Operating Expenses
        csvData.push(['OPERATING EXPENSES', '', '']);
        stmt.operatingExpenses.forEach(exp => {
            csvData.push([exp.categoryName, exp.amount, `${((exp.amount / stmt.netSales) * 100).toFixed(1)}%`]);
        });
        csvData.push(['Total Operating Expenses', stmt.totalOperatingExpenses, `${((stmt.totalOperatingExpenses / stmt.netSales) * 100).toFixed(1)}%`]);
        csvData.push([]);

        // Operating Income
        csvData.push(['OPERATING INCOME', stmt.operatingIncome, `${stmt.operatingMargin.toFixed(1)}%`]);
        csvData.push([]);

        // Net Income
        csvData.push(['NET INCOME', stmt.netIncome, `${stmt.netMargin.toFixed(1)}%`]);
        csvData.push([]);

        // Key Metrics
        csvData.push(['KEY METRICS', '', '']);
        csvData.push(['Gross Margin', '', `${stmt.grossMargin.toFixed(1)}%`]);
        csvData.push(['Operating Margin', '', `${stmt.operatingMargin.toFixed(1)}%`]);
        csvData.push(['Net Margin', '', `${stmt.netMargin.toFixed(1)}%`]);

        // Convert to CSV string
        const csvContent = csvData.map(row => row.join(',')).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `income-statement-${stmt.period}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }



    // Margin indicator helpers
    getMarginClass(margin: number): string {
        if (margin >= 20) return 'healthy';
        if (margin >= 10) return 'moderate';
        return 'low';
    }

    getMarginColor(margin: number): string {
        if (margin >= 20) return '#10b981';
        if (margin >= 10) return '#f59e0b';
        return '#ef4444';
    }

    // Formatting helpers
    formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(value);
    }

    formatPercentage(value: number): string {
        return `${value.toFixed(1)}%`;
    }

    formatVariance(variance: { amount: number; percentage: number }): string {
        const sign = variance.amount >= 0 ? '+' : '';
        return `${sign}${this.formatCurrency(variance.amount)} (${sign}${this.formatPercentage(variance.percentage)})`;
    }

    getVarianceClass(amount: number, isExpense: boolean = false): string {
        if (amount === 0) return 'neutral';
        // For revenue/profit, positive is good. For expenses, negative is good.
        const isGood = isExpense ? amount < 0 : amount > 0;
        return isGood ? 'positive' : 'negative';
    }

    // Financial Health Score (0-100)
    get financialHealthScore(): number {
        const stmt = this.statement();
        if (!stmt) return 0;

        // Weighted scoring
        const grossMarginScore = Math.min((stmt.grossMargin / 50) * 40, 40); // 40% weight
        const netMarginScore = Math.min((stmt.netMargin / 20) * 30, 30); // 30% weight
        const operatingEfficiency = 100 - Math.min((stmt.totalOperatingExpenses / stmt.netSales) * 100, 100);
        const efficiencyScore = (operatingEfficiency / 100) * 30; // 30% weight

        return Math.round(grossMarginScore + netMarginScore + efficiencyScore);
    }

    get healthScoreStatus(): { icon: string, label: string, color: string } {
        const score = this.financialHealthScore;
        if (score >= 75) return { icon: 'circle-fill', label: 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH_SCORE.STATUS.EXCELLENT', color: '#22c55e' };
        if (score >= 60) return { icon: 'circle-fill', label: 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH_SCORE.STATUS.GOOD', color: '#fbbf24' };
        if (score >= 40) return { icon: 'circle-fill', label: 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH_SCORE.STATUS.FAIR', color: '#f97316' };
        return { icon: 'circle-fill', label: 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH_SCORE.STATUS.NEEDS_ATTENTION', color: '#ef4444' };
    }

    getMarginHealth(margin: number, type: 'gross' | 'operating' | 'net'): { icon: string, status: string } {
        const thresholds = {
            gross: { excellent: 40, good: 30, fair: 20 },
            operating: { excellent: 15, good: 10, fair: 5 },
            net: { excellent: 10, good: 5, fair: 2 }
        };

        const t = thresholds[type];
        if (margin >= t.excellent) return { icon: 'circle-fill', status: 'Excellent' };
        if (margin >= t.good) return { icon: 'circle-fill', status: 'Good' };
        if (margin >= t.fair) return { icon: 'circle-fill', status: 'Fair' };
        return { icon: 'circle-fill', status: 'Low' };
    }

    get healthBreakdown() {
        const stmt = this.statement();
        if (!stmt) return null;

        const grossMarginScore = Math.min((stmt.grossMargin / 50) * 40, 40);
        const netMarginScore = Math.min((stmt.netMargin / 20) * 30, 30);
        const operatingEfficiency = 100 - Math.min((stmt.totalOperatingExpenses / stmt.netSales) * 100, 100);
        const efficiencyScore = (operatingEfficiency / 100) * 30;

        return {
            components: [
                {
                    name: 'Gross Margin',
                    weight: 40,
                    score: Math.round(grossMarginScore),
                    maxScore: 40,
                    value: stmt.grossMargin,
                    target: 50,
                    status: this.getMarginHealth(stmt.grossMargin, 'gross'),
                    insight: this.getGrossMarginInsight(stmt.grossMargin)
                },
                {
                    name: 'Net Margin',
                    weight: 30,
                    score: Math.round(netMarginScore),
                    maxScore: 30,
                    value: stmt.netMargin,
                    target: 20,
                    status: this.getMarginHealth(stmt.netMargin, 'net'),
                    insight: this.getNetMarginInsight(stmt.netMargin)
                },
                {
                    name: 'Operating Efficiency',
                    weight: 30,
                    score: Math.round(efficiencyScore),
                    maxScore: 30,
                    value: operatingEfficiency,
                    target: 100,
                    status: operatingEfficiency >= 75 ? { icon: 'circle-fill', status: 'Excellent' } :
                        operatingEfficiency >= 50 ? { icon: 'circle-fill', status: 'Good' } :
                            operatingEfficiency >= 25 ? { icon: 'circle-fill', status: 'Fair' } :
                                { icon: 'circle-fill', status: 'Low' },
                    insight: this.getEfficiencyInsight(operatingEfficiency)
                }
            ],
            recommendations: this.getRecommendations(stmt)
        };
    }

    private getGrossMarginInsight(margin: number): string {
        if (margin >= 40) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.GROSS_EXCELLENT';
        if (margin >= 30) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.GROSS_GOOD';
        if (margin >= 20) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.GROSS_FAIR';
        return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.GROSS_LOW';
    }

    private getNetMarginInsight(margin: number): string {
        if (margin >= 10) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.NET_EXCELLENT';
        if (margin >= 5) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.NET_GOOD';
        if (margin >= 2) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.NET_FAIR';
        return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.NET_LOW';
    }

    private getEfficiencyInsight(efficiency: number): string {
        if (efficiency >= 75) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.EFFICIENCY_EXCELLENT';
        if (efficiency >= 50) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.EFFICIENCY_GOOD';
        if (efficiency >= 25) return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.EFFICIENCY_FAIR';
        return 'COMMAND_CENTER.INCOME_STATEMENT.HEALTH.INSIGHTS.EFFICIENCY_LOW';
    }

    private getRecommendations(stmt: any): string[] {
        const recommendations: string[] = [];

        if (stmt.grossMargin < 30) {
            recommendations.push('COMMAND_CENTER.INCOME_STATEMENT.RECOMMENDATIONS.PRICING');
        }
        if (stmt.netMargin < 5) {
            recommendations.push('COMMAND_CENTER.INCOME_STATEMENT.RECOMMENDATIONS.EXPENSES');
        }
        if ((stmt.totalOperatingExpenses / stmt.netSales) > 0.5) {
            recommendations.push('COMMAND_CENTER.INCOME_STATEMENT.RECOMMENDATIONS.AUDIT');
        }
        if (stmt.grossMargin >= 40 && stmt.netMargin < 10) {
            recommendations.push('COMMAND_CENTER.INCOME_STATEMENT.RECOMMENDATIONS.EFFICIENCY');
        }
        if (recommendations.length === 0) {
            recommendations.push('COMMAND_CENTER.INCOME_STATEMENT.RECOMMENDATIONS.STRONG');
        }

        return recommendations;
    }

    // Dynamic month options removed

    // Group months by year removed

    // Multiple scenarios to reach 100% score
    get pathTo100() {
        const stmt = this.statement();
        if (!stmt) return null;

        const currentGross = stmt.grossMargin;
        const currentNet = stmt.netMargin;
        const currentExpenseRatio = (stmt.totalOperatingExpenses / stmt.netSales) * 100;

        // Calculate gaps
        const grossGap = Math.max(0, 50 - currentGross);
        const netGap = Math.max(0, 20 - currentNet);
        const efficiencyGap = Math.max(0, currentExpenseRatio - 25);

        // Calculate dollar amounts needed
        const revenueNeededForNetMargin = netGap > 0 ? (netGap / 100) * stmt.netSales / (1 - stmt.cogs / stmt.netSales) : 0;
        const expenseReductionForNetMargin = netGap > 0 ? (netGap / 100) * stmt.netSales : 0;
        const efficiencyExpenseReduction = efficiencyGap > 0 ? (efficiencyGap / 100) * stmt.netSales : 0;

        const scenarios: Scenario[] = [];

        // Scenario 1: Reduce Expenses (show if any gap exists)
        const expenseReduction = Math.max(expenseReductionForNetMargin, efficiencyExpenseReduction);
        if (expenseReduction > 100) { // Only show if reduction needed is meaningful (>$100)
            scenarios.push({
                name: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.REDUCE_EXPENSES.NAME',
                icon: 'wallet',
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.REDUCE_EXPENSES.DESC',
                actions: [
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.REDUCE_EXPENSES.ACTION', params: { amount: this.formatCurrency(expenseReduction) } },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.REDUCE_EXPENSES.TARGET', params: { amount: this.formatCurrency(stmt.totalOperatingExpenses - expenseReduction) } }
                ],
                newScore: this.calculateScoreWithExpenseReduction(stmt, expenseReduction),
                difficulty: 'Medium',
                timeframe: '3-6 months'
            });
        }

        // Scenario 2: Increase Revenue (show if net margin gap exists)
        if (revenueNeededForNetMargin > 100) {
            scenarios.push({
                name: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.INCREASE_REVENUE.NAME',
                icon: 'trending-up',
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.INCREASE_REVENUE.DESC',
                actions: [
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.INCREASE_REVENUE.ACTION', params: { amount: this.formatCurrency(revenueNeededForNetMargin) } },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.INCREASE_REVENUE.TARGET', params: { amount: this.formatCurrency(stmt.netSales + revenueNeededForNetMargin) } }
                ],
                newScore: this.calculateScoreWithRevenueIncrease(stmt, revenueNeededForNetMargin),
                difficulty: 'Hard',
                timeframe: '6-12 months'
            });
        }

        // Scenario 3: Balanced Approach (show if both gaps exist)
        if (expenseReduction > 100 && revenueNeededForNetMargin > 100) {
            scenarios.push({
                name: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.BALANCED.NAME',
                icon: 'scale',
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.BALANCED.DESC',
                actions: [ // Balanced approach actions hardcoded in logic for now - using generic split
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.REDUCE_EXPENSES.ACTION', params: { amount: this.formatCurrency(expenseReduction / 2) } },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.INCREASE_REVENUE.ACTION', params: { amount: this.formatCurrency(revenueNeededForNetMargin / 2) } }
                ],
                newScore: this.calculateScoreBalanced(stmt, expenseReduction / 2, revenueNeededForNetMargin / 2),
                difficulty: 'Medium',
                timeframe: '4-8 months'
            });
        }

        // If no scenarios (already at 100%), show congratulations
        if (scenarios.length === 0 && this.financialHealthScore >= 95) {
            scenarios.push({
                name: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.MAINTAIN.NAME',
                icon: 'trophy',
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.MAINTAIN.DESC',
                actions: [
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.MAINTAIN.ACTION_CONTINUE', params: {} },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.MAINTAIN.ACTION_MONITOR', params: {} }
                ],
                newScore: this.financialHealthScore,
                difficulty: 'Low',
                timeframe: 'Ongoing'
            });
        }

        // Fallback: if still no scenarios (gaps too small), show optimization tips
        if (scenarios.length === 0) {
            scenarios.push({
                name: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.FINE_TUNE.NAME',
                icon: 'target',
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.FINE_TUNE.DESC',
                actions: [
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.FINE_TUNE.ACTION_DoingWell', params: { score: this.financialHealthScore } },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.FINE_TUNE.ACTION_Maintain', params: {} },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.FINE_TUNE.ACTION_Gains', params: {} }
                ],
                newScore: Math.min(this.financialHealthScore + 5, 100),
                difficulty: 'Low',
                timeframe: '1-3 months'
            });
        }

        return {
            currentScore: this.financialHealthScore,
            targetScore: 100,
            gap: 100 - this.financialHealthScore,
            components: [
                {
                    name: 'Gross Margin',
                    current: currentGross,
                    target: 50,
                    gap: grossGap,
                    status: grossGap === 0 ? 'achieved' : 'needs-improvement'
                },
                {
                    name: 'Net Margin',
                    current: currentNet,
                    target: 20,
                    gap: netGap,
                    status: netGap === 0 ? 'achieved' : 'needs-improvement'
                },
                {
                    name: 'Operating Efficiency',
                    current: 100 - currentExpenseRatio,
                    target: 75,
                    gap: efficiencyGap,
                    status: efficiencyGap === 0 ? 'achieved' : 'needs-improvement'
                }
            ],
            scenarios,
            quickWin: this.getQuickWin(stmt)
        };
    }

    private calculateScoreWithExpenseReduction(stmt: any, reduction: number): number {
        const newExpenses = stmt.totalOperatingExpenses - reduction;
        const newNetMargin = ((stmt.netSales - stmt.cogs - newExpenses) / stmt.netSales) * 100;
        const newExpenseRatio = (newExpenses / stmt.netSales) * 100;

        const grossScore = Math.min((stmt.grossMargin / 50) * 40, 40);
        const netScore = Math.min((newNetMargin / 20) * 30, 30);
        const efficiencyScore = Math.min(((100 - newExpenseRatio) / 100) * 30, 30);

        return Math.round(grossScore + netScore + efficiencyScore);
    }

    private calculateScoreWithRevenueIncrease(stmt: any, increase: number): number {
        const newRevenue = stmt.netSales + increase;
        const newCOGS = stmt.cogs + (increase * (stmt.cogs / stmt.netSales));
        const newNetMargin = ((newRevenue - newCOGS - stmt.totalOperatingExpenses) / newRevenue) * 100;
        const newExpenseRatio = (stmt.totalOperatingExpenses / newRevenue) * 100;

        const grossScore = Math.min((stmt.grossMargin / 50) * 40, 40);
        const netScore = Math.min((newNetMargin / 20) * 30, 30);
        const efficiencyScore = Math.min(((100 - newExpenseRatio) / 100) * 30, 30);

        return Math.round(grossScore + netScore + efficiencyScore);
    }

    private calculateScoreBalanced(stmt: any, expenseReduction: number, revenueIncrease: number): number {
        const newRevenue = stmt.netSales + revenueIncrease;
        const newCOGS = stmt.cogs + (revenueIncrease * (stmt.cogs / stmt.netSales));
        const newExpenses = stmt.totalOperatingExpenses - expenseReduction;
        const newNetMargin = ((newRevenue - newCOGS - newExpenses) / newRevenue) * 100;
        const newExpenseRatio = (newExpenses / newRevenue) * 100;

        const grossScore = Math.min((stmt.grossMargin / 50) * 40, 40);
        const netScore = Math.min((newNetMargin / 20) * 30, 30);
        const efficiencyScore = Math.min(((100 - newExpenseRatio) / 100) * 30, 30);

        return Math.round(grossScore + netScore + efficiencyScore);
    }

    private getQuickWin(stmt: any): { description: string, actions: any[], newScore: number } | null {
        // Find the easiest path to significant improvement
        const expenseReduction = stmt.totalOperatingExpenses * 0.15; // 15% reduction
        const newScore = this.calculateScoreWithExpenseReduction(stmt, expenseReduction);

        if (newScore > this.financialHealthScore + 10) {
            return {
                description: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.QUICK_WIN.DESC',
                actions: [
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.QUICK_WIN.ACTION_REDUCE', params: { amount: this.formatCurrency(expenseReduction) } },
                    { key: 'COMMAND_CENTER.INCOME_STATEMENT.SCENARIOS.QUICK_WIN.ACTION_BOOST', params: { old: this.financialHealthScore, new: newScore } }
                ],
                newScore
            };
        }

        return null;
    }

    toggleHealthDetails() {
        this.showHealthDetails = !this.showHealthDetails;
    }
}
