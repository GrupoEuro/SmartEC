import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CUSTOMER_CARE_NAVIGATION_CONFIG } from '../../../core/config/customer-care-navigation.config';

@Component({
    selector: 'app-customer-care-layout',
    standalone: true,
    imports: [CommonModule, RouterModule, AppIconComponent],
    template: `
<div class="cc-layout">

    <!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
    <aside class="cc-sidebar" [class.collapsed]="isSidebarCollapsed()">

        <!-- Brand -->
        <div class="cc-sidebar-header">
            <div class="cc-brand">
                <div class="cc-brand-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                </div>
                <div class="cc-brand-text" [class.hidden]="isSidebarCollapsed()">
                    <span class="cc-brand-name">Atención al Cliente</span>
                    <span class="cc-brand-sub">Universal Inbox</span>
                </div>
            </div>
            <button class="cc-toggle-btn" (click)="toggleSidebar()">
                <app-icon [name]="isSidebarCollapsed() ? 'menu' : 'arrow-left'" [size]="18"></app-icon>
            </button>
        </div>

        <!-- Navigation -->
        <nav class="cc-nav">
            <ng-container *ngFor="let item of navigationItems">

                <!-- Single item -->
                <div *ngIf="!item.children" class="cc-nav-single">
                    <a [routerLink]="item.route"
                       [queryParams]="item.queryParams || {}"
                       routerLinkActive="cc-nav-active"
                       class="cc-nav-item"
                       [title]="isSidebarCollapsed() ? item.title : ''">
                        <app-icon [name]="item.icon" [size]="19" class="cc-nav-icon"></app-icon>
                        <span class="cc-nav-label" [class.hidden]="isSidebarCollapsed()">{{ item.title }}</span>
                        <span *ngIf="item.badge && !isSidebarCollapsed()"
                              class="cc-badge" [style.background]="badgeBg(item.badge.color)">
                            {{ item.badge.text }}
                        </span>
                    </a>
                </div>

                <!-- Section with children -->
                <div *ngIf="item.children" class="cc-nav-section">
                    <button class="cc-section-header" (click)="toggleSection(item.id)"
                            [title]="isSidebarCollapsed() ? item.title : ''">
                        <app-icon *ngIf="isSidebarCollapsed()" [name]="item.icon" [size]="20" class="cc-section-icon-collapsed"></app-icon>
                        <span [class.hidden]="isSidebarCollapsed()">{{ item.title }}</span>
                        <app-icon *ngIf="!isSidebarCollapsed()"
                                  [name]="isExpanded(item.id) ? 'chevron-down' : 'chevron-right'"
                                  [size]="13" class="cc-chevron">
                        </app-icon>
                    </button>

                    <div class="cc-section-items"
                         [class.expanded]="isExpanded(item.id)"
                         [class.hidden]="isSidebarCollapsed() && !isExpanded(item.id)">
                        <ng-container *ngFor="let child of item.children">
                            <a [routerLink]="child.route"
                               [queryParams]="child.queryParams || {}"
                               routerLinkActive="cc-nav-active"
                               class="cc-nav-item cc-nav-child"
                               [title]="isSidebarCollapsed() ? child.title : ''">
                                <app-icon [name]="child.icon" [size]="17" class="cc-nav-icon"></app-icon>
                                <span class="cc-nav-label" [class.hidden]="isSidebarCollapsed()">{{ child.title }}</span>
                                <span *ngIf="child.badge && !isSidebarCollapsed()"
                                      class="cc-badge" [style.background]="badgeBg(child.badge.color)">
                                    {{ child.badge.text }}
                                </span>
                            </a>
                        </ng-container>
                    </div>
                </div>

            </ng-container>
        </nav>

        <!-- Footer -->
        <div class="cc-sidebar-footer">
            @if (user$ | async; as user) {
                <div class="cc-user-row">
                    <div class="cc-avatar-sm">
                        @if (user.photoURL) {
                            <img [src]="user.photoURL" [alt]="user.displayName || ''">
                        } @else {
                            <app-icon name="user" [size]="16"></app-icon>
                        }
                    </div>
                    <div class="cc-user-info" [class.hidden]="isSidebarCollapsed()">
                        <span class="cc-user-name">{{ (userProfile$ | async)?.displayName || user.displayName || 'User' }}</span>
                        <span class="cc-user-email">{{ user.email }}</span>
                    </div>
                </div>
            }
            <button class="cc-logout-btn" (click)="logout()">
                <app-icon name="log-out" [size]="17"></app-icon>
                <span [class.hidden]="isSidebarCollapsed()">Cerrar sesión</span>
            </button>
        </div>
    </aside>

    <!-- ── Main ──────────────────────────────────────────────────────────────── -->
    <main class="cc-main" [class.expanded]="isSidebarCollapsed()">
        <header class="cc-topbar">
            <div class="cc-topbar-spacer"></div>
            <div class="cc-topbar-actions">
                @if (user$ | async; as user) {
                    <button class="cc-avatar-btn" (click)="isUserMenuOpen = !isUserMenuOpen">
                        @if (user.photoURL) {
                            <img [src]="user.photoURL" [alt]="user.displayName || ''">
                        } @else {
                            <div class="cc-avatar-placeholder">
                                <app-icon name="user" [size]="16"></app-icon>
                            </div>
                        }
                    </button>
                    @if (isUserMenuOpen) {
                        <div class="cc-user-dropdown">
                            <div class="dd-header">
                                <span class="dd-name">{{ (userProfile$ | async)?.displayName || user.displayName || 'User' }}</span>
                                <span class="dd-email">{{ user.email }}</span>
                            </div>
                            <div class="dd-divider"></div>
                            <a routerLink="/portal" class="dd-item" (click)="isUserMenuOpen=false">
                                <app-icon name="layout-dashboard" [size]="15"></app-icon>
                                Portal principal
                            </a>
                            <div class="dd-divider"></div>
                            <button class="dd-item dd-danger" (click)="logout()">
                                <app-icon name="log-out" [size]="15"></app-icon>
                                Cerrar sesión
                            </button>
                        </div>
                    }
                }
            </div>
        </header>
        <div class="cc-content">
            <router-outlet></router-outlet>
        </div>
    </main>

</div>
    `,
    styles: [`
        :host {
            --cc-accent:       #10b981;   /* emerald — customer care green */
            --cc-accent-light: #6ee7b7;
            --cc-accent-glow:  rgba(16, 185, 129, .15);
            --cc-sidebar-w:    252px;
            --cc-sidebar-collapsed-w: 62px;
            --cc-topbar-h:     56px;
            --cc-bg:           #0f172a; /* slate-900 */
            --cc-surface:      #1e293b; /* slate-800 */
            --cc-sidebar-bg:   #020617; /* slate-950 */
            --cc-border:       #334155; /* slate-700 */
            --cc-text:         #f8fafc; /* slate-50 */
            --cc-text-dim:     #94a3b8; /* slate-400 */
            --cc-transition:   .25s cubic-bezier(.4,0,.2,1);
        }

        .cc-layout { display: flex; min-height: 100vh; background: var(--cc-bg); font-family: 'Inter', system-ui, sans-serif; }

        /* Sidebar */
        .cc-sidebar {
            width: var(--cc-sidebar-w); flex-shrink: 0;
            position: fixed; top: 0; left: 0; height: 100vh;
            display: flex; flex-direction: column;
            background: var(--cc-sidebar-bg);
            border-right: 1px solid var(--cc-border);
            overflow: hidden; z-index: 1000;
            transition: width var(--cc-transition);
            box-shadow: 4px 0 24px rgba(0,0,0,.4);
        }
        .cc-sidebar.collapsed { width: var(--cc-sidebar-collapsed-w); }

        .cc-sidebar-header {
            padding: 1rem .875rem;
            border-bottom: 1px solid var(--cc-border);
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0;
            background: linear-gradient(135deg, rgba(16,185,129,.08) 0%, transparent 100%);
        }
        .cc-brand { display: flex; align-items: center; gap: .75rem; overflow: hidden; }
        .cc-brand-icon {
            width: 34px; height: 34px; border-radius: 10px;
            background: var(--cc-accent-glow);
            border: 1px solid rgba(16,185,129,.3);
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0; color: var(--cc-accent-light);
        }
        .cc-brand-icon svg { width: 17px; height: 17px; }
        .cc-brand-text { display: flex; flex-direction: column; gap: .05rem; overflow: hidden; }
        .cc-brand-name { font-size: .88rem; font-weight: 800; color: var(--cc-text); white-space: nowrap; letter-spacing: -.01em; }
        .cc-brand-sub { font-size: .62rem; color: var(--cc-accent-light); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; opacity: .8; }
        .cc-toggle-btn { background: transparent; border: none; cursor: pointer; padding: 6px; border-radius: 7px; color: var(--cc-text-dim); transition: all .2s; display: flex; align-items: center; flex-shrink: 0; }
        .cc-toggle-btn:hover { color: var(--cc-text); background: rgba(255,255,255,.06); }

        /* Nav */
        .cc-nav { flex: 1; overflow-y: auto; padding: 1rem .75rem; display: flex; flex-direction: column; gap: .125rem; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.06) transparent; }
        .cc-nav-single { margin-bottom: .125rem; }
        .cc-nav-item { display: flex; align-items: center; gap: .65rem; padding: .55rem .75rem; border-radius: 9px; color: var(--cc-text-dim); text-decoration: none; font-size: .85rem; font-weight: 500; transition: all .18s; white-space: nowrap; cursor: pointer; }
        .cc-nav-item:hover { color: var(--cc-text); background: rgba(255,255,255,.05); }
        .cc-nav-child { margin-left: .5rem; }
        .cc-nav-active { color: var(--cc-accent-light) !important; background: var(--cc-accent-glow) !important; border-left: 2.5px solid var(--cc-accent); }
        .cc-nav-icon { flex-shrink: 0; transition: color .18s; }
        .cc-nav-item:hover .cc-nav-icon { color: var(--cc-accent-light); }
        .cc-nav-active .cc-nav-icon { color: var(--cc-accent-light); }
        .cc-nav-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .cc-badge { margin-left: auto; font-size: .6rem; font-weight: 700; padding: .15rem .4rem; border-radius: 4px; color: #fff; flex-shrink: 0; letter-spacing: .03em; }

        .cc-nav-section { margin-bottom: .25rem; }
        .cc-section-header { width: 100%; display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; background: transparent; border: none; cursor: pointer; color: var(--cc-text-dim); font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; transition: color .18s; }
        .cc-section-header:hover { color: var(--cc-text); }
        .cc-section-header span { flex: 1; text-align: left; }
        .cc-chevron { opacity: .5; flex-shrink: 0; }
        .cc-section-icon-collapsed { color: var(--cc-text-dim); }
        .cc-section-items { max-height: 0; overflow: hidden; transition: max-height var(--cc-transition); }
        .cc-section-items.expanded { max-height: 500px; }

        /* Footer */
        .cc-sidebar-footer { border-top: 1px solid var(--cc-border); padding: .875rem; flex-shrink: 0; display: flex; flex-direction: column; gap: .5rem; }
        .cc-user-row { display: flex; align-items: center; gap: .65rem; padding: .35rem .5rem; border-radius: 8px; overflow: hidden; }
        .cc-avatar-sm { width: 30px; height: 30px; border-radius: 50%; background: var(--cc-accent-glow); border: 1px solid rgba(16,185,129,.3); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; color: var(--cc-accent-light); }
        .cc-avatar-sm img { width: 100%; height: 100%; object-fit: cover; }
        .cc-user-info { display: flex; flex-direction: column; gap: .05rem; overflow: hidden; }
        .cc-user-name { font-size: .78rem; font-weight: 600; color: var(--cc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cc-user-email { font-size: .65rem; color: var(--cc-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cc-logout-btn { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-radius: 8px; background: transparent; border: none; cursor: pointer; color: var(--cc-text-dim); font-size: .82rem; font-weight: 500; width: 100%; transition: all .18s; }
        .cc-logout-btn:hover { color: #f87171; background: rgba(248,113,113,.08); }

        /* Main */
        .cc-main { margin-left: var(--cc-sidebar-w); flex: 1; display: flex; flex-direction: column; min-height: 100vh; transition: margin-left var(--cc-transition); background: var(--cc-bg); }
        .cc-main.expanded { margin-left: var(--cc-sidebar-collapsed-w); }
        .cc-topbar { height: var(--cc-topbar-h); background: rgba(2,6,23,.85); backdrop-filter: blur(12px); border-bottom: 1px solid var(--cc-border); display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem; position: sticky; top: 0; z-index: 100; flex-shrink: 0; }
        .cc-topbar-spacer { flex: 1; }
        .cc-topbar-actions { display: flex; align-items: center; gap: .75rem; position: relative; }
        .cc-avatar-btn { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid rgba(16,185,129,.4); background: var(--cc-accent-glow); overflow: hidden; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; transition: border-color .2s; }
        .cc-avatar-btn:hover { border-color: var(--cc-accent); }
        .cc-avatar-btn img { width: 100%; height: 100%; object-fit: cover; }
        .cc-avatar-placeholder { color: var(--cc-accent-light); display: flex; }
        .cc-user-dropdown { position: absolute; top: calc(100% + 8px); right: 0; min-width: 220px; background: #18181b; border: 1px solid var(--cc-border); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.6); overflow: hidden; z-index: 300; }
        .dd-header { padding: .9rem 1rem; display: flex; flex-direction: column; gap: .2rem; }
        .dd-name { font-size: .85rem; font-weight: 700; color: var(--cc-text); }
        .dd-email { font-size: .72rem; color: var(--cc-text-dim); }
        .dd-divider { height: 1px; background: var(--cc-border); }
        .dd-item { display: flex; align-items: center; gap: .6rem; padding: .65rem 1rem; background: transparent; border: none; text-decoration: none; font-size: .82rem; color: var(--cc-text-dim); cursor: pointer; transition: all .18s; width: 100%; }
        .dd-item:hover { background: rgba(255,255,255,.04); color: var(--cc-text); }
        .dd-danger:hover { background: rgba(248,113,113,.08); color: #f87171; }
        .cc-content { flex: 1; overflow: hidden; }

        .hidden { display: none !important; }
        @media (max-width: 768px) { .cc-sidebar { width: var(--cc-sidebar-collapsed-w); } .cc-main { margin-left: var(--cc-sidebar-collapsed-w); } }
        .cc-nav::-webkit-scrollbar { width: 4px; }
        .cc-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
    `]
})
export class CustomerCareLayoutComponent {
    isSidebarCollapsed = signal(false);
    isUserMenuOpen     = false;

    user$        = inject(AuthService).user$;
    userProfile$ = inject(AuthService).userProfile$;

    navigationItems = CUSTOMER_CARE_NAVIGATION_CONFIG;
    expandedSections = new Set<string>();

    private readonly STORAGE_COLLAPSED = 'cc-sidebar-collapsed';
    private readonly STORAGE_SECTIONS  = 'cc-expanded-sections';

    constructor(
        public authService:    AuthService,
        public languageService: LanguageService,
        private router:        Router,
    ) {
        const collapsed = localStorage.getItem(this.STORAGE_COLLAPSED);
        if (collapsed) this.isSidebarCollapsed.set(collapsed === 'true');
        try {
            const saved = localStorage.getItem(this.STORAGE_SECTIONS);
            if (saved) {
                this.expandedSections = new Set(JSON.parse(saved));
            } else {
                this.navigationItems.forEach(item => {
                    if (item.children) this.expandedSections.add(item.id);
                });
            }
        } catch { /* noop */ }
    }

    isExpanded(id: string): boolean { return this.expandedSections.has(id); }

    toggleSection(id: string) {
        if (this.expandedSections.has(id)) this.expandedSections.delete(id);
        else this.expandedSections.add(id);
        localStorage.setItem(this.STORAGE_SECTIONS, JSON.stringify(Array.from(this.expandedSections)));
    }

    toggleSidebar() {
        this.isSidebarCollapsed.update(v => {
            const next = !v;
            localStorage.setItem(this.STORAGE_COLLAPSED, String(next));
            return next;
        });
    }

    badgeBg(colorClass: string = 'bg-emerald-500'): string {
        const map: Record<string, string> = {
            'bg-emerald-500': '#10b981',
            'bg-purple-600':  '#7c3aed',
            'bg-blue-500':    '#3b82f6',
            'bg-sky-500':     '#0ea5e9',
            'bg-indigo-600':  '#4f46e5',
            'bg-amber-500':   '#f59e0b',
        };
        return map[colorClass] ?? '#10b981';
    }

    async logout() { await this.authService.logout(); }
}
