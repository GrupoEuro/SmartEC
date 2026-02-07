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
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { MediaPickerDialogComponent } from '../../../../shared/components/media-picker-dialog/media-picker-dialog.component';
import { IconPickerDialogComponent } from '../../../../shared/components/icon-picker-dialog/icon-picker-dialog.component';
import { MediaAsset } from '../../../../core/models/media.model';

@Component({
    selector: 'app-category-form',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent, ValidationSummaryComponent, AppIconComponent, MediaPickerDialogComponent, IconPickerDialogComponent],
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

    // Media Library Integration
    showMediaPicker = false;

    // Force Rebuild
    openMediaLibrary() {
        this.showMediaPicker = true;
    }

    onMediaAssetSelected(asset: MediaAsset) {
        this.imagePreview = asset.publicUrl;
        this.imageFile = null; // Clear any locally selected file since we are using a URL
        this.categoryForm.markAsDirty();
        this.showMediaPicker = false;

        // If we need to send this URL to the backend, we might need to handle it.
        // The current service seems to expect a file or nothing for the image update.
        // However, if we just want to update the preview for now and let the backend handle the URL update
        // (assuming the backend supports updating image via URL or we download/re-upload or just pass the URL),
        // we need to check how `categoryService.updateCategory` works.
        // 
        // NOTE: The current `categoryService.updateCategory` signature in `category-form.ts` (lines 201-205)
        // takes `this.imageFile || undefined`. It doesn't seem to take a URL string directly for the image
        // unless it's part of `categoryData`.
        //
        // Let's assume for now that we will pass the URL in the categoryData if no file is provided.
        // I will update onSubmit to handle this.
    }

    closeMediaPicker() {
        this.showMediaPicker = false;
    }

    // Icon Picker Integration
    showIconPicker = false;

    openIconPicker() {
        this.showIconPicker = true;
    }

    onIconSelected(icon: string) {
        this.categoryForm.patchValue({ icon });
        this.categoryForm.markAsDirty();
        this.showIconPicker = false;
    }

    closeIconPicker() {
        this.showIconPicker = false;
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

            // Prepare typesafe CategoryPartial
            const categoryData: any = {
                name: {
                    en: formValue.nameEn,
                    es: formValue.nameEs
                },
                slug: formValue.slug,
                order: formValue.order,
                active: formValue.active,
                // created/updated handled by backend/service ideally but keeping simplified here
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
                // If we have an image file, it will be uploaded.
                // If we don't have a file, but we have a preview that is DIFFERENT from original?
                // Actually, the service likely handles "if file provided, upload and update image url. if not, keep existing".
                // But if we selected from media library, we have a NEW URL but NO file.
                // We need to pass this new URL to the backend.
                // Let's add imageUrl to categoryData if we have one and no file.
                if (!this.imageFile && this.imagePreview) {
                    categoryData.imageUrl = this.imagePreview;
                }

                await this.categoryService.updateCategory(
                    this.categoryId,
                    categoryData,
                    this.imageFile || undefined
                );
                this.submitState = 'success';
                this.toast.success('Category updated successfully');
            } else {
                if (!this.imageFile && this.imagePreview) {
                    categoryData.imageUrl = this.imagePreview;
                }
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
