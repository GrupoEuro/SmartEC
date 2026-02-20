
import { UserProfile } from './user.model';
import { Timestamp } from '@angular/fire/firestore';

export type Department = 'WAREHOUSE' | 'LOGISTICS' | 'SUPPORT' | 'ADMIN' | 'SALES' | 'IT';
export type StaffStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'ON_BREAK';

export interface StaffProfile {
    uid: string;              // Foreign Key to users collection
    email: string;            // Denormalized for searching
    displayName: string;      // Denormalized

    // Org Details
    department: Department;
    jobTitle: string;
    employeeId?: string;      // Internal ID e.g. "EMP-001"

    // Operational Context
    assignedWarehouseId?: string; // ID of primary warehouse
    allowedWarehouseIds?: string[]; // IDs of accessible warehouses

    // Support Context
    skills?: string[];        // e.g. 'RETURNS', 'TECH'

    // State
    status: StaffStatus;
    lastActive?: Timestamp;

    created_at: Timestamp;
    updated_at: Timestamp;
}

// Composite Type for UI
export interface StaffMember extends UserProfile {
    profile?: StaffProfile; // Extended data
}
