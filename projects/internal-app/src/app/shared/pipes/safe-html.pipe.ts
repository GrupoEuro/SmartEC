import { Pipe, PipeTransform, inject, PLATFORM_ID } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import DOMPurify from 'dompurify';

/**
 * SafeHtml Pipe — sanitizes raw HTML from Firestore using DOMPurify before
 * passing it to Angular's [innerHTML] binding.
 *
 * Usage: [innerHTML]="content | safeHtml"
 */
@Pipe({
    name: 'safeHtml',
    standalone: true
})
export class SafeHtmlPipe implements PipeTransform {
    private sanitizer = inject(DomSanitizer);
    private platformId = inject(PLATFORM_ID);

    transform(value: string | null | undefined): SafeHtml {
        if (!value) return '';

        // DOMPurify only runs in browser — SSR returns empty string for safety
        if (!isPlatformBrowser(this.platformId)) return '';

        const clean = DOMPurify.sanitize(value, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
        });

        return this.sanitizer.bypassSecurityTrustHtml(clean);
    }
}
