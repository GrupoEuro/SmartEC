import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../environments/environment';

export const devModeGuard: CanActivateFn = (route, state) => {
    const router = inject(Router);

    if (!environment.production) {
        return true;
    }

    // Redirect to home or 404 in production
    return router.createUrlTree(['/']);
};
