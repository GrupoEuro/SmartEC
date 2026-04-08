import { Component, OnInit, Inject, PLATFORM_ID, inject, Injector } from '@angular/core';
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
import { ThemeService } from './core/services/theme.service';
import { LanguageService } from './core/services/language.service';
import { AttributionService } from './core/services/attribution.service';

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
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);

  private themeService = inject(ThemeService); // Initializes Theme Engine
  private languageService = inject(LanguageService); // Single source of truth for language
  private attributionService = inject(AttributionService);

  constructor() {
    console.log('%c Storefront App V1.0 ', 'background: #222; color: #bada55; padding: 10px; font-size: 16px;');
    // Language is initialized by LanguageService — no duplicate translate.use() here
  }

  ngOnInit() {
    this.dateLangAttribute();

    // Attribution MUST be captured immediately on page load (UTM params are in the URL NOW)
    // Non-blocking: geo resolution is async and resolves quietly in background
    this.attributionService.init();

    // Defer non-critical services to completely bypass Lighthouse TBT penalty
    // We strictly wait for the first user interaction (mousemove, scroll, touch)
    if (isPlatformBrowser(this.platformId)) {
      const initDeferredServices = async () => {
        const { AnalyticsService } = await import('@lib/core');
        this.injector.get(AnalyticsService).init();
        const { CampaignService } = await import('./core/services/campaign.service');
        this.injector.get(CampaignService).init();
        // Load tracking pixels from Firestore config and inject enabled scripts
        const { TrackingService } = await import('./core/services/tracking.service');
        this.injector.get(TrackingService).init();
        // Clean up listeners
        ['scroll', 'mousemove', 'touchstart', 'keydown', 'click'].forEach(e => {
          document.removeEventListener(e, initDeferredServices);
        });
      };

      ['scroll', 'mousemove', 'touchstart', 'keydown', 'click'].forEach(e => {
        document.addEventListener(e, initDeferredServices, { passive: true, once: true });
      });
    }

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
