import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';

export interface PdfPreviewData {
    pdfUrl: string;
    title: string;
}

@Component({
    selector: 'app-pdf-preview-dialog',
    standalone: true,
    imports: [CommonModule, NgxExtendedPdfViewerModule, AppIconComponent, TranslateModule],
    template: `
        <div class="pdf-preview-container">
            <header class="preview-header">
                <h2 class="preview-title">{{ data.title }}</h2>
                <button class="close-btn" (click)="close()">
                    <app-icon name="x" [size]="24"></app-icon>
                </button>
            </header>
            <div class="pdf-viewer-wrapper">
                <ngx-extended-pdf-viewer 
                    [src]="data.pdfUrl" 
                    [height]="'80vh'"
                    [showToolbar]="true"
                    [showSidebarButton]="false"
                    [showFindButton]="true"
                    [showPagingButtons]="true"
                    [showZoomButtons]="true"
                    [showPresentationModeButton]="true"
                    [showDownloadButton]="true"
                    [showPrintButton]="true"
                    theme="dark">
                </ngx-extended-pdf-viewer>
            </div>
        </div>
    `,
    styles: [`
        .pdf-preview-container {
            background: #1e1e1e;
            border-radius: 12px;
            overflow: hidden;
            width: 90vw;
            height: 90vh;
            max-width: 1200px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .preview-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            background: rgba(0, 0, 0, 0.3);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .preview-title {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 500;
            color: #fff;
        }

        .close-btn {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.6);
            cursor: pointer;
            padding: 0.5rem;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .close-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        .pdf-viewer-wrapper {
            flex: 1;
            overflow: hidden;
            background: #2a2a2a;
        }
    `]
})
export class PdfPreviewDialogComponent {
    constructor(
        public dialogRef: DialogRef<void>,
        @Inject(DIALOG_DATA) public data: PdfPreviewData
    ) { }

    close(): void {
        this.dialogRef.close();
    }
}
