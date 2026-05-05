import { NavItem } from './admin-navigation.config';

export const CUSTOMER_CARE_NAVIGATION_CONFIG: NavItem[] = [

    // ── Inbox ────────────────────────────────────────────────────────────────
    {
        id: 'cc_inbox',
        title: 'Inbox',
        icon: 'inbox',
        route: '/customer-care/inbox',
        badge: { text: 'LIVE', color: 'bg-emerald-500' }
    },

    // ── Channels ─────────────────────────────────────────────────────────────
    {
        id: 'cc_channels',
        title: 'Canales',
        icon: 'layers',
        children: [
            {
                id: 'cc_website',
                title: 'Chat Web',
                icon: 'globe',
                route: '/customer-care/inbox',
                queryParams: { channel: 'website' },
                badge: { text: 'Web', color: 'bg-violet-600' }
            },
            {
                id: 'cc_whatsapp',
                title: 'WhatsApp',
                icon: 'message-circle',
                route: '/customer-care/inbox',
                queryParams: { channel: 'whatsapp' },
                badge: { text: 'WA', color: 'bg-emerald-500' }
            },
            {
                id: 'cc_instagram',
                title: 'Instagram',
                icon: 'instagram',
                route: '/customer-care/inbox',
                queryParams: { channel: 'instagram' },
                badge: { text: 'IG', color: 'bg-purple-600' }
            },
            {
                id: 'cc_facebook',
                title: 'Facebook',
                icon: 'facebook',
                route: '/customer-care/inbox',
                queryParams: { channel: 'facebook' },
                badge: { text: 'FB', color: 'bg-blue-500' }
            },
            {
                id: 'cc_telegram',
                title: 'Telegram',
                icon: 'send',
                route: '/customer-care/inbox',
                queryParams: { channel: 'telegram' },
                badge: { text: 'TG', color: 'bg-sky-500' }
            },
            {
                id: 'cc_email',
                title: 'Email',
                icon: 'mail',
                route: '/customer-care/inbox',
                queryParams: { channel: 'email' },
            },
            {
                id: 'cc_mercadolibre',
                title: 'MercadoLibre',
                icon: 'shopping-bag',
                route: '/customer-care/inbox',
                queryParams: { channel: 'mercadolibre' },
                badge: { text: 'ML', color: 'bg-amber-500' }
            },
        ]
    },

    // ── Management ───────────────────────────────────────────────────────────
    {
        id: 'cc_management',
        title: 'Gestión',
        icon: 'settings',
        children: [
            {
                id: 'cc_all_conversations',
                title: 'Todas las Conversaciones',
                icon: 'message-square',
                route: '/customer-care/conversations',
            },
            {
                id: 'cc_analytics',
                title: 'Analíticas',
                icon: 'bar-chart-2',
                route: '/customer-care/analytics',
            },
        ]
    },
];
