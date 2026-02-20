import { Component, inject, signal, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../atoms/app-icon/app-icon.component';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';
import { LanguageService } from '@lib/core';

@Component({
    selector: 'app-global-admin-header',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TranslateModule,
        AppIconComponent,
        NotificationBellComponent
    ],
    templateUrl: './global-admin-header.component.html',
    styleUrls: ['./global-admin-header.component.css']
})
export class GlobalAdminHeaderComponent {
    languageService = inject(LanguageService);

    @Input() user: any | null = null;
    @Output() onLogout = new EventEmitter<void>();

    isUserMenuOpen = signal(false);

    toggleLanguage() {
        this.languageService.toggleLanguage();
    }

    toggleUserMenu() {
        this.isUserMenuOpen.update(v => !v);
    }

    logout() {
        this.onLogout.emit();
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
