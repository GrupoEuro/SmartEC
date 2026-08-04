import { Routes } from '@angular/router';
import { AdminLayoutComponent } from './admin-layout/admin-layout.component';
import { AdminLoginComponent } from './admin-login/admin-login.component';
import { adminGuard } from '../../core/guards/admin.guard';
import { roleGuard } from '../../core/guards/role.guard';
import { UnsavedChangesGuard } from '../../core/guards/unsaved-changes.guard';
import { DashboardComponent } from './dashboard/dashboard.component';

export const ADMIN_ROUTES: Routes = [
    {
        path: '',
        component: AdminLayoutComponent,
        canActivate: [adminGuard],
        children: [
            { path: 'dashboard', component: DashboardComponent, title: 'Admin | Dashboard' },
            // ── IA Agents (EuroMind) ───────────────────────────────────────────────
            {
                path: 'ai-agents',
                loadComponent: () => import('./ai-agents/ai-agents-list.component').then(m => m.AiAgentsListComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'EuroMind — Agentes IA'
            },
            {
                path: 'ai-agents/new',
                loadComponent: () => import('./ai-agents/ai-agent-form.component').then(m => m.AiAgentFormComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'Nuevo Agente IA'
            },
            {
                path: 'ai-agents/:id/edit',
                loadComponent: () => import('./ai-agents/ai-agent-form.component').then(m => m.AiAgentFormComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'Configurar Agente IA'
            },
            {
                path: 'ai-agents/settings',
                loadComponent: () => import('./ai-agents/ai-agents-settings.component').then(m => m.AiAgentsSettingsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'Configuración EuroMind IA'
            },
            {
                path: 'catalog-overview',
                loadComponent: () => import('./catalog-overview/catalog-overview.component').then(m => m.CatalogOverviewComponent),
                title: 'Admin | Catálogo Overview'
            },
            {
                path: 'populate-data',
                loadComponent: () => import('./populate-data/populate-data.component').then(m => m.PopulateDataComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Poblar Datos'
            },
            {
                path: 'orders',
                loadComponent: () => import('./orders/order-list/order-list.component').then(m => m.OrderListComponent),
                title: 'Admin | Pedidos'
            },
            {
                path: 'orders/:id',
                loadComponent: () => import('./orders/order-detail/order-detail.component').then(m => m.OrderDetailComponent),
                title: 'Admin | Detalle de Pedido'
            },
            {
                path: 'brands',
                loadComponent: () => import('./brands/brand-list/brand-list.component').then(m => m.BrandListComponent),
                title: 'Admin | Marcas'
            },
            {
                path: 'brands/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./brands/brand-form/brand-form.component').then(m => m.BrandFormComponent),
                title: 'Admin | Nueva Marca'
            },
            {
                path: 'brands/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./brands/brand-form/brand-form.component').then(m => m.BrandFormComponent),
                title: 'Admin | Editar Marca'
            },
            {
                path: 'categories',
                loadComponent: () => import('./categories/category-list/category-list.component').then(m => m.CategoryListComponent),
                title: 'Admin | Categorías'
            },
            {
                path: 'categories/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./categories/category-form/category-form.component').then(m => m.CategoryFormComponent),
                title: 'Admin | Nueva Categoría'
            },
            {
                path: 'categories/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./categories/category-form/category-form.component').then(m => m.CategoryFormComponent),
                title: 'Admin | Editar Categoría'
            },
            {
                path: 'kits',
                loadComponent: () => import('./kits/kit-list/kit-list.component').then(m => m.KitListComponent),
                title: 'Admin | Kits'
            },
            {
                path: 'kits/new',
                loadComponent: () => import('./kits/kit-form/kit-form.component').then(m => m.KitFormComponent),
                title: 'Admin | Nuevo Kit'
            },
            {
                path: 'kits/:id/edit',
                loadComponent: () => import('./kits/kit-form/kit-form.component').then(m => m.KitFormComponent),
                title: 'Admin | Editar Kit'
            },
            {
                path: 'products',
                loadComponent: () => import('./products/product-list/product-list.component').then(m => m.ProductListComponent),
                title: 'Admin | Productos'
            },
            {
                path: 'products/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./products/product-form/product-form.component').then(m => m.ProductFormComponent),
                title: 'Admin | Nuevo Producto'
            },
            {
                path: 'products/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./products/product-form/product-form.component').then(m => m.ProductFormComponent),
                title: 'Admin | Editar Producto'
            },
            {
                path: 'product-types',
                loadComponent: () => import('./product-types/product-type-list/product-type-list.component').then(m => m.ProductTypeListComponent),
                title: 'Admin | Tipos de Producto'
            },
            {
                path: 'product-types/new',
                loadComponent: () => import('./product-types/product-type-form/product-type-form.component').then(m => m.ProductTypeFormComponent),
                title: 'Admin | Nuevo Tipo'
            },
            {
                path: 'product-types/edit/:id',
                loadComponent: () => import('./product-types/product-type-form/product-type-form.component').then(m => m.ProductTypeFormComponent),
                title: 'Admin | Editar Tipo'
            },
            {
                path: 'blog',
                loadComponent: () => import('./blog/blog-list/blog-list.component').then(m => m.BlogListComponent),
                title: 'Admin | Blog'
            },
            {
                path: 'blog/new',
                loadComponent: () => import('./blog/blog-form/blog-form.component').then(m => m.BlogFormComponent),
                title: 'Admin | Nuevo Artículo'
            },
            {
                path: 'blog/edit/:id',
                loadComponent: () => import('./blog/blog-form/blog-form.component').then(m => m.BlogFormComponent),
                title: 'Admin | Editar Artículo'
            },
            {
                path: 'media-library',
                loadComponent: () => import('./media-library/media-library.component').then(m => m.MediaLibraryComponent),
                title: 'Admin | Biblioteca de Medios'
            },
            {
                path: 'pdfs',
                loadComponent: () => import('./pdfs/pdf-list/pdf-list.component').then(m => m.PdfListComponent),
                title: 'Admin | PDFs'
            },
            {
                path: 'pdfs/new',
                loadComponent: () => import('./pdfs/pdf-form/pdf-form.component').then(m => m.PdfFormComponent),
                title: 'Admin | Nuevo PDF'
            },
            {
                path: 'pdfs/edit/:id',
                loadComponent: () => import('./pdfs/pdf-form/pdf-form.component').then(m => m.PdfFormComponent),
                title: 'Admin | Editar PDF'
            },
            {
                path: 'logs',
                loadComponent: () => import('./logs/admin-log-list/admin-log-list.component').then(m => m.AdminLogListComponent),
                title: 'Admin | Logs'
            },
            {
                path: 'distributors',
                loadComponent: () => import('./distributors/distributor-list/distributor-list.component').then(m => m.DistributorListComponent),
                title: 'Admin | Distribuidores'
            },
            {
                path: 'customers',
                loadComponent: () => import('./customers/customer-list/customer-list.component').then(m => m.CustomerListComponent),
                title: 'Admin | Clientes'
            },
            {
                path: 'customers/:id',
                loadComponent: () => import('./customers/customer-detail/customer-detail.component').then(m => m.CustomerDetailComponent),
                title: 'Admin | Detalle de Cliente'
            },
            {
                path: 'coupons',
                loadComponent: () => import('./coupons/coupon-list/coupon-list.component').then(m => m.CouponListComponent),
                title: 'Admin | Cupones'
            },
            {
                path: 'coupons/new',
                loadComponent: () => import('./coupons/coupon-form/coupon-form.component').then(m => m.CouponFormComponent),
                title: 'Admin | Nuevo Cupón'
            },
            {
                path: 'coupons/edit/:id',
                loadComponent: () => import('./coupons/coupon-form/coupon-form.component').then(m => m.CouponFormComponent),
                title: 'Admin | Editar Cupón'
            },
            {
                path: 'coupons/:id/analytics',
                loadComponent: () => import('./coupons/coupon-analytics/coupon-analytics.component').then(m => m.CouponAnalyticsComponent),
                title: 'QR Analytics'
            },
            {
                path: 'promotions',
                loadComponent: () => import('./promotions/promotion-list/promotion-list.component').then(m => m.PromotionListComponent),
                title: 'Admin | Promociones'
            },
            {
                path: 'promotions/new',
                loadComponent: () => import('./promotions/promotion-form/promotion-form.component').then(m => m.PromotionFormComponent),
                title: 'Admin | Nueva Promoción'
            },
            {
                path: 'promotions/edit/:id',
                loadComponent: () => import('./promotions/promotion-form/promotion-form.component').then(m => m.PromotionFormComponent),
                title: 'Admin | Editar Promoción'
            },
            {
                path: 'staff',
                loadComponent: () => import('./system/staff/staff-list/staff-list.component').then(m => m.StaffListComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
                title: 'Admin | Staff'
            },
            {
                path: 'users',
                loadComponent: () => import('./users/user-list/user-list.component')
                    .then(m => m.UserListComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Usuarios'
            },
            {
                path: 'warehouses',
                loadComponent: () => import('./warehouse/warehouse-list/warehouse-list.component').then(m => m.WarehouseListComponent),
                title: 'Admin | Almacenes'
            },
            {
                path: 'warehouses/new',
                loadComponent: () => import('./warehouse/warehouse-wizard/warehouse-wizard.component').then(m => m.WarehouseWizardComponent),
                title: 'Admin | Nuevo Almacén'
            },
            {
                path: 'warehouses/locator',
                loadComponent: () => import('./warehouse/product-locator/product-locator.component').then(m => m.ProductLocatorComponent),
                title: 'Admin | Localizador de Almacén'
            },
            {
                path: 'warehouses/:id',
                loadComponent: () => import('./warehouse/layout-editor/layout-editor.component').then(m => m.LayoutEditorComponent),
                title: 'Admin | Editor de Almacén'
            },

            // ── Integrations subroutes MUST come before the base 'integrations' route ──
            {
                path: 'integrations/callback',
                loadComponent: () => import('./settings/integrations/callback/integration-callback.component').then(m => m.IntegrationCallbackComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Integraciones'
            },
            {
                path: 'integrations/skydropx-debug',
                loadComponent: () => import('./settings/integrations/skydropx-debug/skydropx-debug.component').then(m => m.SkydropxDebugComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Skydropx Debug'
            },
            {
                path: 'integrations/mp-debug',
                loadComponent: () => import('./settings/integrations/mp-debug/mp-debug.component').then(m => m.MpDebugComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | MP Debug'
            },
            {
                path: 'integrations/zip-debug',
                loadComponent: () => import('./settings/integrations/zip-debug/zip-debug.component').then(m => m.ZipDebugComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | ZIP Debug'
            },
            {
                path: 'integrations/sw-debug',
                loadComponent: () => import('./settings/integrations/sw-debug/sw-debug.component').then(m => m.SwDebugComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'MANAGER'] },
                title: 'Admin | SW Sapien Debug'
            },
            {
                path: 'integrations/sap-debug',
                loadComponent: () => import('./settings/integrations/sap-debug/sap-debug.component').then(m => m.SapDebugComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'MANAGER'] },
                title: 'Admin | SAP B1 REST Debug'
            },
            {
                path: 'integrations/products',
                loadComponent: () => import('./settings/integrations/product-link/product-link.component').then(m => m.ProductLinkComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Vincular Productos'
            },
            // ── Inbox Channels config ─────────────────────────────────────────────
            {
                path: 'integrations/inbox',
                loadComponent: () => import('./settings/integrations/inbox-channels/inbox-channels.component').then(m => m.InboxChannelsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Inbox — Configuración de Canales'
            },
            // ── Base integrations route — must be LAST among integrations/* paths ──
            {
                path: 'integrations',
                pathMatch: 'full',
                loadComponent: () => import('./settings/integrations/integration-manager.component').then(m => m.IntegrationManagerComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Integraciones'
            },

            // ── Customer Care / Universal Inbox settings ──────────────────────────
            {
                path: 'customer-care',
                loadComponent: () => import('./settings/integrations/inbox-channels/inbox-channels.component').then(m => m.InboxChannelsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'Atención al Cliente — Configuración'
            },

            {
                path: 'themes',
                loadComponent: () => import('./themes/theme-manager.component').then(m => m.ThemeManagerComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'Admin | Temas'
            },
            {
                path: 'settings',
                loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Admin | Configuración'
            },
            {
                path: 'tracking',
                loadComponent: () => import('./settings/tracking-pixels/tracking-pixels.component').then(m => m.TrackingPixelsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] },
                title: 'Tracking & Pixels'
            },
            {
                path: 'seo',
                loadComponent: () => import('./settings/admin-seo/admin-seo.component').then(m => m.AdminSeoComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN', 'ADMIN'] },
                title: 'SEO / GEO / IA'
            },
            // ── Marketing (Campaigns remain here for Phase 1) ─────────────────────
            // Abandoned Carts → moved to /marketing/abandoned-carts
            // Attribution    → moved to /marketing/attribution
            {
                path: 'marketing/campaigns',
                loadComponent: () => import('./marketing/campaigns/campaign-list/campaign-list.component').then(m => m.CampaignListComponent),
                title: 'Campaigns'
            },
            {
                path: 'marketing/campaigns/new',
                loadComponent: () => import('./marketing/campaigns/campaign-form/campaign-form.component').then(m => m.CampaignFormComponent),
                title: 'New Campaign'
            },
            {
                path: 'marketing/campaigns/edit/:id',
                loadComponent: () => import('./marketing/campaigns/campaign-form/campaign-form.component').then(m => m.CampaignFormComponent),
                title: 'Edit Campaign'
            },
            // ── Legacy redirects (bookmark safety) ────────────────────────────────
            { path: 'marketing/abandoned-carts', redirectTo: '/marketing/abandoned-carts', pathMatch: 'full' },
            { path: 'marketing/attribution',     redirectTo: '/marketing/attribution',     pathMatch: 'full' },
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
        ]
    },
    {
        path: 'login',
        component: AdminLoginComponent
    }
];
