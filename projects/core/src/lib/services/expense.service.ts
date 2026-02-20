import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, Timestamp, orderBy } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { Expense, ExpenseSummary, ExpenseCategory, getExpenseCategoryName } from '../models/income-statement.model';

@Injectable({
    providedIn: 'root'
})
export class ExpenseService {
    private firestore = inject(Firestore);
    private expensesCollection = collection(this.firestore, 'expenses');

    /**
     * Get all expenses for a period
     */
    getExpenses(startDate: Date, endDate: Date): Observable<Expense[]> {
        const q = query(
            this.expensesCollection,
            where('date', '>=', Timestamp.fromDate(startDate)),
            where('date', '<=', Timestamp.fromDate(endDate)),
            orderBy('date', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Expense)))
        );
    }

    /**
     * Get expense summary for period
     */
    getExpenseSummary(startDate: Date, endDate: Date): Observable<ExpenseSummary> {
        return this.getExpenses(startDate, endDate).pipe(
            map(expenses => {
                const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

                // Group by category
                const categoryMap = new Map<ExpenseCategory, number>();
                expenses.forEach(expense => {
                    const current = categoryMap.get(expense.category) || 0;
                    categoryMap.set(expense.category, current + expense.amount);
                });

                // Convert to array with percentages
                const byCategory = Array.from(categoryMap.entries()).map(([category, amount]) => ({
                    category,
                    categoryName: getExpenseCategoryName(category),
                    amount,
                    percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0
                })).sort((a, b) => b.amount - a.amount);

                return {
                    period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
                    startDate,
                    endDate,
                    totalExpenses,
                    byCategory
                };
            })
        );
    }

    /**
     * Create new expense
     */
    async createExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Promise<string> {
        const expenseData = {
            ...expense,
            date: expense.date instanceof Date ? Timestamp.fromDate(expense.date) : expense.date,
            createdAt: Timestamp.now()
        };

        const docRef = await addDoc(this.expensesCollection, expenseData);
        return docRef.id;
    }

    /**
     * Update expense
     */
    async updateExpense(id: string, updates: Partial<Expense>): Promise<void> {
        const expenseDoc = doc(this.firestore, 'expenses', id);
        const updateData = {
            ...updates,
            updatedAt: Timestamp.now()
        };
        await updateDoc(expenseDoc, updateData);
    }

    /**
     * Delete expense
     */
    async deleteExpense(id: string): Promise<void> {
        const expenseDoc = doc(this.firestore, 'expenses', id);
        await deleteDoc(expenseDoc);
    }

    /**
     * Get recurring expenses
     */
    getRecurringExpenses(): Observable<Expense[]> {
        const q = query(
            this.expensesCollection,
            where('recurring', '==', true),
            orderBy('date', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Expense)))
        );
    }
}
