import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { map, take, tap } from 'rxjs/operators';

export const commandCenterGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.userProfile$.pipe(
        take(1),
        map(user => {
            // Check if user is logged in
            if (!user) {
                console.log('Command Center: Not logged in - Redirecting to admin login');
                router.navigate(['/admin/login']);
                return false;
            }

            // Check if user has MANAGER or SUPER_ADMIN role
            const allowedRoles = ['SUPER_ADMIN', 'MANAGER'];
            if (allowedRoles.includes(user.role)) {
                return true;
            }

            // User doesn't have permission
            console.log('Command Center: Access denied - User role:', user.role);
            router.navigate(['/admin/dashboard']);
            return false;
        })
    );
};
