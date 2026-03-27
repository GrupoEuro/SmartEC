import { Component, inject, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PromotionEngineService } from '../../../core/services/promotion-engine.service';

@Component({
    selector: 'app-exit-intent',
    standalone: true,
    imports: [CommonModule],
    template: `
    @if (engine.isOpen() && engine.activePromotion()) {
        <div class="promo-overlay" (click)="engine.close()">
            <div class="promo-modal" [style.background]="engine.activePromotion()!.bgColor" (click)="$event.stopPropagation()">
                <button class="promo-close" (click)="engine.close()">✕</button>

                <div class="promo-emoji">{{ engine.activePromotion()!.emoji }}</div>
                <h2 class="promo-headline">{{ engine.t(engine.activePromotion()!.headline) }}</h2>
                <p class="promo-body">{{ engine.t(engine.activePromotion()!.body) }}</p>

                @if (engine.activePromotion()!.couponCode) {
                    <div class="promo-coupon-box">
                        <code class="promo-code">{{ engine.activePromotion()!.couponCode }}</code>
                        <button class="promo-copy" (click)="engine.copyCode()">
                            {{ engine.copied() ? '✓ Copiado' : 'Copiar' }}
                        </button>
                    </div>
                }

                <div class="promo-actions">
                    <button class="promo-cta" (click)="engine.onCtaClick()">
                        {{ engine.t(engine.activePromotion()!.ctaLabel) }}
                    </button>
                    <button class="promo-dismiss" (click)="engine.close()">No, gracias</button>
                </div>
            </div>
        </div>
    }
    `,
    styles: [`
        .promo-overlay {
            position: fixed; inset: 0; z-index: 2000;
            display: flex; align-items: center; justify-content: center; padding: 16px;
            background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease;
        }
        .promo-modal {
            position: relative; border-radius: 20px; padding: 40px 32px; max-width: 420px; width: 100%;
            text-align: center; border: 1px solid rgba(255,255,255,0.12);
            box-shadow: 0 25px 60px rgba(0,0,0,0.5);
            animation: zoomIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        .promo-close {
            position: absolute; top: 14px; right: 16px; background: none; border: none;
            color: rgba(255,255,255,0.5); font-size: 1.1rem; cursor: pointer; padding: 4px 8px;
            border-radius: 6px; transition: color 0.2s, background 0.2s;
        }
        .promo-close:hover { color: #fff; background: rgba(255,255,255,0.1); }
        .promo-emoji { font-size: 3rem; margin-bottom: 16px; display: block; }
        .promo-headline { font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0 0 10px; }
        .promo-body { font-size: 0.95rem; color: rgba(255,255,255,0.7); margin: 0 0 24px; line-height: 1.6; }
        .promo-coupon-box {
            background: rgba(0,0,0,0.25); border: 1.5px dashed rgba(255,255,255,0.2);
            border-radius: 10px; padding: 14px 16px; margin-bottom: 20px;
            display: flex; align-items: center; justify-content: space-between;
        }
        .promo-code { font-size: 1.1rem; font-weight: 800; color: #67e8f9; font-family: monospace; letter-spacing: 2px; }
        .promo-copy { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff;
            padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; }
        .promo-copy:hover { background: rgba(255,255,255,0.15); }
        .promo-actions { display: flex; flex-direction: column; gap: 10px; }
        .promo-cta { background: #00acd8; color: #fff; border: none; border-radius: 12px; padding: 14px;
            font-weight: 800; font-size: 1rem; cursor: pointer; transition: all 0.2s; }
        .promo-cta:hover { background: #0095c4; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,172,216,0.4); }
        .promo-dismiss { background: none; border: none; color: rgba(255,255,255,0.35); font-size: 0.8rem; cursor: pointer;
            padding: 4px; transition: color 0.2s; }
        .promo-dismiss:hover { color: rgba(255,255,255,0.6); }
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoomIn  { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
    `]
})
export class ExitIntentComponent implements OnInit {
    readonly engine: PromotionEngineService = inject(PromotionEngineService) as PromotionEngineService;

    constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

    ngOnInit() {
        if (isPlatformBrowser(this.platformId)) {
            this.engine.init();
        }
    }
}
