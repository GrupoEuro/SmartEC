import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { NgxExtendedPdfViewerModule, PDFNotificationService } from 'ngx-extended-pdf-viewer';
import { DocumentSharingService } from '../../../core/services/document-sharing.service';
import { SharedLink } from '../../../core/models/shared-link.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-document-viewer',
    standalone: true,
    imports: [CommonModule, FormsModule, NgxExtendedPdfViewerModule, AppIconComponent],
    templateUrl: './document-viewer.component.html',
    styleUrls: ['./document-viewer.component.css']
})
export class DocumentViewerComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private sharingService = inject(DocumentSharingService);
    private titleService = inject(Title);
    private pdfNotificationService = inject(PDFNotificationService);

    slug = '';
    link = signal<SharedLink | null>(null);
    isLoading = signal(true);
    error = signal<string | null>(null);

    // Gatekeeper State
    accessGranted = signal(false);
    emailInput = '';
    passwordInput = '';
    isVerifying = signal(false);

    // Tracking State
    sessionId: string | null = null;
    startTime = Date.now();
    heartbeatInterval: any;
    pagesViewed = new Set<number>();

    ngOnInit() {
        this.slug = this.route.snapshot.paramMap.get('slug') || '';
        if (!this.slug) {
            this.error.set('Invalid Link');
            this.isLoading.set(false);
            return;
        }

        this.loadLink();
    }

    ngOnDestroy() {
        this.stopTracking();
    }

    async loadLink() {
        try {
            const link = await this.sharingService.getLink(this.slug).toPromise();

            if (!link) {
                this.error.set('Document not found or link is invalid.');
                this.isLoading.set(false);
                return;
            }

            if (!link.isActive) {
                this.error.set('This link has been deactivated.');
                this.isLoading.set(false);
                return;
            }

            if (link.expiresAt) {
                // Firestore Timestamp conversion if needed, assuming simple check for now
                // In real app, convert Timestamp to Date
                const expires = (link.expiresAt as any).toDate ? (link.expiresAt as any).toDate() : new Date(link.expiresAt as any);
                if (new Date() > expires) {
                    this.error.set('This link has expired.');
                    this.isLoading.set(false);
                    return;
                }
            }

            this.link.set(link);
            this.titleService.setTitle(link.assetName + ' - Secure View');

            // Check Gatekeeper
            if (!link.requireEmail && !link.password) {
                this.grantAccess();
            } else {
                this.isLoading.set(false); // Show Gatekeeper
            }

        } catch (err) {
            console.error(err);
            this.error.set('Error loading document.');
            this.isLoading.set(false);
        }
    }

    async submitGatekeeper() {
        const link = this.link();
        if (!link) return;

        this.isVerifying.set(true);

        // 1. Check Password
        if (link.password && link.password !== this.passwordInput) {
            alert('Incorrect Password');
            this.isVerifying.set(false);
            return;
        }

        // 2. Check Email
        if (link.requireEmail && !this.emailInput) {
            alert('Email is required');
            this.isVerifying.set(false);
            return;
        }

        // 3. Grant Access
        await this.grantAccess();
        this.isVerifying.set(false);
    }

    async grantAccess() {
        this.accessGranted.set(true);
        this.isLoading.set(false);

        // Start Tracking
        try {
            this.sessionId = await this.sharingService.startSession(this.slug, {
                viewerEmail: this.emailInput || undefined,
                userAgent: navigator.userAgent
            });
            this.startHeartbeat();
        } catch (e) {
            console.error('Failed to start tracking session', e);
        }
    }

    // ==========================================
    // Tracking Logic
    // ==========================================

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.sessionId && this.documentVisible) {
                const duration = Math.floor((Date.now() - this.startTime) / 1000);
                this.sharingService.updateSessionHeartbeat(
                    this.slug,
                    this.sessionId,
                    duration,
                    Array.from(this.pagesViewed)
                );
            }
        }, 10000); // Every 10 seconds
    }

    stopTracking() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
    }

    // PDF Viewer Events
    documentVisible = true; // Could use Visibility API to pause tracking when tab hidden

    onPageChange(pageNumber: number) {
        this.pagesViewed.add(pageNumber);
    }
}
