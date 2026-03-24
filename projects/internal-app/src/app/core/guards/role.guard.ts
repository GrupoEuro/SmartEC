import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { ToastService } from '../services/toast.service';

export const roleGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const toast = inject(ToastService);
    const expectedRoles = route.data['roles'] as Array<string>;

    const checkProfile = (profile: any) => {
        if (!profile) {
            if (state.url !== '/admin/login') router.navigate(['/admin/login']);
            return false;
        }
        if (!expectedRoles || expectedRoles.length === 0 || expectedRoles.includes(profile.role)) {
            return true;
        }
        toast.error('You do not have permission to access this page.');
        router.navigate(['/admin/dashboard']);
        return false;
    };

    // Fast path: if signals are already populated
    const syncProfile = authService.currentProfile();
    if (syncProfile !== null) {
        return of(checkProfile(syncProfile));
    }

    // Async path: wait for Firebase Auth redirect to resolve first
    return authService.authReady$.pipe(
        switchMap(() => authService.userProfile$),
        map(profile => checkProfile(profile))
    );
};
