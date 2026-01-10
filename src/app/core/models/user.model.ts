export type UserRole =
    | 'SUPER_ADMIN'    // Full access to everything
    | 'MANAGER'        // Command Center + read-only elsewhere
    | 'ADMIN'          // Admin Panel only
    | 'OPERATIONS'     // Operations Portal only
    | 'EDITOR'         // Content management
    | 'CUSTOMER';      // Public site users

export interface CustomerStats {
    totalOrders: number;
    totalSpend: number;
    lastOrderDate?: any; // Timestamp
    averageOrderValue: number;
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    role: UserRole;
    isActive: boolean;
    createdAt: any; // Timestamp
    lastLogin?: any; // Timestamp

    // CRM
    stats?: CustomerStats;
    phone?: string;
    shippingAddress?: any; // To be typed rigidly later if needed
}
