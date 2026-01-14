import { Component, Input, Output, EventEmitter, booleanAttribute } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ChartData, ChartConfiguration, ChartType } from 'chart.js';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { MetricChartComponent } from '../metric-chart/metric-chart.component';

export interface TableColumn {
    key: string;
    label: string;
    format?: 'currency' | 'percent' | 'number' | 'date' | 'category';
}

@Component({
    selector: 'app-chart-card',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent, MetricChartComponent],
    templateUrl: './chart-card.component.html',
    styleUrls: ['./chart-card.component.css']
})
export class ChartCardComponent {
    @Input() title: string = '';
    @Input() subtitle?: string;

    // Chart Inputs
    @Input() type: ChartType = 'line';
    @Input() data: ChartData | null = null;
    @Input() options: ChartConfiguration['options'];
    @Input() height: number = 300;
    @Input() format: 'currency' | 'percentage' | 'number' = 'number';

    // Table Inputs
    @Input() tableData: any[] = [];
    @Input() tableColumns: TableColumn[] = [];
    @Input({ transform: booleanAttribute }) disableTable: boolean = false;


    // State
    isTableVisible = false;

    toggleTable() {
        this.isTableVisible = !this.isTableVisible;
    }

    formatValue(value: any, format?: string): string {
        if (value === null || value === undefined) return '-';

        switch (format) {
            case 'currency':
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
            case 'percent':
                return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1 }).format(value / 100);
            case 'date':
                return new Date(value).toLocaleDateString();
            case 'number':
                return new Intl.NumberFormat('en-US').format(value);
            default:
                return String(value);
        }
    }

    exportCSV() {
        // Generic CSV export based on table columns
        if (!this.tableData || !this.tableColumns) return;

        const headers = this.tableColumns.map(c => c.label);
        const rows = this.tableData.map(row =>
            this.tableColumns.map(col => {
                const val = row[col.key];
                return `"${val}"`; // Simple escaping
            }).join(',')
        );

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.title.replace(/\s+/g, '_').toLowerCase()}_export.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }
}
