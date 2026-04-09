import { Routes } from '@angular/router';
import { marketingGuard } from '../../core/guards/marketing.guard';
import { MarketingLayoutComponent } from './marketing-layout/marketing-layout.component';

export const MARKETING_ROUTES: Routes = [
    {
        path: '',
        component: MarketingLayoutComponent,
        canActivate: [marketingGuard],
        children: [
            // Default
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

            // ── Dashboard ──────────────────────────────────────────────────────
            {
                path: 'dashboard',
                loadComponent: () => import('./marketing-dashboard/marketing-dashboard.component')
                    .then(m => m.MarketingDashboardComponent),
                title: 'Marketing Hub | Dashboard'
            },

            // ── Analytics ─────────────────────────────────────────────────────
            {
                path: 'attribution',
                loadComponent: () => import('./attribution/attribution-report.component')
                    .then(m => m.AttributionReportComponent),
                title: 'Marketing Hub | Attribution'
            },
            {
                path: 'whatsapp',
                loadComponent: () => import('./whatsapp-engagement/whatsapp-engagement.component')
                    .then(m => m.WhatsappEngagementComponent),
                title: 'Marketing Hub | WhatsApp Engagement'
            },
            {
                path: 'abandoned-carts',
                loadComponent: () => import('../admin/marketing/abandoned-carts/abandoned-carts.component')
                    .then(m => m.AbandonedCartsComponent),
                title: 'Marketing Hub | Abandoned Carts'
            },

            // ── Campaigns ─────────────────────────────────────────────────────
            {
                path: 'campaigns',
                loadComponent: () => import('./campaigns/mkt-campaigns.component')
                    .then(m => m.MktCampaignsComponent),
                title: 'Marketing Hub | Campaigns'
            },
            {
                path: 'campaigns/new',
                loadComponent: () => import('../admin/marketing/campaigns/campaign-form/campaign-form.component')
                    .then(m => m.CampaignFormComponent),
                title: 'Marketing Hub | New Campaign'
            },
            {
                path: 'campaigns/edit/:id',
                loadComponent: () => import('../admin/marketing/campaigns/campaign-form/campaign-form.component')
                    .then(m => m.CampaignFormComponent),
                title: 'Marketing Hub | Edit Campaign'
            },

            // ── Coupons / QR ──────────────────────────────────────────────────
            {
                path: 'coupons',
                loadComponent: () => import('./coupons/mkt-coupons.component')
                    .then(m => m.MktCouponsComponent),
                title: 'Marketing Hub | Coupons & QR'
            },
            {
                path: 'coupons/qr/:id',
                loadComponent: () => import('./coupons/qr-report/qr-report.component')
                    .then(m => m.QrReportComponent),
                title: 'Marketing Hub | QR Report'
            },
            {
                path: 'coupons/qr/:couponId/scan/:scanId',
                loadComponent: () => import('./coupons/scan-detail/scan-detail.component')
                    .then(m => m.ScanDetailComponent),
                title: 'Marketing Hub | Detalle de Escaneo'
            },

            // ── Segments ──────────────────────────────────────────────────────
            {
                path: 'segments',
                loadComponent: () => import('./segments/mkt-segments.component')
                    .then(m => m.MktSegmentsComponent),
                title: 'Marketing Hub | Segments'
            },
        ]
    }
];
