import { Component, EventEmitter, inject, Input, OnChanges, Output, signal, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InventoryLedgerService } from '../../../../core/services/inventory-ledger.service';
import { KardexEntry, InventoryBalance } from '../../../../core/models/inventory-ledger.model';
import { Product } from '../../../../core/models/product.model';
import { Timestamp } from '@angular/fire/firestore';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

interface KardexRow extends KardexEntry {
    runningBalance: number;
    runningValue: number;
    contextTitle: string;
    contextSubtitle: string;
    formattedDate: Date;
}

import { InventoryAdjustmentModalComponent } from '../adjustment/inventory-adjustment-modal.component';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
    selector: 'app-inventory-kardex',
    standalone: true,
    imports: [CommonModule, AppIconComponent, TranslateModule, InventoryAdjustmentModalComponent],
    templateUrl: './inventory-kardex.component.html',
    styleUrls: ['./inventory-kardex.component.css'],
    encapsulation: ViewEncapsulation.None
})
export class InventoryKardexComponent implements OnChanges {
    private ledgerService = inject(InventoryLedgerService);
    private toast = inject(ToastService);

    @Input() product: Product | null = null;
    @Input() isOpen = false;
    @Output() close = new EventEmitter<void>();

    // State
    isLoading = signal(false);
    history = signal<KardexRow[]>([]);
    currentBalance = signal<InventoryBalance | null>(null);
    showAdjustmentModal = signal(false);

    async ngOnChanges(changes: SimpleChanges) {
        console.log('[Kardex] ngOnChanges triggered:', changes);
        console.log('[Kardex] isOpen changed:', changes['isOpen']);
        console.log('[Kardex] isOpen value:', changes['isOpen']?.currentValue);
        console.log('[Kardex] product:', this.product);

        if (changes['isOpen']?.currentValue === true && this.product) {
            console.log('[Kardex] Calling loadData()...');
            await this.loadData();
        } else {
            console.log('[Kardex] NOT calling loadData - isOpen:', changes['isOpen']?.currentValue, 'product:', !!this.product);
        }
    }

    async loadData() {
        console.log('[Kardex] === LOAD DATA CALLED ===');
        console.log('[Kardex] Product:', this.product);
        console.log('[Kardex] Product ID:', this.product?.id);

        if (!this.product) {
            console.log('[Kardex] NO PRODUCT - EARLY EXIT');
            return;
        }

        this.isLoading.set(true);
        console.log('[Kardex] Loading set to true');

        try {
            // 1. Fetch Current Balance (Source of Truth)
            console.log('[Kardex] Fetching balance for product:', this.product.id);
            const balance$ = this.ledgerService.getBalance(this.product.id!);
            const balance = await firstValueFrom(balance$);
            console.log('[Kardex] Balance result:', balance);
            this.currentBalance.set(balance || null);

            // 2. Fetch History
            console.log('[Kardex] Fetching history for product:', this.product.id);
            const history$ = this.ledgerService.getHistory(this.product.id!);
            const rawEntries = await firstValueFrom(history$);
            console.log('[Kardex] History result:', rawEntries);
            console.log('[Kardex] Entry count:', rawEntries?.length);

            // 3. Process & Calculte Reverse
            if (rawEntries && rawEntries.length > 0) {
                console.log('[Kardex] Processing', rawEntries.length, 'entries...');
                const processed = this.calculateRunningBalances(rawEntries, balance);
                console.log('[Kardex] Processed entries:', processed);
                this.history.set(processed);
            } else {
                console.log('[Kardex] NO ENTRIES FOUND - Setting empty array');
                this.history.set([]);
            }

        } catch (err) {
            console.error('[Kardex] CRITICAL ERROR:', err);
            console.error('[Kardex] Error details:', JSON.stringify(err, null, 2));
            this.toast.error('Error loading kardex history');
        } finally {
            this.isLoading.set(false);
            console.log('[Kardex] Loading set to false');
            console.log('[Kardex] Final history length:', this.history().length);
        }
    }

    openAdjustment() {
        this.showAdjustmentModal.set(true);
    }

    async onAdjustmentClose(success: boolean) {
        this.showAdjustmentModal.set(false);
        if (success) {
            // Reload history to show the new adjustment
            await this.loadData();
        }
    }


    private calculateRunningBalances(entries: KardexEntry[], currentBal: InventoryBalance | null | undefined): KardexRow[] {
        const rows: KardexRow[] = [];

        // Start from current known state (or Product fallback if no balance entry exists yet)
        let currentQty = currentBal?.quantity ?? this.product?.stockQuantity ?? 0;
        let currentVal = currentBal?.totalValue ?? ((this.product?.stockQuantity || 0) * (this.product?.averageCost || 0));

        // Iterate Newest -> Oldest
        for (const entry of entries) {
            // Context Formatting
            const title = this.formatContextTitle(entry);
            const subtitle = this.formatContextSubtitle(entry);

            // Create Row with *Post-Transaction* Balance (which is the current state of iteration)
            const row: KardexRow = {
                ...entry,
                runningBalance: currentQty,
                runningValue: currentVal,
                contextTitle: title,
                contextSubtitle: subtitle,
                formattedDate: (entry.date as Timestamp).toDate()
            };
            rows.push(row);

            // Reverse the math to find state for the next (older) row
            // Only affect Physical Balance if the transaction affected Physical Stock
            if (entry.type !== 'RESERVE_STOCK' && entry.type !== 'RELEASE_STOCK') {
                currentQty = currentQty - entry.quantityChange;
            }

            // Value Reversal (Approximate for now based on Unit Cost recorded)
            // If we added $500 value, remove it.
            // Note: This is an estimation for display. True historical value requires complex snapshots.
            const moveValue = entry.quantityChange * entry.unitCost;
            currentVal = currentVal - moveValue;
        }

        return rows;
    }

    private formatContextTitle(entry: KardexEntry): string {
        switch (entry.referenceType) {
            case 'PURCHASE_ORDER': return `Purchase Order #${entry.notes?.split(':')[1]?.trim() || '???'}`;
            case 'ORDER': return `Sales Order #${entry.referenceId?.substring(0, 8).toUpperCase() || '???'}`;
            case 'ADJUSTMENT': return 'Manual Adjustment';
            case 'RETURN': return 'Customer Return';
            default: return 'Transaction';
        }
    }

    private formatContextSubtitle(entry: KardexEntry): string {
        if (entry.referenceType === 'ADJUSTMENT') return entry.notes || 'No notes';
        if (entry.referenceType === 'PURCHASE_ORDER') return 'Supplier Inbound';
        if (entry.referenceType === 'ORDER') return 'Customer Outbound';
        return entry.notes || '';
    }

    onClose() {
        this.close.emit();
    }
}
