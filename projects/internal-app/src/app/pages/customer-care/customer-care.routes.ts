import { Routes } from '@angular/router';
import { CustomerCareLayoutComponent } from './customer-care-layout/customer-care-layout.component';
import { adminGuard } from '../../core/guards/admin.guard';

export const CUSTOMER_CARE_ROUTES: Routes = [
    {
        path: '',
        component: CustomerCareLayoutComponent,
        canActivate: [adminGuard],
        children: [
            { path: '', redirectTo: 'inbox', pathMatch: 'full' },

            // ── Inbox ─────────────────────────────────────────────────────────
            {
                path: 'inbox',
                loadComponent: () => import('./inbox/inbox.component')
                    .then(m => m.InboxComponent),
                title: 'Atención al Cliente | Inbox'
            },

            // ── All Conversations (history, resolved, etc.) ───────────────────
            {
                path: 'conversations',
                loadComponent: () => import('./conversations/conversations.component')
                    .then(m => m.ConversationsComponent),
                title: 'Atención al Cliente | Conversaciones'
            },

            // ── Analytics ─────────────────────────────────────────────────────
            {
                path: 'analytics',
                loadComponent: () => import('./analytics/care-analytics.component')
                    .then(m => m.CareAnalyticsComponent),
                title: 'Atención al Cliente | Analíticas'
            },
        ]
    }
];
