import { Component, inject, signal, computed, effect, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CampaignService } from '../../../core/services/campaign.service';
import { interval, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
    selector: 'app-countdown-timer',
    standalone: true,
    imports: [CommonModule],
    template: `
    @if (isActive() && timeRemaining()) {
        <div class="bg-gradient-to-r from-red-600 to-pink-600 text-white py-2 px-4 text-center font-bold text-sm md:text-base flex items-center justify-center gap-4 animate-in slide-in-from-top duration-500 shadow-md relative z-50">
            <span class="hidden md:inline">{{ campaignName() }} Terminates In:</span>
            <span class="md:hidden">Ends In:</span>
            
            <div class="flex items-center gap-2 font-mono text-lg tracking-wider bg-black/20 px-3 py-1 rounded-lg">
                <div class="flex flex-col items-center leading-none">
                    <span>{{ timeRemaining().days }}</span>
                    <span class="text-[9px] opacity-70 font-sans">d</span>
                </div>
                <span>:</span>
                <div class="flex flex-col items-center leading-none">
                    <span>{{ timeRemaining().hours }}</span>
                    <span class="text-[9px] opacity-70 font-sans">h</span>
                </div>
                <span>:</span>
                <div class="flex flex-col items-center leading-none">
                    <span>{{ timeRemaining().minutes }}</span>
                    <span class="text-[9px] opacity-70 font-sans">m</span>
                </div>
                <span>:</span>
                <div class="flex flex-col items-center leading-none">
                    <span class="text-yellow-300">{{ timeRemaining().seconds }}</span>
                    <span class="text-[9px] opacity-70 font-sans">s</span>
                </div>
            </div>
            
            <span class="hidden md:inline text-xs bg-white/20 px-2 py-0.5 rounded uppercase tracking-wider">Don't Miss Out</span>
        </div>
    }
  `
})
export class CountdownTimerComponent implements OnInit, OnDestroy {
    private campaignService = inject(CampaignService);
    private subscription?: Subscription;

    // Computed State
    isActive = computed(() => !!this.campaignService.activeCampaign());
    campaignName = computed(() => this.campaignService.activeCampaign()?.name || '');

    // Timer State
    endDate: Date | null = null;
    timeRemaining = signal<any>(null);

    constructor() {
        effect(() => {
            const campaign = this.campaignService.activeCampaign();
            if (campaign) {
                this.endDate = campaign.endDate.toDate();
                this.startTimer();
            } else {
                this.stopTimer();
            }
        });
    }

    ngOnInit() { }

    ngOnDestroy() {
        this.stopTimer();
    }

    private startTimer() {
        this.stopTimer();
        if (!this.endDate) return;

        this.subscription = interval(1000).subscribe(() => {
            const now = new Date().getTime();
            const end = this.endDate!.getTime();
            const distance = end - now;

            if (distance < 0) {
                this.timeRemaining.set(null);
                this.stopTimer();
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            this.timeRemaining.set({
                days: this.pad(days),
                hours: this.pad(hours),
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
