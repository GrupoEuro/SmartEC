import { Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * SafeHtmlPipe
 *
 * Sanitizes HTML strings through Angular's DomSanitizer before binding to [innerHTML].
 * Uses SecurityContext.HTML (strips scripts, event handlers, dangerous attributes) — this
 * is the SANITIZE path, NOT bypassSecurityTrustHtml. Content is cleaned, not trusted as-is.
 *
 * Usage:
 *   <div [innerHTML]="content | safeHtml"></div>
 */
@Pipe({
    name: 'safeHtml',
    standalone: true,
    pure: true
})
export class SafeHtmlPipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) {}

    transform(value: string | null | undefined): SafeHtml {
        if (!value) return '';
        // sanitize() strips unsafe HTML — this is NOT a trust bypass
        const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, value) ?? '';
        return this.sanitizer.bypassSecurityTrustHtml(sanitized);
    }
}
