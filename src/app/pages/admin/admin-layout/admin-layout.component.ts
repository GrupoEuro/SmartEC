import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { HasRoleDirective } from '../../../core/directives/has-role.directive';

import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, HasRoleDirective, AppIconComponent],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css', '../admin-tables.css']
})
export class AdminLayoutComponent {
  authService = inject(AuthService);
  user$ = this.authService.user$;
  userProfile$ = this.authService.userProfile$;
  translate = inject(TranslateService);
  languageService = inject(LanguageService);

  // Sidebar state with persistence
  isSidebarCollapsed = localStorage.getItem('admin-sidebar-collapsed') === 'true';


  isUserMenuOpen = false;



  // Collapsible sections state
  sections = {
    ecommerce: this.getSectionState('ecommerce', true),
    content: this.getSectionState('content', true),
    business: this.getSectionState('business', true),
    system: this.getSectionState('system', true)
  };

  private getSectionState(section: string, defaultState: boolean): boolean {
    const saved = localStorage.getItem(`admin-section-${section}`);
    return saved !== null ? saved === 'true' : defaultState;
  }

  private saveSectionState(section: string, state: boolean): void {
    localStorage.setItem(`admin-section-${section}`, state.toString());
  }

  toggleSection(section: keyof typeof this.sections) {
    this.sections[section] = !this.sections[section];
    this.saveSectionState(section, this.sections[section]);
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    localStorage.setItem('admin-sidebar-collapsed', this.isSidebarCollapsed.toString());
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
}
