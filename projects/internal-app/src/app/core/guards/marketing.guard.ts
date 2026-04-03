import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Marketing Hub Guard
 *
 * Allowed roles:
 *  - MARKETING  — primary user, owns campaign + analytics workflow
 *  - ADMIN      — content admins should still have access
 *  - SUPER_ADMIN — unrestricted
 *  - MANAGER    — managers can review campaign performance
 *
 * Redirects unauthenticated users to the login page.
 * Redirects authenticated users without access to the admin dashboard.
 */
export const marketingGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router      = inject(Router);

    return authService.userProfile$.pipe(
        take(1),
        map(profile => {
            if (!profile) {
                router.navigate(['/admin/login'], {
                    queryParams: { returnUrl: state.url }
                });
                return false;
            }

            const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'MARKETING', 'OPERATIONS'];
            if (allowedRoles.includes(profile.role)) {
                return true;
            }

            router.navigate(['/admin/dashboard']);
            return false;
        })
    );
};
