import { Component, Input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICONS } from './icons';

@Component({
    selector: 'app-icon',
    standalone: true,
    imports: [CommonModule],
    template: `
        <svg 
            [attr.width]="size" 
            [attr.height]="size" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            [attr.class]="class"
            [innerHTML]="svgContent()">
        </svg>
    `,
    styles: [`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 0;
        }
    `]
})
export class AppIconComponent {
    @Input() name: string = '';
    @Input() size: number = 24;
    @Input() class: string = '';

    constructor(private sanitizer: DomSanitizer) { }

    svgContent = computed(() => {
        const iconName = this.name.toLowerCase();
        const content = ICONS[iconName];

        if (!content) {
            // console.warn(`Icon not found: ${iconName}`);
            // Return a fallback or empty
            return '';
        }

        return this.sanitizer.bypassSecurityTrustHtml(content);
    });
}
