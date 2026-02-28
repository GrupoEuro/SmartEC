import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
    constructor(private authService: AuthService, private router: Router) { }

    canActivate(route: any, state: any): boolean | UrlTree | Observable<boolean | UrlTree> | Promise<boolean | UrlTree> {
        return this.authService.user$.pipe(
            take(1),
            map(user => {
                const loggedIn = !!user;
                if (loggedIn) {
                    return true;
                }

                // Intelligent redirect: if accessing account, go to customer login
                if (state.url.startsWith('/account')) {
                    return this.router.createUrlTree(['/login']);
                }

                // Default to login
                return this.router.createUrlTree(['/login']);
            })
        );
    }
}
