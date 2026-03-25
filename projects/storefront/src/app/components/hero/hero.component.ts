import { Component, OnInit, OnDestroy, inject, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router, RouterModule } from '@angular/router';
import { LanguageService } from '../../core/services/language.service';
import {
    Firestore,
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    doc,
    updateDoc,
    increment
} from '@angular/fire/firestore';

export interface HeroSlide {
    index: number;          // Position within slides array
    imageUrl: string;
    ctaUrl?: string;
    ctaLabel?: string;
    active: boolean;
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
    private injector = inject(Injector);
    private _firestore: Firestore | null = null;

    private get firestore(): Firestore {
        if (!this._firestore) {
            this._firestore = this.injector.get('FIRESTORE' as any) as Firestore;
        }
        return this._firestore!;
    }

    slides: HeroSlide[] = [];
    currentIndex = 0;
    hasActiveCampaign = false;       // default hero shows until campaign is confirmed
    activeCampaignId: string | null = null;

    private autoplayTimer: any;
    private unsubscribe: (() => void) | null = null;
    private readonly INTERVAL = 5000;

    ngOnInit() {
        this.translate.use(this.languageService.currentLang());
        this.loadActiveCampaign();
    }

    ngOnDestroy() {
        this.stopAutoplay();
        this.unsubscribe?.();
    }

    private loadActiveCampaign() {
        const campaignsRef = collection(this.firestore, 'campaigns');
        const q = query(
            campaignsRef,
            where('isActive', '==', true),
            orderBy('priority', 'desc'),
            limit(1)
        );

        this.unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                if (snapshot.empty) {
                    // No active campaign → fall back to default hero
                    this.hasActiveCampaign = false;
                    this.slides = [];
                    this.stopAutoplay();
                    return;
                }

                const campaignDoc = snapshot.docs[0];
                this.activeCampaignId = campaignDoc.id;

                const data = campaignDoc.data();
                const allSlides: any[] = data['slides'] || [];

                const mapped = allSlides
                    .filter((s: any) => s.active)
                    .sort((a: any, b: any) => a.order - b.order)
                    .map((s: any, i: number) => ({
                        index: i,
                        imageUrl: s.imageUrl,
                        ctaUrl: s.ctaUrl || undefined,
                        ctaLabel: s.ctaLabel || undefined,
                        active: s.active
                    }));

                if (mapped.length === 0) {
                    // Campaign exists but has no active slides → show default hero
                    this.hasActiveCampaign = false;
                    this.slides = [];
                    return;
                }

                this.slides = mapped;
                this.hasActiveCampaign = true;

                if (this.currentIndex >= this.slides.length) {
                    this.currentIndex = 0;
                }
                if (this.slides.length > 1) {
                    this.restartAutoplay();
                }
            },
            (err) => {
                // Firestore error (missing index, permissions, etc.) — show default hero
                console.warn('[Hero] Campaign query failed, showing default hero:', err.message);
                this.hasActiveCampaign = false;
                this.slides = [];
            }
        );
    }

    onSlideClick(slide: HeroSlide) {
        if (!slide.ctaUrl) return;

        // Track click analytics
        this.trackClick(slide.index);

        // Navigate
        if (slide.ctaUrl.startsWith('http')) {
            window.open(slide.ctaUrl, '_blank');
        } else {
            this.router.navigate([slide.ctaUrl]);
        }
    }

    private trackClick(slideIndex: number) {
        if (!this.activeCampaignId) return;
        const campaignRef = doc(this.firestore, 'campaigns', this.activeCampaignId);
        // Firestore doesn't support array element field updates directly,
        // so we use the slide's position and a denormalized counter map
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
