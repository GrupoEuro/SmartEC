export interface NavItem {
    id: string;
    title: string;      // Translation key or raw text if needed
    icon: string;       // Icon name for AppIconComponent
    route?: string;     // Router link
    queryParams?: Record<string, string>;  // Optional query params for routerLink
    children?: NavItem[];
    roles?: string[];   // Roles allowed to see this item
    badge?: {
        text: string;
        color?: string; // tw class like 'bg-orange-500'
    };
    divider?: boolean; // If true, rendering a decorative divider above
}

export const ADMIN_NAVIGATION: NavItem[] = [
    {
        id: 'dashboard',
        title: 'ADMIN.SIDEBAR.DASHBOARD',
        icon: 'layout-dashboard',
        route: '/admin/dashboard'
    },
    {
        id: 'business',
        title: 'ADMIN.SIDEBAR.SECTION_BUSINESS',
        icon: 'briefcase',
        children: [
            {
                id: 'warehouses',
                title: 'ADMIN.WAREHOUSES.TITLE',
                icon: 'box',
                route: '/admin/warehouses'
            },
            {
                id: 'distributors',
                title: 'ADMIN.SIDEBAR.DISTRIBUTORS',
                icon: 'users',
                route: '/admin/distributors'
            },
            {
                id: 'customers',
                title: 'ADMIN.SIDEBAR.CUSTOMERS',
                icon: 'user-check',
                route: '/admin/customers'
            }
        ]
    },
    {
        id: 'ecommerce',
        title: 'ADMIN.SIDEBAR.SECTION_ECOMMERCE',
        icon: 'cart',
        children: [
            {
                id: 'catalog_overview',
                title: 'ADMIN.SIDEBAR.CATALOG_OVERVIEW',
                icon: 'pie-chart',
                route: '/admin/catalog-overview'
            },
            {
                id: 'products',
                title: 'ADMIN.SIDEBAR.PRODUCTS',
                icon: 'package',
                route: '/admin/products'
            },
            {
                id: 'kits',
                title: 'ADMIN.SIDEBAR.KITS',
                icon: 'gift',
                route: '/admin/kits'
            },
            {
                id: 'product_types',
                title: 'ADMIN.SIDEBAR.PRODUCT_TYPES',
                icon: 'layers',
                route: '/admin/product-types'
            },
            {
                id: 'categories',
                title: 'ADMIN.SIDEBAR.CATEGORIES',
                icon: 'grid',
                route: '/admin/categories'
            },
            {
                id: 'brands',
                title: 'ADMIN.SIDEBAR.BRANDS',
                icon: 'tag',
                route: '/admin/brands'
            },
            {
                id: 'sales_history',
                title: 'ADMIN.SIDEBAR.ORDERS',
                icon: 'file-text',
                route: '/admin/orders'
            }
        ]
    },
    {
        id: 'content',
        title: 'ADMIN.SIDEBAR.SECTION_CONTENT',
        icon: 'folder',
        children: [

            {
                id: 'blog',
                title: 'ADMIN.SIDEBAR.BLOG',
                icon: 'edit',
                route: '/admin/blog'
            },
            {
                id: 'media_library',
                title: 'ADMIN.SIDEBAR.MEDIA_LIBRARY',
                icon: 'image',
                route: '/admin/media-library'
            },
            {
                id: 'pdfs',
                title: 'ADMIN.SIDEBAR.PDF_LIBRARY',
                icon: 'file-text',
                route: '/admin/pdfs'
            }
        ]
    },
    {
        id: 'marketing',
        title: 'ADMIN.SIDEBAR.SECTION_MARKETING',
        icon: 'trending-up',
        children: [
            // Promotions engine stays in Admin (CMS creation tool)
            {
                id: 'promotions',
                title: 'ADMIN.SIDEBAR.PROMOTIONS',
                icon: 'zap',
                route: '/admin/promotions'
            },
            // Coupons form creation stays in Admin (CMS)
            {
                id: 'coupons',
                title: 'ADMIN.SIDEBAR.COUPONS',
                icon: 'gift',
                route: '/admin/coupons'
            },
            // Campaign builder stays in Admin (CMS creation)
            {
                id: 'campaigns',
                title: 'ADMIN.SIDEBAR.CAMPAIGNS',
                icon: 'target',
                route: '/admin/marketing/campaigns'
            },
            // Competitor Intelligence
            {
                id: 'competitor_intel',
                title: 'ADMIN.SIDEBAR.COMPETITOR_INTEL',
                icon: 'radar',
                route: '/admin/marketing/competitor-intel',
                badge: { text: 'MeLi', color: 'bg-yellow-500' }
            },
            // ── Jump to Marketing Hub ──────────────────────────────
            {
                id: 'go_marketing_hub',
                title: 'ADMIN.SIDEBAR.GO_MARKETING_HUB',
                icon: 'bar-chart-2',
                route: '/marketing/dashboard',
                badge: { text: 'Hub', color: 'bg-indigo-600' },
                divider: true
            }
        ]
    },

    {
        id: 'system',
        title: 'ADMIN.SIDEBAR.SECTION_SYSTEM',
        icon: 'settings',
        children: [
            {
                id: 'staff',
                title: 'ADMIN.SIDEBAR.STAFF',
                icon: 'shield',
                route: '/admin/staff'
            },
            {
                id: 'users',
                title: 'ADMIN.SIDEBAR.USERS',
                icon: 'user', // or 'users'
                route: '/admin/users'
            },
            {
                id: 'themes',
                title: 'ADMIN.SIDEBAR.THEMES',
                icon: 'palette',
                route: '/admin/themes'
            },

            {
                id: 'settings',
                title: 'ADMIN.SIDEBAR.SETTINGS', // Define new key
                icon: 'settings',
                route: '/admin/settings'
            },
            {
                id: 'integrations',
                title: 'ADMIN.SIDEBAR.INTEGRATIONS',
                icon: 'power-plug',
                route: '/admin/integrations'
            },
            {
                id: 'tracking',
                title: 'Tracking & Pixels',
                icon: 'bar-chart-2',
                route: '/admin/tracking',
                badge: { text: 'Marketing', color: 'bg-violet-600' }
            },
            {
                id: 'seo',
                title: 'SEO / GEO / IA',
                icon: 'search',
                route: '/admin/seo',
                badge: { text: 'Nuevo', color: 'bg-emerald-600' }
            },
            {
                id: 'inbox_channels',
                title: 'Configuración de Canales',
                icon: 'inbox',
                route: '/admin/customer-care',
            },
            {
                id: 'ai_agents',
                title: 'EuroMind — Agentes IA',
                icon: 'cpu',
                route: '/admin/ai-agents',
                badge: { text: 'IA', color: 'bg-violet-600' }
            },
            {
                id: 'ai_agents_settings',
                title: 'Configuración de IA',
                icon: 'sliders',
                route: '/admin/ai-agents/settings',
            },
            {
                id: 'logs',
                title: 'ADMIN.SIDEBAR.LOGS',
                icon: 'activity',
                route: '/admin/logs'
            }
        ]
    }
];
