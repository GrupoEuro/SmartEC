import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { TranslateModule } from '@ngx-translate/core';

import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { OPERATIONS_NAVIGATION_CONFIG } from '../../../core/config/operations-navigation.config';

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

    // Source of Truth
    navigationItems = OPERATIONS_NAVIGATION_CONFIG;
    expandedSections = new Set<string>();

    constructor(
        public authService: AuthService,
        public languageService: LanguageService,
        private router: Router
    ) {
        this.initSidebarState();
    }

    private initSidebarState() {
        // Restore sidebar collapse state
        const collapsedState = localStorage.getItem('ops-sidebar-collapsed');
        if (collapsedState) {
            this.isSidebarCollapsed.set(collapsedState === 'true');
        }

        // Restore expanded sections
        try {
            const savedSections = localStorage.getItem('ops-expanded-sections');
            if (savedSections) {
                this.expandedSections = new Set(JSON.parse(savedSections));
            } else {
                // Default: Expand all for operations
                this.navigationItems.forEach(item => {
                    if (item.children) {
                        this.expandedSections.add(item.id);
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to parse sidebar state', e);
        }
    }

    isExpanded(itemId: string): boolean {
        return this.expandedSections.has(itemId);
    }

    toggleSection(itemId: string) {
        if (this.expandedSections.has(itemId)) {
            this.expandedSections.delete(itemId);
        } else {
            this.expandedSections.add(itemId);
        }
        this.saveState();
    }

    toggleSidebar() {
        this.isSidebarCollapsed.update(val => {
            const newState = !val;
            localStorage.setItem('ops-sidebar-collapsed', newState.toString());
            return newState;
        });
    }

    private saveState() {
        localStorage.setItem('ops-expanded-sections', JSON.stringify(Array.from(this.expandedSections)));
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
