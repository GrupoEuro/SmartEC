export interface RouteNode {
    path: string;
    label: string;
    icon: string;
    type: 'public' | 'admin' | 'ops' | 'system' | 'dev';
    children?: RouteNode[];
}

export const APP_MAP: RouteNode[] = [
    {
        path: '/',
        label: 'Public Platform',
        icon: 'globe',
        type: 'public',
        children: [
            { path: '', label: 'Home Page', icon: 'home', type: 'public' },
            { path: 'praxis', label: 'Praxis Brand', icon: 'check-circle', type: 'public' },
            {
                path: 'blog',
                label: 'Blog',
                icon: 'file-text',
                type: 'public',
                children: [
                    { path: ':slug', label: 'Article Detail', icon: 'file-text', type: 'public' }
                ]
            },
            { path: 'biblioteca', label: 'PDF Library', icon: 'paperclip', type: 'public' },
            {
                path: 'catalog',
                label: 'Catalog',
                icon: 'box',
                type: 'public',
                children: [
                    { path: 'product/:slug', label: 'Product Detail', icon: 'tag', type: 'public' }
                ]
            },
            { path: 'terms', label: 'Terms & Conditions', icon: 'scale', type: 'public' },
            { path: 'privacy', label: 'Privacy Policy', icon: 'lock', type: 'public' }
        ]
    },
    {
        path: '/operations',
        label: 'Operations Portal',
        icon: 'briefcase',
        type: 'ops',
        children: [
            { path: 'dashboard', label: 'Ops Dashboard', icon: 'activity', type: 'ops' },
            {
                path: 'orders',
                label: 'Order Queue',
                icon: 'list',
                type: 'ops',
                children: [
                    { path: 'new', label: 'Order Builder', icon: 'plus-square', type: 'ops' },
                    { path: ':id', label: 'Fulfillment', icon: 'check-square', type: 'ops' }
                ]
            },
            {
                path: 'customers',
                label: 'Customer Lookup',
                icon: 'users',
                type: 'ops',
                children: [
                    { path: ':id', label: 'Profile', icon: 'user', type: 'ops' }
                ]
            },
            { path: 'inventory', label: 'Inventory Lookup', icon: 'box', type: 'ops' },
            { path: 'promotions', label: 'Promo Reference', icon: 'gift', type: 'ops' }
        ]
    },
    {
        path: '/command-center',
        label: 'Command Center',
        icon: 'command-center',
        type: 'system',
        children: [
            { path: 'dashboard', label: 'Executive Dashboard', icon: 'activity', type: 'system' },
            {
                path: 'approvals',
                label: 'Approvals Hub',
                icon: 'check-circle',
                type: 'system',
                children: [
                    { path: ':id', label: 'Request Details', icon: 'file-text', type: 'system' }
                ]
            },
            { path: 'financials', label: 'Financial Overview', icon: 'dollar-sign', type: 'system' },
            { path: 'income-statement', label: 'Income Statement', icon: 'file-text', type: 'system' },
            { path: 'expenses', label: 'OpEx Management', icon: 'credit-card', type: 'system' },
            { path: 'sales-analytics', label: 'Sales Analytics', icon: 'bar-chart', type: 'system' },
            { path: 'inventory-analytics', label: 'Inventory Intelligence', icon: 'box', type: 'system' },
            { path: 'customer-insights', label: 'Customer 360', icon: 'users', type: 'system' },
            { path: 'operational-metrics', label: 'Ops Metrics', icon: 'activity', type: 'system' }
        ]
    },
    {
        path: '/admin',
        label: 'Admin Panel',
        icon: 'shield',
        type: 'admin',
        children: [
            { path: 'dashboard', label: 'Admin Dashboard', icon: 'home', type: 'admin' },
            { path: 'catalog-overview', label: 'Catalog Manager', icon: 'box', type: 'admin' },
            { path: 'populate-data', label: 'Legacy Seeder', icon: 'database', type: 'admin' },
            { path: 'banners', label: 'Banners', icon: 'image', type: 'admin' },
            { path: 'orders', label: 'Order Manager', icon: 'shopping-cart', type: 'admin' },
            { path: 'brands', label: 'Brands', icon: 'tag', type: 'admin' },
            { path: 'categories', label: 'Categories', icon: 'layers', type: 'admin' },
            { path: 'products', label: 'Products', icon: 'box', type: 'admin' },
            { path: 'customers', label: 'Customers', icon: 'users', type: 'admin' },
            { path: 'users', label: 'Staff Users', icon: 'user-check', type: 'admin' },
            { path: 'settings', label: 'Global Settings', icon: 'settings', type: 'admin' }
        ]
    },
    {
        path: '/dev-tools',
        label: 'Developer Tools',
        icon: 'tool',
        type: 'dev',
        children: [
            { path: 'icons', label: 'Icon Library', icon: 'image', type: 'dev' },
            { path: 'libraries', label: 'Stack Explorer', icon: 'layers', type: 'dev' },
            { path: 'stats', label: 'Project Vitality', icon: 'activity', type: 'dev' },
            { path: 'theme', label: 'Theme Playground', icon: 'layout', type: 'dev' },
            { path: 'permissions', label: 'Permissions Map', icon: 'lock', type: 'dev' },
            { path: 'data', label: 'Simulation Engine', icon: 'database', type: 'dev' },
            { path: 'database', label: 'DB Visualizer', icon: 'server', type: 'dev' },
            { path: 'logs', label: 'Log Explorer', icon: 'file-text', type: 'dev' },
            { path: 'routes', label: 'Route Visualizer', icon: 'map', type: 'dev' },
            { path: 'state', label: 'State Inspector', icon: 'camera', type: 'dev' },
            { path: 'firestore', label: 'Firestore Monitor', icon: 'activity', type: 'dev' },
            { path: 'i18n', label: 'I18n Studio', icon: 'globe', type: 'dev' },
            { path: 'config', label: 'System Config', icon: 'settings', type: 'dev' },

            { path: 'doc-generator', label: 'Document Generator', icon: 'file-text', type: 'dev' }
        ]
    }
];
