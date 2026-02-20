import { Timestamp } from '@angular/fire/firestore';

export type NoteType = 'info' | 'warning' | 'issue';

export interface OrderNote {
    id?: string;
    orderId: string;
    text: string;
    createdBy: string;        // User ID
    createdByName: string;    // Display name
    createdAt: Timestamp;
    updatedAt?: Timestamp;
    type: NoteType;
    isInternal: boolean;      // Internal vs customer-facing
    isResolved?: boolean;     // For issues
}
