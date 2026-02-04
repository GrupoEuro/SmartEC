import { Timestamp } from 'firebase/firestore';

export interface MediaFolder {
    id?: string;
    name: string;
    parentId: string | null; // null for root folders
    path: string; // Breadcrumb path string, e.g., "products/summer"
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

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
        category: string; // Legacy category support, eventually rely entirely on folders
        folderId?: string | null; // ID of the folder this asset belongs to
        uploadedBy?: string; // User ID
    };
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

export interface MediaFilter {
    category?: string;
    folderId?: string; // Filter by specific folder ID
    tag?: string;
    searchQuery?: string;
    search?: string;
    limit?: number;
    startAfter?: any; // For pagination
    sortField?: 'createdAt' | 'size' | 'filename';
    sortDirection?: 'asc' | 'desc';
    type?: 'image' | 'video' | 'document' | 'audio' | 'vector' | 'all';
    lastDoc?: any;
}
