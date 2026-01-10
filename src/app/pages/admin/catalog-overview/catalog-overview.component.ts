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

interface BrandStats {
    brand: Brand;
    productCount: number;
    activeProducts: number;
}

interface CategoryNode {
    category: Category;
    productCount: number;
    children: CategoryNode[];
    level: number;
    expanded: boolean;
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

    isLoading = true;
    brandStats: BrandStats[] = [];
    categoryTree: CategoryNode[] = [];

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
            this.productService.getProducts()
        ]).pipe(
            catchError(error => {
                console.error('Error loading catalog data:', error);
                this.isLoading = false;
                return of([[], [], []] as [Brand[], Category[], any[]]);
            })
        ).subscribe(([brands, categories, products]) => {
            this.processData(brands, categories, products);
            this.isLoading = false;
        });
    }

    processData(brands: Brand[], categories: Category[], products: any[]) {
        this.totalBrands = brands.length;
        this.totalCategories = categories.length;
        this.totalProducts = products.length;

        // Process Brand Stats
        this.brandStats = brands.map(brand => {
            const brandProducts = products.filter(p => p.brand === brand.name);
            return {
                brand,
                productCount: brandProducts.length,
                activeProducts: brandProducts.filter(p => p.active).length
            };
        }).sort((a, b) => b.productCount - a.productCount);

        // Identify products with missing references
        this.productsWithoutBrand = products.filter(p => !p.brand || !brands.find(b => b.name === p.brand)).length;
        this.productsWithoutCategory = products.filter(p => !p.categoryId || !categories.find(c => c.id === p.categoryId)).length;

        // Build Category Tree
        this.categoryTree = this.buildCategoryTree(categories, products);
    }

    buildCategoryTree(categories: Category[], products: any[]): CategoryNode[] {
        // First, map all categories to nodes
        const nodes = categories.map(category => {
            const categoryProducts = products.filter(p => p.categoryId === category.id);
            return {
                category,
                productCount: categoryProducts.length,
                children: [],
                level: 0,
                expanded: true
            };
        });

        // Create a map for easy lookup
        const nodeMap = new Map<string, CategoryNode>();
        nodes.forEach(node => nodeMap.set(node.category.id!, node));

        const rootNodes: CategoryNode[] = [];

        // Assign children to parents
        nodes.forEach(node => {
            if (node.category.parentId && nodeMap.has(node.category.parentId)) {
                const parent = nodeMap.get(node.category.parentId)!;
                node.level = parent.level + 1;
                parent.children.push(node);
            } else {
                rootNodes.push(node);
            }
        });

        // Recursively count total products (including subcategories)
        // Optional: if we want the count to reflect *subtree* count, we can do a traversal.
        // For now, let's keep it as direct products count, but maybe sort roots?
        return rootNodes.sort((a, b) => a.category.order! - b.category.order!);
    }

    toggleNode(node: CategoryNode) {
        node.expanded = !node.expanded;
    }
}
