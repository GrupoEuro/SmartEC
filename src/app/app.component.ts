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
import { ConfirmDialogComponent } from './components/shared/confirm-dialog/confirm-dialog.component';
import { AnalyticsService } from './core/services/analytics.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, ToastComponent, ChatWidgetComponent, ConfirmDialogComponent],
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

  constructor() {
    console.log('%c App Version Admin Settings V5 ', 'background: #222; color: #bada55; padding: 10px; font-size: 16px;');

    // Set default language
    this.translate.setDefaultLang('es');
    this.translate.use('es');
  }

  ngOnInit() {
    this.dateLangAttribute();

    // Initialize analytics tracking
    this.analytics.init();

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

  isAdminRoute(): boolean {
    const url = this.router.url;
    return url.includes('/admin') || url.includes('/operations') || url.includes('/command-center') || url.includes('/dev-tools') || url.includes('/help');
  }

  private dateLangAttribute() {
    this.translate.onLangChange.subscribe((event: LangChangeEvent) => {
      this.document.documentElement.lang = event.lang;
    });
  }
}
