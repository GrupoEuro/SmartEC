import { NavItem } from './admin-navigation.config';

export const MARKETING_NAVIGATION_CONFIG: NavItem[] = [
    // ── Overview ────────────────────────────────────────────────────────────
    {
        id: 'mh_dashboard',
        title: 'MARKETING.SIDEBAR.DASHBOARD',
        icon: 'layout-dashboard',
        route: '/marketing/dashboard',
    },

    // ── Campaigns ────────────────────────────────────────────────────────────
    {
        id: 'mh_campaigns',
        title: 'MARKETING.SIDEBAR.SECTION_CAMPAIGNS',
        icon: 'megaphone',
        children: [
            {
                id: 'mh_campaigns_list',
                title: 'MARKETING.SIDEBAR.CAMPAIGNS',
                icon: 'target',
                route: '/marketing/campaigns',
            },
            {
                id: 'mh_coupons',
                title: 'MARKETING.SIDEBAR.COUPONS',
                icon: 'qr-code',
                route: '/marketing/coupons',
                badge: { text: 'QR', color: 'bg-indigo-600' }
            },
        ]
    },

    // ── Analytics ────────────────────────────────────────────────────────────
    {
        id: 'mh_analytics',
        title: 'MARKETING.SIDEBAR.SECTION_ANALYTICS',
        icon: 'bar-chart-2',
        children: [
            {
                id: 'mh_ai_analytics',
                title: 'MARKETING.SIDEBAR.AI_ANALYTICS',
                icon: 'cpu',
                route: '/marketing/ai-analytics',
                badge: { text: 'BETA', color: 'bg-indigo-600' }
            },
            {
                id: 'mh_attribution',
                title: 'MARKETING.SIDEBAR.ATTRIBUTION',
                icon: 'bar-chart-2',
                route: '/marketing/attribution',
            },
            {
                id: 'mh_whatsapp',
                title: 'MARKETING.SIDEBAR.WHATSAPP',
                icon: 'message-circle',
                route: '/marketing/whatsapp',
                badge: { text: 'WA', color: 'bg-emerald-500' }
            },
            {
                id: 'mh_abandoned_carts',
                title: 'MARKETING.SIDEBAR.ABANDONED_CARTS',
                icon: 'shopping-cart',
                route: '/marketing/abandoned-carts',
            },
        ]
    },

    // ── Customer Intelligence ─────────────────────────────────────────────────
    {
        id: 'mh_intelligence',
        title: 'MARKETING.SIDEBAR.SECTION_INTELLIGENCE',
        icon: 'users',
        children: [
            {
                id: 'mh_segments',
                title: 'MARKETING.SIDEBAR.SEGMENTS',
                icon: 'pie-chart',
                route: '/marketing/segments',
                badge: { text: 'RFM', color: 'bg-amber-500' }
            },
        ]
    },
];
