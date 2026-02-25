import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';

@Component({
    selector: 'app-hero',
    standalone: true,
    imports: [CommonModule, TranslateModule, NgOptimizedImage],
    templateUrl: './hero.component.html',
    styleUrl: './hero.component.css'
})
export class HeroComponent implements OnInit {
    private translate = inject(TranslateService);
    private languageService = inject(LanguageService);

    ngOnInit() {
        // Force the TranslateService to use the current language loaded by LanguageService
        // This resolves issues where standalone components lose the context of the translation loader
        this.translate.use(this.languageService.currentLang());
    }

    scrollToContact() {
        const contactSection = document.getElementById('contact');
        if (contactSection) {
            contactSection.scrollIntoView({ behavior: 'smooth' });
        }
    }
}
