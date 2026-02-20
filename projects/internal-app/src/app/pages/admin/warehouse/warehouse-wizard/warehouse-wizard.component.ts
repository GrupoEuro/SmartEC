import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { WarehouseService } from '../../../../core/services/warehouse.service';
import { WarehouseType } from '../../../../core/models/warehouse.model';

@Component({
    selector: 'app-warehouse-wizard',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AppIconComponent],
    templateUrl: './warehouse-wizard.component.html',
    styleUrls: ['./warehouse-wizard.component.css']
})
export class WarehouseWizardComponent {
    private fb = inject(FormBuilder);
    private warehouseService = inject(WarehouseService);
    public router = inject(Router);

    currentStep = signal(1);
    selectedType = signal<WarehouseType>('physical');
    isSubmitting = signal(false);

    form: FormGroup = this.fb.group({
        name: ['', Validators.required],
        code: ['', [Validators.required, Validators.pattern('^[A-Z0-9-_]+$')]],
        type: ['physical', Validators.required],
        // Physical
        address: [''],
        totalArea: [0],
        // Virtual
        processType: ['general']
    });

    selectType(type: WarehouseType) {
        this.selectedType.set(type);
        this.form.patchValue({ type });
        this.nextStep();
    }

    nextStep() {
        this.currentStep.update(s => s + 1);
    }

    prevStep() {
        this.currentStep.update(s => s - 1);
    }

    async onSubmit() {
        if (this.form.invalid) return;

        this.isSubmitting.set(true);
        try {
            const warehouseId = await this.warehouseService.createWarehouse(this.form.value);
            // Navigate to the management page (to be built, for now list)
            this.router.navigate(['/admin/warehouses']);
        } catch (error) {
            console.error('Error creating warehouse:', error);
        } finally {
            this.isSubmitting.set(false);
        }
    }
}
