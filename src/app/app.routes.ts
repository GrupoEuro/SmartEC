import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { PraxisComponent } from './pages/praxis/praxis.component';
import { devModeGuard } from './core/guards/dev-mode.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
    { path: '', component: HomeComponent },
    {
        path: 'checkout',
        loadComponent: () => import('./pages/checkout/checkout.component').then(m => m.CheckoutComponent),
        title: 'NAVBAR.CHECKOUT'
    },
    {
        path: 'order-confirmation',
        loadComponent: () => import('./pages/order-confirmation/order-confirmation.component').then(m => m.OrderConfirmationComponent),
        title: 'Order Confirmation'
    },
    { path: 'praxis', component: PraxisComponent },
    {
        path: 'blog',
        loadComponent: () => import('./pages/blog/blog-list/blog-list.component').then(m => m.BlogListComponent)
    },
    {
        path: 'blog/:slug',
        loadComponent: () => import('./pages/blog/blog-detail/blog-detail.component').then(m => m.BlogDetailComponent)
    },
    {
        path: 'biblioteca',
        loadComponent: () => import('./pages/pdf-library/pdf-library.component').then(m => m.PdfLibraryComponent)
    },
    {
        path: 'catalog',
        loadComponent: () => import('./pages/catalog/catalog.component').then(m => m.CatalogComponent)
    },
    {
        path: 'product/:slug',
        loadComponent: () => import('./pages/product-detail/product-detail.component').then(m => m.ProductDetailComponent)
    },
    {
        path: 'terms',
        loadComponent: () => import('./pages/legal/terms/terms.component').then(m => m.TermsComponent)
    },
    {
        path: 'privacy',
        loadComponent: () => import('./pages/legal/privacy/privacy.component').then(m => m.PrivacyComponent)
    },
    {
        path: 'operations',
        loadChildren: () => import('./pages/operations/operations.routes').then(m => m.operationsRoutes)
    },
    {
        path: 'help',
        loadChildren: () => import('./pages/help/help.routes').then(m => m.helpRoutes)
    },
    {
        path: 'command-center',
        loadChildren: () => import('./pages/command-center/command-center.routes').then(m => m.commandCenterRoutes)
    },
    {
        path: 'test-page',
        loadComponent: () => import('./pages/test-page.component').then(m => m.TestPageComponent)
    },
    {
        path: 'dev-tools',
        loadChildren: () => import('./pages/dev-tools/dev-tools.routes').then(m => m.devToolsRoutes),
        canActivate: [devModeGuard]
    },
    {
        path: 'admin',
        loadChildren: () => import('./pages/admin/admin.routes').then(m => m.ADMIN_ROUTES)
    },
    {
        path: 'portal',
        loadComponent: () => import('./pages/admin/portal-launcher/portal-launcher.component').then(m => m.PortalLauncherComponent),
        canActivate: [roleGuard] // Ensure at least logged in
    },
    {
        path: 'view/:slug',
        loadComponent: () => import('./pages/public/document-viewer/document-viewer.component').then(m => m.DocumentViewerComponent)
    },
    {
        path: '**',
        loadComponent: () => import('./pages/not-found/not-found.component').then(m => m.NotFoundComponent)
    }
];
