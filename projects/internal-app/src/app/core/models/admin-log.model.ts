export interface AdminLog {
    id?: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'REGISTER' | 'UNAUTHORIZED';
    module: 'BANNER' | 'BLOG' | 'AUTH' | 'SECURITY' | 'PRICING';
    targetId?: string;
    details: string;
    timestamp: Date;
    userEmail: string;
    userId: string;
    ipAddress?: string;
}
