import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminPageHeaderComponent } from '../../../admin/shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { Firestore, collection, collectionData, query, orderBy, limit, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Order } from '../../../../core/models/order.model';
import { ToastService } from '../../../../core/services/toast.service';

export type InvoicingTab = 'pending' | 'issued' | 'failed';

@Component({
    selector: 'app-invoicing-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './invoicing-dashboard.component.html',
    styleUrl: './invoicing-dashboard.component.css'
})
export class InvoicingDashboardComponent implements OnInit {
    private firestore = inject(Firestore);
    private fns = inject(Functions);
    private toast = inject(ToastService);

    activeTab = signal<InvoicingTab>('pending');
    isLoading = signal<boolean>(false);
    expandedOrderId = signal<string | null>(null);
    processingIds = signal<Record<string, boolean>>({});

    // Search & Pagination
    searchQuery = signal<string>('');
    currentPage = signal<number>(1);
    pageSize = signal<number>(15);
    
    // Raw orders from MeLi
    private allMeliOrders = signal<any[]>([]);

    // Computed signals based on invoice state
    pendingOrders = computed(() => {
        return this.allMeliOrders().filter(o => 
            o.meliInvoice && 
            o.meliInvoice.isGenericRfc === false && 
            (!o.invoiceStatus || o.invoiceStatus === 'pending')
        );
    });

    issuedOrders = computed(() => {
        return this.allMeliOrders().filter(o => 
            o.invoiceStatus === 'issued'
        );
    });

    failedOrders = computed(() => {
        return this.allMeliOrders().filter(o => 
            o.invoiceStatus === 'failed'
        );
    });

    // First filter by tab
    private filteredByTab = computed(() => {
        const tab = this.activeTab();
        if (tab === 'pending') return this.pendingOrders();
        if (tab === 'issued') return this.issuedOrders();
        if (tab === 'failed') return this.failedOrders();
        return [];
    });

    // Then apply search and sort (Valid first)
    filteredOrders = computed(() => {
        const query = this.searchQuery().toLowerCase().trim();
        let base = [...this.filteredByTab()];
        
        if (query) {
            base = base.filter(o => {
                const idMatch = o.id?.toLowerCase().includes(query) || o.orderNumber?.toLowerCase().includes(query) || o.amazonOrderId?.toLowerCase().includes(query);
                const nameMatch = o.meliInvoice?.name?.toLowerCase().includes(query) || o.customer?.name?.toLowerCase().includes(query);
                const rfcMatch = o.meliInvoice?.rfc?.toLowerCase().includes(query);
                return idMatch || nameMatch || rfcMatch;
            });
        }

        // Sort so that orders with COMPLETE invoice data appear first
        base.sort((a, b) => {
            const aValid = this.isInvoiceDataComplete(a).valid ? 1 : 0;
            const bValid = this.isInvoiceDataComplete(b).valid ? 1 : 0;
            if (aValid !== bValid) return bValid - aValid; // 1 before 0
            // Fallback to createdAt desc
            return b.createdAt.getTime() - a.createdAt.getTime();
        });

        return base;
    });

    // Valid Count for Summary
    validPendingCount = computed(() => {
        return this.pendingOrders().filter(o => this.isInvoiceDataComplete(o).valid).length;
    });

    // Finally apply pagination
    displayedOrders = computed(() => {
        const filtered = this.filteredOrders();
        const start = (this.currentPage() - 1) * this.pageSize();
        return filtered.slice(start, start + this.pageSize());
    });

    totalPages = computed(() => Math.ceil(this.filteredOrders().length / this.pageSize()));
    
    get paginationText() {
        const total = this.filteredOrders().length;
        if (total === 0) return 'Mostrando 0 - 0 de 0';
        const start = (this.currentPage() - 1) * this.pageSize() + 1;
        const end = Math.min(start + this.pageSize() - 1, total);
        return `Mostrando ${start} - ${end} de ${total}`;
    }

    ngOnInit() {
        this.loadOrders();
    }

    private loadOrders() {
        this.isLoading.set(true);
        // We use the composite index: sourceChannel + createdAt
        const q = query(
            collection(this.firestore, 'orders'),
            where('sourceChannel', '==', 'mercadolibre'),
            orderBy('createdAt', 'desc'),
            limit(20)
        );

        collectionData(q, { idField: 'id' }).subscribe({
            next: (docs: any[]) => {
                const mapped = docs.map(d => ({
                    ...d,
                    createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : (d.createdAt ? new Date(d.createdAt) : new Date()),
                }));
                this.allMeliOrders.set(mapped);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('[Invoicing] load error:', err);
                this.toast.error('Error loading MeLi orders');
                this.isLoading.set(false);
            }
        });
    }

    setTab(tab: InvoicingTab) {
        this.activeTab.set(tab);
        this.expandedOrderId.set(null);
        this.currentPage.set(1);
    }

    onSearch(event: any) {
        this.searchQuery.set(event.target.value);
        this.currentPage.set(1);
        this.expandedOrderId.set(null);
    }

    prevPage() {
        if (this.currentPage() > 1) {
            this.currentPage.update(p => p - 1);
            this.expandedOrderId.set(null);
        }
    }

    nextPage() {
        if (this.currentPage() < this.totalPages()) {
            this.currentPage.update(p => p + 1);
            this.expandedOrderId.set(null);
        }
    }

    toggleRow(orderId: string) {
        this.expandedOrderId.update(current => current === orderId ? null : orderId);
    }

    // Validation Logic
    isInvoiceDataComplete(order: any): { valid: boolean; missing: string[] } {
        const missing: string[] = [];
        const inv = order.meliInvoice;
        
        if (!inv) return { valid: false, missing: ['Sin datos fiscales'] };

        // RFC format: 3-4 letters, 6 numbers, 3 alphanumeric
        const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-V1-9][A-Z1-9][0-9A]$/i;
        
        if (!inv.rfc) {
            missing.push('RFC faltante');
        } else if (!rfcRegex.test(inv.rfc)) {
            missing.push(`RFC inválido (${inv.rfc})`);
        }

        if (!inv.taxpayerType) {
            missing.push('Régimen Fiscal (Taxpayer Type) faltante');
        }

        if (!inv.billingAddress?.zipCode) {
            missing.push('Código Postal faltante');
        }

        return { valid: missing.length === 0, missing };
    }

    async markAsInvoiced(order: any, event: Event) {
        event.stopPropagation();
        
        const validCheck = this.isInvoiceDataComplete(order);
        if (!validCheck.valid) {
            this.toast.error('No se puede facturar. Faltan datos fiscales del receptor.');
            return;
        }

        this.processingIds.update(v => ({ ...v, [order.id]: true }));

        try {
            const genInvoice = httpsCallable(this.fns, 'generateInvoice');
            await genInvoice({ orderId: order.id });
            this.toast.success('CFDI generado exitosamente vía Facturapi.');
        } catch (error: any) {
            console.error('Invoice error:', error);
            this.toast.error(`Error PAC: ${error.message}`);
        } finally {
            this.processingIds.update(v => ({ ...v, [order.id]: false }));
        }
    }

    fmtMXN(val: number | null | undefined): string {
        if (!val) return '$0.00';
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
    }
}
