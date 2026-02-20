import { Timestamp } from '@angular/fire/firestore';

export interface OrderAssignment {
    id?: string;
    orderId: string;
    assignedTo: string;      // User ID
    assignedToName: string;  // Display name
    assignedBy: string;      // User ID
    assignedByName: string;  // Display name
    assignedAt: Timestamp;
    status: 'assigned' | 'in-progress' | 'completed';
    notes?: string;
    completedAt?: Timestamp;
}
