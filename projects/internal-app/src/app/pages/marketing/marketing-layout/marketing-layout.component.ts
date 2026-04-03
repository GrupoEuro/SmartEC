import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { MARKETING_NAVIGATION_CONFIG } from '../../../core/config/marketing-navigation.config';

@Component({
    selector: 'app-marketing-layout',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent],
    templateUrl: './marketing-layout.component.html',
    styleUrls: ['./marketing-layout.component.css'],
})
export class MarketingLayoutComponent {
    isSidebarCollapsed = signal(false);
    isUserMenuOpen     = false;
    isLangMenuOpen     = false;

    user$         = this.authService.user$;
    userProfile$  = this.authService.userProfile$;

    navigationItems = MARKETING_NAVIGATION_CONFIG;
    expandedSections = new Set<string>();

    private readonly STORAGE_COLLAPSED = 'mh-sidebar-collapsed';
    private readonly STORAGE_SECTIONS  = 'mh-expanded-sections';

    constructor(
        public authService:    AuthService,
        public languageService: LanguageService,
        private router:        Router,
    ) {
        this.initSidebarState();
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────

    private initSidebarState() {
        const collapsed = localStorage.getItem(this.STORAGE_COLLAPSED);
        if (collapsed) this.isSidebarCollapsed.set(collapsed === 'true');

        try {
            const saved = localStorage.getItem(this.STORAGE_SECTIONS);
            if (saved) {
                this.expandedSections = new Set(JSON.parse(saved));
            } else {
                // Default: expand all sections
                this.navigationItems.forEach(item => {
                    if (item.children) this.expandedSections.add(item.id);
                });
            }
        } catch { /* noop */ }
    }

    isExpanded(id: string): boolean { return this.expandedSections.has(id); }

    toggleSection(id: string) {
        if (this.expandedSections.has(id)) {
            this.expandedSections.delete(id);
        } else {
            this.expandedSections.add(id);
        }
        localStorage.setItem(this.STORAGE_SECTIONS, JSON.stringify(Array.from(this.expandedSections)));
    }

    toggleSidebar() {
        this.isSidebarCollapsed.update(v => {
            const next = !v;
            localStorage.setItem(this.STORAGE_COLLAPSED, String(next));
            return next;
        });
    }

    // ── Header ────────────────────────────────────────────────────────────────

    toggleUserMenu()  { this.isUserMenuOpen = !this.isUserMenuOpen; }
    closeUserMenu()   { this.isUserMenuOpen = false; }

    setLanguage(lang: 'en' | 'es') {
        this.languageService.setLanguage(lang);
        this.isLangMenuOpen = false;
    }

    async logout() { await this.authService.logout(); }

    /** Convert Tailwind bg-* class to a raw CSS colour for inline [style.background] */
    badgeBg(colorClass: string = 'bg-indigo-600'): string {
        const map: Record<string, string> = {
            'bg-indigo-600':  '#4f46e5',
            'bg-purple-600':  '#7c3aed',
            'bg-emerald-500': '#10b981',
            'bg-blue-500':    '#3b82f6',
            'bg-orange-500':  '#f97316',
            'bg-zinc-600':    '#52525b',
            'bg-red-600':     '#dc2626',
            'bg-amber-500':   '#f59e0b',
        };
        return map[colorClass] ?? '#4f46e5';
    }
}
