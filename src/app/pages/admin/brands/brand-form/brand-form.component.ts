import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BrandService } from '../../../../core/services/brand.service';
import { Brand } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { CanComponentDeactivate } from '../../../../core/guards/unsaved-changes.guard';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

@Component({
    selector: 'app-brand-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent],
    templateUrl: './brand-form.component.html',
    styleUrl: './brand-form.component.css'
})
export class BrandFormComponent implements OnInit, CanComponentDeactivate {
    private fb = inject(FormBuilder);
    private brandService = inject(BrandService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    brandForm: FormGroup;
    isEditing = false;
    isSubmitting = false;
    previewUrl: string | null = null;
    selectedFile: File | null = null;
    currentBrandId: string | null = null;
    currentBrand: Brand | null = null;

    constructor() {
        this.brandForm = this.fb.group({
            name: ['', Validators.required],
            slug: ['', Validators.required],
            description_es: [''],
            description_en: [''],
            website: [''],
            countryOfOrigin: [''],
            order: [0, Validators.required],
            featured: [false],
            active: [true]
        });

        // Auto-generate slug from name
        this.brandForm.get('name')?.valueChanges.subscribe(name => {
            if (!this.isEditing && name) {
                const slug = this.generateSlug(name);
                this.brandForm.patchValue({ slug }, { emitEvent: false });
            }
        });
    }

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.isEditing = true;
            this.currentBrandId = id;
            this.loadBrand(id);
        }
    }

    async loadBrand(id: string) {
        try {
            const brand = await firstValueFrom(this.brandService.getBrandById(id));
            if (brand) {
                this.currentBrand = brand;
                this.brandForm.patchValue({
                    name: brand.name,
                    slug: brand.slug,
                    description_es: brand.description?.es || '',
                    description_en: brand.description?.en || '',
                    website: brand.website || '',
                    countryOfOrigin: brand.countryOfOrigin || '',
                    order: brand.order,
                    featured: brand.featured,
                    active: brand.active
                });
                this.previewUrl = brand.logoUrl || null;
            } else {
                this.toast.error('Brand not found');
                this.router.navigate(['/admin/brands']);
            }
        } catch (error) {
            console.error('Error loading brand:', error);
            this.toast.error('Error loading brand info');
            this.router.navigate(['/admin/brands']);
        }
    }

    onFileSelected(event: Event) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            this.selectedFile = file;
            // Create preview
            const reader = new FileReader();
            reader.onload = () => {
                this.previewUrl = reader.result as string;
            };
            reader.readAsDataURL(file);
            this.brandForm.markAsDirty();
        }
    }

    generateSlug(name: string): string {
        return name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    async onSubmit() {
        if (this.brandForm.invalid) {
            this.brandForm.markAllAsTouched();
            return;
        }

        if (!this.selectedFile && !this.isEditing && !this.previewUrl) {
            this.toast.error('Please select a logo');
            return;
        }

        this.isSubmitting = true;
        const formValue = this.brandForm.value;

        const brandData: Omit<Brand, 'id'> = {
            name: formValue.name,
            slug: formValue.slug,
            description: {
                es: formValue.description_es || '',
                en: formValue.description_en || ''
            },
            website: formValue.website || undefined,
            countryOfOrigin: formValue.countryOfOrigin || undefined,
            order: formValue.order,
            featured: formValue.featured,
            active: formValue.active,
            createdAt: this.currentBrand?.createdAt || new Date(),
            updatedAt: new Date()
        };

        try {
            if (this.isEditing && this.currentBrandId) {
                await this.brandService.updateBrand(this.currentBrandId, brandData, this.selectedFile || undefined);
                this.toast.success('Brand updated successfully');
            } else {
                await this.brandService.createBrand(brandData, this.selectedFile || undefined);
                this.toast.success('Brand created successfully');
            }
            this.brandForm.markAsPristine();
            this.router.navigate(['/admin/brands']);
        } catch (error) {
            console.error('Error saving brand:', error);
            this.toast.error('Error saving brand');
        } finally {
            this.isSubmitting = false;
        }
    }

    async onCancel() {
        if (this.brandForm.dirty) {
            const confirmed = await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
            if (!confirmed) return;
        }
        this.router.navigate(['/admin/brands']);
    }

    async canDeactivate(): Promise<boolean> {
        if (this.brandForm.dirty && !this.isSubmitting) {
            return await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
        }
        return true;
    }
}
