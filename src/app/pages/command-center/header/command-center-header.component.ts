import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-command-center-header',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TranslateModule,
        FormsModule,
        AppIconComponent,
        NotificationBellComponent
    ],
    templateUrl: './command-center-header.component.html',
    styleUrls: ['./command-center-header.component.css']
})
export class CommandCenterHeaderComponent implements OnInit {
    private router = inject(Router);
    authService = inject(AuthService);
    languageService = inject(LanguageService);
    contextService = inject(CommandCenterContextService);

    user$ = this.authService.user$;
    userProfile$ = this.authService.userProfile$;

    // UI State
    isUserMenuOpen = signal(false);
    isPeriodSelectorOpen = signal(false);
    breadcrumbs = signal<{ label: string, url: string }[]>([]);

    // Custom Date State
    customStart: string = '';
    customEnd: string = '';

    constructor() {
        // Track router changes for breadcrumbs
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe(() => {
            this.updateBreadcrumbs();
        });
    }

    ngOnInit() {
        this.updateBreadcrumbs();
    }

    private updateBreadcrumbs() {
        const url = this.router.url;
        const segments = url.split('/').filter(s => s);

        const crumbs = [{ label: 'Command Center', url: '/command-center/dashboard' }];

        // Map common paths to readable names
        const pathMap: { [key: string]: string } = {
            'dashboard': 'Dashboard',
            'financials': 'Financial Overview',
            'income-statement': 'Income Statement',
            'expenses': 'Expense Management',
            'customer-insights': 'Customer Insights',
            'sales-analytics': 'Sales Analytics',
            'inventory-analytics': 'Inventory Analytics',
            'operational-metrics': 'Operations',
            'approvals': 'Approvals'
        };

        // Build breadcrumbs (skip first 'command-center' segment usually)
        let accumulatedPath = '';
        segments.forEach(segment => {
            accumulatedPath += `/${segment}`;
            if (segment === 'command-center') return; // Already added root

            const label = pathMap[segment] || this.formatSegment(segment);
            crumbs.push({ label, url: accumulatedPath });
        });

        // Remove duplicates if any (simple check)
        const uniqueCrumbs = crumbs.filter((c, index, self) =>
            index === self.findIndex(t => t.url === c.url)
        );

        this.breadcrumbs.set(uniqueCrumbs);
    }

    private formatSegment(segment: string): string {
        return segment.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // Actions
    toggleLanguage() {
        this.languageService.toggleLanguage();
    }

    toggleUserMenu() {
        this.isUserMenuOpen.update(v => !v);
        this.isPeriodSelectorOpen.set(false);
    }

    togglePeriodSelector() {
        this.isPeriodSelectorOpen.update(v => !v);
        this.isUserMenuOpen.set(false);
    }

    selectPeriod(period: string) {
        this.contextService.setPeriod(period);
        this.isPeriodSelectorOpen.set(false);
    }

    logout() {
        this.authService.logout();
    }

    refreshData() {
        this.contextService.triggerRefresh();
    }

    getUserInitials(displayName: string | null | undefined): string {
        if (!displayName) return 'U';
        const names = displayName.split(' ');
        if (names.length >= 2) {
            return (names[0][0] + names[1][0]).toUpperCase();
        }
        return displayName[0].toUpperCase();
    }

    // Helper to get Year Label for custom option
    getYearLabel(yearKey: string): string {
        return yearKey; // simple pass-through used in template
    }

    onCustomDateChange(value: string, type: 'start' | 'end') {
        if (type === 'start') this.customStart = value;
        if (type === 'end') this.customEnd = value;

        if (this.customStart && this.customEnd) {
            const start = new Date(this.customStart);
            //Set end to end of day
            const end = new Date(this.customEnd);
            end.setHours(23, 59, 59, 999);

            if (start <= end) {
                this.contextService.setCustomRange(start, end);
            }
        }
    }
}
