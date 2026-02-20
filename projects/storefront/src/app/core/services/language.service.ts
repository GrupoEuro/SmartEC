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

  private readonly STORAGE_KEY = 'euro_lang';

  constructor() {
    this.translate.addLangs(['es', 'en']);
    this.translate.setDefaultLang('es');

    // On browser: load saved preference from localStorage, default to 'es'
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      const initialLang = saved && ['es', 'en'].includes(saved) ? saved : 'es';
      this.translate.use(initialLang);
      this.currentLang.set(initialLang);
      document.documentElement.lang = initialLang;
    } else {
      // SSR always uses 'es'
      this.translate.use('es');
    }
  }

  setLanguage(lang: string) {
    this.translate.use(lang);
    this.currentLang.set(lang);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    }
  }

  toggleLanguage() {
    const newLang = this.currentLang() === 'es' ? 'en' : 'es';
    this.setLanguage(newLang);
  }
}
