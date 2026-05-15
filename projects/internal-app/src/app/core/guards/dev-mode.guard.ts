import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// Dev tools are restricted to DEV environments AND SUPER_ADMIN role.
export const devModeGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    // Completely disable route in production to prevent accidental seeding or data wiping
    if (environment.production) {
        return router.createUrlTree(['/admin/dashboard']);
    }

    return authService.userProfile$.pipe(
        take(1),
        map(profile => {
            if (profile?.role === 'SUPER_ADMIN') {
                return true;
            }
            return router.createUrlTree(['/admin/dashboard']);
        })
    );
};
