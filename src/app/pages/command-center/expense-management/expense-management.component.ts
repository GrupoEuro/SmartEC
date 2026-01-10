import { Component, OnInit, inject, signal, computed, effect, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ExpenseService } from '../../../core/services/expense.service';
import { Expense, ExpenseCategory, getExpenseCategoryName } from '../../../core/models/income-statement.model';
import { Timestamp, Firestore } from '@angular/fire/firestore';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { CommandCenterDataService } from '../services/command-center-data.service';
import { toSignal } from '@angular/core/rxjs-interop';


@Component({
    selector: 'app-expense-management',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        TranslateModule,
        AppIconComponent
    ],
    templateUrl: './expense-management.component.html',
    styleUrls: ['./expense-management.component.css']
})
export class ExpenseManagementComponent implements OnInit {
    private expenseService = inject(ExpenseService);
    private firestore = inject(Firestore); // Inject Firestore directly
    private fb = inject(FormBuilder);
    private dataService = inject(CommandCenterDataService);
    public contextService = inject(CommandCenterContextService);



    // Convert observable to signal
    private expenseData = toSignal(this.dataService.expenseData$, {
        initialValue: []
    });

    isLoading = toSignal(this.dataService.isLoading$, {
        initialValue: false
    });

    // State
    expenses = computed(() => this.expenseData());
    filteredExpenses = signal<Expense[]>([]);
    showForm = signal(false);
    editingExpense = signal<Expense | null>(null);

    // View mode and pagination
    viewMode: 'cards' | 'table' = 'cards';
    sortBy: 'date' | 'amount' | 'category' = 'date';
    sortDirection: 'asc' | 'desc' = 'desc';
    currentPage = 1;
    pageSize = 10;
    selectedExpenses = new Set<string>();

    // Filters
    searchTerm = '';
    selectedCategory: ExpenseCategory | 'ALL' = 'ALL';

    // Form
    expenseForm!: FormGroup;

    // Categories
    categories: { value: ExpenseCategory; label: string }[] = [
        { value: 'SALARIES', label: getExpenseCategoryName('SALARIES') },
        { value: 'RENT', label: getExpenseCategoryName('RENT') },
        { value: 'UTILITIES', label: getExpenseCategoryName('UTILITIES') },
        { value: 'MARKETING', label: getExpenseCategoryName('MARKETING') },
        { value: 'INSURANCE', label: getExpenseCategoryName('INSURANCE') },
        { value: 'DEPRECIATION', label: getExpenseCategoryName('DEPRECIATION') },
        { value: 'SUPPLIES', label: getExpenseCategoryName('SUPPLIES') },
        { value: 'MAINTENANCE', label: getExpenseCategoryName('MAINTENANCE') },
        { value: 'PROFESSIONAL_SERVICES', label: getExpenseCategoryName('PROFESSIONAL_SERVICES') },
        { value: 'TAXES', label: getExpenseCategoryName('TAXES') },
        { value: 'SHIPPING', label: getExpenseCategoryName('SHIPPING') },
        { value: 'OTHER', label: getExpenseCategoryName('OTHER') }
    ];

    constructor() {
        const injector = inject(Injector);

        // Effect to reactively apply filters when expense data changes
        effect(() => {
            this.applyFilters();
        }, { allowSignalWrites: true });
    }

    ngOnInit() {
        this.initForm();
    }



    // Check 1: Any docs exist?


    // New reactive diagnostic for query






    initForm() {
        this.expenseForm = this.fb.group({
            category: ['SALARIES', Validators.required],
            amount: [0, [Validators.required, Validators.min(0)]],
            description: ['', Validators.required],
            date: [new Date().toISOString().split('T')[0], Validators.required],
            recurring: [false],
            frequency: ['monthly'],
            vendor: [''],
            notes: ['']
        });
    }

    applyFilters() {
        let filtered = this.expenses();

        // Category filter
        if (this.selectedCategory !== 'ALL') {
            filtered = filtered.filter(e => e.category === this.selectedCategory);
        }

        // Search filter
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter(e =>
                e.description.toLowerCase().includes(term) ||
                e.vendor?.toLowerCase().includes(term) ||
                getExpenseCategoryName(e.category).toLowerCase().includes(term)
            );
        }

        this.filteredExpenses.set(filtered);
    }

    onCategoryChange() {
        this.applyFilters();
    }

    onSearch() {
        this.applyFilters();
    }

    openAddForm() {
        this.editingExpense.set(null);
        this.expenseForm.reset({
            category: 'SALARIES',
            amount: 0,
            date: new Date().toISOString().split('T')[0],
            recurring: false,
            frequency: 'monthly'
        });
        this.showForm.set(true);
    }

    openEditForm(expense: Expense) {
        this.editingExpense.set(expense);
        const date = expense.date instanceof Timestamp
            ? expense.date.toDate()
            : expense.date;

        this.expenseForm.patchValue({
            category: expense.category,
            amount: expense.amount,
            description: expense.description,
            date: date instanceof Date ? date.toISOString().split('T')[0] : date,
            recurring: expense.recurring,
            frequency: expense.frequency || 'monthly',
            vendor: expense.vendor || '',
            notes: expense.notes || ''
        });
        this.showForm.set(true);
    }

    closeForm() {
        this.showForm.set(false);
        this.editingExpense.set(null);
        this.expenseForm.reset();
    }

    async saveExpense() {
        if (this.expenseForm.invalid) return;

        const formValue = this.expenseForm.value;
        const expenseData = {
            category: formValue.category,
            amount: parseFloat(formValue.amount),
            description: formValue.description,
            date: new Date(formValue.date),
            recurring: formValue.recurring,
            frequency: formValue.recurring ? formValue.frequency : undefined,
            vendor: formValue.vendor || undefined,
            notes: formValue.notes || undefined,
            createdBy: 'current-user' // TODO: Get from auth service
        };

        try {
            const editing = this.editingExpense();
            if (editing?.id) {
                await this.expenseService.updateExpense(editing.id, expenseData);
            } else {
                await this.expenseService.createExpense(expenseData);
            }
            this.closeForm();
            this.dataService.refresh(); // Trigger refresh
        } catch (err) {
            console.error('Error saving expense:', err);
        }
    }

    async deleteExpense(expense: Expense) {
        if (!expense.id) return;

        const confirmed = confirm('¿Eliminar este gasto?');
        if (!confirmed) return;

        try {
            await this.expenseService.deleteExpense(expense.id);
            this.dataService.refresh(); // Trigger refresh
        } catch (err) {
            console.error('Error deleting expense:', err);
        }
    }

    getTotalExpenses(): number {
        return this.filteredExpenses().reduce((sum, e) => sum + e.amount, 0);
    }

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(value);
    }

    formatDate(date: any): string {
        const d = date instanceof Timestamp ? date.toDate() : new Date(date);
        return d.toLocaleDateString('es-MX');
    }

    getCategoryName(category: ExpenseCategory): string {
        return getExpenseCategoryName(category);
    }

    // ===== VIEW MODE & PAGINATION =====

    toggleView(mode: 'cards' | 'table') {
        this.viewMode = mode;
        localStorage.setItem('expenseViewMode', mode);
        this.currentPage = 1; // Reset to first page when switching views
    }

    get paginatedExpenses() {
        const sorted = this.getSortedExpenses();
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return sorted.slice(start, end);
    }

    get totalPages(): number {
        return Math.ceil(this.filteredExpenses().length / this.pageSize);
    }

    changePage(page: number) {
        if (page >= 1 && page <= this.totalPages) {
            this.currentPage = page;
        }
    }

    changePageSize(size: number) {
        this.pageSize = size;
        this.currentPage = 1;
    }

    getEndIndex(): number {
        return Math.min(this.currentPage * this.pageSize, this.filteredExpenses().length);
    }

    // ===== SORTING =====

    sortExpenses(column: 'date' | 'amount' | 'category') {
        if (this.sortBy === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = column;
            this.sortDirection = 'desc';
        }
    }

    private getSortedExpenses(): Expense[] {
        const expenses = [...this.filteredExpenses()];

        expenses.sort((a, b) => {
            let comparison = 0;

            switch (this.sortBy) {
                case 'date':
                    const dateA = a.date instanceof Timestamp ? a.date.toDate() : new Date(a.date);
                    const dateB = b.date instanceof Timestamp ? b.date.toDate() : new Date(b.date);
                    comparison = dateA.getTime() - dateB.getTime();
                    break;
                case 'amount':
                    comparison = a.amount - b.amount;
                    break;
                case 'category':
                    comparison = a.category.localeCompare(b.category);
                    break;
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        return expenses;
    }

    // ===== BULK SELECTION =====

    toggleExpenseSelection(expenseId: string) {
        if (this.selectedExpenses.has(expenseId)) {
            this.selectedExpenses.delete(expenseId);
        } else {
            this.selectedExpenses.add(expenseId);
        }
    }

    toggleSelectAll(event: any) {
        if (event.target.checked) {
            this.paginatedExpenses.forEach(e => {
                if (e.id) this.selectedExpenses.add(e.id);
            });
        } else {
            this.paginatedExpenses.forEach(e => {
                if (e.id) this.selectedExpenses.delete(e.id);
            });
        }
    }

    get allSelected(): boolean {
        return this.paginatedExpenses.length > 0 &&
            this.paginatedExpenses.every(e => e.id && this.selectedExpenses.has(e.id));
    }

    deselectAll() {
        this.selectedExpenses.clear();
    }

    async deleteSelected() {
        if (this.selectedExpenses.size === 0) return;

        const confirmed = confirm(`¿Eliminar ${this.selectedExpenses.size} gastos seleccionados?`);
        if (!confirmed) return;

        try {
            for (const id of this.selectedExpenses) {
                await this.expenseService.deleteExpense(id);
            }
            this.selectedExpenses.clear();
            this.dataService.refresh(); // Trigger refresh
        } catch (err) {
            console.error('Error deleting selected expenses:', err);
        }
    }

    // ===== EXPORT FUNCTIONALITY =====

    async exportToCSV(selectedOnly = false) {
        const expenses = selectedOnly
            ? this.filteredExpenses().filter(e => e.id && this.selectedExpenses.has(e.id))
            : this.filteredExpenses();

        const csv = this.generateCSV(expenses);
        this.downloadFile(csv, `expenses_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    }

    async exportToExcel(selectedOnly = false) {
        const expenses = selectedOnly
            ? this.filteredExpenses().filter(e => e.id && this.selectedExpenses.has(e.id))
            : this.filteredExpenses();

        // Dynamic import of xlsx library
        const XLSX = await import('xlsx');

        const worksheet = XLSX.utils.json_to_sheet(expenses.map(e => ({
            'Date': this.formatDate(e.date),
            'Category': this.getCategoryName(e.category),
            'Description': e.description,
            'Vendor': e.vendor || '',
            'Amount': e.amount,
            'Recurring': e.recurring ? 'Yes' : 'No',
            'Frequency': e.frequency || '',
            'Notes': e.notes || ''
        })));

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Expenses');

        // Generate Excel file
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses_${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    private generateCSV(expenses: Expense[]): string {
        const headers = ['Date', 'Category', 'Description', 'Vendor', 'Amount', 'Recurring', 'Frequency', 'Notes'];
        const rows = expenses.map(e => [
            this.formatDate(e.date),
            this.getCategoryName(e.category),
            e.description,
            e.vendor || '',
            e.amount.toString(),
            e.recurring ? 'Yes' : 'No',
            e.frequency || '',
            e.notes || ''
        ]);

        return [headers, ...rows].map(row =>
            row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');
    }

    private downloadFile(content: string, filename: string, type: string) {
        const blob = new Blob([content], { type });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}
