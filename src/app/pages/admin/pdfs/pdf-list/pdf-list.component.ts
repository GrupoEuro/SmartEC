import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PdfService } from '../../../../core/services/pdf.service';
import { PDF } from '../../../../core/models/pdf.model';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { PdfPreviewDialogComponent } from '../pdf-preview-dialog/pdf-preview-dialog.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-pdf-list',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslateModule, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './pdf-list.component.html',
    styleUrls: ['./pdf-list.component.css', '../../admin-tables.css']
})
export class PdfListComponent implements OnInit {
    private pdfService = inject(PdfService);
    private translate = inject(TranslateService);
    private confirmDialog = inject(ConfirmDialogService);
    private toast = inject(ToastService);
    private dialog = inject(Dialog);
    pdfs$!: Observable<PDF[]>;

    ngOnInit() {
        this.pdfs$ = this.pdfService.getAllPDFs().pipe(
            map(pdfs => pdfs.map(pdf => ({
                ...pdf,
                createdAt: (pdf.createdAt as any)?.toDate ? (pdf.createdAt as any).toDate() : pdf.createdAt
            })))
        );
    }

    openPreview(pdf: PDF) {
        if (pdf.fileUrl) {
            this.dialog.open(PdfPreviewDialogComponent, {
                data: {
                    pdfUrl: pdf.fileUrl,
                    title: pdf.title.en || pdf.fileName
                },
                width: '95vw',
                maxWidth: '1200px',
                height: '90vh',
                panelClass: 'pdf-preview-dialog-panel'
            });
        }
    }

    async deletePDF(pdf: PDF) {
        const confirmed = await this.confirmDialog.confirmDelete(
            pdf.title.en,
            'PDF'
        );

        if (!confirmed) return;

        try {
            await this.pdfService.deletePDF(pdf.id!).toPromise();
            this.toast.success('PDF deleted successfully');
            // Refresh the list
            this.pdfs$ = this.pdfService.getAllPDFs();
        } catch (error) {
            console.error('Error deleting PDF:', error);
            this.toast.error('Failed to delete PDF. Please try again.');
        }
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    getCategoryLabel(category: string): string {
        const labels: Record<string, string> = {
            'catalog': 'Catalog',
            'technical': 'Technical',
            'promotional': 'Promotional',
            'price-list': 'Price List',
            'other': 'Other'
        };
        return labels[category] || category;
    }
}
