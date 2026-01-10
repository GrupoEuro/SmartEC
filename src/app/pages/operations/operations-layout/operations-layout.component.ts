import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { TranslateModule } from '@ngx-translate/core';

import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-operations-layout',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent],
    templateUrl: './operations-layout.component.html',
    styleUrls: ['./operations-layout.component.css']
})
export class OperationsLayoutComponent {
    isSidebarCollapsed = signal(false);
    isUserMenuOpen = false;

    user$ = this.authService.user$;
    userProfile$ = this.authService.userProfile$;

    // Reorganized sections - Fulfillment & Inventory focused
    sections = {
        fulfillment: true,   // Order Fulfillment (expanded by default)
        inventory: true,     // Inventory Control (expanded by default)
        warehouse: false,    // Warehouse Management
        customers: false,    // Customer Management
        procurement: false,  // Procurement & Suppliers
        promotions: false    // Promotions & Coupons
    };

    constructor(
        public authService: AuthService,
        public languageService: LanguageService,
        private router: Router
    ) { }

    toggleSidebar() {
        this.isSidebarCollapsed.update(val => !val);
    }

    toggleSection(section: keyof typeof this.sections) {
        this.sections[section] = !this.sections[section];
    }

    toggleUserMenu() {
        this.isUserMenuOpen = !this.isUserMenuOpen;
    }

    toggleLanguage() {
        const newLang = this.languageService.currentLang() === 'es' ? 'en' : 'es';
        this.languageService.setLanguage(newLang);
    }

    getUserInitials(name: string | null | undefined): string {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    logout() {
        this.authService.logout().then(() => {
            this.router.navigate(['/']);
        });
    }
}
