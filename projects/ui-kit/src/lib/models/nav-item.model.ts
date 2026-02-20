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
