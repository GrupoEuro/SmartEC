import { Routes } from '@angular/router';
import { commandCenterGuard } from '../../core/guards/command-center.guard';

export const commandCenterRoutes: Routes = [
    {
        path: '',
        canActivate: [commandCenterGuard],
        loadComponent: () => import('./command-center-layout/command-center-layout.component')
            .then(m => m.CommandCenterLayoutComponent),
        children: [
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            },
            {
                path: 'dashboard',
                loadComponent: () => import('./dashboard/command-center-dashboard.component')
                    .then(m => m.CommandCenterDashboardComponent),
                title: 'Command Center | Dashboard'
            },
            {
                path: 'mission-control',
                loadComponent: () => import('./mission-control/mission-control.component').then(m => m.MissionControlComponent),
                title: 'Command Center | Mission Control'
            },
            {
                path: 'approvals',
                loadComponent: () => import('./approvals/approvals-dashboard.component')
                    .then(m => m.ApprovalsDashboardComponent),
                title: 'Command Center | Aprobaciones'
            },
            {
                path: 'approvals/:id',
                loadComponent: () => import('./approvals/approval-detail/approval-detail.component')
                    .then(m => m.ApprovalDetailComponent),
                title: 'Command Center | Detalle de Aprobación'
            },
            {
                path: 'financials',
                loadComponent: () => import('./financials/financial-dashboard.component')
                    .then(m => m.FinancialDashboardComponent),
                title: 'Command Center | Financiero'
            },
            {
                path: 'income-statement',
                loadComponent: () => import('./income-statement/income-statement.component')
                    .then(m => m.IncomeStatementComponent),
                title: 'Command Center | Estado de Resultados'
            },
            {
                path: 'expenses',
                loadComponent: () => import('./expense-management/expense-management.component')
                    .then(m => m.ExpenseManagementComponent),
                title: 'Command Center | Gastos Operativos'
            },
            {
                path: 'sales-analytics',
                loadComponent: () => import('./sales-analytics/sales-analytics.component')
                    .then(m => m.SalesAnalyticsComponent),
                title: 'Command Center | Análisis de Ventas'
            },
            {
                path: 'inventory-analytics',
                loadComponent: () => import('./inventory-analytics/inventory-analytics.component')
                    .then(m => m.InventoryAnalyticsComponent),
                title: 'Command Center | Inventario'
            },
            {
                path: 'customer-insights',
                loadComponent: () => import('./customer-insights/customer-insights.component')
                    .then(m => m.CustomerInsightsComponent),
                title: 'Command Center | Insights de Clientes'
            },
            {
                path: 'operational-metrics',
                loadComponent: () => import('./operational-metrics/operational-metrics.component')
                    .then(m => m.OperationalMetricsComponent),
                title: 'Command Center | Métricas Operativas'
            }
        ]
    }
];
