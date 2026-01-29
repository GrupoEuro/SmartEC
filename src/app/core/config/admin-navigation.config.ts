export interface NavItem {
    id: string;
    title: string;      // Translation key or raw text if needed
    icon: string;       // Icon name for AppIconComponent
    route?: string;     // Router link
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
                id: 'products',
                title: 'ADMIN.SIDEBAR.PRODUCTS',
                icon: 'package',
                route: '/admin/products'
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
                id: 'banners',
                title: 'ADMIN.SIDEBAR.BANNERS',
                icon: 'layers',
                route: '/admin/banners'
            },
            {
                id: 'blog',
                title: 'ADMIN.SIDEBAR.BLOG',
                icon: 'edit',
                route: '/admin/blog'
            },
            {
                id: 'media_library',
                title: 'Media Library',
                icon: 'image',
                route: '/admin/media-library'
            },
            {
                id: 'pdf_library',
                title: 'ADMIN.SIDEBAR.PDF_LIBRARY',
                icon: 'document',
                route: '/admin/pdf-library'
            }
        ]
    },
    {
        id: 'integrations',
        title: 'ADMIN.SIDEBAR.INTEGRATIONS',
        icon: 'link',
        route: '/admin/integrations',
        badge: {
            text: 'BETA',
            color: 'bg-indigo-500'
        }
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
                id: 'settings',
                title: 'ADMIN.SIDEBAR.SETTINGS', // Define new key
                icon: 'settings',
                route: '/admin/settings'
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
