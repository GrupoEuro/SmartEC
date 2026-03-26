import { Injectable, inject, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, collection, query, where, orderBy, getDocs, doc, increment, updateDoc } from '@angular/fire/firestore';
import { AuthService, CartService, LanguageService } from '@lib/core';
import { signal } from '@angular/core';

export interface BilingualText { es: string; en: string; }

export interface StorefrontPromotion {
    id:              string;
    emoji:           string;
    headline:        BilingualText;
    body:            BilingualText;
    ctaLabel:        BilingualText;
    bgColor:         string;
    couponCode:      string;
    trigger:         string;
    triggerDelay:    number;
    scrollThreshold: number;
    audienceNewOnly:  boolean;
    audienceCartOnly: boolean;
    maxShowsPerUser:  number;
    priority:        number;
    startDate:       Date | null;
    endDate:         Date | null;
}

@Injectable({ providedIn: 'root' })
export class PromotionEngineService {
    private firestore       = inject(Firestore);
    private authService     = inject(AuthService);
    private cartService     = inject(CartService);
    private languageService = inject(LanguageService);

    activePromotion = signal<StorefrontPromotion | null>(null);
    isOpen          = signal(false);
    copied          = signal(false);

    private promotions: StorefrontPromotion[] = [];
    private loaded = false;

    constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

    /** Resolve a bilingual text object to the active UI language */
    t(bi: BilingualText): string {
        const lang = this.languageService.currentLang() as 'es' | 'en';
        return bi?.[lang] ?? bi?.es ?? '';
    }

    /** Call once from AppComponent or RootLayout */
    async init() {
        if (!isPlatformBrowser(this.platformId)) return;
        await this.loadPromotions();
        this.registerTriggers();
    }

    private async loadPromotions() {
        if (this.loaded) return;
        try {
            const col  = collection(this.firestore, 'promotions');
            const q    = query(col, where('status', '==', 'active'), orderBy('priority', 'desc'));
            const snap = await getDocs(q);
            this.promotions = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    ...data,
                    startDate: data.startDate?.toDate?.() ?? null,
                    endDate:   data.endDate?.toDate?.()   ?? null,
                } as StorefrontPromotion;
            });
            this.loaded = true;
        } catch (e) {
            console.warn('[PromotionEngine] Failed to load promotions', e);
        }
    }

    private registerTriggers() {
        for (const promo of this.promotions) {
            if (!this.isEligible(promo)) continue;
            switch (promo.trigger) {
                case 'exit_intent':  this.registerExitIntent(promo);  break;
                case 'welcome_user': this.registerWelcomeUser(promo); break;
                case 'timed_delay':  this.registerTimedDelay(promo);  break;
                case 'scroll_depth': this.registerScrollDepth(promo); break;
                case 'seasonal':     this.show(promo);                break;
            }
        }
    }

    private registerExitIntent(promo: StorefrontPromotion) {
        const handler = (e: MouseEvent) => {
            if (e.clientY <= 0) { this.show(promo); document.removeEventListener('mouseleave', handler); }
        };
        document.addEventListener('mouseleave', handler);
    }

    private registerWelcomeUser(promo: StorefrontPromotion) {
        const user  = this.authService.currentUser();
        const isNew = !localStorage.getItem('ie_returning_visitor');
        if (!user && isNew) {
            setTimeout(() => this.show(promo), 1500);
            localStorage.setItem('ie_returning_visitor', '1');
        }
    }

    private registerTimedDelay(promo: StorefrontPromotion) {
        setTimeout(() => this.show(promo), promo.triggerDelay || 5000);
    }

    private registerScrollDepth(promo: StorefrontPromotion) {
        const threshold = (promo.scrollThreshold || 50) / 100;
        const handler = () => {
            const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
            if (scrolled >= threshold) { this.show(promo); window.removeEventListener('scroll', handler); }
        };
        window.addEventListener('scroll', handler, { passive: true });
    }

    private isEligible(promo: StorefrontPromotion): boolean {
        const key = `promo_shown_${promo.id}`;
        const now = Date.now();
        if (promo.startDate && new Date(promo.startDate).getTime() > now) return false;
        if (promo.endDate   && new Date(promo.endDate).getTime()   < now) return false;
        if (promo.audienceNewOnly  && localStorage.getItem('ie_returning_visitor')) return false;
        if (promo.audienceCartOnly && this.cartService.cartItems().length === 0)    return false;
        if (promo.maxShowsPerUser > 0) {
            const shown = Number(localStorage.getItem(key) ?? '0');
            if (shown >= promo.maxShowsPerUser) return false;
        }
        return true;
    }

    private show(promo: StorefrontPromotion) {
        if (this.isOpen()) return;
        this.activePromotion.set(promo);
        this.isOpen.set(true);
        const key   = `promo_shown_${promo.id}`;
        const shown = Number(localStorage.getItem(key) ?? '0');
        localStorage.setItem(key, String(shown + 1));
        updateDoc(doc(this.firestore, `promotions/${promo.id}`), { totalShown: increment(1) }).catch(() => {});
    }

    close() { this.isOpen.set(false); this.copied.set(false); }

    copyCode() {
        const code = this.activePromotion()?.couponCode;
        if (!code) return;
        navigator.clipboard.writeText(code);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
        const id = this.activePromotion()?.id;
        if (id) updateDoc(doc(this.firestore, `promotions/${id}`), { totalClicked: increment(1) }).catch(() => {});
    }

    onCtaClick() {
        const id = this.activePromotion()?.id;
        if (id) updateDoc(doc(this.firestore, `promotions/${id}`), { totalClicked: increment(1) }).catch(() => {});
        this.close();
    }
}
