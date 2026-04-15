import { Component, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router, RouterModule } from '@angular/router';
import { LanguageService } from '../../core/services/language.service';
import { CampaignService } from '../../core/services/campaign.service';
import {
    Firestore,
    doc,
    updateDoc,
    increment
} from '@angular/fire/firestore';

export interface HeroSlide {
    index: number;
    type: 'hero' | 'banner';   // 'hero' = default branded slide, 'banner' = campaign image
    imageUrl?: string;          // Only for 'banner' type
    ctaUrl?: string;
    ctaLabel?: string;
}

@Component({
    selector: 'app-hero',
    standalone: true,
    imports: [CommonModule, TranslateModule, RouterModule],
    templateUrl: './hero.component.html',
    styleUrl: './hero.component.css'
})
export class HeroComponent implements OnInit, OnDestroy {
    private translate = inject(TranslateService);
    private languageService = inject(LanguageService);
    private router = inject(Router);
    private firestore = inject(Firestore);
    private campaignService = inject(CampaignService);

    slides: HeroSlide[] = [];
    currentIndex = 0;
    activeCampaignId: string | null = null;

    private autoplayTimer: any;
    private readonly INTERVAL = 5000;

    constructor() {
        // React to campaign changes in real-time via the shared CampaignService signal
        effect(() => {
            const campaign = this.campaignService.activeCampaign();
            this.buildSlides(campaign);
        });
    }

    ngOnInit() {
        this.translate.use(this.languageService.currentLang());
        // Ensure CampaignService has been initialized
        this.campaignService.init();
    }

    ngOnDestroy() {
        this.stopAutoplay();
    }

    private buildSlides(campaign: any) {
        // Slide 0 is always the default hero
        const heroSlide: HeroSlide = { index: 0, type: 'hero' };

        if (!campaign) {
            // No campaign — just the branded hero, no carousel
            this.slides = [heroSlide];
            this.stopAutoplay();
            return;
        }

        this.activeCampaignId = campaign.id || null;

        const campaignBanners: HeroSlide[] = (campaign.slides || [])
            .filter((s: any) => s.active && s.imageUrl)
            .sort((a: any, b: any) => a.order - b.order)
            .map((s: any, i: number) => ({
                index: i + 1,   // hero is 0, banners start at 1
                type: 'banner' as const,
                imageUrl: s.imageUrl,
                ctaUrl: s.ctaUrl || undefined,
                ctaLabel: s.ctaLabel || undefined
            }));

        this.slides = [heroSlide, ...campaignBanners];

        // Only autoplay when there are multiple slides
        if (this.currentIndex >= this.slides.length) {
            this.currentIndex = 0;
        }
        if (this.slides.length > 1) {
            this.restartAutoplay();
        }
    }

    onSlideClick(slide: HeroSlide) {
        if (slide.type === 'hero' || !slide.ctaUrl) return;
        this.trackClick(slide.index);
        if (slide.ctaUrl.startsWith('http')) {
            window.open(slide.ctaUrl, '_blank');
        } else {
            this.router.navigate([slide.ctaUrl]);
        }
    }

    private trackClick(slideIndex: number) {
        if (!this.activeCampaignId) return;
        const campaignRef = doc(this.firestore, 'campaigns', this.activeCampaignId);
        updateDoc(campaignRef, {
            [`slideClicks.${slideIndex}`]: increment(1)
        }).catch(err => console.warn('Click tracking failed:', err));
    }

    goTo(index: number) {
        if (!this.slides.length) return;
        this.currentIndex = (index + this.slides.length) % this.slides.length;
        this.restartAutoplay();
    }

    prev() { this.goTo(this.currentIndex - 1); }
    next() { this.goTo(this.currentIndex + 1); }

    private startAutoplay() {
        this.autoplayTimer = setInterval(() => this.next(), this.INTERVAL);
    }

    private stopAutoplay() {
        if (this.autoplayTimer) clearInterval(this.autoplayTimer);
    }

    private restartAutoplay() {
        this.stopAutoplay();
        this.startAutoplay();
    }

    scrollToContact() {
        document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    }
}

