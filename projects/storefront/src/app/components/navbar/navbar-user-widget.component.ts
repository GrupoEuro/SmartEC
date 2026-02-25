import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';

@Component({
    selector: 'app-navbar-user-widget',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    styleUrls: ['./navbar.component.css'],
    template: `
    @if (authService.user$ | async; as user) {
        @if (!isMobile) {
            <div class="user-menu-container">
                <button class="user-avatar" (click)="toggleUserMenu()" [title]="user.displayName || user.email || ''">
                    @if (user.photoURL) {
                    <img [src]="user.photoURL" [alt]="user.displayName || 'User'">
                    } @else {
                    <span class="user-initials">{{ getUserInitials(user.displayName) }}</span>
                    }
                </button>
                @if (isUserMenuOpen) {
                <div class="user-dropdown">
                    <div class="user-info">
                        <div class="user-name">{{ user.displayName || 'User' }}</div>
                        <div class="user-email">{{ user.email }}</div>
                    </div>
                    <div class="dropdown-divider"></div>
                    <a [routerLink]="['/admin/dashboard']" (click)="onNavigated()" class="dropdown-item">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dropdown-icon"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> {{ 'PORTAL.ADMIN.TITLE' | translate }}
                    </a>
                    <button (click)="logout()" class="dropdown-item logout-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dropdown-icon"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> {{ 'PORTAL.LOGOUT' | translate }}
                    </button>
                </div>
                }
            </div>
        } @else {
            <div class="mobile-user-section">
                <div class="mobile-user-info">
                    @if (user.photoURL) {
                    <img [src]="user.photoURL" [alt]="user.displayName || 'User'" class="mobile-user-avatar">
                    } @else {
                    <div class="mobile-user-avatar">{{ getUserInitials(user.displayName) }}</div>
                    }
                    <div>
                        <div class="mobile-user-name">{{ user.displayName || 'User' }}</div>
                        <div class="mobile-user-email">{{ user.email }}</div>
                    </div>
                </div>
                <a [routerLink]="['/admin/dashboard']" (click)="onNavigated()" class="mobile-menu-item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dropdown-icon"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Admin Panel
                </a>
                <button (click)="logout()" class="mobile-logout-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dropdown-icon" style="vertical-align: middle; margin-right: 6px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> {{ 'PORTAL.LOGOUT' | translate }}
                </button>
            </div>
        }
    } @else {
        @if (!isMobile) {
            <button (click)="login()" class="login-btn">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Login
            </button>
        } @else {
            <button (click)="login()" class="mobile-login-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Login
            </button>
        }
    }
  `
})
export class NavbarUserWidgetComponent {
    authService = inject(AuthService);
    router = inject(Router);

    @Input() isMobile = false;
    @Output() navigated = new EventEmitter<void>();

    isUserMenuOpen = false;

    toggleUserMenu() {
        this.isUserMenuOpen = !this.isUserMenuOpen;
    }

    closeUserMenu() {
        this.isUserMenuOpen = false;
    }

    onNavigated() {
        this.closeUserMenu();
        this.navigated.emit();
    }

    login() {
        this.router.navigate(['/login']);
        this.onNavigated();
    }

    async logout() {
        await this.authService.logout();
        this.onNavigated();
    }

    getUserInitials(displayName: string | null): string {
        if (!displayName) return 'U';
        const names = displayName.split(' ');
        if (names.length >= 2) {
            return (names[0][0] + names[1][0]).toUpperCase();
        }
        return displayName[0].toUpperCase();
    }
}
