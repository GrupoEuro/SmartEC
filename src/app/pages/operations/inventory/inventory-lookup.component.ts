import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { ProductService } from '../../../core/services/product.service';
import { Product } from '../../../core/models/product.model';
import { TableDataSource } from '../../../core/utils/table-data-source';
import { PaginationComponent } from '../../admin/shared/pagination/pagination.component';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { ToastService } from '../../../core/services/toast.service';
import { HelpContextButtonComponent } from '../../../shared/components/help-context-button/help-context-button.component';

import { InventoryKardexComponent } from './kardex/inventory-kardex.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-inventory-lookup',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, TranslateModule, PaginationComponent, AdminPageHeaderComponent, HelpContextButtonComponent, InventoryKardexComponent, AppIconComponent],
    templateUrl: './inventory-lookup.component.html',
    styleUrls: ['./inventory-lookup.component.css']
})
export class InventoryLookupComponent implements OnInit {
    private productService = inject(ProductService);
    private fb = inject(FormBuilder);
    private toast = inject(ToastService);
    private firestore = inject(Firestore); // FIXED: Moved from method to class field

    // UI State
    isLoading = signal(true);
    showKardex = signal(false);
    selectedKardexProduct = signal<Product | null>(null);

    // Data Source
    dataSource = new TableDataSource<Product>([], 10);

    // Filters
    searchControl = this.fb.control('');
    stockStatusFilter = signal<'all' | 'in' | 'low' | 'out'>('all');
    brandFilter = signal<string>('all');

    // Filter Options (computed from data)
    availableBrands = signal<string[]>([]);

    ngOnInit() {
        this.loadInventory();
        this.setupSearch();
    }

    async loadInventory() {
        this.isLoading.set(true);

        try {
            // Fetch products and inventory balances in parallel
            const [products, balances] = await Promise.all([
                firstValueFrom(this.productService.getProducts()),
                this.loadInventoryBalances()
            ]);

            console.log('[Inventory] Products loaded:', products.length);
            console.log('[Inventory] Balances loaded:', balances.length);
            console.log('[Inventory] Sample balance:', balances[0]);

            // Merge inventory balances with products
            const productsWithInventory = products.map(product => {
                // Sum up available stock across all locations for this product
                const productBalances = balances.filter(b => b.productId === product.id);
                const totalAvailable = productBalances.reduce((sum, b) => sum + (b.available || 0), 0);
                const totalPhysical = productBalances.reduce((sum, b) => sum + (b.quantity || 0), 0);

                if (productBalances.length > 0) {
                    console.log(`[Inventory] Product ${product.sku}: ${productBalances.length} locations, ${totalAvailable} available, ${totalPhysical} physical`);
                }

                return {
                    ...product,
                    stockQuantity: totalPhysical,      // Physical stock
                    availableStock: totalAvailable,    // Available stock (this is what the HTML displays!)
                    inStock: totalAvailable > 0
                };
            });

            console.log('[Inventory] Products with inventory:', productsWithInventory.length);
            console.log('[Inventory] Sample product:', productsWithInventory[0]);

            this.dataSource.setData(productsWithInventory);
            this.updateAvailableBrands(productsWithInventory);
            this.applyFilters();
            this.isLoading.set(false);
        } catch (err) {
            console.error('Error loading inventory:', err);
            this.toast.error('Error loading inventory');
            this.isLoading.set(false);
        }
    }

    private async loadInventoryBalances(): Promise<any[]> {
        const balancesSnapshot = await getDocs(collection(this.firestore, 'inventory_balances'));
        return balancesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    openKardex(product: Product) {
        this.selectedKardexProduct.set(product);
        this.showKardex.set(true);
    }

    closeKardex() {
        this.showKardex.set(false);
        this.selectedKardexProduct.set(null);
    }

    setupSearch() {
        this.searchControl.valueChanges.pipe(
            debounceTime(300),
            distinctUntilChanged()
        ).subscribe(() => {
            this.applyFilters();
        });
    }

    applyFilters() {
        this.dataSource.refresh((product) => {
            // Stock Filter
            const status = this.stockStatusFilter();
            if (status !== 'all') {
                const stock = product.stockQuantity || 0;
                if (status === 'in' && (stock <= 0)) return false;
                if (status === 'out' && (stock > 0)) return false;
                if (status === 'low' && (stock > 5 || stock === 0)) return false;
            }

            // Brand Filter
            const brand = this.brandFilter();
            if (brand !== 'all' && product.brand !== brand) {
                return false;
            }

            // Search Filter
            const term = this.searchControl.value?.toLowerCase() || '';
            if (term) {
                const matches =
                    product.name.es.toLowerCase().includes(term) ||
                    product.sku.toLowerCase().includes(term) ||
                    product.brand.toLowerCase().includes(term);
                if (!matches) return false;
            }

            return true;
        });
    }

    setStockFilter(status: 'all' | 'in' | 'low' | 'out') {
        this.stockStatusFilter.set(status);
        this.applyFilters();
    }

    setBrandFilter(event: Event) {
        const value = (event.target as HTMLSelectElement).value;
        this.brandFilter.set(value);
        this.applyFilters();
    }

    clearFilters() {
        this.searchControl.setValue('');
        this.stockStatusFilter.set('all');
        this.brandFilter.set('all');
        this.dataSource.pagination.currentPage = 1;
        this.applyFilters();
    }

    updateAvailableBrands(products: Product[]) {
        const brands = new Set(products.map(p => p.brand).filter(b => !!b));
        this.availableBrands.set(Array.from(brands).sort());
    }

    // Getters for Template
    get displayedProducts() {
        return this.dataSource.displayedData;
    }

    get paginationConfig() {
        return this.dataSource.pagination;
    }

    get sortField() {
        return this.dataSource.sortField;
    }

    get sortDirection() {
        return this.dataSource.sortDirection;
    }

    // Actions
    onSortChange(field: string) {
        this.dataSource.sort(field as keyof Product);
    }

    onPageChange(page: number) {
        this.dataSource.setPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    getStockClass(product: Product): string {
        if (!product.inStock || product.stockQuantity === 0) return 'stock-out';
        if (product.stockQuantity <= 5) return 'stock-low';
        return 'stock-in';
    }

    getStockLabelKey(product: Product): string {
        if (!product.inStock || product.stockQuantity === 0) return 'ADMIN.PRODUCTS.STOCK_OUT';
        if (product.stockQuantity <= 5) return 'ADMIN.PRODUCTS.STOCK_LOW';
        return 'ADMIN.PRODUCTS.STOCK_IN';
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    // Export to CSV
    handleExport() {
        const filtered = this.dataSource.filteredData;
        this.exportToCSV(filtered);
    }

    exportToCSV(products: Product[]) {
        const escapeCSVField = (field: string): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['SKU', 'Producto', 'Marca', 'Precio', 'Stock', 'Estado'];
        const rows = products.map(p => [
            escapeCSVField(p.sku),
            escapeCSVField(p.name.es),
            escapeCSVField(p.brand),
            escapeCSVField(p.price.toString()),
            escapeCSVField(p.stockQuantity.toString()),
            escapeCSVField(p.inStock && p.stockQuantity > 0 ? 'En Stock' : 'Agotado')
        ]);

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inventario_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.toast.success('Inventario exportado exitosamente');
    }
}
