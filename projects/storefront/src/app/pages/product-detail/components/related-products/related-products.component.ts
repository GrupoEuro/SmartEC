import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Product, LanguageService } from '@lib/core';

@Component({
    selector: 'app-related-products',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './related-products.component.html',
    styleUrl: './related-products.component.css'
})
export class RelatedProductsComponent {
    @Input() products: Product[] = [];
    protected readonly lang = inject(LanguageService).currentLang;
    /** Typed getter for strict-mode template indexing — 'es' | 'en' */
    protected get activeLang(): 'es' | 'en' {
        return (this.lang() === 'en') ? 'en' : 'es';
    }
}
