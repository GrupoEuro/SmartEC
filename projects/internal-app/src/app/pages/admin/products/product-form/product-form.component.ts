import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ProductService } from '../../../../core/services/product.service';
import { CategoryService } from '../../../../core/services/category.service';
import { ProductTypeConfigService } from '../../../../core/services/product-type-config.service';
import { Product } from '../../../../core/models/product.model';
import { Category, ProductType, ProductTypeDefinition, SpecificationField } from '../../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { LoadingSpinnerComponent } from '../../../../components/shared/loading-spinner/loading-spinner.component';
import { ValidationSummaryComponent } from '../../shared/validation-summary/validation-summary.component';
import { CharacterCounterComponent } from '../../shared/character-counter/character-counter.component';
import { SeoPreviewComponent } from '../../shared/seo-preview/seo-preview.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { FormHelperService } from '../../../../core/services/form-helper.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { CanComponentDeactivate } from '../../../../core/guards/unsaved-changes.guard';
import { MediaPickerDialogComponent } from '../../../../shared/components/media-picker-dialog/media-picker-dialog.component';
import { MediaAsset } from '../../../../core/models/media.model';
import { firstValueFrom } from 'rxjs';
import { CdkDragDrop, moveItemInArray, DragDropModule } from '@angular/cdk/drag-drop';

// Image metadata interface
interface ImageMetadata {
    width: number;
    height: number;
    size: number;
    type: string;
    aspectRatio: string;
    filename: string;
}

@Component({
    selector: 'app-product-form',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ReactiveFormsModule,
        TranslateModule,
        AdminPageHeaderComponent,
        LoadingSpinnerComponent,
        ValidationSummaryComponent,
        CharacterCounterComponent,
        SeoPreviewComponent,
        StatusBadgeComponent,
        ToggleSwitchComponent,
        MediaPickerDialogComponent,
        DragDropModule
    ],
    templateUrl: './product-form.component.html',
    styleUrls: [
        './product-form.component.css',
        './media-library-styles.css'
    ]
})
export class ProductFormComponent implements OnInit, CanComponentDeactivate {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private productService = inject(ProductService);
    private categoryService = inject(CategoryService);
    private productTypeConfig = inject(ProductTypeConfigService);
    private formHelper = inject(FormHelperService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    productForm!: FormGroup;
    isEditing = false;
    productId: string | null = null;
    isSubmitting = false;

    // Submit button states
    submitSuccess = false;
    submitError = false;
    errorCount = 0;
    submitState: 'idle' | 'validating' | 'uploading' | 'saving' | 'success' | 'error' = 'idle';
    errorMessage = '';

    // Unified image handling
    productImages: Array<{ url: string, file?: File, meta?: ImageMetadata }> = [];

    // Media library picker
    showMediaPicker = false;
    mediaPickerMode: 'main' | 'gallery' = 'main';

    // Product Type Management
    availableProductTypes: ProductTypeDefinition[] = [];
    selectedProductType: ProductType = 'tire';
    currentSpecSchema: SpecificationField[] = [];

    // Options
    categories: Category[] = [];
    brands = ['Praxis', 'Michelin', 'Pirelli', 'Dunlop', 'Bridgestone', 'Continental'];

    // Field labels for validation summary (dynamic based on product type)
    fieldLabels: { [key: string]: string } = {
        productType: 'Product Type',
        nameEn: 'Product Name (English)',
        nameEs: 'Product Name (Spanish)',
        slug: 'URL Slug',
        sku: 'SKU',
        brand: 'Brand',
        categoryId: 'Category',
        descriptionEn: 'Description (English)',
        descriptionEs: 'Description (Spanish)',
        price: 'Price',
        stockQuantity: 'Stock Quantity'
    };

    // Tab Management
    activeTab = 'general';
    tabs = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'specs', label: 'Specifications', icon: '🔧' },
        { id: 'media', label: 'Media', icon: '🖼️' },
        { id: 'pricing', label: 'Pricing & Stock', icon: '💰' },
        { id: 'marketing', label: 'Marketing & SEO', icon: '📢' }
    ];

    // Computed properties for character counters
    get metaTitleLength(): number {
        return this.productForm.get('metaTitle')?.value?.length || 0;
    }

    get metaDescriptionLength(): number {
        return this.productForm.get('metaDescription')?.value?.length || 0;
    }

    get descriptionEnLength(): number {
        return this.productForm.get('descriptionEn')?.value?.length || 0;
    }

    get descriptionEsLength(): number {
        return this.productForm.get('descriptionEs')?.value?.length || 0;
    }

    // SEO Helper Properties
    get seoScore(): number {
        let score = 0;
        const metaTitle = this.productForm.get('metaTitle')?.value || '';
        const metaDescription = this.productForm.get('metaDescription')?.value || '';

        // Meta Title Score (40 points)
        if (metaTitle.length >= 50 && metaTitle.length <= 60) score += 40;
        else if (metaTitle.length >= 40 && metaTitle.length <= 70) score += 25;
        else if (metaTitle.length > 0) score += 10;

        // Meta Description Score (40 points)
        if (metaDescription.length >= 150 && metaDescription.length <= 160) score += 40;
        else if (metaDescription.length >= 120 && metaDescription.length <= 180) score += 25;
        else if (metaDescription.length > 0) score += 10;

        // Has content (20 points)
        if (metaTitle.length > 0 && metaDescription.length > 0) score += 20;

        return score;
    }

    get metaTitleOptimal(): boolean {
        const length = this.metaTitleLength;
        return length >= 50 && length <= 60;
    }

    get metaDescriptionOptimal(): boolean {
        const length = this.metaDescriptionLength;
        return length >= 150 && length <= 160;
    }

    get seoQualityLabel(): string {
        const score = this.seoScore;
        if (score >= 80) return 'Excellent';
        if (score >= 60) return 'Good';
        if (score >= 40) return 'Fair';
        return 'Needs Improvement';
    }

    lastModified: Date = new Date();

    setActiveTab(tabId: string) {
        this.activeTab = tabId;
        // Optionally scroll to top or focus first input
    }

    ngOnInit() {
        // Subscribe to product type templates (supports real-time updates)
        this.productTypeConfig.templates$.subscribe(types => {
            this.availableProductTypes = types;
            // Update current schema if not editing
            if (!this.isEditing) {
                this.currentSpecSchema = this.productTypeConfig.getSpecificationSchema(this.selectedProductType);
            }
        });

        this.initForm();
        this.loadCategories();
        this.checkEditMode();
        this.setupAutoSKU();
    }

    initForm() {
        this.productForm = this.fb.group({
            // Product Type
            productType: [this.selectedProductType, Validators.required],

            // Basic Info
            nameEn: ['', Validators.required],
            nameEs: ['', Validators.required],
            slug: ['', Validators.required],
            sku: ['', Validators.required],
            brand: ['', Validators.required],
            categoryId: ['', Validators.required],

            // Dynamic Specifications (will be populated based on product type)
            specifications: this.fb.group({}),

            // Descriptions
            descriptionEn: ['', Validators.required],
            descriptionEs: ['', Validators.required],

            // Features (Arrays)
            featuresEn: this.fb.array([]),
            featuresEs: this.fb.array([]),

            // Pricing & Stock
            price: [null, [Validators.required, Validators.min(0)]],
            compareAtPrice: [null, Validators.min(0)],
            stockQuantity: [0, [Validators.required, Validators.min(0)]],
            inStock: [true],

            // Marketing
            tags: [''],
            featured: [false],
            newArrival: [false],
            bestSeller: [false],

            // SEO Optimization
            metaTitle: [''],
            metaDescription: [''],
            focusKeywords: [''],

            // Status & Publishing
            publishStatus: ['draft'],
            visibility: ['public'],
            active: [true],
            enableScheduledPublish: [false],
            publishDate: [null]
        });

        // Listen to product type changes
        this.productForm.get('productType')?.valueChanges.subscribe(type => {
            this.onProductTypeChange(type as ProductType);
        });

        // Initialize specifications for default product type
        this.buildSpecificationFields(this.selectedProductType);
        this.updateFieldLabels();
    }

    /**
     * Handle product type selection change
     */
    onProductTypeChange(type: ProductType) {
        this.selectedProductType = type;
        this.currentSpecSchema = this.productTypeConfig.getSpecificationSchema(type);
        this.buildSpecificationFields(type);
        this.updateFieldLabels();
    }

    /**
     * Build dynamic specification form fields based on product type
     */
    private buildSpecificationFields(type: ProductType) {
        const specsGroup = this.productForm.get('specifications') as FormGroup;

        // Clear existing specification fields
        Object.keys(specsGroup.controls).forEach(key => {
            specsGroup.removeControl(key);
        });

        // Get schema for the selected product type
        const schema = this.productTypeConfig.getSpecificationSchema(type);

        // Add new fields based on schema
        schema.forEach(field => {
            const validators = field.required ? [Validators.required] : [];

            // Add min/max validators for number fields
            if (field.type === 'number') {
                if (field.min !== undefined) validators.push(Validators.min(field.min));
                if (field.max !== undefined) validators.push(Validators.max(field.max));
            }

            // Determine default value based on field type
            let defaultValue: any = '';
            if (field.type === 'boolean') defaultValue = false;
            else if (field.type === 'number') defaultValue = null;

            specsGroup.addControl(field.key, this.fb.control(defaultValue, validators));
        });
    }

    /**
     * Update field labels dynamically for validation summary
     */
    private updateFieldLabels() {
        // Reset to base labels
        this.fieldLabels = {
            productType: 'Product Type',
            nameEn: 'Product Name (English)',
            nameEs: 'Product Name (Spanish)',
            slug: 'URL Slug',
            sku: 'SKU',
            brand: 'Brand',
            categoryId: 'Category',
            descriptionEn: 'Description (English)',
            descriptionEs: 'Description (Spanish)',
            price: 'Price',
            stockQuantity: 'Stock Quantity'
        };

        // Add specification field labels
        this.currentSpecSchema.forEach(field => {
            this.fieldLabels[`specifications.${field.key}`] = field.label.en;
        });
    }

    get featuresEn(): FormArray {
        return this.productForm.get('featuresEn') as FormArray;
    }

    get featuresEs(): FormArray {
        return this.productForm.get('featuresEs') as FormArray;
    }

    addFeature(lang: 'en' | 'es') {
        const array = lang === 'en' ? this.featuresEn : this.featuresEs;
        array.push(this.fb.control(''));
    }

    removeFeature(lang: 'en' | 'es', index: number) {
        const array = lang === 'en' ? this.featuresEn : this.featuresEs;
        array.removeAt(index);
    }

    async loadCategories() {
        try {
            this.categories = await firstValueFrom(
                this.categoryService.getActiveCategories()
            );
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    async checkEditMode() {
        this.productId = this.route.snapshot.paramMap.get('id');
        if (this.productId) {
            this.isEditing = true;
            await this.loadProduct(this.productId);
        }
    }

    async loadProduct(id: string) {
        try {
            const product = await firstValueFrom(
                this.productService.getProductById(id)
            );

            if (product) {
                // First, set the product type and rebuild spec fields
                const productType = (product as any).productType || 'tire';
                this.selectedProductType = productType;
                this.currentSpecSchema = this.productTypeConfig.getSpecificationSchema(productType);
                this.buildSpecificationFields(productType);
                this.updateFieldLabels();

                // Patch basic fields
                this.productForm.patchValue({
                    productType: productType,
                    nameEn: product.name?.en || '',
                    nameEs: product.name?.es || '',
                    slug: product.slug || '',
                    sku: product.sku || '',
                    brand: product.brand || '',
                    categoryId: product.categoryId || '',
                    descriptionEn: product.description?.en || '',
                    descriptionEs: product.description?.es || '',
                    price: product.price || 0,
                    compareAtPrice: product.compareAtPrice || null,
                    stockQuantity: product.stockQuantity || 0,
                    inStock: product.inStock ?? true,
                    tags: product.tags?.join(', ') || '',
                    featured: product.featured ?? false,
                    newArrival: product.newArrival ?? false,
                    bestSeller: product.bestSeller ?? false,
                    active: product.active ?? true,
                    // SEO fields
                    metaTitle: product.seo?.metaTitle || '',
                    metaDescription: product.seo?.metaDescription || '',
                    focusKeywords: product.seo?.focusKeywords?.join(', ') || '',
                    // Status fields
                    publishStatus: product.publishStatus || 'draft',
                    visibility: product.visibility || 'public'
                });

                // Patch dynamic specifications
                if (product.specifications) {
                    const specsGroup = this.productForm.get('specifications') as FormGroup;
                    specsGroup.patchValue(product.specifications);
                }

                // Load features safely
                if (product.features?.en) {
                    product.features.en.forEach(feature => {
                        this.featuresEn.push(this.fb.control(feature));
                    });
                }

                if (product.features?.es) {
                    product.features.es.forEach(feature => {
                        this.featuresEs.push(this.fb.control(feature));
                    });
                }

                // Load images into unified array
                if (product.images?.main) {
                    this.productImages.push({ url: product.images.main });
                }
                if (product.images?.gallery) {
                    product.images.gallery.forEach(url => {
                        this.productImages.push({ url });
                    });
                }
            } else {
                this.toast.error('Product not found');
                this.router.navigate(['/admin/products']);
            }
        } catch (error) {
            console.error('Error loading product:', error);
            this.toast.error('Error loading product details. Please check console for details.');
            // Do not redirect immediately so we can inspect the state if needed, 
            // or redirect if it's critical.
            // this.router.navigate(['/admin/products']); 
        }
    }

    setupAutoSKU() {
        // Auto-generate SKU when tire specs change
        this.productForm.get('brand')?.valueChanges.subscribe(() => this.generateSKU());
        this.productForm.get('width')?.valueChanges.subscribe(() => this.generateSKU());
        this.productForm.get('aspectRatio')?.valueChanges.subscribe(() => this.generateSKU());
        this.productForm.get('diameter')?.valueChanges.subscribe(() => this.generateSKU());
    }

    generateSKU() {
        if (this.isEditing) return; // Don't auto-generate for existing products

        const brand = this.productForm.get('brand')?.value;
        const width = this.productForm.get('width')?.value;
        const aspectRatio = this.productForm.get('aspectRatio')?.value;
        const diameter = this.productForm.get('diameter')?.value;

        if (brand && width && aspectRatio && diameter) {
            const sku = this.productService.generateSKU(brand, width, aspectRatio, diameter);
            this.productForm.patchValue({ sku }, { emitEvent: false });
        }
    }

    // Unified image upload handler
    async onImagesSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const filesArray = Array.from(input.files);

            for (const file of filesArray) {
                // Extract metadata
                const meta = await this.extractImageMetadata(file);

                // Create preview
                const reader = new FileReader();
                reader.onload = (e) => {
                    this.productImages.push({
                        url: e.target?.result as string,
                        file: file,
                        meta: meta
                    });
                };
                reader.readAsDataURL(file);
            }

            // Clear input
            input.value = '';
        }
    }

    // Drag & drop reordering
    onImageReorder(event: CdkDragDrop<any>) {
        moveItemInArray(this.productImages, event.previousIndex, event.currentIndex);
    }

    // Remove image
    removeImage(index: number) {
        this.productImages.splice(index, 1);
    }

    // Media Library Integration
    openMediaLibrary(target: 'main' | 'gallery' = 'gallery') {
        this.mediaPickerMode = target;
        this.showMediaPicker = true;
    }

    onMediaAssetSelected(asset: MediaAsset) {
        // Add to unified array
        this.productImages.push({
            url: asset.publicUrl
        });
        this.showMediaPicker = false;
    }

    closeMediaPicker() {
        this.showMediaPicker = false;
    }

    async onSubmit() {
        // Prevent double submission
        if (this.isSubmitting) return;

        // Validation phase
        this.submitState = 'validating';

        // Check for product images (custom validation)
        if (this.productImages.length === 0) {
            this.toast.error('At least one product image is required');
            this.errorMessage = 'Please upload at least one product image';
            this.submitState = 'error';

            // Scroll to image section
            const imageSection = document.querySelector('.images-grid');
            if (imageSection) {
                imageSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        if (this.productForm.invalid) {
            this.productForm.markAllAsTouched();

            // Count validation errors
            this.errorCount = this.countFormErrors(this.productForm);

            // Get list of invalid fields for better feedback
            const invalidFields = this.getInvalidFields(this.productForm);
            console.log('Invalid fields:', invalidFields);

            // Show validation error toast
            this.toast.error(`Please fix ${this.errorCount} error(s) in: ${invalidFields.join(', ')}`);
            this.errorMessage = `Please fix validation errors in: ${invalidFields.join(', ')}`;
            this.submitState = 'error';

            // Scroll to validation summary
            const summary = document.querySelector('app-validation-summary');
            if (summary) {
                summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // Reset error state after 5 seconds (gave user more time to read)
            setTimeout(() => {
                // Keep error state visible but clear message if needed
                // this.submitState = 'idle'; 
            }, 5000);
            return;
        }

        // Reset error count and start submission
        this.errorCount = 0;
        this.isSubmitting = true;
        this.submitState = this.productImages.length > 0 ? 'uploading' : 'saving';

        try {
            const formValue = this.productForm.value;

            // Update to saving state
            this.submitState = 'saving';

            const productData: any = {
                productType: formValue.productType || this.selectedProductType,
                type: 'simple',
                name: {
                    en: formValue.nameEn,
                    es: formValue.nameEs
                },
                slug: formValue.slug,
                sku: formValue.sku,
                brand: formValue.brand,
                categoryId: formValue.categoryId,

                // Dynamic specifications from form
                specifications: formValue.specifications || {},

                description: {
                    en: formValue.descriptionEn,
                    es: formValue.descriptionEs
                },
                features: {
                    en: formValue.featuresEn,
                    es: formValue.featuresEs
                },
                applications: [],
                images: {
                    main: this.productImages[0]?.url || '',
                    gallery: this.productImages.slice(1).map(img => img.url)
                },
                price: formValue.price,
                compareAtPrice: formValue.compareAtPrice,
                inStock: formValue.inStock,
                stockQuantity: formValue.stockQuantity,
                tags: formValue.tags ? formValue.tags.split(',').map((t: string) => t.trim()) : [],
                featured: formValue.featured,
                newArrival: formValue.newArrival,
                bestSeller: formValue.bestSeller,
                active: formValue.active,
                seo: {
                    metaTitle: formValue.metaTitle || '',
                    metaDescription: formValue.metaDescription || '',
                    focusKeywords: formValue.focusKeywords ? formValue.focusKeywords.split(',').map((k: string) => k.trim()) : []
                },
                publishStatus: formValue.publishStatus || 'draft',
                visibility: formValue.visibility || 'public',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Only add scheduledPublishDate if it's actually set
            if (formValue.enableScheduledPublish && formValue.publishDate) {
                productData.scheduledPublishDate = new Date(formValue.publishDate);
            }

            if (this.isEditing && this.productId) {
                const mainImage = this.productImages[0];
                const galleryImages = this.productImages.slice(1);
                await this.productService.updateProduct(
                    this.productId,
                    productData as any,
                    mainImage?.file || undefined,
                    galleryImages.length > 0 ? galleryImages.map(img => img.file!).filter(f => f) : []
                );
                this.toast.success('Product updated successfully!');
            } else {
                const mainImage = this.productImages[0];
                if (mainImage?.file) {
                    const galleryImages = this.productImages.slice(1);
                    await this.productService.createProduct(
                        productData as any,
                        mainImage.file,
                        galleryImages.length > 0 ? galleryImages.map(img => img.file!).filter(f => f) : []
                    );
                } else {
                    // No file to upload, use existing image URL
                    // this.toast.success('Product created successfully!');
                }
                this.toast.success('Product created successfully!');
            }

            // Show success state
            this.submitState = 'success';
            this.submitSuccess = true;
            this.submitError = false;
            this.productForm.markAsPristine();

            // Navigate after brief delay to show success state
            setTimeout(() => {
                this.router.navigate(['/admin/products']);
            }, 1500);

        } catch (error) {
            console.error('Error saving product:', error);

            // Show error state
            this.submitState = 'error';
            this.submitError = true;
            this.submitSuccess = false;

            // Specific error message
            if (error instanceof Error) {
                this.errorMessage = error.message;
                this.toast.error(`Failed to save: ${error.message}`);
            } else {
                this.errorMessage = 'An unexpected error occurred';
                this.toast.error('Failed to save product. Please try again.');
            }

            // Reset error state after 5 seconds
            setTimeout(() => {
                this.submitState = 'idle';
                this.errorMessage = '';
            }, 5000);
        } finally {
            this.isSubmitting = false;
        }
    }

    async onCancel() {
        if (this.productForm.dirty) {
            const confirmed = await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
            if (!confirmed) return;
        }
        this.router.navigate(['/admin/products']);
    }

    async canDeactivate(): Promise<boolean> {
        if (this.productForm.dirty && !this.isSubmitting) {
            return await this.confirmDialog.confirmWarning(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to leave?'
            );
        }
        return true;
    }

    getErrorCount(): number {
        return this.formHelper.getFormErrors(this.productForm)
            ? Object.keys(this.formHelper.getFormErrors(this.productForm)).length
            : 0;
    }

    countFormErrors(form: FormGroup): number {
        let errorCount = 0;

        Object.keys(form.controls).forEach(key => {
            const control = form.get(key);
            if (control?.errors) {
                errorCount++;
            }
            // Handle FormArray 
            if (control instanceof FormArray) {
                control.controls.forEach(arrayControl => {
                    if (arrayControl.errors) errorCount++;
                });
            }
        });

        return errorCount;
    }

    hasLowStock(): boolean {
        const stock = this.productForm.get('stockQuantity')?.value;
        return stock !== null && stock >= 0 && stock < 5;
    }

    private getInvalidFields(form: FormGroup, prefix = ''): string[] {
        const invalidFields: string[] = [];
        const controls = form.controls;

        for (const name in controls) {
            const control = controls[name];
            if (control.invalid) {
                if (control instanceof FormGroup) {
                    // Recursively check nested groups (like specifications)
                    const nested = this.getInvalidFields(control, prefix + name + '.');
                    invalidFields.push(...nested);
                } else if (control instanceof FormArray) {
                    // Recursively check form arrays
                    control.controls.forEach((c, index) => {
                        if (c instanceof FormGroup) {
                            const nested = this.getInvalidFields(c, `${prefix}${name}[${index}].`);
                            invalidFields.push(...nested);
                        } else if (c.invalid) {
                            const fieldKey = `${prefix}${name}[${index}]`;
                            const label = this.fieldLabels[fieldKey] || fieldKey;
                            invalidFields.push(label);
                        }
                    });
                } else {
                    // Get human readable label if available
                    const fieldKey = prefix + name;
                    const label = this.fieldLabels[fieldKey] || fieldKey;
                    invalidFields.push(label);
                }
            }
        }
        return invalidFields;
    }

    // Image metadata extraction helpers
    async extractImageMetadata(file: File): Promise<ImageMetadata> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const aspectRatio = this.calculateAspectRatio(img.width, img.height);

                resolve({
                    width: img.width,
                    height: img.height,
                    size: file.size,
                    type: file.type.split('/')[1].toUpperCase(),
                    aspectRatio: aspectRatio,
                    filename: file.name
                });
            };

            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        });
    }

    calculateAspectRatio(width: number, height: number): string {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        return `${width / divisor}:${height / divisor}`;
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }
}
