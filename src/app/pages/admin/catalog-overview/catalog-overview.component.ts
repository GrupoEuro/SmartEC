import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { BrandService } from '../../../core/services/brand.service';
import { CategoryService } from '../../../core/services/category.service';
import { ProductService } from '../../../core/services/product.service';
import { Brand, Category } from '../../../core/models/catalog.model';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';
import { ProductTypeConfigService } from '../../../core/services/product-type-config.service';
import { LanguageService } from '../../../core/services/language.service';

// Unified Node for the Master Visualizer Tree
interface CatalogNode {
    id: string;
    name: string;
    type: 'root' | 'type' | 'category' | 'brand';
    icon?: string;
    image?: string; // For brand logos
    count: number;
    children: CatalogNode[];
    expanded: boolean;
    level: number;
    actions?: { link: any[], icon: string }[];
}

@Component({
    selector: 'app-catalog-overview',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './catalog-overview.component.html',
    styleUrl: './catalog-overview.component.css'
})
export class CatalogOverviewComponent implements OnInit {
    private brandService = inject(BrandService);
    private categoryService = inject(CategoryService);
    private productService = inject(ProductService);
    private productTypeService = inject(ProductTypeConfigService);
    private languageService = inject(LanguageService);

    isLoading = true;
    masterTree: CatalogNode[] = [];

    // Quick Stats
    totalBrands = 0;
    totalCategories = 0;
    totalProducts = 0;
    productsWithoutCategory = 0;
    productsWithoutBrand = 0;

    ngOnInit() {
        this.loadData();
    }

    loadData() {
        combineLatest([
            this.brandService.getBrands(),
            this.categoryService.getCategories(),
            this.productService.getProducts(),
            this.productTypeService.templates$
        ]).pipe(
            catchError(error => {
                console.error('Error loading catalog data:', error);
                this.isLoading = false;
                return of([[], [], [], []] as [Brand[], Category[], any[], any[]]);
            })
        ).subscribe(([brands, categories, products, productTypes]) => {
            this.processData(brands, categories, products, productTypes);
            this.isLoading = false;
        });
    }

    processData(brands: Brand[], categories: Category[], products: any[], productTypes: any[]) {
        this.totalBrands = brands.length;
        this.totalCategories = categories.length;
        this.totalProducts = products.length;

        // Identification of orphans (kept for stats cards if needed)
        this.productsWithoutBrand = products.filter(p => !p.brand).length;
        this.productsWithoutCategory = products.filter(p => !p.categoryId).length;

        // Build the Unified Master Tree
        this.masterTree = this.buildMasterTree(products, categories, brands);
    }

    buildMasterTree(products: any[], categories: Category[], brands: Brand[]): CatalogNode[] {
        const currentLang = this.languageService.currentLang() as 'en' | 'es';
        const allProductTypes = this.productTypeService.getAllProductTypes();

        // Level 1: Product Types
        return allProductTypes.map(typeDef => {
            const typeProducts = products.filter(p => p.productType === typeDef.id);
            if (typeProducts.length === 0) return null;

            // Level 2: Brands within this Type
            // Group the 'typeProducts' by brand name
            const brandGroups = new Map<string, any[]>();
            typeProducts.forEach(p => {
                const brandName = p.brand || 'No Brand';
                if (!brandGroups.has(brandName)) brandGroups.set(brandName, []);
                brandGroups.get(brandName)!.push(p);
            });

            const brandNodes: CatalogNode[] = [];
            brandGroups.forEach((brandProducts, brandName) => {
                const brandObj = brands.find(b => b.name === brandName);

                // Level 3: Categories within this Brand
                const categoryGroups = new Map<string, any[]>();
                brandProducts.forEach(p => {
                    const catId = p.categoryId || 'uncategorized';
                    if (!categoryGroups.has(catId)) categoryGroups.set(catId, []);
                    categoryGroups.get(catId)!.push(p);
                });

                const categoryNodes: CatalogNode[] = [];
                categoryGroups.forEach((catProducts, catId) => {
                    let catName = 'Uncategorized';
                    let category: Category | undefined;

                    if (catId !== 'uncategorized') {
                        category = categories.find(c => c.id === catId);
                        if (category) {
                            catName = (category.name as any)[currentLang] || category.name.en;
                        }
                    }

                    categoryNodes.push({
                        id: `cat-${catId}-${brandName}`, // Ensure unique ID
                        name: catName,
                        type: 'category',
                        icon: category?.icon || '📁',
                        count: catProducts.length,
                        children: [], // Categories are leaf nodes in this view
                        expanded: false,
                        level: 3,
                        actions: category ? [{ link: ['/admin/categories', category.id, 'edit'], icon: '✏️' }] : []
                    });
                });

                // Sort categories by count
                categoryNodes.sort((a, b) => b.count - a.count);

                brandNodes.push({
                    id: `brand-${brandName}-${typeDef.id}`,
                    name: brandName,
                    type: 'brand',
                    image: brandObj?.logoUrl,
                    count: brandProducts.length,
                    children: categoryNodes,
                    expanded: false,
                    level: 2,
                    actions: brandObj ? [{ link: ['/admin/brands', brandObj.id, 'edit'], icon: '✏️' }] : []
                });
            });

            // Sort brands by count
            brandNodes.sort((a, b) => b.count - a.count);

            return {
                id: `type-${typeDef.id}`,
                name: typeDef.name[currentLang] || typeDef.name['en'],
                type: 'type',
                icon: typeDef.icon,
                count: typeProducts.length,
                children: brandNodes,
                expanded: true, // Auto-expand types
                level: 1,
                actions: [{ link: ['/admin/product-types'], icon: '⚙️' }]
            };
        }).filter(node => node !== null && node.count > 0) as CatalogNode[];
    }

    toggleNode(node: CatalogNode) {
        node.expanded = !node.expanded;
    }
}
