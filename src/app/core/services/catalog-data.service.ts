import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { map, catchError, shareReplay } from 'rxjs/operators';
import { BrandService } from './brand.service';
import { CategoryService } from './category.service';
import { ProductService } from './product.service';
import { ProductTypeConfigService } from './product-type-config.service';
import { LanguageService } from './language.service';
import { Brand, Category } from '../models/catalog.model';

export interface VisualizerNode {
    id: string;
    name: string;
    type: 'root' | 'type' | 'brand' | 'category' | 'product';
    iconName: string; // Lucide icon name
    count: number;
    children: VisualizerNode[];
    data?: any; // Original data object
    expanded?: boolean;
    level: number;
}

@Injectable({
    providedIn: 'root'
})
export class CatalogDataService {
    private brandService = inject(BrandService);
    private categoryService = inject(CategoryService);
    private productService = inject(ProductService);
    private productTypeService = inject(ProductTypeConfigService);
    private languageService = inject(LanguageService);



    private lang$ = toObservable(this.languageService.currentLang);

    getUnifiedCatalog(): Observable<VisualizerNode[]> {
        return combineLatest([
            this.brandService.getBrands(),
            this.categoryService.getCategories(),
            this.productService.getProducts(),
            this.productTypeService.templates$,
            this.lang$
        ]).pipe(
            map(([brands, categories, products, productTypes, lang]) => {
                // Ensure lang is typed correctly if needed, or just usage in buildTree
                // Since buildTree fetches lang from service, strictly we just need the trigger.
                // But it's better to pass it.
                return this.buildTree(brands, categories, products, productTypes);
            }),
            catchError(err => {
                console.error('Values V3 Data Error:', err);
                return of([]);
            }),
            shareReplay(1)
        );
    }

    private buildTree(brands: Brand[], categories: Category[], products: any[], productTypes: any[]): VisualizerNode[] {
        const currentLang = this.languageService.currentLang() as 'en' | 'es';
        const allTypes = this.productTypeService.getAllProductTypes();

        const usedBrandIds = new Set<string>();
        const usedCategoryIds = new Set<string>();
        const usedProductIds = new Set<string>();

        // Level 1: Product Types
        const typeNodes = allTypes.map(typeDef => {
            const typeProducts = products.filter(p => p.productType === typeDef.id);
            if (typeProducts.length === 0) return null;

            // Track used products
            typeProducts.forEach(p => usedProductIds.add(p.id));

            // Level 2: Brands
            const brandNodes = this.getBrandNodes(typeProducts, brands, categories, currentLang, usedBrandIds, usedCategoryIds);

            return {
                id: `type-${typeDef.id}`,
                // Use translation key for product type name if available, otherwise fallback to object
                name: (typeDef.name as any)[currentLang] || typeDef.name['en'],
                type: 'type',
                iconName: 'layers', // Lucide icon
                count: typeProducts.length,
                children: brandNodes,
                expanded: true,
                level: 1
            } as VisualizerNode;
        }).filter(n => n !== null) as VisualizerNode[];

        // --- Anomaly Detection ---
        const anomalyNodes: VisualizerNode[] = [];

        // 1. Ghost Brands (Unused)
        const ghostBrands = brands.filter(b => !usedBrandIds.has(b.id || ''));

        if (ghostBrands.length > 0) {
            anomalyNodes.push({
                id: 'ghost-brands',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.UNUSED_BRANDS',
                type: 'brand',
                iconName: 'ghost',
                count: ghostBrands.length,
                children: ghostBrands.map(b => ({
                    id: `ghost-brand-${b.id}`,
                    name: b.name,
                    type: 'brand',
                    iconName: 'tag',
                    count: 0,
                    children: [],
                    level: 3
                } as VisualizerNode)),
                expanded: false,
                level: 2
            });
        }

        // 2. Ghost Categories (Unused)
        const ghostCategories = categories.filter(c => !usedCategoryIds.has(c.id || ''));
        if (ghostCategories.length > 0) {
            anomalyNodes.push({
                id: 'ghost-categories',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.UNUSED_CATEGORIES',
                type: 'category',
                iconName: 'folder-minus',
                count: ghostCategories.length,
                children: ghostCategories.map(c => ({
                    id: `ghost-cat-${c.id}`,
                    name: (c.name as any)[currentLang] || c.name.en,
                    type: 'category',
                    iconName: 'folder',
                    count: 0,
                    children: [],
                    level: 3
                } as VisualizerNode)),
                expanded: false,
                level: 2
            });
        }

        // 3. True Orphans (No Valid Product Type)
        const trueOrphans = products.filter(p => !usedProductIds.has(p.id));
        if (trueOrphans.length > 0) {
            anomalyNodes.push({
                id: 'orphan-products',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.UNKNOWN_TYPE',
                type: 'product',
                iconName: 'file-warning',
                count: trueOrphans.length,
                children: [],
                expanded: false,
                level: 2
            });
        }

        // 4. Data Quality Issues (Missing Brand/Category)
        const noBrandProducts = products.filter(p => !p.brand);
        if (noBrandProducts.length > 0) {
            anomalyNodes.push({
                id: 'issue-no-brand',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.NO_BRAND',
                type: 'product',
                iconName: 'tag',
                count: noBrandProducts.length,
                children: [],
                expanded: false,
                level: 2
            });
        }

        const noCategoryProducts = products.filter(p => !p.categoryId);
        if (noCategoryProducts.length > 0) {
            anomalyNodes.push({
                id: 'issue-no-cat',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.NO_CATEGORY',
                type: 'product',
                iconName: 'folder-minus',
                count: noCategoryProducts.length,
                children: [],
                expanded: false,
                level: 2
            });
        }

        if (anomalyNodes.length > 0) {
            typeNodes.push({
                id: 'anomalies-root',
                name: 'ADMIN.CATALOG_OVERVIEW.NODES.SYSTEM_ANOMALIES',
                type: 'root',
                iconName: 'alert-triangle',
                count: ghostBrands.length + ghostCategories.length + trueOrphans.length + noBrandProducts.length + noCategoryProducts.length,
                children: anomalyNodes,
                expanded: true,
                level: 1
            });
        }

        return typeNodes;
    }

    private getBrandNodes(products: any[], brands: Brand[], categories: Category[], lang: 'en' | 'es', usedBrandIds: Set<string>, usedCategoryIds: Set<string>): VisualizerNode[] {
        const brandGroups = new Map<string, any[]>();

        products.forEach(p => {
            const bName = p.brand || 'No Brand';
            if (!brandGroups.has(bName)) brandGroups.set(bName, []);
            brandGroups.get(bName)!.push(p);
        });

        const nodes: VisualizerNode[] = [];

        brandGroups.forEach((groupProducts, brandName) => {
            const brandObj = brands.find(b => b.name === brandName);
            if (brandObj && brandObj.id) usedBrandIds.add(brandObj.id);

            const catNodes = this.getCategoryNodes(null, groupProducts, categories, lang, usedCategoryIds);

            // Handle orphans
            const orphans = groupProducts.filter(p => !p.categoryId);
            if (orphans.length > 0) {
                catNodes.push({
                    id: `orphan-${brandName}`,
                    name: 'ADMIN.CATALOG_OVERVIEW.NODES.UNCATEGORIZED',
                    type: 'category',
                    iconName: 'alert-circle',
                    count: orphans.length,
                    children: [],
                    level: 3,
                    expanded: false
                });
            }

            nodes.push({
                id: `brand-${brandName}`,
                name: brandName,
                type: 'brand',
                iconName: 'tag',
                count: groupProducts.length,
                children: catNodes,
                data: brandObj,
                expanded: false,
                level: 2
            });
        });

        return nodes.sort((a, b) => b.count - a.count);
    }

    private getCategoryNodes(parentId: string | null, products: any[], allCategories: Category[], lang: 'en' | 'es', usedCategoryIds: Set<string>): VisualizerNode[] {
        // Find categories that are children of parentId
        const activeCats = allCategories.filter(c => {
            // Match parentId (null logic)
            const isChild = c.parentId === (parentId || undefined) || (parentId === null && !c.parentId);
            return isChild;
        });

        const nodes: VisualizerNode[] = [];

        activeCats.forEach(cat => {
            // Strictly match products in this category
            const directProducts = products.filter(p => p.categoryId === cat.id);

            // Recurse for subcategories
            const childNodes = this.getCategoryNodes(cat.id!, products, allCategories, lang, usedCategoryIds);

            // If empty branch, skip
            if (directProducts.length === 0 && childNodes.length === 0) return;

            // Mark collected
            if (cat.id) usedCategoryIds.add(cat.id);

            const totalCount = directProducts.length + childNodes.reduce((sum, c) => sum + c.count, 0);

            nodes.push({
                id: `cat-${cat.id}`,
                name: (cat.name as any)[lang] || cat.name.en,
                type: 'category',
                iconName: 'folder',
                count: totalCount,
                children: childNodes,
                data: cat,
                expanded: false,
                level: 3
            });
        });

        return nodes.sort((a, b) => b.count - a.count);
    }
}
