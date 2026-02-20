import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Operations Guard
 * Allows access to users with OPERATIONS, ADMIN, or SUPER_ADMIN roles
 * Redirects unauthorized users to login
 */
export const operationsGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.userProfile$.pipe(
        take(1),
        map(profile => {
            if (!profile) {
                router.navigate(['/admin/login'], {
                    queryParams: { returnUrl: state.url }
                });
                return false;
            }

            const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'];
            if (allowedRoles.includes(profile.role)) {
                return true;
            }

            // User is logged in but doesn't have operations access
            router.navigate(['/']);
            return false;
        })
    );
};
