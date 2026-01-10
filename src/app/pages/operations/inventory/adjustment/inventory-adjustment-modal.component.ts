import { Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { InventoryLedgerService } from '../../../../core/services/inventory-ledger.service';
import { Product } from '../../../../core/models/product.model';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-inventory-adjustment-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule, AppIconComponent],
    templateUrl: './inventory-adjustment-modal.component.html',
    styleUrls: ['./inventory-adjustment-modal.component.css']
})
export class InventoryAdjustmentModalComponent {
    private fb = inject(FormBuilder);
    private ledgerService = inject(InventoryLedgerService); // Use existing service
    private toast = inject(ToastService);

    @Input() product: Product | null = null;
    @Input() currentStock: number = 0;
    @Output() close = new EventEmitter<boolean>(); // true = success/changed

    form: FormGroup;
    isSubmitting = signal(false);

    reasons = [
        { id: 'DAMAGED', label: 'Damaged / Broken', type: 'OUT' },
        { id: 'LOST', label: 'Lost / Theft', type: 'OUT' },
        { id: 'FOUND', label: 'Found in Warehouse', type: 'IN' },
        { id: 'COUNT_CORRECTION', label: 'Count Correction', type: 'BOTH' },
        { id: 'PROMOTION', label: 'Marketing / Promotion', type: 'OUT' }
    ];

    constructor() {
        this.form = this.fb.group({
            type: ['OUT', Validators.required],
            quantity: [1, [Validators.required, Validators.min(1)]],
            reason: ['', Validators.required],
            notes: ['', Validators.required]
        });
    }

    get predictedBalance(): number {
        if (!this.form.valid) return this.currentStock;
        const qty = this.form.get('quantity')?.value || 0;
        const type = this.form.get('type')?.value;
        return type === 'IN' ? (this.currentStock + qty) : (this.currentStock - qty);
    }

    async onSubmit() {
        if (this.form.invalid || !this.product) return;

        this.isSubmitting.set(true);
        const { type, quantity, reason, notes } = this.form.value;

        // Calculate signed quantity change
        const finalQty = type === 'IN' ? quantity : -quantity;

        // Costing Logic:
        // For OUT: We don't strictly need unitCost (Ledger handles it using AvgCost or 0).
        // For IN (Found): We should typically use the Current Average Cost to not skew the value too much, 
        // OR 0 if we want to lower avg cost. Let's use Current Avg Cost.
        const unitCost = this.product.averageCost || 0;

        try {
            await this.ledgerService.logTransaction(
                this.product.id!,
                'ADJUSTMENT',
                finalQty,
                unitCost,
                'MANUAL-' + Date.now(), // Reference ID
                'ADJUSTMENT',
                `${reason}: ${notes}` // Combine reason and notes
            );

            this.toast.success('Inventory adjusted successfully');
            this.close.emit(true);
        } catch (error) {
            this.toast.error('Failed to adjust inventory');
        } finally {
            this.isSubmitting.set(false);
        }
    }

    onCancel() {
        this.close.emit(false);
    }
}
