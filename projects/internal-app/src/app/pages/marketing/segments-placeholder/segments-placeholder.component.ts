import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-segments-placeholder',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    template: `
    <div class="seg-root">
        <div class="seg-card">
            <div class="seg-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
            </div>
            <span class="seg-badge">{{ 'MARKETING.SEGMENTS.COMING_SOON' | translate }}</span>
            <h2>{{ 'MARKETING.SEGMENTS.TITLE' | translate }}</h2>
            <p>{{ 'MARKETING.SEGMENTS.BODY' | translate }}</p>
            <div class="seg-features">
                <div class="seg-feature">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    {{ 'MARKETING.SEGMENTS.F1' | translate }}
                </div>
                <div class="seg-feature">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    {{ 'MARKETING.SEGMENTS.F2' | translate }}
                </div>
                <div class="seg-feature">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    {{ 'MARKETING.SEGMENTS.F3' | translate }}
                </div>
            </div>
        </div>
    </div>
    `,
    styles: [`
        .seg-root { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
        .seg-card {
            background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
            border-radius: 20px; padding: 3rem; max-width: 520px; width: 100%;
            display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1rem;
        }
        .seg-icon {
            width: 64px; height: 64px; border-radius: 18px;
            background: rgba(139,92,246,.15); border: 1px solid rgba(139,92,246,.3);
            display: flex; align-items: center; justify-content: center; color: #c4b5fd;
        }
        .seg-icon svg { width: 30px; height: 30px; }
        .seg-badge {
            padding: .25rem .75rem; border-radius: 50px;
            background: rgba(139,92,246,.15); border: 1px solid rgba(139,92,246,.3);
            color: #c4b5fd; font-size: .68rem; font-weight: 700;
            text-transform: uppercase; letter-spacing: .05em;
        }
        h2 { font-size: 1.25rem; font-weight: 800; color: #e4e4e7; margin: 0; }
        p  { font-size: .875rem; color: #71717a; margin: 0; line-height: 1.6; }
        .seg-features { display: flex; flex-direction: column; gap: .5rem; width: 100%; max-width: 320px; }
        .seg-feature {
            display: flex; align-items: center; gap: .6rem;
            font-size: .82rem; color: #a1a1aa;
            background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
            border-radius: 8px; padding: .55rem .875rem;
        }
        .seg-feature svg { color: #4ade80; flex-shrink: 0; }
    `]
})
export class SegmentsPlaceholderComponent {}
