import { Timestamp } from '@angular/fire/firestore';

export interface AppNotification {
    id?: string;
    type: 'info' | 'warning' | 'success' | 'error';
    title: string;
    message: string;
    timestamp: Date;
    read: boolean;
    link?: string; // Optional deep link to a relevant resource (e.g., /orders/123)
    metadata?: any; // Flexible field for custom data
}
