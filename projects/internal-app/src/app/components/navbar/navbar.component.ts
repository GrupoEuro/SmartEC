import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';
import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import { CountdownTimerComponent } from '../../shared/components/countdown-timer/countdown-timer.component';
import { SearchBarComponent } from '../../shared/components/search-bar/search-bar.component';

@Component({
    selector: 'app-navbar',
    standalone: true,
    imports: [TranslateModule, CommonModule, RouterLink, RouterModule, CountdownTimerComponent, SearchBarComponent],
    templateUrl: './navbar.component.html',
    styleUrl: './navbar.component.css'
})
export class NavbarComponent {
    languageService = inject(LanguageService);
    authService = inject(AuthService);
    cartService = inject(CartService);
    isMobileMenuOpen = false;
    isUserMenuOpen = false;

    toggleMobileMenu() {
        this.isMobileMenuOpen = !this.isMobileMenuOpen;
    }

    openCart() {
        this.cartService.openCart();
    }

    toggleLanguage() {
        this.languageService.toggleLanguage();
    }

    closeMobileMenu() {
        this.isMobileMenuOpen = false;
    }

    toggleUserMenu() {
        this.isUserMenuOpen = !this.isUserMenuOpen;
    }

    closeUserMenu() {
        this.isUserMenuOpen = false;
    }

    async login() {
        await this.authService.loginWithGoogle();
        this.closeMobileMenu();
    }

    async logout() {
        await this.authService.logout();
        this.closeUserMenu();
        this.closeMobileMenu();
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
