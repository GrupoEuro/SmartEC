import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ImportValidationResult } from '../../../../core/services/product-import.service';

@Component({
    selector: 'app-import-result-dialog',
    standalone: true,
    imports: [CommonModule, MatDialogModule],
    template: `
        <div class="dialog-header">
            <h2>Import Validation Report</h2>
            <button class="close-btn" (click)="close()">✕</button>
        </div>

        <div class="dialog-content">
            <!-- Summary Stats -->
            <div class="summary-stats">
                <div class="stat-card valid">
                    <span class="count">{{ data.summary.valid }}</span>
                    <span class="label">Valid Rows</span>
                </div>
                <div class="stat-card invalid" [class.has-errors]="data.summary.invalid > 0">
                    <span class="count">{{ data.summary.invalid }}</span>
                    <span class="label">Errors</span>
                </div>
            </div>

            <!-- Error List -->
            <div class="error-section" *ngIf="data.invalidRows.length > 0">
                <h3>Errors Found</h3>
                <div class="table-container">
                    <table class="error-table">
                        <thead>
                            <tr>
                                <th>Row</th>
                                <th>SKU</th>
                                <th>Issue</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr *ngFor="let err of data.invalidRows">
                                <td>{{ err.row }}</td>
                                <td class="font-mono">{{ err.sku }}</td>
                                <td class="error-msg">{{ err.error }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="warning-box">
                    ⚠️ Rows with errors will be skipped. Only valid rows will be imported.
                </div>
            </div>

            <div class="success-box" *ngIf="data.invalidRows.length === 0">
                ✅ All {{ data.summary.total }} rows look good! Ready to import.
            </div>
        </div>

        <div class="dialog-footer">
            <button class="btn-cancel" (click)="close()">Cancel</button>
            <button class="btn-confirm" 
                    [disabled]="data.summary.valid === 0" 
                    (click)="confirm()">
                Import {{ data.summary.valid }} Products
            </button>
        </div>
    `,
    styles: [`
        .dialog-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 24px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            background: #18181b;
            color: white;
        }
        .dialog-header h2 { margin: 0; font-size: 1.25rem; }
        .close-btn { background: none; border: none; color: #a1a1aa; font-size: 1.5rem; cursor: pointer; }

        .dialog-content { padding: 24px; background: #09090b; color: #e4e4e7; max-height: 60vh; overflow-y: auto; }

        .summary-stats { display: flex; gap: 20px; margin-bottom: 24px; }
        .stat-card {
            flex: 1;
            background: #27272a;
            padding: 16px;
            border-radius: 8px;
            text-align: center;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .stat-card.valid .count { color: #10b981; }
        .stat-card.invalid.has-errors .count { color: #ef4444; }
        .count { display: block; font-size: 2rem; font-weight: 800; line-height: 1; margin-bottom: 4px; }
        .label { font-size: 0.85rem; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; }

        .error-section h3 { margin: 0 0 12px; font-size: 1rem; color: #ef4444; }
        .table-container { 
            background: #1f1f22; 
            border-radius: 8px; 
            overflow: hidden; 
            border: 1px solid rgba(255,255,255,0.05); 
        }
        .error-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .error-table th, .error-table td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .error-table th { background: #27272a; color: #a1a1aa; font-weight: 600; }
        .font-mono { font-family: monospace; color: #fbbf24; }
        .error-msg { color: #ef4444; }

        .warning-box { margin-top: 16px; padding: 12px; background: rgba(245, 158, 11, 0.1); color: #fbbf24; border-radius: 6px; font-size: 0.9rem; }
        .success-box { padding: 20px; text-align: center; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 8px; font-size: 1.1rem; font-weight: 500; }

        .dialog-footer {
            padding: 20px 24px;
            background: #18181b;
            border-top: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        .btn-cancel { padding: 10px 20px; background: transparent; border: 1px solid #3f3f46; color: white; border-radius: 6px; cursor: pointer; }
        .btn-confirm { padding: 10px 20px; background: #00ACD8; border: none; color: white; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .btn-confirm:disabled { background: #3f3f46; color: #71717a; cursor: not-allowed; }
    `]
})
export class ImportResultDialogComponent {
    constructor(
        public dialogRef: MatDialogRef<ImportResultDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: ImportValidationResult
    ) { }

    close() {
        this.dialogRef.close(false);
    }

    confirm() {
        this.dialogRef.close(true);
    }
}
