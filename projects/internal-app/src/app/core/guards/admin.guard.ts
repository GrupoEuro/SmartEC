import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';
import { ToastService } from '../services/toast.service';

// Roles that are allowed to access the internal admin panel
const INTERNAL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'];

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const auth = inject(Auth);
  const toast = inject(ToastService);

  return authService.userProfile$.pipe(
    take(1),
    map(profile => {
      // 1. Not logged in
      if (!profile) {
        router.navigate(['/admin/login']);
        return false;
      }

      // 2. Logged in but is a customer (storefront user) — force sign out
      if (!INTERNAL_ROLES.includes(profile.role)) {
        toast.error('Access denied. This portal is for internal staff only.');
        signOut(auth).then(() => router.navigate(['/admin/login']));
        return false;
      }

      // 3. Account deactivated
      if (!profile.isActive) {
        toast.error('Your account has been deactivated. Contact an administrator.');
        signOut(auth).then(() => router.navigate(['/admin/login']));
        return false;
      }

      return true;
    })
  );
};
