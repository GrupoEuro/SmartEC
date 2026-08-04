import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CartService } from './core/services/cart.service';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/home-v3/home-v3.component').then(m => m.HomeV3Component),
        title: 'Importadora Eurollantas | Llantas para Moto en México'
    },
    {
        path: 'nosotros',
        loadComponent: () => import('./pages/nosotros/nosotros.component').then(m => m.NosotrosComponent),
        title: 'Nosotros | Importadora Eurollantas'
    },
    {
        path: 'login',
        loadComponent: () => import('./pages/auth/login/login.component').then(m => m.LoginComponent),
        title: 'Sign In | Eurollantas'
    },
    {
        path: 'checkout',
        loadComponent: () => import('./pages/checkout/checkout.component').then(m => m.CheckoutComponent),
        title: 'NAVBAR.CHECKOUT',
        canActivate: [() => {
            const cartService = inject(CartService);
            const router = inject(Router);
            return cartService.cartCount() > 0 ? true : router.createUrlTree(['/catalogo']);
        }]
    },
    {
        path: 'order-confirmation',
        loadComponent: () => import('./pages/order-confirmation/order-confirmation.component').then(m => m.OrderConfirmationComponent),
        title: 'Order Confirmation',
        canActivate: [() => {
            const router = inject(Router);
            const nav = router.getCurrentNavigation();
            return nav?.extras?.state?.['orderId'] ? true : router.createUrlTree(['/catalogo']);
        }]
    },
    {
        path: 'blog',
        loadComponent: () => import('./pages/blog/blog-list/blog-list.component').then(m => m.BlogListComponent)
    },
    {
        path: 'blog/:slug',
        loadComponent: () => import('./pages/blog/blog-detail/blog-detail.component').then(m => m.BlogDetailComponent)
    },
    {
        path: 'praxis',
        loadComponent: () => import('./pages/praxis/praxis.component').then(m => m.PraxisComponent)
    },
    // /michelin has no dedicated page — redirect to filtered catalog
    { path: 'michelin', redirectTo: '/catalogo?brand=Michelin', pathMatch: 'full' },
    {
        path: 'biblioteca',
        loadComponent: () => import('./pages/pdf-library/pdf-library.component').then(m => m.PdfLibraryComponent)
    },
    // ── URL aliases → /catalogo (canonical) ─────────────────────────────────
    // Firebase hosting has CDN-level 301 redirects (primary). These route-level
    // redirects are a second-layer fallback (local dev, SPA post-hydration).
    { path: 'catalog',    redirectTo: '/catalogo', pathMatch: 'full' },
    { path: 'shop',       redirectTo: '/catalogo', pathMatch: 'full' },
    { path: 'store',      redirectTo: '/catalogo', pathMatch: 'full' },
    { path: 'tienda',     redirectTo: '/catalogo', pathMatch: 'full' },
    { path: 'products',   redirectTo: '/catalogo', pathMatch: 'full' },
    { path: 'productos',  redirectTo: '/catalogo', pathMatch: 'full' },
    // ── Primary catalog route ─────────────────────────────────────────────────
    {
        path: 'catalogo',
        loadComponent: () => import('./pages/catalog-v2/catalog-v2.component').then(m => m.CatalogV2Component),
        title: 'Llantas para Moto Michelin y Praxis | Eurollantas'
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
        path: 'help',
        loadChildren: () => import('./pages/help/help.routes').then(m => m.helpRoutes)
    },
    {
        path: 'account',
        loadChildren: () => import('./pages/account/account.routes').then(m => m.accountRoutes)
    },
    {
        path: 'view/:slug',
        loadComponent: () => import('./pages/public/document-viewer/document-viewer.component').then(m => m.DocumentViewerComponent)
    },
    {
        path: 'q/:code',
        loadComponent: () => import('./pages/public/qr-tracking/qr-tracking.component').then(m => m.QrTrackingComponent)
    },
    {
        path: '**',
        loadComponent: () => import('./pages/not-found/not-found.component').then(m => m.NotFoundComponent)
    }
];
