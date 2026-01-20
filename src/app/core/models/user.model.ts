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

export interface TaxInfo {
    rfc: string;           // Registro Federal de Contribuyentes
    legalName: string;     // Razón Social
    fiscalRegime: string;  // Régimen Fiscal (e.g., 601)
    fiscalZip: string;     // Código Postal Fiscal 
    cfdiUse: string;       // Uso de CFDI (e.g., G03)
    constanciaFiscalUrl?: string; // Optional: URL to uploaded PDF
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
    taxInfo?: TaxInfo; // SAT / Invoicing Data
    shippingAddress?: any; // To be typed rigidly later if needed
}
