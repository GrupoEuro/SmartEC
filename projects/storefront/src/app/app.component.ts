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
import { MetaService } from './core/services/meta.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

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
  private metaService = inject(MetaService);
  private firestore  = inject(Firestore);

  constructor() {
    console.log('%c Storefront App V1.0 ', 'background: #222; color: #bada55; padding: 10px; font-size: 16px;');
    // Language is initialized by LanguageService — no duplicate translate.use() here
  }

  ngOnInit() {
    this.dateLangAttribute();

    // Attribution MUST be captured immediately on page load (UTM params are in the URL NOW)
    this.attributionService.init();

    // Dynamically inject FAQ + Org schema from Firestore (Admin SEO panel edits go live instantly)
    if (isPlatformBrowser(this.platformId)) {
      this.injectDynamicSeoSchemas();
    }

    if (isPlatformBrowser(this.platformId)) {
      // ── Tracking pixels: initialize immediately (non-blocking) ───────────────
      // MUST be outside the deferred block so we capture:
      //   a) The initial landing page PageView (router NavigationEnd fires before any interaction)
      //   b) Purchase events on payment-gateway redirects (no interaction before confirmation page)
      // Scripts are async-loaded so this has no Lighthouse TBT impact.
      (async () => {
        const { TrackingService } = await import('./core/services/tracking.service');
        const trackingSvc = this.injector.get(TrackingService);
        await trackingSvc.init();
        // Explicitly fire the initial PageView — the router's NavigationEnd for the
        // landing route already fired before init() completed, so wirePageViews()
        // only catches subsequent navigations. We fire this one manually.
        trackingSvc.trackPageView(window.location.pathname + window.location.search);
      })();

      // ── Heavy/non-critical services: defer until first interaction ────────────
      let initialized = false;
      const EVENTS = ['scroll', 'mousemove', 'touchstart', 'keydown', 'click'];

      const initDeferredServices = async () => {
        if (initialized) return;   // Guard: only run once regardless of how many events fire
        initialized = true;

        // Remove all listeners immediately so nothing else can trigger this
        EVENTS.forEach(e => document.removeEventListener(e, initDeferredServices));

        const { AnalyticsService } = await import('@lib/core');
        this.injector.get(AnalyticsService).init();
        const { CampaignService } = await import('./core/services/campaign.service');
        this.injector.get(CampaignService).init();
      };

      EVENTS.forEach(e => {
        document.addEventListener(e, initDeferredServices, { passive: true });
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

  /**
   * Fetch config/seo from Firestore (managed via Admin → SEO panel) and
   * replace the static FAQPage JSON-LD in index.html with the live version.
   * Non-blocking — a Firestore error silently falls back to the static schema.
   */
  private async injectDynamicSeoSchemas(): Promise<void> {
    try {
      const snap = await getDoc(doc(this.firestore, 'config/seo'));
      if (!snap.exists()) return;
      const data = snap.data() as any;

      const activeFaqs: { question: string; answer: string }[] =
        (data.faq ?? []).filter((f: any) => f.active && f.question && f.answer);

      if (activeFaqs.length === 0) return;

      this.metaService.addStructuredData({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        '@id': 'https://importadoraeuro.com/#faq',
        mainEntity: activeFaqs.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }, 'schema-faq-dynamic');

      console.log(`[SEO] Dynamic FAQ injected — ${activeFaqs.length} Q&As from Firestore.`);
    } catch (e) {
      // Non-critical — static index.html schema remains as fallback
      console.debug('[SEO] Dynamic FAQ fetch failed, using static schema.', e);
    }
  }
}
