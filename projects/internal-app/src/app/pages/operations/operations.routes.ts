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
                loadComponent: () => import('./dashboard/operations-dashboard.component').then(m => m.OperationsDashboardComponent),
                title: 'Operations | Dashboard'
            },
            {
                path: 'orders',
                loadComponent: () => import('./orders/order-queue.component').then(m => m.OrderQueueComponent),
                title: 'Operations | Pedidos'
            },
            {
                path: 'orders/new',
                loadComponent: () => import('./orders/order-builder/order-builder.component').then(m => m.OrderBuilderComponent),
                title: 'Operations | Nuevo Pedido'
            },
            {
                path: 'orders/:id',
                loadComponent: () => import('./orders/order-fulfillment.component').then(m => m.OrderFulfillmentComponent),
                title: 'Operations | Fulfillment'
            },
            {
                path: 'invoicing',
                loadComponent: () => import('./invoicing/invoicing-dashboard/invoicing-dashboard.component').then(m => m.InvoicingDashboardComponent),
                title: 'Invoicing'
            },
            {
                path: 'customers',
                loadComponent: () => import('./customers/customer-lookup.component').then(m => m.CustomerLookupComponent),
                title: 'Operations | Clientes'
            },
            {
                path: 'customers/:id',
                loadComponent: () => import('./customers/customer-detail/customer-detail.component').then(m => m.CustomerDetailComponent),
                title: 'Operations | Detalle de Cliente'
            },
            {
                path: 'inventory',
                loadComponent: () => import('./inventory/inventory-lookup.component').then(m => m.InventoryLookupComponent),
                title: 'Operations | Inventario'
            },
            {
                path: 'inventory/locator',
                loadComponent: () => import('./inventory/product-locator-v2/product-locator-v2.component').then(m => m.ProductLocatorV2Component),
                title: 'Operations | Localizador'
            },
            {
                path: 'inventory/kardex/:productId',
                loadComponent: () => import('./inventory/kardex-page.component').then(m => m.KardexPageComponent),
                title: 'Operations | Kardex'
            },
            {
                path: 'cycle-counting',
                loadComponent: () => import('./inventory/cycle-counting.component').then(m => m.CycleCountingComponent),
                title: 'Operations | Conteo Cíclico'
            },
            {
                path: 'cycle-counting/:id',
                loadComponent: () => import('./inventory/cycle-counting/cycle-count-detail.component').then(m => m.CycleCountDetailComponent),
                title: 'Operations | Detalle de Conteo'
            },
            {
                path: 'abc-analysis',
                loadComponent: () => import('./inventory/abc-analysis.component').then(m => m.AbcAnalysisComponent),
                title: 'Operations | Análisis ABC'
            },
            {
                path: 'replenishment-planner',
                loadComponent: () => import('./inventory/replenishment-planner.component').then(m => m.ReplenishmentPlannerComponent),
                title: 'Operations | Planeador de Reabasto'
            },
            {
                path: 'promotions',
                loadComponent: () => import('./promotions/promotions-reference.component').then(m => m.PromotionsReferenceComponent),
                title: 'Operations | Promociones'
            },
            {
                path: 'warehouses',
                loadComponent: () => import('./warehouses/warehouse-list.component').then(m => m.WarehouseListComponent),
                title: 'Operations | Almacenes'
            },
            {
                path: 'receiving',
                loadComponent: () => import('./receiving/receiving-dashboard/receiving-dashboard.component').then(m => m.ReceivingDashboardComponent),
                title: 'Operations | Recepción'
            },
            {
                path: 'receiving/receive',
                loadComponent: () => import('./receiving/receive-goods/receive-goods.component').then(m => m.ReceiveGoodsComponent),
                title: 'Operations | Recibir Mercancía'
            },
            {
                path: 'receiving/receive/:id',
                loadComponent: () => import('./receiving/receive-goods/receive-goods.component').then(m => m.ReceiveGoodsComponent),
                title: 'Operations | Recibir Mercancía'
            },
            {
                path: 'receiving/putaway',
                loadComponent: () => import('./receiving/putaway-tasks/putaway-tasks.component').then(m => m.PutawayTasksComponent),
                title: 'Operations | Putaway'
            },
            {
                path: 'procurement',
                loadComponent: () => import('./procurement/purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent),
                title: 'Operations | Compras'
            },
            {
                path: 'procurement/:id',
                loadComponent: () => import('./procurement/purchase-order-detail/purchase-order-detail.component').then(m => m.PurchaseOrderDetailComponent),
                title: 'Operations | Detalle de Compra'
            },
            // ─── Administración de Precios ──────────────────────────────────────────
            {
                path: 'pricing',
                redirectTo: 'pricing/dashboard',
                pathMatch: 'full'
            },
            {
                path: 'pricing/dashboard',
                loadComponent: () => import('./pricing/pricing-strategy/pricing-strategy.component').then(m => m.PricingStrategyComponent),
                title: 'Pricing Dashboard'
            },
            {
                path: 'pricing/anomalies',
                loadComponent: () => import('./pricing/pricing-dashboard.component').then(m => m.PricingDashboardComponent),
                title: 'Gestión de Precios'
            },
            {
                path: 'pricing/simulation',
                loadComponent: () => import('./pricing/pricing-simulation.component').then(m => m.PricingSimulationComponent),
                title: 'Simulador de Precios'
            },
            {
                path: 'pricing/costs',
                loadComponent: () => import('./pricing/cost-management-hub.component').then(m => m.CostManagementHubComponent),
                title: 'Cost Management Hub'
            },
            {
                path: 'pricing/constructor',
                loadComponent: () => import('./pricing/smart-price-constructor/smart-price-constructor.component').then(m => m.SmartPriceConstructorComponent),
                title: 'Operations | Constructor de Precios'
            },
            {
                path: 'pricing/calendar',
                loadComponent: () => import('./pricing/pricing-calendar/pricing-calendar.component').then(m => m.PricingCalendarComponent),
                title: 'Operations | Calendario de Precios'
            },
            {
                path: 'pricing/grid',
                loadComponent: () => import('./pricing/pricing-list/pricing-list.component').then(m => m.PricingListComponent),
                title: 'Operations | Tabla de Precios'
            },
            {
                path: 'pricing/kits',
                loadComponent: () => import('./pricing/pricing-kit-builder.component').then(m => m.PricingKitBuilderComponent),
                title: 'Operations | Kits de Precio'
            },
            {
                path: 'pricing/income-analytics',
                loadComponent: () => import('./pricing/income-analytics/income-analytics.component').then(m => m.IncomeAnalyticsComponent),
                title: 'Income Analytics'
            },
            // ─── Analytics / Metrics Hub ────────────────────────────────────────
            {
                path: 'metrics',
                loadComponent: () => import('./metrics/metrics-hub.component').then(m => m.MetricsHubComponent),
                title: 'Operations | Métricas'
            },
            {
                path: 'metrics/meli-full',
                loadComponent: () => import('./metrics/meli-full/meli-full-report.component').then(m => m.MeliFullReportComponent),
                title: 'Operations | Reporte MercadoLibre'
            },
            {
                path: 'metrics/ai-insights',
                loadComponent: () => import('./metrics/ai-insights/ai-insights.component').then(m => m.AiInsightsComponent),
                title: 'AI Insights Engine'
            },
            {
                path: 'metrics/products',
                loadComponent: () => import('./metrics/product-analytics/product-analytics.component').then(m => m.ProductAnalyticsComponent),
                title: 'Análisis de Productos'
            },
            {
                path: 'metrics/geo',
                loadComponent: () => import('./metrics/geo-analytics/geo-analytics.component').then(m => m.GeoAnalyticsComponent),
                title: 'Análisis Geográfico'
            },
            {
                path: 'metrics/cohorts',
                loadComponent: () => import('./metrics/customer-cohorts/customer-cohorts.component').then(m => m.CustomerCohortsComponent),
                title: 'Cohortes de Clientes'
            },
            {
                path: 'metrics/busquedas',
                loadComponent: () => import('./metrics/search-metrics-summary/search-metrics-summary.component').then(m => m.SearchMetricsSummaryComponent),
                title: 'Análisis de Búsquedas'
            },
            {
                path: 'metrics/channel/:channel',
                loadComponent: () => import('./metrics/channel-report/channel-report.component').then(m => m.ChannelReportComponent),
                title: 'Reporte de Canal'
            },
            {
                path: 'metrics/competitor-intel',
                loadComponent: () => import('./metrics/competitor-intel/competitor-intel.component').then(m => m.CompetitorIntelComponent),
                title: 'Inteligencia Competitiva — MercadoLibre'
            },
            // Channels & Integrations
            {
                path: 'channels/mercadolibre',
                loadComponent: () => import('./channels/mercadolibre-hub/mercadolibre-hub.component').then(m => m.MercadolibreHubComponent),
                title: 'Operations | MercadoLibre'
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
