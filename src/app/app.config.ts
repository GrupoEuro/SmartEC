import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideImageLoader } from './core/services/config/image-loader.config';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { getFirestore, provideFirestore, initializeFirestore, memoryLocalCache } from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { environment } from '../environments/environment';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideClientHydration(),
    provideHttpClient(withFetch()),
    provideCharts(withDefaultRegisterables()),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'es',
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient]
        }
      })
    ),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => {
      const app = getApp();
      return initializeFirestore(app, {
        localCache: memoryLocalCache()
      });
    }),
    provideAuth(() => {
      const app = getApp();
      return getAuth(app);
    }),
    provideStorage(() => {
      const app = getApp();
      return getStorage(app);
    }),
    provideImageLoader(),
    provideAnimations()
  ]
};
