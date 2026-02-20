
import { Timestamp } from '@angular/fire/firestore';

export interface UnifiedCustomer {
    id: string; // Master ID (could be the Web User ID or a generated hash)

    // Identity
    displayName: string;
    email: string;
    phone?: string;
    avatarUrl?: string;

    // The "Golden Record"
    channels: string[]; // ['WEB', 'AMAZON_FBA', 'POS']
    linkedIds: string[]; // ['uid_123', 'amazon_cust_555']

    // Unified Metrics
    totalLifetimeValue: number;
    totalOrders: number;
    avgOrderValue: number;
    firstSeen: Date | Timestamp;
    lastSeen: Date | Timestamp;

    // Channel Breakdown
    channelBreakdown: {
        channel: string;
        spend: number;
        orders: number;
    }[];
}
