import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';

import { ProductKit, ProductKitInput } from '../../../../core/models/product-kit.model';
import { Product } from '../../../../core/models/product.model';
import { KitService } from '../../../../core/services/kit.service';
import { ProductService } from '../../../../core/services/product.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';

@Component({
    selector: 'app-kit-form',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        TranslateModule,
        AdminPageHeaderComponent,
        ToggleSwitchComponent
    ],
    templateUrl: './kit-form.component.html',
    styleUrls: ['./kit-form.component.css']
})
export class KitFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private kitService = inject(KitService);
    private productService = inject(ProductService);
    private toastService = inject(ToastService);

    kitForm!: FormGroup;
    kitId: string | null = null;
    isEditMode = false;
    isSaving = signal(false);
    activeTab = signal<'basic' | 'components' | 'pricing' | 'seo'>('basic');

    // Product picker
    availableProducts = signal<Product[]>([]);
    showProductPicker = signal(false);
    searchTerm = signal('');

    // Computed values
    filteredProducts = computed(() => {
        const term = this.searchTerm().toLowerCase();
        if (!term) return this.availableProducts();
        return this.availableProducts().filter(p =>
            p.name.es.toLowerCase().includes(term) ||
            p.name.en.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term)
        );
    });

    // Computed value for total component price
    totalComponentPrice(): number {
        const components = this.components.value;
        return components.reduce((sum: number, comp: any) =>
            sum + (comp.unitPrice * comp.quantity), 0
        );
    }

    savingsAmount(): number {
        const kitPrice = this.kitForm?.get('price')?.value || 0;
        return this.totalComponentPrice() - kitPrice;
    }

    getSavingsPercentage(): number {
        const total = this.totalComponentPrice();
        if (total === 0) return 0;
        const price = this.kitForm.get('price')?.value || 0;
        return Math.round(((total - price) / total) * 100);
    }

    ngOnInit() {
        this.initForm();
        this.loadProducts();

        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.kitId = id;
            this.isEditMode = true;
            this.loadKit(id);
        }
    }

    initForm() {
        this.kitForm = this.fb.group({
            name: this.fb.group({
                es: ['', Validators.required],
                en: ['']
            }),
            sku: ['', Validators.required],
            description: this.fb.group({
                es: [''],
                en: ['']
            }),
            components: this.fb.array([]),
            price: [0, [Validators.required, Validators.min(0)]],
            compareAtPrice: [null],
            image: [''],
            featured: [false],
            active: [true],
            publishStatus: ['draft'],
            tags: [[]],
            seo: this.fb.group({
                metaTitle: [''],
                metaDescription: [''],
                focusKeywords: [[]]
            })
        });
    }

    get components() {
        return this.kitForm.get('components') as FormArray;
    }

    loadProducts() {
        this.productService.getProducts().subscribe({
            next: (products: Product[]) => {
                this.availableProducts.set(products.filter((p: Product) => p.active));
            },
            error: (error: any) => {
                console.error('Error loading products:', error);
            }
        });
    }

    loadKit(id: string) {
        this.kitService.getKitById(id).subscribe({
            next: (kit) => {
                if (kit) {
                    this.kitForm.patchValue({
                        name: kit.name,
                        sku: kit.sku,
                        description: kit.description,
                        price: kit.price,
                        compareAtPrice: kit.compareAtPrice,
                        image: kit.image,
                        featured: kit.featured,
                        active: kit.active,
                        publishStatus: kit.publishStatus,
                        tags: kit.tags,
                        seo: kit.seo
                    });

                    // Load components
                    kit.components.forEach(comp => {
                        this.components.push(this.fb.group({
                            productId: [comp.productId],
                            productName: [comp.productName],
                            productImage: [comp.productImage],
                            sku: [comp.sku],
                            quantity: [comp.quantity, [Validators.required, Validators.min(1)]],
                            unitPrice: [comp.unitPrice]
                        }));
                    });
                }
            },
            error: (error) => {
                console.error('Error loading kit:', error);
                this.toastService.error('ADMIN.KITS.ERROR_LOAD');
            }
        });
    }

    addProduct(product: Product) {
        this.components.push(this.fb.group({
            productId: [product.id],
            productName: [product.name.es],
            productImage: [product.images.main],
            sku: [product.sku],
            quantity: [1, [Validators.required, Validators.min(1)]],
            unitPrice: [product.price]
        }));
        this.showProductPicker.set(false);
        this.searchTerm.set('');
    }

    removeComponent(index: number) {
        this.components.removeAt(index);
    }

    onSubmit() {
        if (this.kitForm.invalid) {
            this.toastService.error('Please fill all required fields');
            return;
        }

        this.isSaving.set(true);
        const formValue = this.kitForm.value;

        const kitData: ProductKitInput = {
            name: formValue.name,
            slug: this.kitService.generateSlug(formValue.name.es),
            sku: formValue.sku,
            description: formValue.description,
            components: formValue.components,
            price: formValue.price,
            compareAtPrice: formValue.compareAtPrice,
            savingsAmount: this.savingsAmount(),
            savingsPercentage: this.getSavingsPercentage(),
            image: formValue.image || '',
            featured: formValue.featured,
            tags: formValue.tags || [],
            seo: formValue.seo,
            active: formValue.active,
            publishStatus: formValue.publishStatus
        };

        if (this.isEditMode && this.kitId) {
            this.kitService.updateKit(this.kitId, kitData).subscribe({
                next: () => {
                    this.toastService.success('ADMIN.KITS.SUCCESS_UPDATE');
                    this.isSaving.set(false);
                    this.router.navigate(['/admin/kits']);
                },
                error: (error) => {
                    console.error('Error updating kit:', error);
                    this.toastService.error('ADMIN.KITS.ERROR_SAVE');
                    this.isSaving.set(false);
                }
            });
        } else {
            this.kitService.createKit(kitData).subscribe({
                next: () => {
                    this.toastService.success('ADMIN.KITS.SUCCESS_CREATE');
                    this.isSaving.set(false);
                    this.router.navigate(['/admin/kits']);
                },
                error: (error) => {
                    console.error('Error creating kit:', error);
                    this.toastService.error('ADMIN.KITS.ERROR_SAVE');
                    this.isSaving.set(false);
                }
            });
        }
    }

    canSave(): boolean {
        const nameGroup = this.kitForm.get('name');
        const nameEs = nameGroup?.get('es')?.value;
        const sku = this.kitForm.get('sku')?.value;
        const price = this.kitForm.get('price')?.value;



        // Check if required fields have values
        const result = !!(nameEs && sku && (price !== null && price !== undefined && price >= 0));

        return result;
    }

    cancel() {
        this.router.navigate(['/admin/kits']);
    }
}
