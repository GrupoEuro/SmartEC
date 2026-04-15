import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query, where, getDocs,
    orderBy, Timestamp,
} from '@angular/fire/firestore';
import { Campaign } from '../../../../core/models/campaign.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-active-campaigns-widget',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AppIconComponent],
    templateUrl: './active-campaigns-widget.component.html',
})
export class ActiveCampaignsWidgetComponent implements OnInit {
    private fs = inject(Firestore);

    isLoading   = signal(true);
    campaigns   = signal<Campaign[]>([]);
    isCollapsed = signal(false);

    ngOnInit() { this.load(); }

    private async load() {
        const now = Timestamp.now();
        try {
            const snap = await getDocs(query(
                collection(this.fs, 'campaigns'),
                where('isActive', '==', true),
                where('endDate', '>=', now),
                orderBy('endDate', 'asc'),
            ));
            const active: Campaign[] = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Campaign);
            this.campaigns.set(active);
        } catch (e) {
            console.warn('[ActiveCampaignsWidget] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    toggle() { this.isCollapsed.update(v => !v); }

    daysLeft(endDate: Timestamp): number {
        const ms = endDate.toDate().getTime() - Date.now();
        return Math.max(0, Math.ceil(ms / 86_400_000));
    }

    urgencyClass(days: number): string {
        if (days <= 2)  return 'urgent';
        if (days <= 7)  return 'soon';
        return 'safe';
    }
}
