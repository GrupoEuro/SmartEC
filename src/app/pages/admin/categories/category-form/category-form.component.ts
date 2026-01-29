import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CategoryService } from '../../../../core/services/category.service';
import { Category } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { ValidationSummaryComponent } from '../../shared/validation-summary/validation-summary.component';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { CanComponentDeactivate } from '../../../../core/guards/unsaved-changes.guard';
import { firstValueFrom } from 'rxjs';

@Component({
    selector: 'app-category-form',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent, ValidationSummaryComponent],
    templateUrl: './category-form.component.html',
    styleUrl: './category-form.component.css'
})
export class CategoryFormComponent implements OnInit, CanComponentDeactivate {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private categoryService = inject(CategoryService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    categoryForm!: FormGroup;
    isEditing = false;
    categoryId: string | null = null;
    isSubmitting = false;
    submitState: 'idle' | 'validating' | 'saving' | 'success' | 'error' = 'idle';
    imageFile: File | null = null;
    imagePreview: string | null = null;
    parentCategories: Category[] = [];

    // Field labels for validation summary
    fieldLabels: { [key: string]: string } = {
        nameEn: 'Category Name (English)',
        nameEs: 'Category Name (Spanish)',
        slug: 'URL Slug',
        descriptionEn: 'Description (English)',
        descriptionEs: 'Description (Spanish)',
        icon: 'Icon',
        parentId: 'Parent Category',
        order: 'Display Order',
        active: 'Active Status'
    };

    ngOnInit() {
        this.initForm();
        this.loadParentCategories();
        this.checkEditMode();
    }

    initForm() {
        this.categoryForm = this.fb.group({
            nameEn: ['', Validators.required],
            nameEs: ['', Validators.required],
            slug: ['', Validators.required],
            descriptionEn: [''],
            descriptionEs: [''],
            icon: [''],
            parentId: [null],
            order: [0, [Validators.required, Validators.min(0)]],
            active: [true]
        });

        // Auto-generate slug from English name
        this.categoryForm.get('nameEn')?.valueChanges.subscribe(value => {
            if (value && !this.isEditing) {
                const slug = this.categoryService.generateSlug(value);
                this.categoryForm.patchValue({ slug }, { emitEvent: false });
            }
        });
    }

    async loadParentCategories() {
        try {
            this.parentCategories = await firstValueFrom(
                this.categoryService.getCategories()
            );
            // Filter out subcategories - only show root categories as parent options
            this.parentCategories = this.parentCategories.filter(cat => !cat.parentId);
        } catch (error) {
            console.error('Error loading parent categories:', error);
            this.toast.error('Failed to load parent categories');
        }
    }

    async checkEditMode() {
        this.categoryId = this.route.snapshot.paramMap.get('id');
        if (this.categoryId) {
            this.isEditing = true;
            await this.loadCategory(this.categoryId);
        }
    }

    async loadCategory(id: string) {
        try {
            const category = await firstValueFrom(
                this.categoryService.getCategoryById(id)
            );

            if (category) {
                this.categoryForm.patchValue({
                    nameEn: category.name.en,
                    nameEs: category.name.es,
                    slug: category.slug,
                    descriptionEn: category.description?.en || '',
                    descriptionEs: category.description?.es || '',
                    icon: category.icon || '',
                    parentId: category.parentId || null,
                    order: category.order,
                    active: category.active
                });

                if (category.imageUrl) {
                    this.imagePreview = category.imageUrl;
                }
            } else {
                this.toast.error('Category not found');
                this.router.navigate(['/admin/categories']);
            }
        } catch (error) {
            console.error('Error loading category:', error);
            this.toast.error('Error loading category info');
            this.router.navigate(['/admin/categories']);
        }
    }

    onImageSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            this.imageFile = input.files[0];

            // Create preview
            const reader = new FileReader();
            reader.onload = (e) => {
                this.imagePreview = e.target?.result as string;
            };
            reader.readAsDataURL(this.imageFile);
            this.categoryForm.markAsDirty();
        }
    }

    removeImage() {
        this.imageFile = null;
        this.imagePreview = null;
        this.categoryForm.markAsDirty();
    }

    async onSubmit() {
        if (this.categoryForm.invalid || this.isSubmitting) {
            this.categoryForm.markAllAsTouched();
            return;
        }

        // Start submit process
        this.isSubmitting = true;
        this.submitState = 'saving';

        try {
            const formValue = this.categoryForm.value;

            const categoryData: any = {
                name: {
                    en: formValue.nameEn,
                    es: formValue.nameEs
                },
                slug: formValue.slug,
                order: formValue.order,
                active: formValue.active,
                imageUrl: '',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Only add optional fields if they have values
            if (formValue.descriptionEn || formValue.descriptionEs) {
                categoryData.description = {
                    en: formValue.descriptionEn || '',
                    es: formValue.descriptionEs || ''
                };
            }

            if (formValue.icon) {
                categoryData.icon = formValue.icon;
            }

            if (formValue.parentId) {
                categoryData.parentId = formValue.parentId;
            }

            if (this.isEditing && this.categoryId) {
                await this.categoryService.updateCategory(
                    this.categoryId,
                    categoryData,
                    this.imageFile || undefined
                );
                this.submitState = 'success';
                this.toast.success('Category updated successfully');
            } else {
                await this.categoryService.createCategory(
                    categoryData,
                    this.imageFile || undefined
                );
                this.submitState = 'success';
                this.toast.success('Category created successfully');
            }

            this.categoryForm.markAsPristine();

            // Navigate after short delay to show success state
            setTimeout(() => {
                this.router.navigate(['/admin/categories']);
            }, 500);
        } catch (error) {
            console.error('Error saving category:', error);
            this.submitState = 'error';
            this.toast.error('Error saving category. Please try again.');
        } finally {
            setTimeout(() => {
                this.isSubmitting = false;
                if (this.submitState !== 'success') {
                    this.submitState = 'idle';
                }
            }, 1000);
        }
    }

    async onCancel() {
        if (this.categoryForm.dirty) {
            const confirmed = await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
            if (!confirmed) return;
        }
        this.router.navigate(['/admin/categories']);
    }

    async canDeactivate(): Promise<boolean> {
        if (this.categoryForm.dirty && !this.isSubmitting) {
            return await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
        }
        return true;
    }
}
