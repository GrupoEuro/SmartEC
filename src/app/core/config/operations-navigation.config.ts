import { NavItem } from './admin-navigation.config';

export const OPERATIONS_NAVIGATION_CONFIG: NavItem[] = [
    {
        id: 'dashboard',
        title: 'OPERATIONS.DASHBOARD.TITLE',
        icon: 'layout-dashboard',
        route: '/operations/dashboard'
    },
    {
        id: 'fulfillment',
        title: 'OPERATIONS.SIDEBAR.FULFILLMENT',
        icon: 'shopping-bag',
        children: [
            {
                id: 'orders',
                title: 'OPERATIONS.SIDEBAR.ORDER_QUEUE',
                icon: 'list',
                route: '/operations/orders'
            }
        ]
    },
    {
        id: 'inventory',
        title: 'OPERATIONS.SIDEBAR.INVENTORY',
        icon: 'package',
        children: [
            {
                id: 'lookup',
                title: 'OPERATIONS.SIDEBAR.LOOKUP',
                icon: 'search',
                route: '/operations/inventory'
            },
            {
                id: 'locator',
                title: 'OPERATIONS.SIDEBAR.LOCATOR',
                icon: 'map-pin',
                route: '/operations/inventory/locator',
                badge: {
                    text: '3D',
                    color: 'bg-emerald-500'
                }
            },
            {
                id: 'cycle_counts',
                title: 'OPERATIONS.SIDEBAR.CYCLE_COUNTS',
                icon: 'refresh-cw',
                route: '/operations/cycle-counting'
            },
            {
                id: 'abc',
                title: 'OPERATIONS.SIDEBAR.ABC_ANALYSIS',
                icon: 'bar-chart-2',
                route: '/operations/abc-analysis'
            },
            {
                id: 'replenishment',
                title: 'Replenishment Planner',
                icon: 'trending-up',
                route: '/operations/replenishment-planner',
                badge: {
                    text: 'NEW',
                    color: 'bg-purple-500'
                }
            }
        ]
    },
    {
        id: 'warehouse',
        title: 'Warehouse Operations',
        icon: 'warehouse',
        children: [
            {
                id: 'warehouses',
                title: 'OPERATIONS.SIDEBAR.WAREHOUSES',
                icon: 'building',
                route: '/operations/warehouses'
            },
            {
                id: 'receiving',
                title: 'Receiving',
                icon: 'download',
                route: '/operations/receiving',
                badge: {
                    text: 'NEW',
                    color: 'bg-blue-500'
                }
            }
        ]
    },
    {
        id: 'supply_chain',
        title: 'Supply Chain',
        icon: 'truck',
        children: [
            {
                id: 'procurement',
                title: 'OPERATIONS.SIDEBAR.PURCHASE_ORDERS',
                icon: 'clipboard-list',
                route: '/operations/procurement'
            }
        ]
    },
    {
        id: 'commercial',
        title: 'OPERATIONS.SIDEBAR.COMMERCIAL',
        icon: 'briefcase',
        children: [
            {
                id: 'customers',
                title: 'OPERATIONS.SIDEBAR.CUSTOMERS',
                icon: 'users',
                route: '/operations/customers'
            },
            {
                id: 'promotions',
                title: 'OPERATIONS.SIDEBAR.PROMOTIONS',
                icon: 'tag',
                route: '/operations/promotions'
            }
        ]
    }
];
