import { Component, OnInit, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PdfService } from '../../../../core/services/pdf.service';
import { PDF, PDFFormData } from '../../../../core/models/pdf.model';
import { take } from 'rxjs/operators';

import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';

@Component({
    selector: 'app-pdf-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent],
    templateUrl: './pdf-form.component.html',
    styleUrls: ['./pdf-form.component.css', '../../shared/admin-forms.css']
})
export class PdfFormComponent implements OnInit {
    fb = inject(FormBuilder);
    pdfService = inject(PdfService);
    router = inject(Router);
    route = inject(ActivatedRoute);

    pdfForm: FormGroup;
    isEditing = false;
    isSubmitting = false;
    pdfPreviewUrl: string | null = null;
    thumbnailPreviewUrl: string | null = null;
    selectedPdfFile: File | null = null;
    selectedThumbnailFile: File | null = null;
    currentPdfId: string | null = null;
    currentPdf: PDF | null = null;

    categories = [
        { value: 'catalog', label: 'Catalog' },
        { value: 'technical', label: 'Technical Sheets' },
        { value: 'promotional', label: 'Promotional Material' },
        { value: 'price-list', label: 'Price List' },
        { value: 'other', label: 'Other' }
    ];

    constructor() {
        this.pdfForm = this.fb.group({
            title_es: ['', Validators.required],
            title_en: ['', Validators.required],
            description_es: ['', Validators.required],
            description_en: ['', Validators.required],
            category: ['catalog', Validators.required],
            isPublic: [true],
            requiresAuth: [false],
            tags: ['']
        });
    }

    ngOnInit() {
        // Subscribe to isPublic changes to handle requiresAuth
        this.pdfForm.get('isPublic')?.valueChanges.subscribe(() => {
            this.onAccessTypeChange();
        });

        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.isEditing = true;
            this.currentPdfId = id;
            this.loadPDF(id);
        }
    }

    loadPDF(id: string) {
        this.pdfService.getPDFById(id).pipe(take(1)).subscribe(pdf => {
            if (pdf) {
                this.currentPdf = pdf;
                this.pdfForm.patchValue({
                    title_es: pdf.title.es,
                    title_en: pdf.title.en,
                    description_es: pdf.description.es,
                    description_en: pdf.description.en,
                    category: pdf.category,
                    isPublic: pdf.isPublic,
                    requiresAuth: pdf.requiresAuth,
                    tags: pdf.tags.join(', ')
                });
                this.pdfPreviewUrl = pdf.fileUrl;
                this.thumbnailPreviewUrl = pdf.thumbnailUrl || null;
            }
        });
    }

    onPdfFileSelected(event: Event) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            if (file.type !== 'application/pdf') {
                alert('Please select a PDF file');
                return;
            }
            this.selectedPdfFile = file;
            this.pdfPreviewUrl = URL.createObjectURL(file);
        }
    }

    onThumbnailSelected(event: Event) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file');
                return;
            }
            this.selectedThumbnailFile = file;
            // Create preview
            const reader = new FileReader();
            reader.onload = () => {
                this.thumbnailPreviewUrl = reader.result as string;
            };
            reader.readAsDataURL(file);
        }
    }

    async onSubmit() {
        if (this.pdfForm.invalid) {
            alert('Please fill in all required fields');
            return;
        }

        if (!this.selectedPdfFile && !this.isEditing) {
            alert('Please select a PDF file');
            return;
        }

        this.isSubmitting = true;
        const formValue: PDFFormData = this.pdfForm.value;

        try {
            if (this.isEditing && this.currentPdfId) {
                // Update existing PDF
                this.pdfService.updatePDF(
                    this.currentPdfId,
                    formValue,
                    this.selectedPdfFile || undefined,
                    this.selectedThumbnailFile || undefined
                ).subscribe({
                    next: () => {

                        this.router.navigate(['/admin/pdfs']);
                    },
                    error: (error) => {
                        console.error('Error updating PDF:', error);
                        alert('Error updating PDF');
                        this.isSubmitting = false;
                    }
                });
            } else {
                // Create new PDF
                if (!this.selectedPdfFile) {
                    alert('PDF file is required');
                    this.isSubmitting = false;
                    return;
                }

                this.pdfService.createPDF(
                    formValue,
                    this.selectedPdfFile,
                    this.selectedThumbnailFile || undefined
                ).subscribe({
                    next: () => {

                        this.router.navigate(['/admin/pdfs']);
                    },
                    error: (error) => {
                        console.error('Error creating PDF:', error);
                        alert('Error creating PDF');
                        this.isSubmitting = false;
                    }
                });
            }
        } catch (error) {
            console.error('Error saving PDF:', error);
            alert('Error saving PDF');
            this.isSubmitting = false;
        }
    }

    onAccessTypeChange() {
        const isPublic = this.pdfForm.get('isPublic')?.value;
        if (isPublic) {
            // If public, disable requiresAuth
            this.pdfForm.patchValue({ requiresAuth: false });
        }
    }

    onCancel() {
        this.router.navigate(['/admin/pdfs']);
    }
}
