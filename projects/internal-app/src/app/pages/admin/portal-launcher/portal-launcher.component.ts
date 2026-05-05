import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { Firestore, collection, query, where, onSnapshot } from '@angular/fire/firestore';
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
export class PortalLauncherComponent implements OnInit, OnDestroy {
    private auth      = inject(AuthService);
    private router    = inject(Router);
    private firestore = inject(Firestore);
    public translate  = inject(TranslateService);

    currentUser      = signal<UserProfile | null>(null);
    availablePortals = signal<Portal[]>([]);
    loading          = signal(true);

    /** Live count of conversations with unread messages */
    inboxUnread = signal(0);
    private unreadUnsub: (() => void) | null = null;

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
            icon: 'megaphone',
            description: 'PORTAL.MARKETING.DESC',
            badge: 'NEW'
        },
        {
            id: 'customer-care',
            title: 'Atención al Cliente',
            route: '/customer-care/inbox',
            roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'],
            icon: 'support_agent',
            description: 'Inbox unificado: WhatsApp, Instagram, Facebook, Telegram y Email.',
            badge: 'LIVE'
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

        // 4. Live inbox unread counter (only if customer-care portal is available)
        if (allowedPortals.some(p => p.id === 'customer-care')) {
            this.listenInboxUnread();
        }
    }

    ngOnDestroy() {
        this.unreadUnsub?.();
    }

    private listenInboxUnread() {
        const q = query(
            collection(this.firestore, 'customer_conversations'),
            where('unreadCount', '>', 0)
        );
        this.unreadUnsub = onSnapshot(q,
            snap => this.inboxUnread.set(snap.size),
            ()   => this.inboxUnread.set(0)
        );
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
