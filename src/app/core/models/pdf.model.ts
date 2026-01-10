export interface PDF {
    id?: string;
    title: {
        es: string;
        en: string;
    };
    description: {
        es: string;
        en: string;
    };
    category: 'catalog' | 'technical' | 'promotional' | 'price-list' | 'other';
    fileUrl: string;
    fileName: string;
    fileSize: number; // in bytes
    thumbnailUrl?: string;
    isPublic: boolean; // true = free download, false = restricted
    requiresAuth: boolean; // requires login to download
    downloadCount: number;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    createdBy: string; // admin user ID
    active: boolean; // for soft delete
}

export interface PDFFormData {
    title_es: string;
    title_en: string;
    description_es: string;
    description_en: string;
    category: string;
    isPublic: boolean;
    requiresAuth: boolean;
    tags: string;
    file?: File;
    thumbnail?: File;
}
