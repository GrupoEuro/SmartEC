import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideImageLoader } from './core/services/config/image-loader.config';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideFirestore, initializeFirestore, memoryLocalCache, Firestore } from '@angular/fire/firestore';
import { provideAuth, getAuth, Auth } from '@angular/fire/auth';
import { provideStorage, getStorage, Storage } from '@angular/fire/storage';

import { environment } from '../environments/environment';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideClientHydration(),
    provideHttpClient(withFetch()),
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
    provideFirestore(() => initializeFirestore(getApp(), {
      localCache: memoryLocalCache()
    })),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
    { provide: 'FIRESTORE', useExisting: Firestore },
    { provide: 'AUTH', useExisting: Auth },
    { provide: 'STORAGE', useExisting: Storage },
    provideImageLoader(),
    provideAnimationsAsync()
  ]
};

