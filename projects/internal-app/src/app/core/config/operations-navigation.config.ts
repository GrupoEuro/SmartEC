import { NavItem } from './admin-navigation.config';

export const OPERATIONS_NAVIGATION_CONFIG: NavItem[] = [
    {
        id: 'dashboard',
        title: 'OPERATIONS.DASHBOARD.TITLE',
        icon: 'layout-dashboard',
        route: '/operations/dashboard'
    },
    {
        id: 'income_analytics',
        title: 'Income Analytics',
        icon: 'pie-chart',
        route: '/operations/pricing/income-analytics',
        badge: { text: '💰', color: 'bg-emerald-700' }
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
            },
            {
                id: 'invoicing',
                title: 'Facturación / Invoicing',
                icon: 'file-text',
                route: '/operations/invoicing',
                badge: {
                    text: 'CFDI',
                    color: 'bg-emerald-600'
                }
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
                title: 'OPERATIONS.SIDEBAR.REPLENISHMENT_PLANNER',
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
        title: 'OPERATIONS.SIDEBAR.WAREHOUSE_OPERATIONS',
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
                title: 'OPERATIONS.SIDEBAR.RECEIVING',
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
        title: 'OPERATIONS.SIDEBAR.SUPPLY_CHAIN',
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
        id: 'pricing_mgmt',
        title: 'Gestión Precios',
        icon: 'price_check',
        children: [
            {
                id: 'dashboard',
                title: 'OPERATIONS.SIDEBAR.PRICING_DASHBOARD',
                icon: 'layout-dashboard',
                route: '/operations/pricing/dashboard'
            },
            {
                id: 'anomalies',
                title: 'Alertas y Anomalías',
                icon: 'alert-triangle',
                route: '/operations/pricing/anomalies',
                badge: { text: 'NUEVO', color: 'bg-rose-600' }
            },
            {
                id: 'simulation',
                title: 'Simulador de Precios',
                icon: 'trending-up',
                route: '/operations/pricing/simulation',
                badge: { text: 'What-If', color: 'bg-indigo-600' }
            },
            {
                id: 'etl',
                title: 'Ingesta de Datos (ETL)',
                icon: 'upload-cloud',
                route: '/operations/pricing/etl-import',
                badge: { text: 'NUEVO', color: 'bg-emerald-600' }
            },
            {
                id: 'smart_builder',
                title: 'OPERATIONS.SIDEBAR.SMART_BUILDER',
                icon: 'psychology',
                route: '/operations/pricing/constructor',
                badge: {
                    text: 'V2',
                    color: 'bg-purple-600'
                }
            },
            {
                id: 'calendar',
                title: 'OPERATIONS.SIDEBAR.CAMPAIGN_CALENDAR',
                icon: 'calendar_month',
                route: '/operations/pricing/calendar'
            },
            {
                id: 'grid',
                title: 'OPERATIONS.SIDEBAR.SMART_PRICE_GRID',
                icon: 'table_view',
                route: '/operations/pricing/grid',
                badge: {
                    text: 'BULK',
                    color: 'bg-emerald-600'
                }
            },
            {
                id: 'price_intelligence',
                title: 'Price Intelligence',
                icon: 'trending-up',
                route: '/operations/price-intelligence',
                badge: { text: 'Nuevo', color: 'bg-violet-600' }
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
                children: [
                    {
                        id: 'customer_directory',
                        title: 'Directory', // Add localization later if needed
                        icon: 'users',
                        route: '/operations/customers'
                    },
                    {
                        id: 'customer_segments',
                        title: 'Segments & Insights', // Priority 4 Roadmap Placeholder
                        icon: 'pie-chart',
                        route: '/operations/customers' // Pointing to base for now until priority 4 is built
                    }
                ]
            },
            {
                id: 'promotions',
                title: 'OPERATIONS.SIDEBAR.PROMOTIONS',
                icon: 'tag',
                route: '/operations/promotions'
            }
        ]
    },
    {
        id: 'metrics',
        title: 'Métricas de Canales',
        icon: 'bar-chart-2',
        badge: { text: 'NUEVO', color: 'bg-violet-600' },
        children: [
            {
                id: 'metrics_overview',
                title: 'Vista General',
                icon: 'layout-dashboard',
                route: '/operations/metrics'
            },
            {
                id: 'meli_full_report',
                title: 'MeLi Full Report',
                icon: 'zap',
                route: '/operations/metrics/meli-full',
                badge: { text: 'Full', color: 'bg-orange-500' }
            },
            {
                id: 'metrics_web',
                title: 'Tienda Web',
                icon: 'globe',
                route: '/operations/metrics/channel/WEB'
            },
            {
                id: 'metrics_pos',
                title: 'Punto de Venta',
                icon: 'credit-card',
                route: '/operations/metrics/channel/POS'
            },
            {
                id: 'metrics_meli_classic',
                title: 'MeLi Clásica',
                icon: 'shopping-bag',
                route: '/operations/metrics/channel/MELI_CLASSIC'
            },
            {
                id: 'metrics_amazon',
                title: 'Amazon',
                icon: 'package',
                route: '/operations/metrics/channel/AMAZON_MFN'
            },
            {
                id: 'metrics_busquedas',
                title: 'Búsquedas',
                icon: 'search',
                route: '/operations/metrics/busquedas',
                badge: { text: 'NEW', color: 'bg-violet-600' }
            },
            {
                id: 'metrics_ai_insights',
                title: 'AI Insights Engine',
                icon: 'sparkles',
                route: '/operations/metrics/ai-insights',
                badge: { text: 'Beta', color: 'bg-indigo-500' }
            },
            {
                id: 'metrics_competitor_intel',
                title: 'Inteligencia Competitiva',
                icon: 'radar',
                route: '/operations/metrics/competitor-intel',
                badge: { text: 'MeLi', color: 'bg-yellow-500' }
            }
        ]
    },
    {
        id: 'channels',
        title: 'Marketplaces', // Add translation key later
        icon: 'shopping-cart',
        children: [
            {
                id: 'mercadolibre',
                title: 'MercadoLibre Hub',
                icon: 'shopping-bag',
                route: '/operations/channels/mercadolibre'
            },
            {
                id: 'amazon',
                title: 'Amazon Hub',
                icon: 'package',
                route: '/operations/channels/amazon',
                badge: { text: 'NEW', color: 'bg-orange-500' }
            }
        ]
    }
];
