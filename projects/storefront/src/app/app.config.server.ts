import { mergeApplicationConfig, ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { Observable, from } from 'rxjs';
import { join } from 'path';
import * as fs from 'fs';

export class TranslateServerLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    return new Observable((observer) => {
      const distPath = join(process.cwd(), 'dist', 'storefront', 'browser', 'assets', 'i18n', `${lang}.json`);
      const sourcePath = join(process.cwd(), 'projects', 'storefront', 'src', 'assets', 'i18n', `${lang}.json`);

      console.log(`[TranslateServerLoader] Checking for translations...`);
      console.log(`[TranslateServerLoader] Dist Path: ${distPath}`);
      console.log(`[TranslateServerLoader] Source Path: ${sourcePath}`);

      if (fs.existsSync(distPath)) {
        try {
          const jsonData = JSON.parse(fs.readFileSync(distPath, 'utf8'));
          observer.next(jsonData);
          observer.complete();
          return;
        } catch (e) {
          console.error(`[TranslateServerLoader] Error reading dist file: ${e}`);
        }
      } else {
        console.warn(`[TranslateServerLoader] Dist file not found.`);
      }

      if (fs.existsSync(sourcePath)) {
        try {
          const jsonData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
          observer.next(jsonData);
          observer.complete();
          return;
        } catch (e) {
          console.error(`[TranslateServerLoader] Error reading source file: ${e}`);
        }
      } else {
        console.error(`[TranslateServerLoader] Source file not found either!`);
      }

      observer.next({});
      observer.complete();
    });
  }
}

export function translateServerLoaderFactory() {
  return new TranslateServerLoader();
}

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: translateServerLoaderFactory
        }
      })
    )
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
