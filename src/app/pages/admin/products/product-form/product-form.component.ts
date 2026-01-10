import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ProductService } from '../../../../core/services/product.service';
import { CategoryService } from '../../../../core/services/category.service';
import { Product } from '../../../../core/models/product.model';
import { Category } from '../../../../core/models/catalog.model';
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
import { firstValueFrom } from 'rxjs';

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
        ToggleSwitchComponent
    ],
    templateUrl: './product-form.component.html',
    styleUrl: './product-form.component.css'
})
export class ProductFormComponent implements OnInit, CanComponentDeactivate {
    private fb = inject(FormBuilder);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private productService = inject(ProductService);
    private categoryService = inject(CategoryService);
    private formHelper = inject(FormHelperService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    productForm!: FormGroup;
    isEditing = false;
    productId: string | null = null;
    isSubmitting = false;

    // Image handling
    mainImageFile: File | null = null;
    mainImagePreview: string | null = null;
    galleryFiles: File[] = [];
    galleryPreviews: string[] = [];

    // Options
    categories: Category[] = [];
    brands = ['Praxis', 'Michelin', 'Pirelli', 'Dunlop', 'Bridgestone', 'Continental'];
    widths = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    aspectRatios = [50, 55, 60, 65, 70, 75, 80, 90];
    diameters = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    loadIndexes = ['51', '54', '57', '58', '59', '60', '62', '65', '69', '73'];
    speedRatings = ['H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z'];

    // Field labels for validation summary
    fieldLabels = {
        nameEn: 'Product Name (English)',
        nameEs: 'Product Name (Spanish)',
        slug: 'URL Slug',
        sku: 'SKU',
        brand: 'Brand',
        categoryId: 'Category',
        width: 'Tire Width',
        aspectRatio: 'Aspect Ratio',
        diameter: 'Diameter',
        loadIndex: 'Load Index',
        speedRating: 'Speed Rating',
        construction: 'Construction Type',
        descriptionEn: 'Description (English)',
        descriptionEs: 'Description (Spanish)',
        price: 'Price',
        stockQuantity: 'Stock Quantity'
    };

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

    lastModified: Date = new Date();

    ngOnInit() {
        this.initForm();
        this.loadCategories();
        this.checkEditMode();
        this.setupAutoSKU();
    }

    initForm() {
        this.productForm = this.fb.group({
            // Basic Info
            nameEn: ['', Validators.required],
            nameEs: ['', Validators.required],
            slug: ['', Validators.required],
            sku: ['', Validators.required],
            brand: ['', Validators.required],
            categoryId: ['', Validators.required],

            // Tire Specifications
            width: [null, Validators.required],
            aspectRatio: [null, Validators.required],
            diameter: [null, Validators.required],
            loadIndex: ['', Validators.required],
            speedRating: ['', Validators.required],
            tubeless: [true],
            construction: ['radial', Validators.required],

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
                this.productForm.patchValue({
                    nameEn: product.name.en,
                    nameEs: product.name.es,
                    slug: product.slug,
                    sku: product.sku,
                    brand: product.brand,
                    categoryId: product.categoryId,
                    width: product.specifications.width,
                    aspectRatio: product.specifications.aspectRatio,
                    diameter: product.specifications.diameter,
                    loadIndex: product.specifications.loadIndex,
                    speedRating: product.specifications.speedRating,
                    tubeless: product.specifications.tubeless,
                    construction: product.specifications.construction,
                    descriptionEn: product.description.en,
                    descriptionEs: product.description.es,
                    price: product.price,
                    compareAtPrice: product.compareAtPrice,
                    stockQuantity: product.stockQuantity,
                    inStock: product.inStock,
                    tags: product.tags.join(', '),
                    featured: product.featured,
                    newArrival: product.newArrival,
                    bestSeller: product.bestSeller,
                    active: product.active,
                    // SEO fields
                    metaTitle: product.seo?.metaTitle || '',
                    metaDescription: product.seo?.metaDescription || '',
                    focusKeywords: product.seo?.focusKeywords?.join(', ') || '',
                    // Status fields
                    publishStatus: product.publishStatus || 'draft',
                    visibility: product.visibility || 'public'
                });

                // Load features
                product.features.en.forEach(feature => {
                    this.featuresEn.push(this.fb.control(feature));
                });
                product.features.es.forEach(feature => {
                    this.featuresEs.push(this.fb.control(feature));
                });

                // Load images
                if (product.images.main) {
                    this.mainImagePreview = product.images.main;
                }
                if (product.images.gallery) {
                    this.galleryPreviews = product.images.gallery;
                }
            }
        } catch (error) {
            console.error('Error loading product:', error);
            alert('Error loading product');
            this.router.navigate(['/admin/products']);
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

    onMainImageSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            this.mainImageFile = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                this.mainImagePreview = e.target?.result as string;
            };
            reader.readAsDataURL(this.mainImageFile);
        }
    }

    onGalleryImagesSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            Array.from(input.files).forEach(file => {
                this.galleryFiles.push(file);
                const reader = new FileReader();
                reader.onload = (e) => {
                    this.galleryPreviews.push(e.target?.result as string);
                };
                reader.readAsDataURL(file);
            });
        }
    }

    removeMainImage() {
        this.mainImageFile = null;
        this.mainImagePreview = null;
    }

    removeGalleryImage(index: number) {
        this.galleryFiles.splice(index, 1);
        this.galleryPreviews.splice(index, 1);
    }

    async onSubmit() {
        if (this.productForm.invalid || this.isSubmitting) {
            if (this.productForm.invalid) {
                // Assuming formHelper and toast are injected dependencies
                // this.formHelper.markAllAsTouched(this.productForm); // Uncomment if formHelper is available
                // this.toast.error('Please fix the errors before saving'); // Uncomment if toast is available
            }
            return;
        }

        this.isSubmitting = true;

        try {
            const formValue = this.productForm.value;

            const productData: Omit<Product, 'id'> = {
                type: 'simple',
                name: {
                    en: formValue.nameEn,
                    es: formValue.nameEs
                },
                slug: formValue.slug,
                sku: formValue.sku,
                brand: formValue.brand,
                categoryId: formValue.categoryId,
                specifications: {
                    width: formValue.width,
                    aspectRatio: formValue.aspectRatio,
                    diameter: formValue.diameter,
                    loadIndex: formValue.loadIndex,
                    speedRating: formValue.speedRating,
                    tubeless: formValue.tubeless,
                    construction: formValue.construction
                },
                description: {
                    en: formValue.descriptionEn,
                    es: formValue.descriptionEs
                },
                features: {
                    en: formValue.featuresEn,
                    es: formValue.featuresEs
                },
                applications: [], // Motorcycle models - can be added later
                images: {
                    main: this.mainImagePreview || 'https://via.placeholder.com/400x300/00ACD8/FFFFFF?text=Product',
                    gallery: this.galleryPreviews
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
                // SEO fields
                seo: {
                    metaTitle: formValue.metaTitle || undefined,
                    metaDescription: formValue.metaDescription || undefined,
                    focusKeywords: formValue.focusKeywords ? formValue.focusKeywords.split(',').map((k: string) => k.trim()) : undefined
                },
                // Status fields
                publishStatus: formValue.publishStatus || 'draft',
                visibility: formValue.visibility || 'public',
                scheduledPublishDate: formValue.enableScheduledPublish && formValue.publishDate ? new Date(formValue.publishDate) : undefined,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            if (this.isEditing && this.productId) {
                await this.productService.updateProduct(this.productId, productData as any, this.mainImageFile!, this.galleryFiles.length > 0 ? this.galleryFiles : undefined);
                // this.toast.success('Product updated successfully'); // Uncomment if toast is available
            } else {
                // Creating new product - main image is required
                if (!this.mainImageFile) {
                    alert('Please upload a main product image');
                    this.isSubmitting = false;
                    return;
                }

                await this.productService.createProduct(
                    productData as any,
                    this.mainImageFile,
                    this.galleryFiles.length > 0 ? this.galleryFiles : undefined
                );
                alert('Product created successfully!');
            }

            // Mark form as pristine to prevent unsaved changes warning after successful save
            this.productForm.markAsPristine();

            this.router.navigate(['/admin/products']);
        } catch (error) {
            console.error('Error saving product:', error);
            alert('Error saving product. Please try again.');
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

    hasLowStock(): boolean {
        const stock = this.productForm.get('stockQuantity')?.value;
        return stock !== null && stock >= 0 && stock < 5;
    }
}
