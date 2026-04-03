import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { UserProfile } from '../../../core/models/user.model';

interface Portal {
    id: string;
    title: string;
    route: string;
    roles: string[];
    icon: string;
    description: string;
    badge?: string;
}

import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-portal-launcher',
    standalone: true,
    imports: [CommonModule, AppIconComponent, TranslateModule],
    templateUrl: './portal-launcher.component.html',
    styleUrl: './portal-launcher.component.css'
})
export class PortalLauncherComponent implements OnInit {
    private auth = inject(AuthService);
    private router = inject(Router);
    public translate = inject(TranslateService);

    currentUser = signal<UserProfile | null>(null);
    availablePortals = signal<Portal[]>([]);
    loading = signal(true);

    // Portal Configuration
    // This defines the ecosystem of the application
    private readonly PORTALS: Portal[] = [
        {
            id: 'command-center',
            title: 'PORTAL.COMMAND_CENTER.TITLE',
            route: '/command-center',
            roles: ['SUPER_ADMIN', 'MANAGER'],
            icon: 'hub',
            description: 'PORTAL.COMMAND_CENTER.DESC'
        },
        {
            id: 'operations',
            title: 'PORTAL.OPERATIONS.TITLE',
            route: '/operations',
            roles: ['SUPER_ADMIN', 'OPERATIONS', 'MANAGER'],
            icon: 'inventory_2',
            description: 'PORTAL.OPERATIONS.DESC'
        },
        {
            id: 'admin',
            title: 'PORTAL.ADMIN_PANEL_CARD.TITLE',
            route: '/admin/dashboard',
            roles: ['SUPER_ADMIN', 'ADMIN'],
            icon: 'admin_panel_settings',
            description: 'PORTAL.ADMIN_PANEL_CARD.DESC'
        },
        {
            id: 'marketing',
            title: 'PORTAL.MARKETING.TITLE',
            route: '/marketing/dashboard',
            roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'MARKETING'],
            icon: 'bar_chart_4_bars',
            description: 'PORTAL.MARKETING.DESC',
            badge: 'NEW'
        },
        {
            id: 'help',
            title: 'PORTAL.HELP.TITLE',
            route: '/help',
            roles: ['SUPER_ADMIN', 'MANAGER', 'OPERATIONS', 'ADMIN', 'EDITOR'],
            icon: 'school',
            description: 'PORTAL.HELP.DESC'
        },
        {
            id: 'dev-tools',
            title: 'PORTAL.DEV_TOOLS.TITLE',
            route: '/dev-tools',
            roles: ['SUPER_ADMIN'],
            icon: 'terminal',
            description: 'PORTAL.DEV_TOOLS.DESC',
            badge: 'DEV'
        }
    ];

    async ngOnInit() {
        // 1. Get User Profile — use signal (set by handleLoginSuccess before navigation)
        let profile = this.auth.currentProfile();

        // Fallback: direct URL entry — wait for auth to settle then check signal
        if (!profile) {
            await firstValueFrom(this.auth.authReady$);
            profile = this.auth.currentProfile();
        }

        if (!profile) {
            this.router.navigate(['/admin/login']);
            return;
        }

        this.currentUser.set(profile);

        // 2. Filter Portals based on Role
        const userRole = profile.role;
        const allowedPortals = this.PORTALS.filter(portal =>
            portal.roles.includes(userRole)
        );

        this.availablePortals.set(allowedPortals);
        this.loading.set(false);

        // 3. Smart Redirect Logic
        if (allowedPortals.length === 1) {
            this.router.navigate([allowedPortals[0].route]);
        }

        if (allowedPortals.length === 0) {
        }
    }

    navigateTo(route: string) {
        this.router.navigate([route]);
    }

    switchLanguage(lang: string) {
        this.translate.use(lang);
    }

    logout() {
        this.auth.logout();
    }
}
