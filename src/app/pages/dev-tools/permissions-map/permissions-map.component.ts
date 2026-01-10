import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface PermissionRow {
    route: string;
    description: string;
    guard: string;
    roles: Record<string, 'ALLOWED' | 'DENIED' | 'WARNING'>;
    risk?: 'HIGH' | 'MEDIUM' | 'LOW';
}

@Component({
    selector: 'app-permissions-map',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    templateUrl: './permissions-map.component.html',
    styleUrls: ['./permissions-map.component.css']
})
export class PermissionsMapComponent {

    roles = ['SUPER_ADMIN', 'MANAGER', 'ADMIN', 'OPERATIONS', 'EDITOR', 'CUSTOMER'];

    matrix: PermissionRow[] = [
        {
            route: '/admin',
            description: 'Admin Portal Root',
            guard: 'adminGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'ALLOWED',
                'ADMIN': 'ALLOWED',
                'OPERATIONS': 'ALLOWED',
                'EDITOR': 'ALLOWED',
                'CUSTOMER': 'WARNING' // Because it only checks if logged in!
            },
            risk: 'HIGH'
        },
        {
            route: '/admin/users',
            description: 'User Management',
            guard: 'roleGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'DENIED',
                'ADMIN': 'DENIED',
                'OPERATIONS': 'DENIED',
                'EDITOR': 'DENIED',
                'CUSTOMER': 'DENIED'
            }
        },
        {
            route: '/admin/settings',
            description: 'System Settings',
            guard: 'roleGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'DENIED',
                'ADMIN': 'DENIED',
                'OPERATIONS': 'DENIED',
                'EDITOR': 'DENIED',
                'CUSTOMER': 'DENIED'
            }
        },
        {
            route: '/operations',
            description: 'Operations Portal',
            guard: 'operationsGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'DENIED',
                'ADMIN': 'ALLOWED',
                'OPERATIONS': 'ALLOWED',
                'EDITOR': 'DENIED',
                'CUSTOMER': 'DENIED'
            }
        },
        {
            route: '/command-center',
            description: 'Command Center',
            guard: 'commandCenterGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'ALLOWED',
                'ADMIN': 'DENIED',
                'OPERATIONS': 'DENIED',
                'EDITOR': 'DENIED',
                'CUSTOMER': 'DENIED'
            }
        },
        {
            route: '/dev-tools',
            description: 'Developer Tools',
            guard: 'devModeGuard',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'ALLOWED',
                'ADMIN': 'ALLOWED',
                'OPERATIONS': 'ALLOWED',
                'EDITOR': 'ALLOWED',
                'CUSTOMER': 'WARNING' // Auth only check
            },
            risk: 'MEDIUM'
        },
        {
            route: '/catalog',
            description: 'Public Catalog',
            guard: '-',
            roles: {
                'SUPER_ADMIN': 'ALLOWED',
                'MANAGER': 'ALLOWED',
                'ADMIN': 'ALLOWED',
                'OPERATIONS': 'ALLOWED',
                'EDITOR': 'ALLOWED',
                'CUSTOMER': 'ALLOWED' // Public
            }
        }
    ];

    getIcon(status: 'ALLOWED' | 'DENIED' | 'WARNING'): string {
        switch (status) {
            case 'ALLOWED': return 'check-circle';
            case 'DENIED': return 'x-circle';
            case 'WARNING': return 'alert-triangle';
        }
    }

    getColor(status: 'ALLOWED' | 'DENIED' | 'WARNING'): string {
        switch (status) {
            case 'ALLOWED': return 'text-emerald-500';
            case 'DENIED': return 'text-gray-300 opacity-30';
            case 'WARNING': return 'text-amber-500';
        }
    }
}
