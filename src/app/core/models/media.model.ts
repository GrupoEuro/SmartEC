import { Timestamp } from 'firebase/firestore';

export interface MediaAsset {
    id?: string;
    storagePath: string; // Path in Firebase Storage (e.g., 'media/2024/01/image.jpg')
    publicUrl: string;   // Public downloadable URL
    filename: string;
    contentType: string; // e.g., 'image/jpeg', 'image/png'
    size: number;        // Size in bytes
    metadata: {
        width: number;
        height: number;
        altText: string;
        tags: string[];
        category: string; // 'products', 'banners', 'ui', 'documents'
        uploadedBy?: string; // User ID
    };
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

export interface MediaFilter {
    category?: string;
    tag?: string;
    search?: string;
    limit?: number;
    startAfter?: any; // For pagination
    sortField?: 'createdAt' | 'size' | 'filename';
    sortDirection?: 'asc' | 'desc';
}
