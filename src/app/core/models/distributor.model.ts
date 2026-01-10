export interface DistributorSubmission {
    id: string;
    name: string;
    business: string;
    email: string;
    phone: string;
    state: string;
    volume: string;
    comments: string;
    createdAt: Date;
    status?: 'new' | 'contacted' | 'pending' | 'converted' | 'rejected';
    notes?: string;
    contactedBy?: string;
    contactedAt?: Date;
}
