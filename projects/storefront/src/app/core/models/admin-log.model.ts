export interface AdminLog {
    id?: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'REGISTER';
    module: 'BANNER' | 'BLOG' | 'AUTH';
    targetId?: string;
    details: string;
    timestamp: Date;
    userEmail: string;
    userId: string;
    ipAddress?: string;
}
