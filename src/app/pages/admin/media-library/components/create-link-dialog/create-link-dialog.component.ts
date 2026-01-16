import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { MediaAsset } from '../../../../../core/models/media.model';
import { SharedLink } from '../../../../../core/models/shared-link.model';
import { DocumentSharingService } from '../../../../../core/services/document-sharing.service';

@Component({
    selector: 'app-create-link-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './create-link-dialog.component.html'
})
export class CreateLinkDialogComponent {
    @Input() asset!: MediaAsset;
    @Output() close = new EventEmitter<void>();
    @Output() linkCreated = new EventEmitter<string>();

    isCreating = signal(false);
    createdLink = signal<string | null>(null); // If set, show success state

    // Form State
    requireEmail = signal(true);
    requirePassword = signal(false);
    password = signal('');
    expiresInDays = signal(7); // Default 7 days
    allowDownload = signal(false);
    allowPrint = signal(false);

    constructor(private sharingService: DocumentSharingService) { }

    async createLink() {
        this.isCreating.set(true);
        try {
            const config: any = {
                assetId: this.asset.id!,
                assetUrl: this.asset.publicUrl,
                assetName: this.asset.filename,
                contentType: this.asset.contentType,
                createdBy: 'admin', // TODO: Get actual user ID
                isActive: true,
                requireEmail: this.requireEmail(),
                password: this.requirePassword() ? this.password() : undefined,
                settings: {
                    allowDownload: this.allowDownload(),
                    allowPrint: this.allowPrint()
                }
            };

            // Calculate expiration
            if (this.expiresInDays() > 0) {
                const date = new Date();
                date.setDate(date.getDate() + this.expiresInDays());
                // Simple mock timestamp for now, service handles conversion if needed or use Timestamp.fromDate(date)
                // Ideally pass a Date object and let service handle Timestamp conversion
                config.expiresAt = date;
            }

            const slug = await this.sharingService.createLink(config);
            this.createdLink.set(window.location.origin + '/view/' + slug);
            this.linkCreated.emit(slug);
        } catch (error) {
            console.error('Error creating link:', error);
        } finally {
            this.isCreating.set(false);
        }
    }

    copyLink() {
        if (this.createdLink()) {
            navigator.clipboard.writeText(this.createdLink()!);
            // Could show a toast here
        }
    }
}
