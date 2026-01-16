import { Timestamp } from '@angular/fire/firestore';

export interface SharedLink {
    id: string;              // Unique slug (e.g., 'Xy9zK2')
    assetId: string;         // Reference to source PDF
    assetUrl: string;        // Snapshot of URL at creation
    assetName: string;       // Display name
    contentType: string;     // e.g. 'application/pdf'
    createdBy: string;       // Admin UID
    createdAt: Timestamp;
    expiresAt?: Timestamp;   // Optional expiration
    isActive: boolean;       // Manual kill switch
    requireEmail: boolean;   // Gatekeeper: Must enter email to view
    password?: string;       // Gatekeeper: Optional password
    settings: {
        allowDownload: boolean;// Default: false
        allowPrint: boolean;   // Default: false
    };
    stats: {
        totalViews: number;
        uniqueViewers: number;
    }
}

export interface LinkSession {
    id: string;
    linkId: string;
    viewerEmail?: string;    // If requireEmail=true
    ipAddress?: string;      // Anonymized if needed
    userAgent: string;       // Device/Browser info
    startTime: Timestamp;
    lastActive: Timestamp;
    durationSeconds: number; // Updated via heartbeat
    pagesViewed: number[];   // Array of page numbers visited
}
