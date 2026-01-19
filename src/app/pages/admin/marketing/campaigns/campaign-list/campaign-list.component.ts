import { Component, inject, signal, Signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Firestore, collection, collectionData, query, orderBy, Timestamp } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Campaign, WebsiteTheme } from '../../../../../core/models/campaign.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component'; // Assuming shared icon component
import { map } from 'rxjs';

@Component({
    selector: 'app-campaign-list',
    standalone: true,
    imports: [CommonModule, RouterLink, DatePipe, AppIconComponent],
    template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-800 dark:text-white">Marketing Calendar</h1>
          <p class="text-slate-500">Schedule visual takeovers and seasonal campaigns</p>
        </div>
        <button routerLink="new" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors font-medium">
          <app-icon name="plus" [size]="18"></app-icon>
          Schedule Campaign
        </button>
      </div>

      <!-- Timeline / List -->
      <div class="grid gap-6">
        <!-- Active Now Section -->
        @if (activeCampaigns.length > 0) {
          <div class="space-y-3">
             <h3 class="text-sm font-bold text-green-600 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Active Now
             </h3>
             @for (campaign of activeCampaigns; track campaign.id) {
               <div class="bg-white dark:bg-slate-800 rounded-xl border-l-4 border-green-500 shadow-sm p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                 <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-lg font-bold text-slate-900 dark:text-white">{{ campaign.name }}</span>
                        <span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                            {{ campaign.themeId }} Theme
                        </span>
                    </div>
                    <p class="text-slate-500 text-sm">
                        Ends in {{ getDaysRemaining(campaign.endDate) }} days • Priority {{ campaign.priority }}
                    </p>
                 </div>
                 <div class="flex items-center gap-3">
                    <button [routerLink]="['edit', campaign.id]" class="text-slate-400 hover:text-blue-500 transition-colors">
                        <app-icon name="edit" [size]="20"></app-icon>
                    </button>
                 </div>
               </div>
             }
          </div>
        }

        <!-- Upcoming Section -->
        <div class="space-y-3">
            <h3 class="text-sm font-bold text-slate-500 uppercase tracking-wider">Upcoming</h3>
            @if (upcomingCampaigns.length === 0) {
                <div class="p-8 text-center bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                    <p class="text-slate-400">No upcoming campaigns scheduled.</p>
                </div>
            }
            @for (campaign of upcomingCampaigns; track campaign.id) {
                <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 opacity-75 hover:opacity-100 transition-opacity">
                 <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-lg font-medium text-slate-700 dark:text-slate-200">{{ campaign.name }}</span>
                        <span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                            {{ campaign.themeId }}
                        </span>
                    </div>
                    <p class="text-slate-500 text-sm">
                        Starts {{ campaign.startDate.toDate() | date:'mediumDate' }} • {{ getDuration(campaign.startDate, campaign.endDate) }} days
                    </p>
                 </div>
                 <div class="flex items-center gap-3">
                    <button [routerLink]="['edit', campaign.id]" class="text-slate-400 hover:text-blue-500 transition-colors">
                        <app-icon name="edit" [size]="20"></app-icon>
                    </button>
                 </div>
               </div>
            }
        </div>

        <!-- Past Section -->
        <details class="group">
            <summary class="flex items-center gap-2 cursor-pointer text-slate-500 hover:text-slate-700 mb-3">
                <span class="text-sm font-bold uppercase tracking-wider">Past Campaigns</span>
                <app-icon name="chevron-down" [size]="16" class="transition-transform group-open:rotate-180"></app-icon>
            </summary>
            <div class="space-y-3 pl-4 border-l-2 border-slate-100 dark:border-slate-800">
                @for (campaign of pastCampaigns; track campaign.id) {
                    <div class="py-3 flex items-center justify-between">
                         <div>
                            <span class="block font-medium text-slate-600 dark:text-slate-400 line-through">{{ campaign.name }}</span>
                            <span class="text-xs text-slate-400">Ended {{ campaign.endDate.toDate() | date:'shortDate' }}</span>
                         </div>
                         <button [routerLink]="['edit', campaign.id]" class="text-slate-400 hover:text-blue-500">
                             <app-icon name="eye" [size]="16"></app-icon>
                         </button>
                    </div>
                }
            </div>
        </details>
      </div>
    </div>
  `
})
export class CampaignListComponent {
    private firestore = inject(Firestore);

    // Fetch campaigns
    private campaigns$ = collectionData(
        query(collection(this.firestore, 'campaigns'), orderBy('startDate', 'asc')),
        { idField: 'id' }
    ) as any; // typing cast for simple collectionData

    campaigns: Signal<Campaign[]> = toSignal(this.campaigns$, { initialValue: [] as Campaign[] });

    // Computed properties for categorizing
    // Note: Done via getters efficiently enough for this list size

    get activeCampaigns() {
        const list = this.campaigns();
        if (!list) return [];
        const now = new Date();
        // Filter active: isActive == true AND now is between start/end
        return list.filter(c => c.isActive && c.startDate.toDate() <= now && c.endDate.toDate() >= now);
    }

    get upcomingCampaigns() {
        const list = this.campaigns();
        if (!list) return [];
        const now = new Date();
        // Filter upcoming: startDate > now
        return list.filter(c => c.startDate.toDate() > now);
    }

    get pastCampaigns() {
        const list = this.campaigns();
        if (!list) return [];
        const now = new Date();
        // Filter past: endDate < now
        return list.filter(c => c.endDate.toDate() < now);
    }

    getDaysRemaining(endDate: Timestamp): number {
        const now = new Date().getTime();
        const end = endDate.toDate().getTime();
        return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    }

    getDuration(start: Timestamp, end: Timestamp): number {
        const s = start.toDate().getTime();
        const e = end.toDate().getTime();
        return Math.ceil((e - s) / (1000 * 60 * 60 * 24));
    }
}
