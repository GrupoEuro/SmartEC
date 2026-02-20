export interface PDFDownload {
    id?: string;
    pdfId: string;
    pdfTitle: string; // for easier querying
    ipAddressHash: string; // hashed IP for privacy
    userAgent: string;
    timestamp: Date;
    userId?: string; // if user is authenticated
    userEmail?: string; // if user is authenticated
    success: boolean; // whether download completed
}

export interface DownloadRateLimit {
    ipAddressHash: string;
    downloads: number;
    firstDownloadAt: Date;
    lastDownloadAt: Date;
}
