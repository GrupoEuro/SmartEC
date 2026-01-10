import { Routes } from '@angular/router';
import { DevLayoutComponent } from './dev-layout/dev-layout.component';

export const devToolsRoutes: Routes = [
    {
        path: '',
        component: DevLayoutComponent,
        children: [
            {
                path: '',
                redirectTo: 'icons',
                pathMatch: 'full'
            },
            {
                path: 'icons',
                loadComponent: () => import('./icon-library/icon-library.component')
                    .then(m => m.IconLibraryComponent),
                data: { title: 'Icon Library' }
            },
            {
                path: 'libraries',
                loadComponent: () => import('./library-explorer/library-explorer.component').then(m => m.LibraryExplorerComponent),
                data: { title: 'Stack Explorer' }
            },
            {
                path: 'stats',
                loadComponent: () => import('./project-stats/project-stats.component').then(m => m.ProjectStatsComponent),
                data: { title: 'Project Vitality' }
            },
            {
                path: 'data',
                loadComponent: () => import('./data-seeder/data-seeder.component').then(m => m.DataSeederComponent),
                data: { title: 'Data Seeder' }
            },
            {
                path: 'database',
                loadComponent: () => import('./database-outlook/database-outlook.component').then(m => m.DatabaseOutlookComponent),
                data: { title: 'Database Visualizer' }
            },
            {
                path: 'logs',
                loadComponent: () => import('./log-explorer/log-explorer.component').then(m => m.LogExplorerComponent),
                data: { title: 'Log Explorer' }
            },
            {
                path: 'state',
                loadComponent: () => import('./state-inspector/state-inspector.component').then(m => m.StateInspectorComponent),
                data: { title: 'State Inspector' }
            },
            {
                path: 'routes',
                loadComponent: () => import('./route-visualizer/route-visualizer.component').then(m => m.RouteVisualizerComponent),
                data: { title: 'Route Visualizer' }
            },
            {
                path: 'permissions',
                loadComponent: () => import('./permissions-map/permissions-map.component').then(m => m.PermissionsMapComponent),
                data: { title: 'Permissions Map' }
            },
            {
                path: 'firestore',
                loadComponent: () => import('./firestore-monitor/firestore-monitor.component').then(m => m.FirestoreMonitorComponent),
                data: { title: 'Firestore Monitor' }
            },
            {
                path: 'i18n',
                loadComponent: () => import('./i18n-studio/i18n-studio.component').then(m => m.I18nStudioComponent),
                data: { title: 'I18n Studio' }
            },
            {
                path: 'config',
                loadComponent: () => import('./config/config.component').then(m => m.ConfigComponent),
                data: { title: 'System Config' }
            },
            {
                path: 'theme',
                loadComponent: () => import('./theme-playground/theme-playground.component').then(m => m.ThemePlaygroundComponent),
                data: { title: 'Theme Playground' }
            },

            {
                path: 'doc-generator',
                loadComponent: () => import('./xml-generator/xml-generator.component').then(m => m.XmlGeneratorComponent),
                data: { title: 'Document Generator' }
            }
        ]
    }
];
