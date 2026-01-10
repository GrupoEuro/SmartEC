import { bootstrapApplication } from '@angular/platform-browser';
// Force Rebuild v1.4.0
// Force rebuild
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
