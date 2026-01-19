import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
            title: 'PORTAL.ADMIN.TITLE',
            route: '/admin/dashboard',
            roles: ['SUPER_ADMIN', 'ADMIN'],
            icon: 'admin_panel_settings',
            description: 'PORTAL.ADMIN.DESC'
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
        // 1. Get User Profile
        const profile = await this.auth.getCurrentUser();

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
        // If user only has ONE portal (and it's not just "Help"), auto-redirect.
        // We typically don't want to trap them in Help, but if that's all they have, so be it.
        // Refinement: If they have exactly 1 portal, go there.

        // EXCEPTION: Super Admins or multi-role users might want the choice.
        // But if length is 1, they have no choice.
        if (allowedPortals.length === 1) {
            console.log(`Portal Launcher: Auto-redirecting to ${allowedPortals[0].title}`);
            this.router.navigate([allowedPortals[0].route]);
        }

        // 3b. If NO portals? (Shouldn't happen if Role checks work, but safety net)
        if (allowedPortals.length === 0) {
            // Maybe show a "Contact Admin" state or redirect home
            console.warn('Portal Launcher: No portals available for this role.');
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
