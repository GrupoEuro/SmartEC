import { Component, inject, Signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, collectionData, query, orderBy, Timestamp } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Campaign } from '../../../core/models/campaign.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-mkt-campaigns',
    standalone: true,
    imports: [CommonModule, DatePipe, RouterLink, TranslateModule, AppIconComponent],
    templateUrl: './mkt-campaigns.component.html',
    styleUrls: ['./mkt-campaigns.component.css'],
})
export class MktCampaignsComponent {
    private firestore = inject(Firestore);
    private router    = inject(Router);

    campaigns: Signal<Campaign[]> = toSignal(
        collectionData(
            query(collection(this.firestore, 'campaigns'), orderBy('startDate', 'asc')),
            { idField: 'id' }
        ) as any,
        { initialValue: [] as Campaign[] }
    );

    readonly active   = computed(() => this.campaigns().filter(c => c.isActive && c.startDate.toDate() <= new Date() && c.endDate.toDate() >= new Date()));
    readonly upcoming = computed(() => this.campaigns().filter(c => c.startDate.toDate() > new Date()));
    readonly past     = computed(() => this.campaigns().filter(c => c.endDate.toDate() < new Date()));

    daysRemaining(end: Timestamp) { return Math.ceil((end.toDate().getTime() - Date.now()) / 86400000); }
    duration(s: Timestamp, e: Timestamp) { return Math.ceil((e.toDate().getTime() - s.toDate().getTime()) / 86400000); }

    themeColor(themeId: string): string {
        const map: Record<string, string> = {
            black_friday: '#f59e0b',
            hot_sale:     '#ef4444',
            dia_de_madres:'#ec4899',
            navidad:      '#22c55e',
            default:      '#6366f1',
        };
        return map[themeId?.toLowerCase()] ?? map['default'];
    }
}
