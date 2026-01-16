import { Component, EventEmitter, Input, Output, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedLink, LinkSession } from '../../../../../core/models/shared-link.model';
import { DocumentSharingService } from '../../../../../core/services/document-sharing.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-link-stats-dialog',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    templateUrl: './link-stats-dialog.component.html'
})
export class LinkStatsDialogComponent implements OnInit {
    @Input() link!: SharedLink;
    @Output() close = new EventEmitter<void>();

    private sharingService = inject(DocumentSharingService);
    sessions = signal<LinkSession[]>([]);
    isLoading = signal(true);

    averageDuration = computed(() => {
        const s = this.sessions();
        if (s.length === 0) return '0s';
        const total = s.reduce((acc, curr) => acc + curr.durationSeconds, 0);
        return this.formatDuration(Math.round(total / s.length));
    });

    ngOnInit() {
        this.loadStats();
    }

    async loadStats() {
        try {
            const data = await this.sharingService.getLinkAnalytics(this.link.id);
            this.sessions.set(data.sort((a, b) => b.startTime.seconds - a.startTime.seconds));
        } catch (e) {
            console.error(e);
        } finally {
            this.isLoading.set(false);
        }
    }

    formatDuration(seconds: number): string {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        return `${mins}m ${seconds % 60}s`;
    }
}
