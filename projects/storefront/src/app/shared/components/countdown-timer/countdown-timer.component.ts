import { Component, inject, signal, computed, effect, untracked, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { CampaignService } from '../../../core/services/campaign.service';
import { interval, Subscription } from 'rxjs';

@Component({
    selector: 'app-countdown-timer',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    templateUrl: './countdown-timer.component.html',
    styleUrl: './countdown-timer.component.css'
})
export class CountdownTimerComponent implements OnInit, OnDestroy {
    private campaignService = inject(CampaignService);
    private subscription?: Subscription;

    // Computed State
    isActive     = computed(() => !!this.campaignService.activeCampaign());
    campaignName = computed(() => this.campaignService.activeCampaign()?.name || '');
    coupon       = computed(() => this.campaignService.campaignCoupon());

    // Timer State
    endDate       = signal<Date | null>(null);
    timeRemaining = signal<any>(null);
    copied        = false;

    async copyCode() {
        const code = this.coupon()?.code;
        if (!code) return;
        try { await navigator.clipboard.writeText(code); } catch {
            const ta = document.createElement('textarea');
            ta.value = code; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        }
        this.copied = true;
        setTimeout(() => this.copied = false, 2500);
    }

    /** Returns "$ 250 off" or "20% off" depending on coupon type */
    couponDiscountLabel(): string {
        const c = this.coupon();
        if (!c) return '';
        return c.type === 'percentage'
            ? `${c.value}% off`
            : `$${c.value} MXN off`;
    }

    constructor() {
        // untracked() lets us write to endDate and call startTimer (which writes timeRemaining)
        // inside this effect without triggering NG0600 (signal write in reactive context).
        effect(() => {
            const campaign = this.campaignService.activeCampaign();
            untracked(() => {
                if (campaign) {
                    this.endDate.set(campaign.endDate.toDate());
                    this.startTimer();
                } else {
                    this.stopTimer();
                }
            });
        });
    }

    ngOnInit() { }

    ngOnDestroy() {
        this.stopTimer();
    }

    private startTimer() {
        this.stopTimer();
        const end = this.endDate();
        if (!end) return;

        this.subscription = interval(1000).subscribe(() => {
            const now      = new Date().getTime();
            const distance = end.getTime() - now;

            if (distance < 0) {
                this.timeRemaining.set(null);
                this.stopTimer();
                return;
            }

            const days    = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours   = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            this.timeRemaining.set({
                days:    this.pad(days),
                hours:   this.pad(hours),
                minutes: this.pad(minutes),
                seconds: this.pad(seconds)
            });
        });
    }

    private stopTimer() {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = undefined;
        }
    }

    private pad(n: number): string {
        return n < 10 ? '0' + n : '' + n;
    }
}
