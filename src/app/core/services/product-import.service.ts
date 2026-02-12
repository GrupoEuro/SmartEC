import { Injectable, inject } from '@angular/core';
import { ProductService } from './product.service';
import { CategoryService } from './category.service';
import { BrandService } from './brand.service';
import * as XLSX from 'xlsx';
import { firstValueFrom } from 'rxjs';
import { Product } from '../models/product.model';

export interface ImportValidationResult {
    validRows: any[];
    invalidRows: { row: number; sku: string; error: string; data: any }[];
    summary: {
        total: number;
        valid: number;
        invalid: number;
    };
}

export interface ImportProgress {
    processed: number;
    total: number;
    success: number;
    failed: number;
    errors: string[];
}

@Injectable({
    providedIn: 'root'
})
export class ProductImportService {
    private productService = inject(ProductService);
    private categoryService = inject(CategoryService);
    private brandService = inject(BrandService);

    constructor() { }

    /**
     * Parse and Validate Excel File
     * Returns a report of valid and invalid rows "Dry Run"
     */
    async validateImportFile(file: File): Promise<ImportValidationResult> {
        const data = await this.parseExcel(file);

        // Load reference data for validation
        const categories = await firstValueFrom(this.categoryService.getCategories());
        const validCategoryNames = new Set(categories.map(c => c.name.en.toLowerCase()));
        const validCategoryIds = new Set(categories.map(c => c.id));

        const brands = await firstValueFrom(this.brandService.getBrands());
        const validBrands = new Set(brands.map(b => b.name.toLowerCase()));

        const result: ImportValidationResult = {
            validRows: [],
            invalidRows: [],
            summary: { total: data.length, valid: 0, invalid: 0 }
        };

        const seenSkus = new Set<string>();

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNum = i + 2; // +1 for header, +1 for 0-index
            const errors: string[] = [];

            // 1. Required Fields
            if (!row.SKU) errors.push('Missing SKU');
            if (!row['Name En'] && !row['Name']) errors.push('Missing Name');
            if (row.Price === undefined || row.Price === null) errors.push('Missing Price');

            // 2. Data Types
            if (row.Price && typeof row.Price !== 'number') errors.push('Price must be a number');
            if (row.Stock && typeof row.Stock !== 'number') errors.push('Stock must be a number');

            // 3. Duplicates in file
            if (row.SKU && seenSkus.has(row.SKU.toString())) {
                errors.push('Duplicate SKU in file');
            }
            if (row.SKU) seenSkus.add(row.SKU.toString());

            // 4. Reference Integrity (Category)
            if (row.Category) {
                const cat = row.Category.toString().toLowerCase();
                if (!validCategoryNames.has(cat) && !validCategoryIds.has(row.Category)) {
                    errors.push(`Category '${row.Category}' not found`);
                }
            }

            // 5. Reference Integrity (Brand)
            if (row.Brand) {
                const brand = row.Brand.toString().toLowerCase();
                // Simple check, maybe warn instead of error if we want to allow new brands on fly
                // For now, strict validation
                // if (!validBrands.has(brand)) errors.push(`Brand '${row.Brand}' not found`);
            }

            if (errors.length > 0) {
                result.invalidRows.push({
                    row: rowNum,
                    sku: row.SKU || 'N/A',
                    error: errors.join(', '),
                    data: row
                });
            } else {
                result.validRows.push(row);
            }
        }

        result.summary.valid = result.validRows.length;
        result.summary.invalid = result.invalidRows.length;

        return result;
    }

    /**
     * Process Valid Rows
     */
    async processImport(rows: any[], onProgress: (progress: ImportProgress) => void) {
        const progress: ImportProgress = {
            processed: 0,
            total: rows.length,
            success: 0,
            failed: 0,
            errors: []
        };

        // Cache categories again for mapping
        const categories = await firstValueFrom(this.categoryService.getCategories());

        for (const row of rows) {
            try {
                const sku = row.SKU.toString();
                const existingProduct = await this.productService.getProductBySku(sku);

                const productData = this.mapRowToProduct(row, categories, existingProduct);

                if (existingProduct && existingProduct.id) {
                    await this.productService.updateProduct(existingProduct.id, productData);
                } else {
                    // Create new
                    await this.productService.createProduct(
                        productData as any,
                        undefined as any, // No image files, only URLs mapped
                        []
                    );
                }
                progress.success++;
            } catch (error: any) {
                console.error(`Error processing SKU ${row.SKU}:`, error);
                progress.failed++;
                progress.errors.push(`SKU ${row.SKU}: ${error.message}`);
            }

            progress.processed++;
            onProgress({ ...progress });
        }
    }

    /**
     * Export Products to Excel (Round-trip compatible)
     */
    async exportProducts(products: Product[]) {
        // Map products to template format
        const rows = products.map(p => ({
            SKU: p.sku,
            'Name En': p.name?.en || '',
            'Name Es': p.name?.es || '',
            Brand: p.brand,
            Category: p.categoryId,
            Price: p.price,
            Stock: p.stockQuantity,
            'Description En': p.description?.en || '',
            'Description Es': p.description?.es || '',
            'Image URL': p.images?.main || ''
        }));

        const fileName = `products_export_${new Date().toISOString().split('T')[0]}.xlsx`;
        await this.generateExcelFile(rows, fileName);
    }

    /**
     * Generate Smart Template with Dropdowns
     */
    async downloadTemplate() {
        this.generateExcelFile([], 'product_import_template.xlsx');
    }

    private async generateExcelFile(data: any[], fileName: string) {
        const categories = await firstValueFrom(this.categoryService.getCategories());
        const brands = await firstValueFrom(this.brandService.getBrands());

        // 1. Headers & Data
        let ws: XLSX.WorkSheet;

        if (data.length === 0) {
            const headers = [
                'SKU', 'Name En', 'Name Es', 'Brand', 'Category',
                'Price', 'Stock', 'Description En', 'Description Es', 'Image URL'
            ];
            // Add one sample row for guidance
            const sampleRow = {
                SKU: 'SAMPLE-001',
                'Name En': 'Sample Product',
                'Name Es': 'Producto Ejemplo',
                Brand: 'Praxis',
                Category: 'Tires',
                Price: 99.99,
                Stock: 10,
                'Description En': 'Description...',
                'Description Es': 'Descripción...',
                'Image URL': 'https://example.com/image.jpg'
            };
            ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
        } else {
            ws = XLSX.utils.json_to_sheet(data);
        }

        // 2. Formatting (Column Widths)
        if (!ws['!cols']) ws['!cols'] = [];
        ws['!cols'] = [
            { wch: 15 }, // SKU
            { wch: 30 }, // Name En
            { wch: 30 }, // Name Es
            { wch: 15 }, // Brand
            { wch: 20 }, // Category
            { wch: 10 }, // Price
            { wch: 10 }, // Stock
            { wch: 40 }, // Desc En
            { wch: 40 }, // Desc Es
            { wch: 50 }  // Image
        ];

        // 3. Create Workbook
        const wb = XLSX.utils.book_new();

        // 4. Reference Data (Hidden Sheet)
        const refSheetName = '_Ref_Data';

        const categoryNames = categories.map(c => c.name.en).sort();
        const brandNames = brands.map(b => b.name).sort();

        const maxLength = Math.max(categoryNames.length, brandNames.length);
        const refData = [];

        for (let i = 0; i < maxLength; i++) {
            refData.push({
                Brands: brandNames[i] || '',
                Categories: categoryNames[i] || ''
            });
        }

        const wsRef = XLSX.utils.json_to_sheet(refData);
        XLSX.utils.book_append_sheet(wb, wsRef, refSheetName);

        // 5. Add Main Sheet
        XLSX.utils.book_append_sheet(wb, ws, 'Products');

        // 6. Save
        XLSX.writeFile(wb, fileName);
    }

    private parseExcel(file: File): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e: any) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    // Try to find 'Products' sheet, otherwise fallback to first sheet
                    let sheetName = 'Products';
                    if (!workbook.SheetNames.includes(sheetName)) {
                        sheetName = workbook.SheetNames[0];
                    }

                    const worksheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet);
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    }

    private mapRowToProduct(row: any, categories: any[], existingProduct: Product | null): Partial<Product> {
        // Find category ID by name
        let categoryId = 'uncategorized';
        if (row.Category) {
            const catName = row.Category.toString().toLowerCase();
            const cat = categories.find(c => c.name.en.toLowerCase() === catName || c.id === row.Category);
            if (cat) categoryId = cat.id;
        }

        const nameEn = row['Name En'] || row['Name'] || existingProduct?.name.en || '';
        const nameEs = row['Name Es'] || existingProduct?.name.es || row['Name En'] || '';
        const brand = row.Brand || existingProduct?.brand || 'Generic';

        // Generate Slug if missing
        let slug = existingProduct?.slug || '';
        if (!slug && (nameEn || nameEs)) {
            slug = this.generateSlug(nameEn || nameEs, brand);
        }

        // Map fields
        const product: Partial<Product> = {
            sku: row.SKU.toString(),
            name: {
                en: nameEn,
                es: nameEs
            },
            slug: slug,
            price: Number(row.Price),
            stockQuantity: Number(row.Stock),
            inStock: Number(row.Stock) > 0,
            brand: brand,
            categoryId: categoryId,
            description: {
                en: row['Description En'] || existingProduct?.description.en || '',
                es: row['Description Es'] || existingProduct?.description.es || ''
            },
            // Maintain existing fields if not updating them
            active: existingProduct ? existingProduct.active : true,
            productType: existingProduct ? existingProduct.productType : 'tire', // Default
            type: 'simple'
        };

        // Handle Image URL
        if (row['Image URL']) {
            product.images = {
                main: row['Image URL'],
                gallery: []
            };
        } else if (existingProduct) {
            // Keep existing images
            product.images = existingProduct.images;
        } else {
            product.images = { main: '', gallery: [] };
        }

        return product;
    }

    /**
     * Generate SEO-friendly slug
     */
    private generateSlug(name: string, brand: string): string {
        const text = `${brand} ${name}`;
        return text
            .toLowerCase()
            .normalize('NFD') // Split accented characters
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
            .replace(/^-+|-+$/g, ''); // Trim leading/trailing hyphens
    }
}
