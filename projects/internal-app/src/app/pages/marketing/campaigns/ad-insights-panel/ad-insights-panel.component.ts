import {
    Component, Input, OnChanges, SimpleChanges,
    signal, computed, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Campaign } from '../../../../core/models/campaign.model';
import { AdInsightsResponse } from '../../../../core/models/paid-media.model';
import { PaidMediaService } from '../../../../core/services/paid-media.service';

@Component({
    selector: 'app-ad-insights-panel',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './ad-insights-panel.component.html',
    styleUrls: ['./ad-insights-panel.component.css'],
})
export class AdInsightsPanelComponent implements OnChanges {
    @Input() campaign!: Campaign;

    private svc = inject(PaidMediaService);

    loading  = signal(true);
    insights = signal<AdInsightsResponse | null>(null);
    error    = signal<string | null>(null);

    // ── Computed display values ───────────────────────────────────────────────

    totalSpend   = computed(() => this.svc.fmtMXN(this.insights()?.totalSpend));
    metaSpend    = computed(() => this.svc.fmtMXN(this.insights()?.meta?.spend));
    googleSpend  = computed(() => this.svc.fmtMXN(this.insights()?.google?.spend));
    realRoas     = computed(() => this.svc.fmtRoas(this.insights()?.realRoas));
    realCpa      = computed(() => this.svc.fmtMXN(this.insights()?.realCpa));
    metaRoas     = computed(() => this.svc.fmtRoas(this.insights()?.meta?.purchaseRoas));
    revenue      = computed(() => this.svc.fmtMXN(this.insights()?.internalRevenue));
    orders       = computed(() => this.insights()?.internalOrders ?? 0);

    metaImpressions = computed(() => this.svc.fmtNum(this.insights()?.meta?.impressions));
    metaClicks      = computed(() => this.svc.fmtNum(this.insights()?.meta?.clicks));
    metaCTR         = computed(() => this.svc.fmtPct(this.insights()?.meta?.ctr));
    metaCPC         = computed(() => this.svc.fmtMXN(this.insights()?.meta?.cpc));
    metaReach       = computed(() => this.svc.fmtNum(this.insights()?.meta?.reach));
    metaFreq        = computed(() => this.insights()?.meta?.frequency?.toFixed(1) ?? '—');
    frequencyWarning = computed(() => this.insights()?.frequencyWarning ?? false);

    googleImpressions = computed(() => this.svc.fmtNum(this.insights()?.google?.impressions));
    googleClicks      = computed(() => this.svc.fmtNum(this.insights()?.google?.clicks));
    googleCTR         = computed(() => this.svc.fmtPct(this.insights()?.google?.ctr));
    googleCPA         = computed(() => this.svc.fmtMXN(this.insights()?.google?.costPerConversion));
    googleConversions = computed(() => this.svc.fmtNum(this.insights()?.google?.conversions));
    googleImpShare    = computed(() => {
        const s = this.insights()?.google?.impressionShare;
        return s != null ? `${(s * 100).toFixed(1)}%` : '—';
    });

    hasMeta   = computed(() => !!this.campaign?.metaCampaignId);
    hasGoogle = computed(() => !!this.campaign?.googleCampaignId);
    hasData   = computed(() => !!this.insights()?.meta || !!this.insights()?.google);

    // ── Sparkline from history ────────────────────────────────────────────────
    spendHistory = computed(() => {
        const h = this.insights()?.history ?? [];
        if (h.length === 0) return [];
        const max = Math.max(...h.map(p => p.totalSpend), 1);
        return h.slice(-14).map(p => ({
            date:    p.date,
            spend:   p.totalSpend,
            revenue: p.revenue,
            roas:    p.roas,
            pct:     Math.round((p.totalSpend / max) * 100),
        }));
    });

    ngOnChanges(changes: SimpleChanges) {
        if (changes['campaign'] && this.campaign) {
            this.load();
        }
    }

    private load() {
        if (!this.campaign?.metaCampaignId && !this.campaign?.googleCampaignId) {
            this.loading.set(false);
            return;
        }

        this.loading.set(true);
        this.error.set(null);

        this.svc.getCampaignInsights({
            campaignName:     this.campaign.name,
            metaCampaignId:   this.campaign.metaCampaignId,
            googleCampaignId: this.campaign.googleCampaignId,
            days:             30,
        }).subscribe({
            next:  data => { this.insights.set(data); this.loading.set(false); },
            error: err  => { this.error.set(err.message ?? 'Error'); this.loading.set(false); },
        });
    }

    fmtMXN(v: number | null | undefined) { return this.svc.fmtMXN(v); }
    fmtNum(v: number | null | undefined) { return this.svc.fmtNum(v); }
}
