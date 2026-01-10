export type SortDirection = 'asc' | 'desc';

export interface PaginationConfig {
    currentPage: number;
    itemsPerPage: number;
    totalItems: number;
}

export class TableDataSource<T> {
    data: T[] = [];
    filteredData: T[] = [];
    displayedData: T[] = [];

    sortField: keyof T | '' = '';
    sortDirection: SortDirection = 'asc';

    pagination: PaginationConfig = {
        currentPage: 1,
        itemsPerPage: 10,
        totalItems: 0
    };

    /**
     * Initialize with data and optional config
     */
    constructor(initialData: T[] = [], itemsPerPage: number = 10) {
        this.data = initialData;
        this.pagination.itemsPerPage = itemsPerPage;
        this.refresh();
    }

    setData(data: T[]) {
        this.data = data;
        this.refresh();
    }

    /**
     * Main pipeline: Filter -> Sort -> Paginate
     * Call this whenever filters or data change.
     */
    refresh(filterFn?: (item: T) => boolean) {
        let processData = [...this.data];

        // 1. Filter
        if (filterFn) {
            processData = processData.filter(filterFn);
        }
        this.filteredData = processData;
        this.pagination.totalItems = this.filteredData.length;

        // 2. Sort
        if (this.sortField) {
            processData = this.sortData(processData);
        }

        // 3. Paginate
        this.updateDisplayedPage(processData);
    }

    /**
     * Set sorting field and direction.
     * Auto-toggles direction if field is the same.
     */
    sort(field: keyof T) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        // Re-run the pipeline logic
        // We assume the caller might want to re-apply filters, but usually filters are stored in the component.
        // For simplicity here, we sort the *already filtered* data if we don't pass a filter function.
        // Ideally, the component calls 'refresh()' with the filter function again.
        // But to make it easier, let's just sort the filteredData and paginate.
        this.refreshInternalFromFiltered();
    }

    setPage(page: number) {
        this.pagination.currentPage = page;
        this.refreshInternalFromFiltered();
    }

    setItemsPerPage(count: number) {
        this.pagination.itemsPerPage = count;
        this.pagination.currentPage = 1;
        this.refreshInternalFromFiltered();
    }

    private sortData(data: T[]): T[] {
        return data.sort((a, b) => {
            const valA = a[this.sortField as keyof T];
            const valB = b[this.sortField as keyof T];

            let comparison = 0;
            if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB);
            } else if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
            } else if (valA instanceof Date && valB instanceof Date) {
                comparison = valA.getTime() - valB.getTime();
            } else {
                // Fallback for other types or mismatched
                comparison = String(valA).localeCompare(String(valB));
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });
    }

    private updateDisplayedPage(data: T[]) {
        const startIndex = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const endIndex = startIndex + this.pagination.itemsPerPage;
        this.displayedData = data.slice(startIndex, endIndex);
    }

    // Internal helper to skip the "Filter" step if we just changed Sort or Page
    private refreshInternalFromFiltered() {
        let data = [...this.filteredData];
        if (this.sortField) {
            data = this.sortData(data);
        }
        this.updateDisplayedPage(data);
    }
}
