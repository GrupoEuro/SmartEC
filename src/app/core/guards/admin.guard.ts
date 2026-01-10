import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { map, take, tap } from 'rxjs/operators';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    take(1),
    map(user => !!user), // Check if user exists
    tap(loggedIn => {
      if (!loggedIn) {
        console.log('Access denied - Redirecting to login');
        router.navigate(['/admin/login']);
      }
    })
  );
};
