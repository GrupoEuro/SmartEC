import { Timestamp } from '@angular/fire/firestore';

/**
 * Expense categories for operating expenses
 */
export type ExpenseCategory =
    | 'SALARIES'
    | 'RENT'
    | 'UTILITIES'
    | 'MARKETING'
    | 'INSURANCE'
    | 'DEPRECIATION'
    | 'SUPPLIES'
    | 'MAINTENANCE'
    | 'PROFESSIONAL_SERVICES'
    | 'TAXES'
    | 'SHIPPING'
    | 'OTHER';

/**
 * Operating expense record
 */
export interface Expense {
    id?: string;
    category: ExpenseCategory;
    amount: number;
    description: string;
    date: Timestamp | Date;
    recurring: boolean;
    frequency?: 'monthly' | 'quarterly' | 'yearly';
    vendor?: string;
    notes?: string;
    createdBy: string;
    createdAt: Timestamp | Date;
    updatedAt?: Timestamp | Date;
}

/**
 * Expense summary by category
 */
export interface ExpenseSummary {
    period: string;
    startDate: Date;
    endDate: Date;
    totalExpenses: number;
    byCategory: {
        category: ExpenseCategory;
        categoryName: string;
        amount: number;
        percentage: number;
    }[];
}

/**
 * Income Statement (P&L)
 */
export interface IncomeStatement {
    period: string;
    startDate: Date;
    endDate: Date;

    // Revenue Section
    grossSales: number;
    returns: number;
    discounts: number;
    netSales: number;

    // COGS Section
    beginningInventory: number;
    purchases: number;
    endingInventory: number;
    cogs: number;

    // Gross Profit
    grossProfit: number;
    grossMargin: number; // percentage

    // Operating Expenses
    operatingExpenses: {
        category: ExpenseCategory;
        categoryName: string;
        amount: number;
    }[];
    totalOperatingExpenses: number;

    // Operating Income
    operatingIncome: number;
    operatingMargin: number; // percentage

    // Other Income/Expenses
    otherIncome: number;
    otherExpenses: number;

    // Net Income
    incomeBeforeTaxes: number;
    taxExpense: number;
    netIncome: number;
    netMargin: number; // percentage

    // Metadata
    generatedAt: Timestamp | Date;
}

/**
 * Income statement comparison
 */
export interface IncomeStatementComparison {
    current: IncomeStatement;
    previous: IncomeStatement;
    variance: {
        netSales: { amount: number; percentage: number };
        cogs: { amount: number; percentage: number };
        grossProfit: { amount: number; percentage: number };
        operatingExpenses: { amount: number; percentage: number };
        netIncome: { amount: number; percentage: number };
    };
}

/**
 * Helper to get expense category display name
 */
export function getExpenseCategoryName(category: ExpenseCategory): string {
    const names: Record<ExpenseCategory, string> = {
        SALARIES: 'Salaries & Wages',
        RENT: 'Rent',
        UTILITIES: 'Utilities',
        MARKETING: 'Marketing & Advertising',
        INSURANCE: 'Insurance',
        DEPRECIATION: 'Depreciation',
        SUPPLIES: 'Supplies',
        MAINTENANCE: 'Maintenance & Repairs',
        PROFESSIONAL_SERVICES: 'Professional Services',
        TAXES: 'Taxes & Licenses',
        SHIPPING: 'Shipping & Delivery',
        OTHER: 'Other Expenses'
    };
    return names[category];
}
