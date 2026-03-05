import { Routes } from '@angular/router';
import { devModeGuard } from './core/guards/dev-mode.guard';
import { adminGuard } from './core/guards/admin.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'admin/login', pathMatch: 'full' },

    // ── Public: Auth ─────────────────────────────────────────────────────────
    {
        path: 'login',
        loadComponent: () => import('./pages/auth/login/login.component').then(m => m.LoginComponent),
        title: 'Sign In | Eurollantas'
    },

    // ── Public: Legal (required by law to be publicly accessible) ────────────
    {
        path: 'terms',
        loadComponent: () => import('./pages/legal/terms/terms.component').then(m => m.TermsComponent)
    },
    {
        path: 'privacy',
        loadComponent: () => import('./pages/legal/privacy/privacy.component').then(m => m.PrivacyComponent)
    },

    // ── Internal: Staff login required ───────────────────────────────────────
    {
        path: 'checkout',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/checkout/checkout.component').then(m => m.CheckoutComponent),
        title: 'NAVBAR.CHECKOUT'
    },
    {
        path: 'order-confirmation',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/order-confirmation/order-confirmation.component').then(m => m.OrderConfirmationComponent),
        title: 'Order Confirmation'
    },
    {
        path: 'blog',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/blog/blog-list/blog-list.component').then(m => m.BlogListComponent)
    },
    {
        path: 'blog/:slug',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/blog/blog-detail/blog-detail.component').then(m => m.BlogDetailComponent)
    },
    {
        path: 'biblioteca',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/pdf-library/pdf-library.component').then(m => m.PdfLibraryComponent)
    },
    {
        path: 'catalog',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/catalog/catalog.component').then(m => m.CatalogComponent)
    },
    {
        path: 'catalog-v2',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/catalog-v2/catalog-v2.component').then(m => m.CatalogV2Component)
    },
    {
        path: 'product/:slug',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/product-detail/product-detail.component').then(m => m.ProductDetailComponent)
    },
    {
        path: 'account',
        canActivate: [adminGuard],
        loadChildren: () => import('./pages/account/account.routes').then(m => m.accountRoutes)
    },
    {
        path: 'view/:slug',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/public/document-viewer/document-viewer.component').then(m => m.DocumentViewerComponent)
    },
    {
        path: 'help',
        canActivate: [adminGuard],
        loadChildren: () => import('./pages/help/help.routes').then(m => m.helpRoutes)
    },

    // ── Internal: Feature sections (guarded by their own child guards) ────────
    {
        path: 'operations',
        loadChildren: () => import('./pages/operations/operations.routes').then(m => m.operationsRoutes)
    },
    {
        path: 'command-center',
        loadChildren: () => import('./pages/command-center/command-center.routes').then(m => m.commandCenterRoutes)
    },
    {
        path: 'dev-tools',
        canActivate: [devModeGuard],
        loadChildren: () => import('./pages/dev-tools/dev-tools.routes').then(m => m.devToolsRoutes)
    },
    {
        path: 'admin',
        loadChildren: () => import('./pages/admin/admin.routes').then(m => m.ADMIN_ROUTES)
    },
    {
        path: 'portal',
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/admin/portal-launcher/portal-launcher.component').then(m => m.PortalLauncherComponent)
    },

    // ── 404 ──────────────────────────────────────────────────────────────────
    {
        path: '**',
        loadComponent: () => import('./pages/not-found/not-found.component').then(m => m.NotFoundComponent)
    }
];
