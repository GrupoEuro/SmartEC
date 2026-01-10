import { Routes } from '@angular/router';

export const helpRoutes: Routes = [
    {
        path: '',
        loadComponent: () => import('./dashboard/help-dashboard.component').then(m => m.HelpDashboardComponent)
    },
    {
        path: 'topic/:id',
        loadComponent: () => import('./topic-detail/topic-detail.component').then(m => m.TopicDetailComponent)
    },
    {
        path: 'glossary',
        loadComponent: () => import('./components/help-glossary/help-glossary.component').then(m => m.HelpGlossaryComponent)
    }
];
