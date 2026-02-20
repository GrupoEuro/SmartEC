import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, collection, collectionData, doc, docData, addDoc, updateDoc, deleteDoc, query, where, orderBy, Timestamp, increment } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, from, map, switchMap, of, throwError } from 'rxjs';
import { PDF, PDFFormData } from '../models/pdf.model';
import { PDFDownload } from '../models/pdf-download.model';
import { AuthService } from './auth.service';
import * as CryptoJS from 'crypto-js';

@Injectable({
    providedIn: 'root'
})
export class PdfService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);
    private authService = inject(AuthService);
    private platformId = inject(PLATFORM_ID);

    private pdfsCollection = collection(this.firestore, 'pdfs');
    private downloadsCollection = collection(this.firestore, 'pdf_downloads');

    // Rate limit: 5 downloads per hour
    private readonly RATE_LIMIT_MAX = 5;
    private readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

    /**
     * Get all PDFs (admin only)
     */
    getAllPDFs(): Observable<PDF[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const q = query(
            this.pdfsCollection,
            where('active', '==', true),
            orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<PDF[]>;
    }

    /**
     * Get only public PDFs (for public library page)
     */
    getPublicPDFs(): Observable<PDF[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const q = query(
            this.pdfsCollection,
            where('active', '==', true),
            where('isPublic', '==', true),
            orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<PDF[]>;
    }

    /**
     * Get PDF by ID
     */
    getPDFById(id: string): Observable<PDF> {
        if (!isPlatformBrowser(this.platformId)) {
            // Return dummy observable to satisfy type, won't emit
            return of({} as PDF);
        }
        const docRef = doc(this.firestore, `pdfs/${id}`) as any;
        return docData(docRef, { idField: 'id' }) as Observable<PDF>;
    }

    /**
     * Create new PDF
     */
    createPDF(formData: PDFFormData, file: File, thumbnail?: File): Observable<string> {
        return this.authService.user$.pipe(
            switchMap(user => {
                if (!user) {
                    return throwError(() => new Error('User not authenticated'));
                }

                // Upload PDF file first
                return from(this.uploadPDFFile(file)).pipe(
                    switchMap(fileUrl => {
                        // Upload thumbnail if provided
                        if (thumbnail) {
                            return from(this.uploadThumbnail(thumbnail)).pipe(
                                switchMap(thumbnailUrl => {
                                    const pdf: any = {
                                        title: {
                                            es: formData.title_es,
                                            en: formData.title_en
                                        },
                                        description: {
                                            es: formData.description_es,
                                            en: formData.description_en
                                        },
                                        category: formData.category,
                                        fileUrl,
                                        fileName: file.name,
                                        fileSize: file.size,
                                        thumbnailUrl: thumbnailUrl,
                                        isPublic: formData.isPublic,
                                        requiresAuth: formData.requiresAuth,
                                        downloadCount: 0,
                                        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
                                        createdAt: new Date(),
                                        updatedAt: new Date(),
                                        createdBy: user.uid,
                                        active: true
                                    };

                                    return from(addDoc(this.pdfsCollection, pdf)).pipe(
                                        map(docRef => docRef.id)
                                    );
                                })
                            );
                        } else {
                            const pdf: any = {
                                title: {
                                    es: formData.title_es,
                                    en: formData.title_en
                                },
                                description: {
                                    es: formData.description_es,
                                    en: formData.description_en
                                },
                                category: formData.category,
                                fileUrl,
                                fileName: file.name,
                                fileSize: file.size,
                                isPublic: formData.isPublic,
                                requiresAuth: formData.requiresAuth,
                                downloadCount: 0,
                                tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                createdBy: user.uid,
                                active: true
                            };

                            return from(addDoc(this.pdfsCollection, pdf)).pipe(
                                map(docRef => docRef.id)
                            );
                        }
                    })
                );
            })
        );
    }

    /**
     * Update existing PDF
     */
    updatePDF(id: string, formData: PDFFormData, file?: File, thumbnail?: File): Observable<void> {
        const docRef = doc(this.firestore, `pdfs/${id}`) as any;

        const updateData: any = {
            title: {
                es: formData.title_es,
                en: formData.title_en
            },
            description: {
                es: formData.description_es,
                en: formData.description_en
            },
            category: formData.category,
            isPublic: formData.isPublic,
            requiresAuth: formData.requiresAuth,
            tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
            updatedAt: new Date()
        };

        // Handle file uploads sequentially
        if (file) {
            return from(this.uploadPDFFile(file)).pipe(
                switchMap(fileUrl => {
                    updateData.fileUrl = fileUrl;
                    updateData.fileName = file.name;
                    updateData.fileSize = file.size;

                    if (thumbnail) {
                        return from(this.uploadThumbnail(thumbnail)).pipe(
                            switchMap(thumbnailUrl => {
                                updateData.thumbnailUrl = thumbnailUrl;
                                return from(updateDoc(docRef, updateData));
                            })
                        );
                    } else {
                        return from(updateDoc(docRef, updateData));
                    }
                })
            );
        } else if (thumbnail) {
            return from(this.uploadThumbnail(thumbnail)).pipe(
                switchMap(thumbnailUrl => {
                    updateData.thumbnailUrl = thumbnailUrl;
                    return from(updateDoc(docRef, updateData));
                })
            );
        } else {
            return from(updateDoc(docRef, updateData));
        }
    }

    /**
     * Soft delete PDF
     */
    deletePDF(id: string): Observable<void> {
        const docRef = doc(this.firestore, `pdfs/${id}`);
        return from(updateDoc(docRef, { active: false, updatedAt: new Date() }));
    }

    /**
     * Upload PDF file to Firebase Storage
     */
    private async uploadPDFFile(file: File): Promise<string> {
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.name}`;
        const storageRef = ref(this.storage, `pdfs/${fileName}`);

        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    }

    /**
     * Upload thumbnail image to Firebase Storage
     */
    private async uploadThumbnail(file: File): Promise<string> {
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.name}`;
        const storageRef = ref(this.storage, `pdf-thumbnails/${fileName}`);

        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    }

    /**
     * Check if user can download (rate limiting)
     */
    canDownload(ipAddress: string): Observable<boolean> {
        if (!isPlatformBrowser(this.platformId)) {
            return of(true);
        }
        const ipHash = this.hashIP(ipAddress);
        const oneHourAgo = new Date(Date.now() - this.RATE_LIMIT_WINDOW);

        const q = query(
            this.downloadsCollection,
            where('ipAddressHash', '==', ipHash),
            where('timestamp', '>=', oneHourAgo)
        );

        return (collectionData(q) as Observable<PDFDownload[]>).pipe(
            map(downloads => downloads.length < this.RATE_LIMIT_MAX)
        );
    }

    /**
     * Track download attempt
     */
    trackDownload(pdfId: string, pdfTitle: string, ipAddress: string, userAgent: string, success: boolean = true): Observable<void> {
        return this.authService.user$.pipe(
            switchMap(user => {
                const download: Omit<PDFDownload, 'id'> = {
                    pdfId,
                    pdfTitle,
                    ipAddressHash: this.hashIP(ipAddress),
                    userAgent,
                    timestamp: new Date(),
                    userId: user?.uid,
                    userEmail: user?.email || undefined,
                    success
                };

                return from(addDoc(this.downloadsCollection, download)).pipe(
                    map(() => undefined)
                );
            })
        );
    }

    /**
     * Increment download counter
     */
    incrementDownloadCount(pdfId: string): Observable<void> {
        const docRef = doc(this.firestore, `pdfs/${pdfId}`);
        return from(updateDoc(docRef, { downloadCount: increment(1) }));
    }

    /**
     * Hash IP address for privacy
     */
    private hashIP(ip: string): string {
        return CryptoJS.SHA256(ip).toString();
    }

    /**
     * Get download statistics for a PDF
     */
    getDownloadStats(pdfId: string): Observable<PDFDownload[]> {
        if (!isPlatformBrowser(this.platformId)) {
            return of([]);
        }
        const q = query(
            this.downloadsCollection,
            where('pdfId', '==', pdfId),
            orderBy('timestamp', 'desc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<PDFDownload[]>;
    }
}
