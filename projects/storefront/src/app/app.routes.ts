import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CartService } from './core/services/cart.service';

export const routes: Routes = [
    { path: '', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
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
            return cartService.cartCount() > 0 ? true : router.createUrlTree(['/catalog']);
        }]
    },
    {
        path: 'order-confirmation',
        loadComponent: () => import('./pages/order-confirmation/order-confirmation.component').then(m => m.OrderConfirmationComponent),
        title: 'Order Confirmation'
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
    {
        path: 'biblioteca',
        loadComponent: () => import('./pages/pdf-library/pdf-library.component').then(m => m.PdfLibraryComponent)
    },
    {
        path: 'catalog',
        loadComponent: () => import('./pages/catalog-v2/catalog-v2.component').then(m => m.CatalogV2Component)
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
