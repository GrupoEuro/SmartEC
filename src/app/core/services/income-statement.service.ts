import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { OrderService } from './order.service';
import { ProductService } from './product.service';
import { ExpenseService } from './expense.service';
import { IncomeStatement, IncomeStatementComparison, getExpenseCategoryName } from '../models/income-statement.model';
import { Timestamp } from '@angular/fire/firestore';

@Injectable({
    providedIn: 'root'
})
export class IncomeStatementService {
    private orderService = inject(OrderService);
    private productService = inject(ProductService);
    private expenseService = inject(ExpenseService);

    /**
     * Generate income statement for period
     */
    generateIncomeStatement(startDate: Date, endDate: Date): Observable<IncomeStatement> {
        return combineLatest([
            this.orderService.getOrders(),
            this.productService.getProducts(),
            this.expenseService.getExpenseSummary(startDate, endDate)
        ]).pipe(
            map(([orders, products, expenseSummary]) => {
                // Filter orders in period
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                // Calculate Revenue
                let grossSales = 0;
                let discounts = 0;
                let totalCOGS = 0;

                periodOrders.forEach(order => {
                    grossSales += order.total;

                    // Calculate discounts from coupons
                    const orderWithCoupon = order as any;
                    if (orderWithCoupon.couponCode && orderWithCoupon.discount) {
                        discounts += orderWithCoupon.discount;
                    }

                    // Calculate COGS
                    order.items?.forEach(item => {
                        const product = products.find(p => p.id === item.productId);
                        if (product) {
                            const costPrice = (product as any).costPrice || 0;
                            totalCOGS += costPrice * item.quantity;
                        }
                    });
                });

                const returns = 0; // TODO: Implement returns tracking
                const netSales = grossSales - returns - discounts;

                // COGS (Simplified - using product costs)
                const beginningInventory = 0; // TODO: Implement inventory snapshots
                const purchases = 0; // TODO: Implement purchase tracking
                const endingInventory = 0; // TODO: Implement inventory snapshots
                const cogs = totalCOGS; // Simplified: direct product costs

                // Gross Profit
                const grossProfit = netSales - cogs;
                const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

                // Operating Expenses
                const operatingExpenses = expenseSummary.byCategory.map(cat => ({
                    category: cat.category,
                    categoryName: cat.categoryName,
                    amount: cat.amount
                }));
                const totalOperatingExpenses = expenseSummary.totalExpenses;

                // Operating Income
                const operatingIncome = grossProfit - totalOperatingExpenses;
                const operatingMargin = netSales > 0 ? (operatingIncome / netSales) * 100 : 0;

                // Other Income/Expenses
                const otherIncome = 0; // TODO: Implement other income tracking
                const otherExpenses = 0; // TODO: Implement other expenses tracking

                // Net Income
                const incomeBeforeTaxes = operatingIncome + otherIncome - otherExpenses;
                const taxExpense = 0; // TODO: Implement tax calculation
                const netIncome = incomeBeforeTaxes - taxExpense;
                const netMargin = netSales > 0 ? (netIncome / netSales) * 100 : 0;

                return {
                    period: this.getPeriodLabel(startDate, endDate),
                    startDate,
                    endDate,

                    // Revenue
                    grossSales,
                    returns,
                    discounts,
                    netSales,

                    // COGS
                    beginningInventory,
                    purchases,
                    endingInventory,
                    cogs,

                    // Gross Profit
                    grossProfit,
                    grossMargin,

                    // Operating Expenses
                    operatingExpenses,
                    totalOperatingExpenses,

                    // Operating Income
                    operatingIncome,
                    operatingMargin,

                    // Other
                    otherIncome,
                    otherExpenses,

                    // Net Income
                    incomeBeforeTaxes,
                    taxExpense,
                    netIncome,
                    netMargin,

                    generatedAt: Timestamp.now()
                };
            })
        );
    }

    /**
     * Compare two periods
     */
    comparePeriods(
        currentStart: Date,
        currentEnd: Date,
        previousStart: Date,
        previousEnd: Date
    ): Observable<IncomeStatementComparison> {
        return combineLatest([
            this.generateIncomeStatement(currentStart, currentEnd),
            this.generateIncomeStatement(previousStart, previousEnd)
        ]).pipe(
            map(([current, previous]) => {
                const calculateVariance = (current: number, previous: number) => ({
                    amount: current - previous,
                    percentage: previous !== 0 ? ((current - previous) / previous) * 100 : 0
                });

                return {
                    current,
                    previous,
                    variance: {
                        netSales: calculateVariance(current.netSales, previous.netSales),
                        cogs: calculateVariance(current.cogs, previous.cogs),
                        grossProfit: calculateVariance(current.grossProfit, previous.grossProfit),
                        operatingExpenses: calculateVariance(current.totalOperatingExpenses, previous.totalOperatingExpenses),
                        netIncome: calculateVariance(current.netIncome, previous.netIncome)
                    }
                };
            })
        );
    }

    /**
     * Export income statement to PDF
     */
    async exportToPDF(statement: IncomeStatement): Promise<Blob> {
        const { jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        let yPos = 20;

        // COLORS
        const colors = {
            primary: [30, 58, 138] as [number, number, number],      // Dark blue
            secondary: [251, 191, 36] as [number, number, number],   // Golden
            success: [34, 197, 94] as [number, number, number],      // Green
            danger: [239, 68, 68] as [number, number, number],       // Red
            neutral: [100, 116, 139] as [number, number, number],    // Gray
            lightBg: [248, 250, 252] as [number, number, number]     // Light background
        };

        // ===== 1. HEADER WITH BRANDING =====
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 50, 'F');

        // Company name
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('IMPORTADORA EURO', 15, 18);

        // Document title
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Income Statement (P&L)', 15, 28);

        // Period and generation date
        doc.setFontSize(9);
        doc.text(`Period: ${statement.period}`, 15, 38);
        doc.text(`Generated: ${new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })}`, 15, 44);

        yPos = 60;

        // ===== 2. EXECUTIVE SUMMARY BOX =====
        doc.setFillColor(...colors.lightBg);
        doc.roundedRect(15, yPos, pageWidth - 30, 32, 3, 3, 'F');

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('EXECUTIVE SUMMARY', 20, yPos + 8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const col1X = 20;
        const col2X = pageWidth / 2 + 5;

        doc.text(`Revenue:`, col1X, yPos + 16);
        doc.setFont('helvetica', 'bold');
        doc.text(this.formatCurrency(statement.netSales), col1X + 30, yPos + 16);
        doc.setFont('helvetica', 'normal');
        doc.text(`Gross Margin:`, col2X, yPos + 16);
        doc.setFont('helvetica', 'bold');
        doc.text(`${statement.grossMargin.toFixed(1)}%`, col2X + 35, yPos + 16);

        doc.setFont('helvetica', 'normal');
        doc.text(`Gross Profit:`, col1X, yPos + 22);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.success);
        doc.text(this.formatCurrency(statement.grossProfit), col1X + 30, yPos + 22);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        doc.text(`Operating Margin:`, col2X, yPos + 22);
        doc.setFont('helvetica', 'bold');
        doc.text(`${statement.operatingMargin.toFixed(1)}%`, col2X + 35, yPos + 22);

        doc.setFont('helvetica', 'normal');
        doc.text(`Net Income:`, col1X, yPos + 28);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...(statement.netIncome >= 0 ? colors.success : colors.danger));
        doc.text(this.formatCurrency(statement.netIncome), col1X + 30, yPos + 28);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        doc.text(`Net Margin:`, col2X, yPos + 28);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...(statement.netMargin >= 0 ? colors.success : colors.danger));
        doc.text(`${statement.netMargin.toFixed(1)}%`, col2X + 35, yPos + 28);

        doc.setTextColor(0, 0, 0);
        yPos += 42;

        // ===== 3. DETAILED P&L TABLE =====
        const tableData: any[] = [];

        // Revenue section
        tableData.push([
            { content: 'REVENUE', colSpan: 3, styles: { fillColor: colors.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } }
        ]);
        tableData.push(['Gross Sales', this.formatCurrency(statement.grossSales), '']);
        if (statement.returns > 0) {
            tableData.push(['  Less: Returns', `(${this.formatCurrency(statement.returns)})`, '']);
        }
        if (statement.discounts > 0) {
            tableData.push(['  Less: Discounts', `(${this.formatCurrency(statement.discounts)})`, '']);
        }
        tableData.push([
            { content: 'Net Sales', styles: { fontStyle: 'bold' } },
            { content: this.formatCurrency(statement.netSales), styles: { fontStyle: 'bold' } },
            { content: '100.0%', styles: { fontStyle: 'bold' } }
        ]);

        // COGS section
        tableData.push([
            { content: 'COST OF GOODS SOLD', colSpan: 3, styles: { fillColor: colors.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } }
        ]);
        tableData.push([
            'Product Costs',
            this.formatCurrency(statement.cogs),
            `${((statement.cogs / statement.netSales) * 100).toFixed(1)}%`
        ]);

        // Gross Profit
        tableData.push([
            { content: 'GROSS PROFIT', styles: { fillColor: colors.lightBg, fontStyle: 'bold', fontSize: 10 } },
            { content: this.formatCurrency(statement.grossProfit), styles: { fillColor: colors.lightBg, fontStyle: 'bold', textColor: colors.success, fontSize: 10 } },
            { content: `${statement.grossMargin.toFixed(1)}%`, styles: { fillColor: colors.lightBg, fontStyle: 'bold', fontSize: 10 } }
        ]);

        // Operating Expenses
        tableData.push([
            { content: 'OPERATING EXPENSES', colSpan: 3, styles: { fillColor: colors.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } }
        ]);

        statement.operatingExpenses.forEach(exp => {
            tableData.push([
                `  ${exp.categoryName}`,
                this.formatCurrency(exp.amount),
                `${((exp.amount / statement.netSales) * 100).toFixed(1)}%`
            ]);
        });

        tableData.push([
            { content: 'Total Operating Expenses', styles: { fontStyle: 'bold' } },
            { content: this.formatCurrency(statement.totalOperatingExpenses), styles: { fontStyle: 'bold' } },
            { content: `${((statement.totalOperatingExpenses / statement.netSales) * 100).toFixed(1)}%`, styles: { fontStyle: 'bold' } }
        ]);

        // Operating Income
        tableData.push([
            { content: 'OPERATING INCOME', styles: { fillColor: colors.lightBg, fontStyle: 'bold', fontSize: 10 } },
            {
                content: this.formatCurrency(statement.operatingIncome), styles: {
                    fillColor: colors.lightBg,
                    fontStyle: 'bold',
                    textColor: statement.operatingIncome >= 0 ? colors.success : colors.danger,
                    fontSize: 10
                }
            },
            { content: `${statement.operatingMargin.toFixed(1)}%`, styles: { fillColor: colors.lightBg, fontStyle: 'bold', fontSize: 10 } }
        ]);

        // Net Income
        tableData.push([
            { content: 'NET INCOME', styles: { fillColor: colors.secondary, fontStyle: 'bold', fontSize: 11 } },
            {
                content: this.formatCurrency(statement.netIncome), styles: {
                    fillColor: colors.secondary,
                    fontStyle: 'bold',
                    textColor: statement.netIncome >= 0 ? colors.success : colors.danger,
                    fontSize: 11
                }
            },
            { content: `${statement.netMargin.toFixed(1)}%`, styles: { fillColor: colors.secondary, fontStyle: 'bold', fontSize: 11 } }
        ]);

        autoTable(doc, {
            startY: yPos,
            head: [[
                { content: 'Description', styles: { fillColor: colors.secondary, textColor: [0, 0, 0], fontStyle: 'bold' } },
                { content: 'Amount', styles: { fillColor: colors.secondary, textColor: [0, 0, 0], fontStyle: 'bold' } },
                { content: '%', styles: { fillColor: colors.secondary, textColor: [0, 0, 0], fontStyle: 'bold' } }
            ]],
            body: tableData,
            theme: 'grid',
            styles: {
                fontSize: 9,
                cellPadding: 3,
                lineColor: [200, 200, 200],
                lineWidth: 0.1
            },
            columnStyles: {
                0: { cellWidth: 100 },
                1: { cellWidth: 50, halign: 'right' },
                2: { cellWidth: 30, halign: 'right' }
            }
        });

        yPos = (doc as any).lastAutoTable.finalY + 10;

        // ===== 4. FOOTER =====
        const pageCount = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);

            // Footer line
            doc.setDrawColor(...colors.neutral);
            doc.setLineWidth(0.5);
            doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);

            // Footer text
            doc.setFontSize(8);
            doc.setTextColor(...colors.neutral);
            doc.setFont('helvetica', 'normal');
            doc.text('Importadora Euro | Confidential Financial Report', 15, pageHeight - 12);
            doc.text(`Page ${i} of ${pageCount} | Generated by Command Center`, pageWidth - 15, pageHeight - 12, { align: 'right' });
        }

        return doc.output('blob');
    }

    private formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(value);
    }

    // Helper methods
    private getOrderDate(order: any): Date {
        if (!order.createdAt) return new Date();
        const createdAt: any = order.createdAt;
        if (typeof createdAt.toDate === 'function') {
            return createdAt.toDate();
        }
        return new Date(createdAt);
    }

    private getPeriodLabel(startDate: Date, endDate: Date): string {
        const start = startDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' });
        const end = endDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' });
        return `${start} - ${end}`;
    }


    /**
     * Get daily revenue breakdown for trend chart
     */
    getDailyRevenue(startDate: Date, endDate: Date): Observable<{ labels: string[], data: number[] }> {
        return this.orderService.getOrders().pipe(
            map(orders => {
                // Filter orders in period
                const periodOrders = orders.filter(o => {
                    const orderDate = this.getOrderDate(o);
                    return orderDate >= startDate && orderDate <= endDate;
                });

                // Group by date, keeping Date object for proper sorting
                const dailyMap = new Map<string, { date: Date, revenue: number }>();

                periodOrders.forEach(order => {
                    const orderDate = this.getOrderDate(order);
                    // Normalize to start of day
                    const dayStart = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
                    const isoKey = dayStart.toISOString();

                    const existing = dailyMap.get(isoKey);
                    if (existing) {
                        existing.revenue += order.total;
                    } else {
                        dailyMap.set(isoKey, { date: dayStart, revenue: order.total });
                    }
                });

                // Sort by date (chronological)
                const sorted = Array.from(dailyMap.values()).sort((a, b) =>
                    a.date.getTime() - b.date.getTime()
                );

                return {
                    labels: sorted.map(item => item.date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })),
                    data: sorted.map(item => item.revenue)
                };
            })
        );
    }
}
