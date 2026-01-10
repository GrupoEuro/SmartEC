import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

export interface ImportedItem {
    sku: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    raw: any;
}

@Injectable({
    providedIn: 'root'
})
export class FileImportService {

    constructor() { }

    async parseFile(file: File): Promise<ImportedItem[]> {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        // Assume first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const rawData = XLSX.utils.sheet_to_json(sheet);

        // Map to standardized items
        return this.mapToItems(rawData);
    }

    private mapToItems(data: any[]): ImportedItem[] {
        return data.map(row => {
            // Heuristic matching for columns
            const sku = this.findValue(row, ['sku', 'part number', 'part_no', 'model', 'no. identificación', 'identifier']);
            const desc = this.findValue(row, ['description', 'desc', 'product', 'name', 'descripcion', 'producto']);
            const qty = this.parseNumber(this.findValue(row, ['qty', 'quantity', 'cantidad', 'units']));
            const price = this.parseNumber(this.findValue(row, ['price', 'cost', 'unit price', 'precio', 'costo']));

            return {
                sku: String(sku || ''),
                description: String(desc || 'Unknown Item'),
                quantity: qty || 0,
                unitPrice: price || 0,
                total: (qty || 0) * (price || 0),
                raw: row
            };
        }).filter(item => item.sku || item.description !== 'Unknown Item'); // Filter empty rows
    }

    private findValue(obj: any, keys: string[]): any {
        const objKeys = Object.keys(obj);
        for (const key of keys) {
            const foundKey = objKeys.find(k => k.toLowerCase().includes(key));
            if (foundKey) return obj[foundKey];
        }
        return null;
    }

    private parseNumber(val: any): number {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            // Remove currency symbols and commas
            const clean = val.replace(/[^0-9.-]/g, '');
            return parseFloat(clean);
        }
        return 0;
    }
}
