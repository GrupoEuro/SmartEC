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
                data: { title: 'COMMAND_CENTER.DASHBOARD' }
            },
            {
                path: 'mission-control',
                loadComponent: () => import('./mission-control/mission-control.component').then(m => m.MissionControlComponent)
            },
            {
                path: 'approvals',
                loadComponent: () => import('./approvals/approvals-dashboard.component')
                    .then(m => m.ApprovalsDashboardComponent),
                data: { title: 'COMMAND_CENTER.APPROVALS.TITLE' }
            },
            {
                path: 'approvals/:id',
                loadComponent: () => import('./approvals/approval-detail/approval-detail.component')
                    .then(m => m.ApprovalDetailComponent),
                data: { title: 'COMMAND_CENTER.APPROVALS.REQUEST_DETAILS' }
            },
            {
                path: 'financials',
                loadComponent: () => import('./financials/financial-dashboard.component')
                    .then(m => m.FinancialDashboardComponent),
                data: { title: 'COMMAND_CENTER.FINANCIALS.TITLE' }
            },
            {
                path: 'income-statement',
                loadComponent: () => import('./income-statement/income-statement.component')
                    .then(m => m.IncomeStatementComponent),
                data: { title: 'COMMAND_CENTER.INCOME_STATEMENT.TITLE' }
            },
            {
                path: 'expenses',
                loadComponent: () => import('./expense-management/expense-management.component')
                    .then(m => m.ExpenseManagementComponent),
                data: { title: 'Gastos Operativos' } // Backup if key missing
            },
            {
                path: 'sales-analytics',
                loadComponent: () => import('./sales-analytics/sales-analytics.component')
                    .then(m => m.SalesAnalyticsComponent),
                data: { title: 'Análisis de Ventas' }
            },
            {
                path: 'inventory-analytics',
                loadComponent: () => import('./inventory-analytics/inventory-analytics.component')
                    .then(m => m.InventoryAnalyticsComponent),
                data: { title: 'COMMAND_CENTER.INVENTORY_ANALYTICS.TITLE' }
            },
            {
                path: 'customer-insights',
                loadComponent: () => import('./customer-insights/customer-insights.component')
                    .then(m => m.CustomerInsightsComponent),
                data: { title: 'COMMAND_CENTER.CUSTOMER_INSIGHTS.TITLE' }
            },
            {
                path: 'operational-metrics',
                loadComponent: () => import('./operational-metrics/operational-metrics.component')
                    .then(m => m.OperationalMetricsComponent),
                data: { title: 'Métricas Operativas' }
            }
        ]
    }
];
