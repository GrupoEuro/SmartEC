import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ExportService {

    /**
     * Exports data to CSV format and triggers download
     * @param data Array of objects to export
     * @param filename Name of the file (without extension)
     * @param headers Optional custom headers. If not provided, uses object keys
     */
    exportToCSV<T extends Record<string, any>>(
        data: T[],
        filename: string,
        headers?: string[]
    ): void {
        if (!data || data.length === 0) {
            console.warn('No data to export');
            return;
        }

        // Use provided headers or extract from first object
        const csvHeaders = headers || Object.keys(data[0]);

        // Helper function to properly escape CSV fields
        const escapeCSVField = (field: any): string => {
            // Convert to string and handle null/undefined
            const str = field?.toString() || '';
            // If field contains comma, quote, or newline, wrap in quotes and escape existing quotes
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Build CSV content
        const rows = data.map(item =>
            csvHeaders.map(header => escapeCSVField(item[header]))
        );

        // Add UTF-8 BOM for Excel compatibility
        const BOM = '\uFEFF';
        const csvContent = BOM + [
            csvHeaders.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    /**
     * Exports data to CSV with custom mapping function
     * @param data Array of objects to export
     * @param filename Name of the file (without extension)
     * @param headers CSV column headers
     * @param mapFn Function to map each item to CSV row values
     */
    exportToCSVWithMapping<T>(
        data: T[],
        filename: string,
        headers: string[],
        mapFn: (item: T) => any[]
    ): void {
        if (!data || data.length === 0) {
            console.warn('No data to export');
            return;
        }

        // Helper function to properly escape CSV fields
        const escapeCSVField = (field: any): string => {
            const str = field?.toString() || '';
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Map data using provided function
        const rows = data.map(item => mapFn(item).map(escapeCSVField));

        // Add UTF-8 BOM for Excel compatibility
        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }
}
