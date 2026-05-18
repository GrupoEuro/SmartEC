import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

// Dev tools are restricted to SUPER_ADMIN role only.
// Previously blocked entirely in production — removed that restriction because
// operational tools like the MeLi Reconciliator require live production data.
export const devModeGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

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
