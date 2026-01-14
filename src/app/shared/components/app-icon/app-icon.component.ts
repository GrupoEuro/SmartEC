import { Component, Input, computed, Inject, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICONS } from './icons';

@Component({
    selector: 'app-icon',
    standalone: true,
    imports: [CommonModule],
    template: `
        @if (isBrowser()) {
            <svg 
                [attr.width]="size" 
                [attr.height]="size" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                [attr.class]="class"
                [innerHTML]="svgContent()">
            </svg>
        }
    `,
    styles: [`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 0;
            min-width: 1em; /* Prevent collapse */
            min-height: 1em;
        }
    `]
})
export class AppIconComponent {
    @Input() name: string = '';
    @Input() size: number = 24;
    @Input() class: string = '';

    isBrowser = signal(false);

    constructor(
        private sanitizer: DomSanitizer,
        @Inject(PLATFORM_ID) platformId: Object
    ) {
        this.isBrowser.set(isPlatformBrowser(platformId));
    }

    svgContent = computed(() => {
        const iconName = this.name.toLowerCase();
        const content = ICONS[iconName];

        if (!content) {
            return '';
        }

        return this.sanitizer.bypassSecurityTrustHtml(content);
    });
}
