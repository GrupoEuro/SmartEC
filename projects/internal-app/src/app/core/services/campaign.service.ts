import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, query, where, orderBy, getDocs, Timestamp, onSnapshot } from '@angular/fire/firestore';
import { Campaign, WebsiteTheme } from '../models/campaign.model';
import { ThemeService } from './theme.service';

@Injectable({
    providedIn: 'root'
})
export class CampaignService {
    private firestore = inject(Firestore);
    private themeService = inject(ThemeService);

    // Active Campaign Signal (The "Winner" based on priority)
    activeCampaign = signal<Campaign | null>(null);

    constructor() {
        this.initCampaignListener();
    }

    /**
     * Real-time listener for active campaigns
     * Logic: Finds all campaigns that are active AND generally in the current time window.
     * Then clientside filters active active second/millisecond precision and picks highest priority.
     */
    private initCampaignListener() {
        const campaignsRef = collection(this.firestore, 'campaigns');

        // We get all campaigns flagged as 'active'. 
        // We refine date logic in JS because Firestore inequality constraints can be tricky with multiple fields.
        const q = query(
            campaignsRef,
            where('isActive', '==', true)
        );

        onSnapshot(q, (snapshot) => {
            const now = Timestamp.now();
            const campaigns: Campaign[] = [];

            snapshot.forEach(doc => {
                const data = doc.data() as Campaign;
                // Verify Date Range
                if (data.startDate <= now && data.endDate >= now) {
                    campaigns.push({ ...data, id: doc.id });
                }
            });

            // Sort by Priority (Descending) -> Highest priority first
            campaigns.sort((a, b) => b.priority - a.priority);

            if (campaigns.length > 0) {
                const winner = campaigns[0];
                console.log('🏆 Active Campaign Found:', winner.name);
                this.activeCampaign.set(winner);

                // 🎨 Auto-Apply Theme
                if (winner.themeId) {
                    this.themeService.setTheme(winner.themeId);
                }
            } else {
                console.log('⚪ No active campaigns. Keeping User Preference.');
                this.activeCampaign.set(null);

                // Do NOT force reset to 'default' here. 
                // This overrides the user's manual selection (or Studio theme).
                // Only reset if the current theme WAS a campaign theme that expired? 
                // For now, let's just NOT touch it.
                // this.themeService.setTheme('default'); 
            }
        });
    }

    /**
     * Returns true if a specific feature ("black-friday-banner") should be shown
     */
    shouldShowPromo(): boolean {
        return !!this.activeCampaign();
    }
}
