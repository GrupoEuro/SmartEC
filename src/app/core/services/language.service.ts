import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class LanguageService {
  private translate = inject(TranslateService);
  private platformId = inject(PLATFORM_ID);

  currentLang = signal<string>('es');

  constructor() {
    this.translate.addLangs(['es', 'en']);
    this.translate.setDefaultLang('es');

    if (isPlatformBrowser(this.platformId)) {
      const browserLang = this.translate.getBrowserLang();
      const initialLang = browserLang?.match(/en|es/) ? browserLang : 'es';
      this.setLanguage(initialLang);
    } else {
      this.setLanguage('es');
    }
  }

  setLanguage(lang: string) {
    this.translate.use(lang);
    this.currentLang.set(lang);
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.lang = lang;
    }
  }

  toggleLanguage() {
    const newLang = this.currentLang() === 'es' ? 'en' : 'es';
    this.setLanguage(newLang);
  }
}
