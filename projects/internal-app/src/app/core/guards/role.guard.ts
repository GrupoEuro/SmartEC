import { inject } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, switchMap, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { ToastService } from '../services/toast.service';

export const roleGuard: CanActivateFn = (route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const toast = inject(ToastService);
    const expectedRoles = route.data['roles'] as Array<string>;

    const checkProfile = (profile: any) => {
        console.log('[AUTH-DEBUG] roleGuard.checkProfile: profile=', profile?.email, 'role=', profile?.role, 'expectedRoles=', expectedRoles);
        if (!profile) {
            console.warn('[AUTH-DEBUG] roleGuard: profile is NULL → navigating to /admin/login');
            if (state.url !== '/admin/login') router.navigate(['/admin/login']);
            return false;
        }
        if (!expectedRoles || expectedRoles.length === 0 || expectedRoles.includes(profile.role)) {
            console.log('[AUTH-DEBUG] roleGuard: ALLOWED ✓');
            return true;
        }
        console.warn('[AUTH-DEBUG] roleGuard: role', profile.role, 'not in expectedRoles → /admin/dashboard');
        toast.error('You do not have permission to access this page.');
        router.navigate(['/admin/dashboard']);
        return false;
    };

    // Fast path: if signals are already populated
    const syncProfile = authService.currentProfile();
    console.log('[AUTH-DEBUG] roleGuard FAST-PATH check: currentProfile() =', syncProfile?.email ?? 'NULL');
    if (syncProfile !== null) {
        console.log('[AUTH-DEBUG] roleGuard: taking FAST PATH (signal populated)');
        return of(checkProfile(syncProfile));
    }

    // Async path: wait for Firebase Auth redirect to resolve first
    console.log('[AUTH-DEBUG] roleGuard: FAST PATH empty → waiting for authReady$...');
    return authService.authReady$.pipe(
        tap(() => console.log('[AUTH-DEBUG] roleGuard: authReady$ fired, subscribing to userProfile$...')),
        switchMap(() => authService.userProfile$),
        tap(p => console.log('[AUTH-DEBUG] roleGuard: userProfile$ emitted:', p?.email ?? 'NULL')),
        map(profile => checkProfile(profile))
    );
};
