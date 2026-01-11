import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { HasRoleDirective } from '../../../core/directives/has-role.directive';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ADMIN_NAVIGATION, NavItem } from '../../../core/config/admin-navigation.config';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, HasRoleDirective, AppIconComponent],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css', '../admin-tables.css']
})
export class AdminLayoutComponent {
  adminVersion = 'v1.6.0-stable';

  authService = inject(AuthService);
  user$ = this.authService.user$;
  userProfile$ = this.authService.userProfile$;
  translate = inject(TranslateService);
  languageService = inject(LanguageService);

  // The Source of Truth for Navigation
  navigationItems = ADMIN_NAVIGATION;

  // State for expanded sections (persisted to localStorage)
  expandedSections = new Set<string>();

  isSidebarCollapsed = false;
  isUserMenuOpen = false;

  constructor() {
    this.initSidebarState();
  }

  private initSidebarState() {
    // Restore sidebar collapse state
    this.isSidebarCollapsed = localStorage.getItem('admin-sidebar-collapsed') === 'true';

    // Restore expanded sections
    try {
      const savedSections = localStorage.getItem('admin-expanded-sections');
      if (savedSections) {
        this.expandedSections = new Set(JSON.parse(savedSections));
      } else {
        // Default: Expand all sections initially for better discoverability
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
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    localStorage.setItem('admin-sidebar-collapsed', this.isSidebarCollapsed.toString());
  }

  private saveState() {
    localStorage.setItem('admin-expanded-sections', JSON.stringify(Array.from(this.expandedSections)));
  }

  toggleUserMenu() {
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  closeUserMenu() {
    this.isUserMenuOpen = false;
  }

  toggleLanguage() {
    this.languageService.toggleLanguage();
  }

  logout() {
    this.authService.logout();
  }

  getUserInitials(displayName: string | null | undefined): string {
    if (!displayName) return 'U';
    const names = displayName.split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[1][0]).toUpperCase();
    }
    return displayName[0].toUpperCase();
  }

  hasRole(requiredRoles?: string[]): boolean {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const profile = this.authService.currentProfile(); // Signal access
    if (!profile) return false;
    return requiredRoles.includes(profile.role);
  }
}
