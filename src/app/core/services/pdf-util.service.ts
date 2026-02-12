import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
// import * as pdfjsLib from 'pdfjs-dist'; // TODO: Install pdfjs-dist package if PDF functionality is needed

@Injectable({
    providedIn: 'root'
})
export class PdfUtilService {
    private isBrowser: boolean;

    constructor(@Inject(PLATFORM_ID) platformId: Object) {
        this.isBrowser = isPlatformBrowser(platformId);
        if (this.isBrowser) {
            // Set worker source for pdf.js
            // We use the same version as the installed package from CDN or local assets
            // For now, we'll try to use the one provided by ngx-extended-pdf-viewer if available, or a public CDN fallback
            // Ideally this should be configured in angular.json, but for quick implementation we use CDN
            // (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        }
    }

    /**
     * Generates a thumbnail image from the first page of the PDF.
     * @param file The PDF file object
     * @returns A Promise resolving to a File object (PNG image)
     */
    async generateThumbnail(file: File): Promise<File> {
        return Promise.reject('PDF functionality not available - pdfjs-dist package not installed');
        // if (!this.isBrowser) return Promise.reject('Not running in browser');
        // try {
        //     const arrayBuffer = await file.arrayBuffer();
        //     const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        //     const pdf = await loadingTask.promise;
        //     // Get first page
        //     const page = await pdf.getPage(1);
        //     // Set scale for reasonable thumbnail size (e.g., width ~300px)
        //     const viewport = page.getViewport({ scale: 0.5 });
        //     // Create canvas
        //     const canvas = document.createElement('canvas');
        //     const context = canvas.getContext('2d');
        //     canvas.height = viewport.height;
        //     canvas.width = viewport.width;
        //     if (!context) throw new Error('Could not get canvas context');
        //     // Render
        //     await page.render({
        //         canvasContext: context,
        //         viewport: viewport
        //     }).promise;
        //     // Convert to blob/file
        //     return new Promise((resolve, reject) => {
        //         canvas.toBlob((blob) => {
        //             if (blob) {
        //                 const thumbFile = new File([blob], `thumbnail-${file.name.replace('.pdf', '')}.png`, {
        //                     type: 'image/png',
        //                     lastModified: Date.now()
        //                 });
        //                 resolve(thumbFile);
        //             } else {
        //                 reject('Could not generate blob from canvas');
        //             }
        //         }, 'image/png');
        //     });
        // } catch (error) {
        //     console.error('Error generating thumbnail:', error);
        //     throw error;
        // }
    }

    /**
     * Extracts text from the first page of the PDF to be used as a description.
     * @param file The PDF file object
     * @param maxLength Maximum length of the extracted text
     * @returns Promise resolving to the extracted text string
     */
    async extractText(file: File, maxLength: number = 200): Promise<string> {
        return Promise.reject('PDF functionality not available - pdfjs-dist package not installed');
        // if (!this.isBrowser) return Promise.reject('Not running in browser');
        // try {
        //     const arrayBuffer = await file.arrayBuffer();
        //     const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        //     const pdf = await loadingTask.promise;
        //     const page = await pdf.getPage(1);
        //     const textContent = await page.getTextContent();
        //     let fullText = textContent.items
        //         .map((item: any) => item.str)
        //         .join(' ');
        //     // Clean up extra spaces
        //     fullText = fullText.replace(/\s+/g, ' ').trim();
        //     if (fullText.length > maxLength) {
        //         return fullText.substring(0, maxLength) + '...';
        //     }
        //     return fullText;
        // } catch (error) {
        //     console.error('Error extracting text:', error);
        //     return '';
        // }
    }
}
