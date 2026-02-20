import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take, tap } from 'rxjs/operators';
import { ToastService } from '../services/toast.service';

export const roleGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const toast = inject(ToastService);
    const expectedRoles = route.data['roles'] as Array<string>;

    return authService.userProfile$.pipe(
        take(1),
        map(user => {
            // 1. Check if user exists
            if (!user) {
                // Not logged in or no profile
                if (state.url !== '/admin/login') {
                    router.navigate(['/admin/login']);
                }
                return false;
            }

            // 2. Check Role
            if (!expectedRoles || expectedRoles.length === 0 || expectedRoles.includes(user.role)) {
                return true;
            }

            // 3. Unauthorized Role
            toast.error('You do not have permission to access this page.');
            router.navigate(['/admin/dashboard']);
            return false;
        })
    );
};
