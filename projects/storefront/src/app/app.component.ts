import { Component, OnInit, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { TranslateService, LangChangeEvent } from '@ngx-translate/core';
import { filter, map, mergeMap } from 'rxjs/operators';
import { ChatWidgetComponent } from './components/chat-widget/chat-widget.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { ToastComponent } from './components/toast/toast.component';
import { ConfirmDialogComponent } from '@lib/ui-kit';
import { ExitIntentComponent } from './shared/components/exit-intent/exit-intent.component';
import { CartDrawerComponent } from './shared/components/cart-drawer/cart-drawer.component';
import { AnalyticsService } from '@lib/core';
import { CampaignService } from './core/services/campaign.service';
import { ThemeService } from './core/services/theme.service';
import { LanguageService } from './core/services/language.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, ToastComponent, ChatWidgetComponent, ConfirmDialogComponent, ExitIntentComponent, CartDrawerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'importadora-euro';
  translate: TranslateService = inject(TranslateService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private titleService = inject(Title);
  private document: Document = inject(DOCUMENT);
  private analytics = inject(AnalyticsService);

  private campaignService = inject(CampaignService);
  private themeService = inject(ThemeService); // Initializes Theme Engine
  private languageService = inject(LanguageService); // Single source of truth for language

  constructor() {
    console.log('%c Storefront App V1.0 ', 'background: #222; color: #bada55; padding: 10px; font-size: 16px;');
    // Language is initialized by LanguageService — no duplicate translate.use() here
  }

  ngOnInit() {
    this.dateLangAttribute();

    // Defer non-critical services to reduce TBT — hard 3s delay to avoid blocking critical path
    setTimeout(() => {
      this.analytics.init();
      this.campaignService.init();
    }, 3000);

    // Dynamic Title Logic
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.activatedRoute),
      map(route => {
        while (route.firstChild) {
          route = route.firstChild;
        }
        return route;
      }),
      filter(route => route.outlet === 'primary'),
      mergeMap(route => route.data)
    ).subscribe((event) => {
      const routeTitle = event['title'];
      if (routeTitle) {
        // Try to translate if it's a key, otherwise use string
        this.translate.get(routeTitle).subscribe((translatedTitle: string) => {
          // Fallback if key equals value (meaning no translation found, or it's a raw string)
          const finalTitle = translatedTitle !== routeTitle ? translatedTitle : routeTitle;
          this.titleService.setTitle(`Importadora Euro - ${finalTitle}`);
        });
      } else {
        this.titleService.setTitle('Importadora Euro');
      }
    });

    // Update title on language change
    this.translate.onLangChange.subscribe(() => {
      let route = this.activatedRoute;
      while (route.firstChild) {
        route = route.firstChild;
      }
      const routeData = route.snapshot.data;
      if (routeData && routeData['title']) {
        const routeTitle = routeData['title'];
        this.translate.get(routeTitle).subscribe((translatedTitle: string) => {
          const finalTitle = translatedTitle !== routeTitle ? translatedTitle : routeTitle;
          this.titleService.setTitle(`Importadora Euro - ${finalTitle}`);
        });
      }
    });
  }

  private dateLangAttribute() {
    this.translate.onLangChange.subscribe((event: LangChangeEvent) => {
      this.document.documentElement.lang = event.lang;
    });
  }
}
