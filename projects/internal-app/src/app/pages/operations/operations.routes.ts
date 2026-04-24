import { Routes } from '@angular/router';
import { operationsGuard } from '../../core/guards/operations.guard';
import { OperationsLayoutComponent } from './operations-layout/operations-layout.component';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

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
                path: 'inventory/locator',
                loadComponent: () => import('./inventory/product-locator-v2/product-locator-v2.component').then(m => m.ProductLocatorV2Component)
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
                path: 'replenishment-planner',
                loadComponent: () => import('./inventory/replenishment-planner.component').then(m => m.ReplenishmentPlannerComponent)
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
                path: 'receiving',
                loadComponent: () => import('./receiving/receiving-dashboard/receiving-dashboard.component').then(m => m.ReceivingDashboardComponent)
            },
            {
                path: 'receiving/receive',
                loadComponent: () => import('./receiving/receive-goods/receive-goods.component').then(m => m.ReceiveGoodsComponent)
            },
            {
                path: 'receiving/receive/:id',
                loadComponent: () => import('./receiving/receive-goods/receive-goods.component').then(m => m.ReceiveGoodsComponent)
            },
            {
                path: 'receiving/putaway',
                loadComponent: () => import('./receiving/putaway-tasks/putaway-tasks.component').then(m => m.PutawayTasksComponent)
            },
            {
                path: 'procurement',
                loadComponent: () => import('./procurement/purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent)
            },
            {
                path: 'procurement/:id',
                loadComponent: () => import('./procurement/purchase-order-detail/purchase-order-detail.component').then(m => m.PurchaseOrderDetailComponent)
            },
            {
                path: 'pricing',
                redirectTo: 'pricing/dashboard',
                pathMatch: 'full'
            },
            {
                path: 'pricing/dashboard',
                loadComponent: () => import('./pricing/pricing-strategy/pricing-strategy.component').then(m => m.PricingStrategyComponent)
            },
            {
                path: 'pricing/constructor',
                loadComponent: () => import('./pricing/smart-price-constructor/smart-price-constructor.component').then(m => m.SmartPriceConstructorComponent)
            },
            {
                path: 'pricing/calendar',
                loadComponent: () => import('./pricing/pricing-calendar/pricing-calendar.component').then(m => m.PricingCalendarComponent)
            },
            {
                path: 'pricing/grid',
                loadComponent: () => import('./pricing/pricing-list/pricing-list.component').then(m => m.PricingListComponent)
            },
            // ─── Analytics / Metrics Hub ────────────────────────────────────────
            {
                path: 'metrics',
                loadComponent: () => import('./metrics/metrics-hub.component').then(m => m.MetricsHubComponent)
            },
            {
                path: 'metrics/meli-full',
                loadComponent: () => import('./metrics/meli-full/meli-full-report.component').then(m => m.MeliFullReportComponent)
            },
            {
                path: 'metrics/channel/:channel',
                loadComponent: () => import('./metrics/channel-report/channel-report.component').then(m => m.ChannelReportComponent),
                title: 'Reporte de Canal'
            },
            // Channels & Integrations
            {
                path: 'channels/mercadolibre',
                loadComponent: () => import('./channels/mercadolibre-hub/mercadolibre-hub.component').then(m => m.MercadolibreHubComponent)
            },
            {
                path: 'channels/amazon',
                loadComponent: () => import('./channels/amazon-hub/amazon-hub.component').then(m => m.AmazonHubComponent),
                title: 'Amazon Hub'
            },
            {
                path: 'price-intelligence',
                loadComponent: () => import('./price-intelligence/price-intelligence.component').then(m => m.PriceIntelligenceComponent),
                title: 'Price Intelligence'
            },
            // Legacy / Redirects
            {
                path: 'pricing-grid',
                redirectTo: 'pricing/grid'
            }
        ],
        providers: [
            provideCharts(withDefaultRegisterables())
        ]
    }
];
