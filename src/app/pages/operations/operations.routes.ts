import { Routes } from '@angular/router';
import { operationsGuard } from '../../core/guards/operations.guard';
import { OperationsLayoutComponent } from './operations-layout/operations-layout.component';

export const operationsRoutes: Routes = [
    {
        path: '',
        component: OperationsLayoutComponent,
        canActivate: [operationsGuard],
        children: [
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            },
            {
                path: 'dashboard',
                loadComponent: () => import('./dashboard/operations-dashboard.component').then(m => m.OperationsDashboardComponent)
            },
            {
                path: 'orders',
                loadComponent: () => import('./orders/order-queue.component').then(m => m.OrderQueueComponent)
            },
            {
                path: 'orders/new',
                loadComponent: () => import('./orders/order-builder/order-builder.component').then(m => m.OrderBuilderComponent)
            },
            {
                path: 'orders/:id',
                loadComponent: () => import('./orders/order-fulfillment.component').then(m => m.OrderFulfillmentComponent)
            },
            {
                path: 'customers',
                loadComponent: () => import('./customers/customer-lookup.component').then(m => m.CustomerLookupComponent)
            },
            {
                path: 'customers/:id',
                loadComponent: () => import('./customers/customer-detail/customer-detail.component').then(m => m.CustomerDetailComponent)
            },
            {
                path: 'inventory',
                loadComponent: () => import('./inventory/inventory-lookup.component').then(m => m.InventoryLookupComponent)
            },
            {
                path: 'inventory/kardex/:productId',
                loadComponent: () => import('./inventory/kardex-page.component').then(m => m.KardexPageComponent)
            },
            {
                path: 'cycle-counting',
                loadComponent: () => import('./inventory/cycle-counting.component').then(m => m.CycleCountingComponent)
            },
            {
                path: 'cycle-counting/:id',
                loadComponent: () => import('./inventory/cycle-counting/cycle-count-detail.component').then(m => m.CycleCountDetailComponent)
            },
            {
                path: 'abc-analysis',
                loadComponent: () => import('./inventory/abc-analysis.component').then(m => m.AbcAnalysisComponent)
            },
            {
                path: 'promotions',
                loadComponent: () => import('./promotions/promotions-reference.component').then(m => m.PromotionsReferenceComponent)
            },
            {
                path: 'warehouses',
                loadComponent: () => import('./warehouses/warehouse-list.component').then(m => m.WarehouseListComponent)
            },
            {
                path: 'procurement',
                loadComponent: () => import('./procurement/purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent)
            },
            {
                path: 'procurement/:id',
                loadComponent: () => import('./procurement/purchase-order-detail/purchase-order-detail.component').then(m => m.PurchaseOrderDetailComponent)
            }
        ]
    }
];
