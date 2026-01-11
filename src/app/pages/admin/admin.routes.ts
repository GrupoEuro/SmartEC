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
            { path: 'dashboard', component: DashboardComponent },
            {
                path: 'catalog-overview',
                loadComponent: () => import('./catalog-overview/catalog-overview.component').then(m => m.CatalogOverviewComponent)
            },
            {
                path: 'populate-data',
                loadComponent: () => import('./populate-data/populate-data.component').then(m => m.PopulateDataComponent)
            },
            {
                path: 'banners',
                loadComponent: () => import('./banners/banner-list/banner-list.component').then(m => m.BannerListComponent)
            },
            {
                path: 'banners/new',
                loadComponent: () => import('./banners/banner-form/banner-form.component').then(m => m.BannerFormComponent)
            },
            {
                path: 'banners/edit/:id',
                loadComponent: () => import('./banners/banner-form/banner-form.component').then(m => m.BannerFormComponent)
            },
            {
                path: 'orders',
                loadComponent: () => import('./orders/order-list/order-list.component').then(m => m.OrderListComponent)
            },
            {
                path: 'orders/:id',
                loadComponent: () => import('./orders/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
            },
            {
                path: 'brands',
                loadComponent: () => import('./brands/brand-list/brand-list.component').then(m => m.BrandListComponent)
            },
            {
                path: 'brands/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./brands/brand-form/brand-form.component').then(m => m.BrandFormComponent)
            },
            {
                path: 'brands/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./brands/brand-form/brand-form.component').then(m => m.BrandFormComponent)
            },
            {
                path: 'categories',
                loadComponent: () => import('./categories/category-list/category-list.component').then(m => m.CategoryListComponent)
            },
            {
                path: 'categories/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./categories/category-form/category-form.component').then(m => m.CategoryFormComponent)
            },
            {
                path: 'categories/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./categories/category-form/category-form.component').then(m => m.CategoryFormComponent)
            },
            {
                path: 'kits',
                loadComponent: () => import('./kits/kit-list/kit-list.component').then(m => m.KitListComponent)
            },
            {
                path: 'kits/new',
                loadComponent: () => import('./kits/kit-form/kit-form.component').then(m => m.KitFormComponent)
            },
            {
                path: 'kits/:id/edit',
                loadComponent: () => import('./kits/kit-form/kit-form.component').then(m => m.KitFormComponent)
            },
            {
                path: 'products',
                loadComponent: () => import('./products/product-list/product-list.component').then(m => m.ProductListComponent)
            },
            {
                path: 'products/new',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./products/product-form/product-form.component').then(m => m.ProductFormComponent)
            },
            {
                path: 'products/:id/edit',
                canDeactivate: [UnsavedChangesGuard],
                loadComponent: () => import('./products/product-form/product-form.component').then(m => m.ProductFormComponent)
            },
            {
                path: 'blog',
                loadComponent: () => import('./blog/blog-list/blog-list.component').then(m => m.BlogListComponent)
            },
            {
                path: 'blog/new',
                loadComponent: () => import('./blog/blog-form/blog-form.component').then(m => m.BlogFormComponent)
            },
            {
                path: 'blog/edit/:id',
                loadComponent: () => import('./blog/blog-form/blog-form.component').then(m => m.BlogFormComponent)
            },
            {
                path: 'pdfs',
                loadComponent: () => import('./pdfs/pdf-list/pdf-list.component').then(m => m.PdfListComponent)
            },
            {
                path: 'pdfs/new',
                loadComponent: () => import('./pdfs/pdf-form/pdf-form.component').then(m => m.PdfFormComponent)
            },
            {
                path: 'pdfs/edit/:id',
                loadComponent: () => import('./pdfs/pdf-form/pdf-form.component').then(m => m.PdfFormComponent)
            },
            {
                path: 'logs',
                loadComponent: () => import('./logs/admin-log-list/admin-log-list.component').then(m => m.AdminLogListComponent)
            },
            {
                path: 'distributors',
                loadComponent: () => import('./distributors/distributor-list/distributor-list.component').then(m => m.DistributorListComponent)
            },
            {
                path: 'customers',
                loadComponent: () => import('./customers/customer-list/customer-list.component').then(m => m.CustomerListComponent)
            },
            {
                path: 'customers/:id',
                loadComponent: () => import('./customers/customer-detail/customer-detail.component').then(m => m.CustomerDetailComponent)
            },
            {
                path: 'coupons',
                loadComponent: () => import('./coupons/coupon-list/coupon-list.component').then(m => m.CouponListComponent)
            },
            {
                path: 'coupons/new',
                loadComponent: () => import('./coupons/coupon-form/coupon-form.component').then(m => m.CouponFormComponent)
            },
            {
                path: 'coupons/edit/:id',
                loadComponent: () => import('./coupons/coupon-form/coupon-form.component').then(m => m.CouponFormComponent)
            },
            {
                path: 'users',
                loadComponent: () => import('./users/user-list/user-list.component')
                    .then(m => m.UserListComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] }
            },
            {
                path: 'warehouses',
                loadComponent: () => import('./warehouse/warehouse-list/warehouse-list.component').then(m => m.WarehouseListComponent)
            },
            {
                path: 'warehouses/new',
                loadComponent: () => import('./warehouse/warehouse-wizard/warehouse-wizard.component').then(m => m.WarehouseWizardComponent)
            },
            {
                path: 'warehouses/locator',
                loadComponent: () => import('./warehouse/product-locator/product-locator.component').then(m => m.ProductLocatorComponent)
            },
            {
                path: 'warehouses/:id',
                loadComponent: () => import('./warehouse/layout-editor/layout-editor.component').then(m => m.LayoutEditorComponent)
            },
            {
                path: 'settings',
                loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent),
                canActivate: [roleGuard],
                data: { roles: ['SUPER_ADMIN'] }
            },
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
        ]
    },
    {
        path: 'login',
        component: AdminLoginComponent
    }
];
