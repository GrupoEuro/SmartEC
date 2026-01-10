import { Timestamp } from '@angular/fire/firestore';

export type PriorityLevel = 'standard' | 'express' | 'rush';

export interface OrderPriority {
    orderId: string;
    level: PriorityLevel;
    sla: Timestamp;          // Expected ship date
    orderAge: number;        // Hours since order
    isOverdue: boolean;
    createdAt: Timestamp;
    updatedAt?: Timestamp;
}

export interface PriorityConfig {
    standard: number;  // Hours
    express: number;   // Hours
    rush: number;      // Hours
}

// Default SLA configurations (in hours)
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
    standard: 72,  // 3 days
    express: 48,   // 2 days
    rush: 24       // 1 day
};
