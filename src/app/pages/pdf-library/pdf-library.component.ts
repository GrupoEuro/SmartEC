import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { PdfService } from '../../core/services/pdf.service';
import { PDF } from '../../core/models/pdf.model';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { TranslateModule } from '@ngx-translate/core';

import { MetaService } from '../../core/services/meta.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
    selector: 'app-pdf-library',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    templateUrl: './pdf-library.component.html',
    styleUrl: './pdf-library.component.css'
})
export class PdfLibraryComponent implements OnInit {
    private pdfService = inject(PdfService);
    private authService = inject(AuthService);
    private router = inject(Router);
    languageService = inject(LanguageService);
    private metaService = inject(MetaService);
    private toast = inject(ToastService);

    pdfs$!: Observable<PDF[]>;
    selectedCategory: string = 'all';
    searchQuery: string = '';

    categories = [
        { value: 'all', label: 'All Categories' },
        { value: 'catalog', label: 'Catalogs' },
        { value: 'technical', label: 'Technical Sheets' },
        { value: 'promotional', label: 'Promotional' },
        { value: 'other', label: 'Other' }
    ];

    private searchSubject = new BehaviorSubject<string>('');
    private categorySubject = new BehaviorSubject<string>('all');

    ngOnInit() {
        this.metaService.updateTags({
            title: 'Biblioteca PDF - Manuales y Catálogos',
            description: 'Descarga manuales oficiales, fichas técnicas y catálogos de llantas Michelin y Praxis. Recursos exclusivos para distribuidores.',
            image: 'assets/images/library-hero.jpg'
        });

        this.pdfs$ = combineLatest([
            this.pdfService.getPublicPDFs(),
            this.searchSubject,
            this.categorySubject
        ]).pipe(
            map(([pdfs, search, category]) => {
                return pdfs.filter(pdf => {
                    const term = search.toLowerCase();
                    const matchesSearch = !term ||
                        pdf.title.en.toLowerCase().includes(term) ||
                        pdf.title.es.toLowerCase().includes(term) ||
                        (pdf.tags && pdf.tags.some(tag => tag.toLowerCase().includes(term)));

                    const matchesCategory = category === 'all' || pdf.category === category;

                    return matchesSearch && matchesCategory;
                });
            })
        );
    }

    onSearch(event: Event) {
        const query = (event.target as HTMLInputElement).value;
        this.searchQuery = query;
        this.searchSubject.next(query);
    }

    setCategory(category: string) {
        this.selectedCategory = category;
        this.categorySubject.next(category);
    }

    async downloadPDF(pdf: PDF) {
        // Check if user is authenticated for restricted PDFs
        if (pdf.requiresAuth) {
            const user = await firstValueFrom(this.authService.user$);
            if (!user) {
                this.toast.info('Please login to download this PDF', 5000);
                await this.authService.loginWithGoogle();
                return;
            }
        }

        // Check rate limit
        const canDownload = await firstValueFrom(this.pdfService.canDownload(this.getClientIP()));
        if (!canDownload) {
            this.toast.warning('Download limit reached. Please try again in an hour.', 5000);
            return;
        }

        // Track download
        const lang = this.languageService.currentLang();
        const title = lang === 'es' ? pdf.title.es : pdf.title.en;

        this.pdfService.trackDownload(
            pdf.id!,
            title,
            this.getClientIP(),
            navigator.userAgent,
            true
        ).subscribe();

        // Increment counter
        this.pdfService.incrementDownloadCount(pdf.id!).subscribe();

        // Trigger download
        window.open(pdf.fileUrl, '_blank');
    }

    async requestAccess(pdf: PDF) {
        const user = await firstValueFrom(this.authService.user$);
        if (!user) {
            this.toast.info('Please login to request access to this PDF');
            await this.authService.loginWithGoogle();
            return;
        }

        // For now, just download if user is logged in
        this.downloadPDF(pdf);
    }

    // Simple client IP detection (for demo purposes)
    // In production, you'd want to get this from the server
    private getClientIP(): string {
        // For demo, we'll use a combination of user agent and timestamp
        // In production, implement proper IP detection via backend
        return `${navigator.userAgent}-${new Date().toDateString()}`;
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    getTitle(pdf: PDF): string {
        const lang = this.languageService.currentLang();
        return lang === 'es' ? pdf.title.es : pdf.title.en;
    }

    getDescription(pdf: PDF): string {
        const lang = this.languageService.currentLang();
        return lang === 'es' ? pdf.description.es : pdf.description.en;
    }
}
