import { Component, inject, OnInit, signal, HostListener } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { ProductTypeTemplateService } from '../../../../core/services/product-type-template.service';
import { ProductTypeTemplate, SpecificationFieldTemplate } from '../../../../core/models/catalog.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { trigger, state, style, transition, animate, keyframes } from '@angular/animations';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { IconPickerDialogComponent } from '../../../../shared/components/icon-picker-dialog/icon-picker-dialog.component';

@Component({
    selector: 'app-product-type-form',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, AppIconComponent, DragDropModule, TranslateModule, IconPickerDialogComponent],
    templateUrl: './product-type-form.component.html',
    styleUrls: ['./product-type-form.component.css'],
    animations: [
        // Field card slide-in animation
        trigger('slideIn', [
            transition(':enter', [
                style({ opacity: 0, transform: 'translateY(-20px) scale(0.95)' }),
                animate('400ms cubic-bezier(0.4, 0, 0.2, 1)',
                    style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
            ])
        ]),
        // Field card slide-out animation
        trigger('slideOut', [
            transition(':leave', [
                style({ opacity: 1, transform: 'scale(1)' }),
                animate('300ms cubic-bezier(0.4, 0, 1, 1)',
                    style({ opacity: 0, transform: 'scale(0.9) translateX(20px)' }))
            ])
        ]),
        // Save button state animation
        trigger('buttonState', [
            state('idle', style({ transform: 'scale(1)' })),
            state('saving', style({ transform: 'scale(0.95)' })),
            state('saved', style({ transform: 'scale(1)' })),
            transition('idle => saving', animate('150ms ease-out')),
            transition('saving => saved', animate('300ms cubic-bezier(0.68, -0.55, 0.265, 1.55)'))
        ]),
        // Icon fade and scale
        trigger('iconChange', [
            transition('* => *', [
                animate('200ms ease-out', keyframes([
                    style({ opacity: 1, transform: 'scale(1)', offset: 0 }),
                    style({ opacity: 0, transform: 'scale(0.8)', offset: 0.5 }),
                    style({ opacity: 1, transform: 'scale(1)', offset: 1 })
                ]))
            ])
        ])
    ]
})
export class ProductTypeFormComponent implements OnInit {
    private productTypeService = inject(ProductTypeTemplateService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private fb = inject(FormBuilder);

    // State
    template: ProductTypeTemplate | null = null;
    isEditing = false;
    loading = true;
    saving = false;
    saved = false;
    buttonState: 'idle' | 'saving' | 'saved' = 'idle';
    selectedFieldIndex: number | null = null;

    // UX Improvements
    lastGeneratedKeys: { [index: number]: string } = {};
    duplicateKeyIndices: number[] = [];

    // Help text for tooltips
    helpText = {
        fieldKey: 'Unique identifier used in code and database. Use lowercase letters, numbers, and underscores only.',
        required: 'End users must fill this field before saving the product.',
        searchable: 'This field will be indexed for product search functionality.',
        filterable: 'This field will appear as a filter option in the catalog.',
        unit: 'Display unit after the value (e.g., "kg", "cm", "L").',
        options: 'For dropdown fields. Separate options with commas.',
        type: 'The type of data this field will accept.',
        minMax: 'Set minimum and maximum allowed values for number fields.'
    };

    // Field type quick templates
    fieldTemplates = [
        {
            id: 'weight',
            icon: '⚖️',
            name: 'Weight',
            template: {
                type: 'number',
                labelEn: 'Weight',
                labelEs: 'Peso',
                key: 'weight',
                unit: 'kg',
                min: 0,
                required: false,
                searchable: false,
                filterable: false
            }
        },
        {
            id: 'dimensions',
            icon: '📏',
            name: 'Dimensions',
            template: {
                type: 'text',
                labelEn: 'Dimensions',
                labelEs: 'Dimensiones',
                key: 'dimensions',
                unit: 'cm',
                required: false,
                searchable: false,
                filterable: false
            }
        },
        {
            id: 'color',
            icon: '🎨',
            name: 'Color',
            template: {
                type: 'select',
                labelEn: 'Color',
                labelEs: 'Color',
                key: 'color',
                optionsString: 'Black, White, Blue, Red, Green, Yellow, Orange, Purple',
                required: false,
                searchable: false,
                filterable: true
            }
        },
        {
            id: 'size',
            icon: '📐',
            name: 'Size',
            template: {
                type: 'select',
                labelEn: 'Size',
                labelEs: 'Talla',
                key: 'size',
                optionsString: 'XS, S, M, L, XL, XXL',
                required: false,
                searchable: false,
                filterable: true
            }
        },
        {
            id: 'material',
            icon: '🧱',
            name: 'Material',
            template: {
                type: 'text',
                labelEn: 'Material',
                labelEs: 'Material',
                key: 'material',
                required: false,
                searchable: true,
                filterable: true
            }
        },
        {
            id: 'battery',
            icon: '🔋',
            name: 'Battery Capacity',
            template: {
                type: 'number',
                labelEn: 'Battery Capacity',
                labelEs: 'Capacidad de Batería',
                key: 'battery_capacity',
                unit: 'mAh',
                min: 0,
                required: false,
                searchable: false,
                filterable: false
            }
        },
        {
            id: 'warranty',
            icon: '🛡️',
            name: 'Warranty',
            template: {
                type: 'text',
                labelEn: 'Warranty Period',
                labelEs: 'Período de Garantía',
                key: 'warranty_period',
                required: false,
                searchable: false,
                filterable: false
            }
        },
        {
            id: 'featured',
            icon: '⭐',
            name: 'Featured',
            template: {
                type: 'boolean',
                labelEn: 'Featured Product',
                labelEs: 'Producto Destacado',
                key: 'is_featured',
                required: false,
                searchable: false,
                filterable: true
            }
        }
    ];

    showTemplates = false;
    showIconPicker = false;

    openIconPicker() {
        this.showIconPicker = true;
    }

    onIconSelected(icon: string) {
        this.productTypeForm?.patchValue({ icon });
        this.productTypeForm?.markAsDirty();
        this.showIconPicker = false;
    }

    closeIconPicker() {
        this.showIconPicker = false;
    }

    productTypeForm: FormGroup | null = null;

    async ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id && id !== 'new') {
            this.isEditing = true;
            await this.loadTemplate(id);
        } else {
            this.initializeNewForm();
        }
        this.loading = false;
    }

    /**
     * Load existing template for editing
     */
    async loadTemplate(id: string) {
        try {
            this.template = await this.productTypeService.getTemplateById(id);
            if (this.template) {
                this.initializeFormWithTemplate(this.template);
            } else {
                alert('Product type not found');
                this.router.navigate(['/admin/product-types']);
            }
        } catch (error) {
            console.error('Error loading template:', error);
            alert('Failed to load product type');
            this.router.navigate(['/admin/product-types']);
        }
    }

    /**
     * Initialize form for new product type
     */
    initializeNewForm() {
        this.productTypeForm = this.fb.group({
            id: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
            nameEn: ['', Validators.required],
            nameEs: ['', Validators.required],
            icon: ['🎯', Validators.required],
            active: [true],
            schema: this.fb.array([])
        });
    }

    /**
     * Initialize form with existing template data
     */
    initializeFormWithTemplate(template: ProductTypeTemplate) {
        this.productTypeForm = this.fb.group({
            id: [{ value: template.id, disabled: true }, [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
            nameEn: [template.name.en, Validators.required],
            nameEs: [template.name.es, Validators.required],
            icon: [template.icon, Validators.required],
            active: [template.active],
            schema: this.fb.array([])
        });

        // Populate schema fields
        template.schema.forEach(field => {
            this.addSpecificationFieldWithData(field);
        });
    }

    /**
     * Get the schema FormArray
     */
    get schemaFields(): FormArray {
        return this.productTypeForm?.get('schema') as FormArray;
    }

    /**
     * Add a new specification field to the form
     */
    addSpecificationField() {
        const fieldGroup = this.fb.group({
            id: [this.generateFieldId()],
            key: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
            labelEn: ['', Validators.required],
            labelEs: ['', Validators.required],
            type: ['text', Validators.required],
            required: [false],
            unit: [''],
            optionsString: [''], // For select type
            min: [null],
            max: [null],
            searchable: [false],
            filterable: [false],
            displayOrder: [this.schemaFields.length]
        });

        this.schemaFields.push(fieldGroup);

        // Auto-focus on the English label input after view update
        setTimeout(() => {
            const newIndex = this.schemaFields.length - 1;
            const labelInput = document.querySelector(
                `.spec-card:nth-child(${newIndex + 1}) input[formControlName="labelEn"]`
            ) as HTMLInputElement;
            labelInput?.focus();
        }, 100);
    }

    /**
     * Add specification field with existing data
     */
    addSpecificationFieldWithData(field: SpecificationFieldTemplate) {
        const fieldGroup = this.fb.group({
            id: [field.id || this.generateFieldId()],
            key: [field.key, [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
            labelEn: [field.label.en, Validators.required],
            labelEs: [field.label.es, Validators.required],
            type: [field.type, Validators.required],
            required: [field.required],
            unit: [field.unit || ''],
            optionsString: [field.options?.join(', ') || ''],
            min: [field.min ?? null],
            max: [field.max ?? null],
            searchable: [field.searchable],
            filterable: [field.filterable],
            displayOrder: [field.displayOrder]
        });

        this.schemaFields.push(fieldGroup);
    }

    /**
     * Add field from a quick template
     */
    addFieldFromTemplate(templateId: string) {
        const template = this.fieldTemplates.find(t => t.id === templateId);
        if (!template) return;

        const tpl = template.template;
        const fieldGroup = this.fb.group({
            id: [this.generateFieldId()],
            key: [tpl.key, [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
            labelEn: [tpl.labelEn, Validators.required],
            labelEs: [tpl.labelEs, Validators.required],
            type: [tpl.type, Validators.required],
            required: [tpl.required],
            unit: [(tpl as any).unit || ''],
            optionsString: [(tpl as any).optionsString || ''],
            min: [(tpl as any).min ?? null],
            max: [(tpl as any).max ?? null],
            searchable: [tpl.searchable],
            filterable: [tpl.filterable],
            displayOrder: [this.schemaFields.length]
        });

        this.schemaFields.push(fieldGroup);
        this.showTemplates = false; // Hide template selector

        // Auto-focus on the key field for quick customization
        setTimeout(() => {
            const newIndex = this.schemaFields.length - 1;
            const keyInput = document.querySelector(
                `.spec-card:nth-child(${newIndex + 1}) input[formControlName="key"]`
            ) as HTMLInputElement;
            keyInput?.select(); // Select the text so user can easily modify
        }, 100);
    }

    /**
     * Remove a specification field (with smart confirmation)
     */
    removeSpecificationField(index: number) {
        const field = this.schemaFields.at(index);
        const labelEn = field.get('labelEn')?.value;
        const key = field.get('key')?.value;
        const hasContent = labelEn || key;

        // Only confirm if field has content
        if (hasContent) {
            const fieldName = labelEn || key || 'this field';
            const confirmed = confirm(
                `Are you sure you want to delete "${fieldName}"?\n\nThis action cannot be undone.`
            );
            if (!confirmed) return;
        }

        this.schemaFields.removeAt(index);
        this.updateDisplayOrders();
        this.updateDuplicateKeyIndices();

        // Clear from lastGeneratedKeys
        delete this.lastGeneratedKeys[index];

        // Shift down the keys for fields after this one
        const newKeys: { [index: number]: string } = {};
        Object.keys(this.lastGeneratedKeys).forEach(key => {
            const idx = parseInt(key);
            if (idx > index) {
                newKeys[idx - 1] = this.lastGeneratedKeys[idx];
            } else if (idx < index) {
                newKeys[idx] = this.lastGeneratedKeys[idx];
            }
        });
        this.lastGeneratedKeys = newKeys;
    }

    /**
     * Move field up in the list
     */
    moveFieldUp(index: number) {
        if (index > 0) {
            const field = this.schemaFields.at(index);
            this.schemaFields.removeAt(index);
            this.schemaFields.insert(index - 1, field);
            this.updateDisplayOrders();
        }
    }

    /**
     * Move field down in the list
     */
    moveFieldDown(index: number) {
        if (index < this.schemaFields.length - 1) {
            const field = this.schemaFields.at(index);
            this.schemaFields.removeAt(index);
            this.schemaFields.insert(index + 1, field);
            this.updateDisplayOrders();
        }
    }

    /**
     * Update display orders after reordering
     */
    updateDisplayOrders() {
        this.schemaFields.controls.forEach((control, index) => {
            control.get('displayOrder')?.setValue(index);
        });
    }

    /**
     * Generate unique field ID
     */
    generateFieldId(): string {
        return 'field_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Submit the form
     */
    async onSubmit() {
        if (this.productTypeForm?.invalid || this.saving) {
            this.markFormGroupTouched(this.productTypeForm!);

            // Check for duplicate keys
            const duplicates = this.checkDuplicateKeys();
            if (duplicates.length > 0) {
                alert(`Duplicate field keys found: ${duplicates.join(', ')}. Please use unique keys for each field.`);
                return;
            }

            alert('Please fill in all required fields correctly');
            return;
        }

        this.saving = true;
        this.buttonState = 'saving';

        try {
            const formValue = this.productTypeForm!.getRawValue();

            // Build the template object
            const templateData: any = {
                id: formValue.id,
                name: {
                    en: formValue.nameEn,
                    es: formValue.nameEs
                },
                icon: formValue.icon,
                active: formValue.active,
                isSystem: false,
                version: 1,
                schema: this.buildSchemaFromForm(formValue.schema)
            };

            if (this.isEditing) {
                // Update existing template
                await this.productTypeService.updateTemplate(formValue.id, {
                    name: templateData.name,
                    icon: templateData.icon,
                    active: templateData.active,
                    schema: templateData.schema
                });
            } else {
                // Create new template
                await this.productTypeService.createTemplate(templateData);
            }

            // Success state
            this.buttonState = 'saved';
            this.saved = true;

            // Wait a moment to show success, then navigate
            setTimeout(() => {
                this.router.navigate(['/admin/product-types']);
            }, 1200);

        } catch (error: any) {
            console.error('Error saving product type:', error);
            alert(`Failed to save product type: ${error.message || 'Unknown error'}`);
            this.buttonState = 'idle';
        } finally {
            this.saving = false;
        }
    }

    /**
     * Build schema array from form data
     */
    buildSchemaFromForm(schemaFormData: any[]): SpecificationFieldTemplate[] {
        return schemaFormData.map(field => {
            const spec: SpecificationFieldTemplate = {
                id: field.id,
                key: field.key,
                label: {
                    en: field.labelEn,
                    es: field.labelEs
                },
                type: field.type,
                required: field.required,
                searchable: field.searchable,
                filterable: field.filterable,
                displayOrder: field.displayOrder
            };

            // Add optional fields
            if (field.unit) spec.unit = field.unit;
            if (field.type === 'select' && field.optionsString) {
                spec.options = field.optionsString.split(',').map((opt: string) => opt.trim()).filter((opt: string) => opt);
            }
            if (field.type === 'number') {
                if (field.min !== null && field.min !== undefined) spec.min = field.min;
                if (field.max !== null && field.max !== undefined) spec.max = field.max;
            }

            return spec;
        });
    }

    /**
     * Mark all form fields as touched to show validation errors
     */
    markFormGroupTouched(formGroup: FormGroup) {
        Object.keys(formGroup.controls).forEach(key => {
            const control = formGroup.get(key);
            control?.markAsTouched();

            if (control instanceof FormGroup) {
                this.markFormGroupTouched(control);
            } else if (control instanceof FormArray) {
                control.controls.forEach(ctrl => {
                    if (ctrl instanceof FormGroup) {
                        this.markFormGroupTouched(ctrl);
                    }
                });
            }
        });
    }

    /**
     * Handle drag-and-drop field reordering
     */
    onFieldDrop(event: CdkDragDrop<any>) {
        const array = this.schemaFields;
        moveItemInArray(array.controls, event.previousIndex, event.currentIndex);
        moveItemInArray(array.value, event.previousIndex, event.currentIndex);
        this.updateDisplayOrders();
        array.updateValueAndValidity();
    }

    /**
     * Handle keyboard shortcuts
     */
    @HostListener('document:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        // Only handle shortcuts if form is active
        if (!this.productTypeForm) return;

        const cmdOrCtrl = event.metaKey || event.ctrlKey;

        if (cmdOrCtrl && event.key === 's') {
            // Cmd/Ctrl + S: Save
            event.preventDefault();
            this.onSubmit();
        } else if (cmdOrCtrl && event.key === 'd' && this.selectedFieldIndex !== null) {
            // Cmd/Ctrl + D: Duplicate selected field
            event.preventDefault();
            this.duplicateField(this.selectedFieldIndex);
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedFieldIndex !== null) {
            // Delete/Backspace: Remove selected field (only if not focused on input)
            const target = event.target as HTMLElement;
            if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
                event.preventDefault();
                this.removeSpecificationField(this.selectedFieldIndex);
            }
        } else if (event.key === 'Escape') {
            // Escape: Deselect field
            this.selectedFieldIndex = null;
        }
    }

    /**
     * Select a field (for keyboard shortcuts)
     */
    selectField(index: number) {
        this.selectedFieldIndex = index;
    }

    /**
     * Duplicate a field
     */
    duplicateField(index: number) {
        const field = this.schemaFields.at(index);
        if (field) {
            const duplicatedField = this.fb.group({
                id: [this.generateFieldId()],
                key: [field.get('key')?.value + '_copy'],
                labelEn: [field.get('labelEn')?.value + ' (Copy)'],
                labelEs: [field.get('labelEs')?.value + ' (Copia)'],
                type: [field.get('type')?.value],
                required: [field.get('required')?.value],
                unit: [field.get('unit')?.value],
                optionsString: [field.get('optionsString')?.value],
                min: [field.get('min')?.value],
                max: [field.get('max')?.value],
                searchable: [field.get('searchable')?.value],
                filterable: [field.get('filterable')?.value],
                displayOrder: [this.schemaFields.length]
            });

            this.schemaFields.insert(index + 1, duplicatedField);
            this.updateDisplayOrders();
        }
    }

    /**
     * Check for duplicate field keys
     */
    checkDuplicateKeys(): string[] {
        const keys = this.schemaFields.controls.map(c => c.get('key')?.value);
        const duplicates = keys.filter((key, index) => key && keys.indexOf(key) !== index);
        return [...new Set(duplicates)];
    }

    /**
     * Check for duplicate keys and update indices for inline display
     */
    updateDuplicateKeyIndices(): void {
        const keys = this.schemaFields.controls.map(c => c.get('key')?.value);
        const duplicateKeys = new Set<string>();
        const seen = new Set<string>();

        keys.forEach(key => {
            if (key && seen.has(key)) {
                duplicateKeys.add(key);
            }
            if (key) seen.add(key);
        });

        this.duplicateKeyIndices = [];
        keys.forEach((key, index) => {
            if (key && duplicateKeys.has(key)) {
                this.duplicateKeyIndices.push(index);
            }
        });
    }

    /**
     * Check if a specific field has a duplicate key
     */
    isDuplicateKey(index: number): boolean {
        return this.duplicateKeyIndices.includes(index);
    }

    /**
     * Get the indices of other fields with the same key
     */
    getDuplicateFieldNumbers(index: number): number[] {
        const field = this.schemaFields.at(index);
        const currentKey = field.get('key')?.value;
        if (!currentKey) return [];

        return this.schemaFields.controls
            .map((c, i) => ({ key: c.get('key')?.value, index: i }))
            .filter(item => item.key === currentKey && item.index !== index)
            .map(item => item.index + 1); // +1 for user-friendly numbering
    }

    /**
     * Smart field key generation from English label
     */
    onLabelEnChange(index: number, event: Event): void {
        const input = event.target as HTMLInputElement;
        const value = input.value;
        const field = this.schemaFields.at(index);
        const currentKey = field.get('key')?.value;

        // Only auto-generate if key is empty or matches previous auto-gen
        if (!currentKey || currentKey === this.lastGeneratedKeys[index]) {
            const suggestedKey = value
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '') // Remove special chars
                .trim()
                .replace(/\s+/g, '_'); // Replace spaces with underscores

            if (suggestedKey) {
                field.patchValue({ key: suggestedKey }, { emitEvent: false });
                this.lastGeneratedKeys[index] = suggestedKey;
                this.updateDuplicateKeyIndices();
            }
        }
    }

    /**
     * Handle manual key changes
     */
    onKeyChange(index: number): void {
        const field = this.schemaFields.at(index);
        const currentKey = field.get('key')?.value;

        // Update last generated key to prevent future auto-generation
        if (currentKey !== this.lastGeneratedKeys[index]) {
            delete this.lastGeneratedKeys[index];
        }

        this.updateDuplicateKeyIndices();
    }

    /**
     * Count required fields
     */
    get requiredFieldsCount(): number {
        return this.schemaFields.controls.filter(c => c.get('required')?.value).length;
    }

    /**
     * Count searchable fields
     */
    get searchableFieldsCount(): number {
        return this.schemaFields.controls.filter(c => c.get('searchable')?.value).length;
    }

    /**
     * Count filterable fields
     */
    get filterableFieldsCount(): number {
        return this.schemaFields.controls.filter(c => c.get('filterable')?.value).length;
    }
}
