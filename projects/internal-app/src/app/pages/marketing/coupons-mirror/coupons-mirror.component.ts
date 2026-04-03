import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-coupons-mirror',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    template: `
    <div class="mirror-root">
        <div class="mirror-card">
            <div class="mirror-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/></svg>
            </div>
            <h2>{{ 'MARKETING.COUPONS.MIRROR_TITLE' | translate }}</h2>
            <p>{{ 'MARKETING.COUPONS.MIRROR_BODY' | translate }}</p>
            <div class="mirror-actions">
                <a routerLink="/admin/coupons" class="mirror-btn-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    {{ 'MARKETING.COUPONS.MIRROR_GO_ADMIN' | translate }}
                </a>
            </div>
            <div class="mirror-phase-note">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {{ 'MARKETING.COUPONS.PHASE2_NOTE' | translate }}
            </div>
        </div>
    </div>
    `,
    styles: [`
        .mirror-root { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
        .mirror-card {
            background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
            border-radius: 20px; padding: 3rem; max-width: 480px; width: 100%;
            display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1.1rem;
        }
        .mirror-icon {
            width: 64px; height: 64px; border-radius: 18px;
            background: rgba(99,102,241,.15); border: 1px solid rgba(99,102,241,.3);
            display: flex; align-items: center; justify-content: center; color: #a5b4fc;
        }
        .mirror-icon svg { width: 30px; height: 30px; }
        h2 { font-size: 1.25rem; font-weight: 800; color: #e4e4e7; margin: 0; }
        p  { font-size: .875rem; color: #71717a; margin: 0; line-height: 1.6; }
        .mirror-actions { display: flex; gap: .75rem; flex-wrap: wrap; justify-content: center; }
        .mirror-btn-primary {
            display: flex; align-items: center; gap: .5rem;
            padding: .65rem 1.5rem; border-radius: 10px;
            background: #6366f1; color: #fff;
            text-decoration: none; font-size: .875rem; font-weight: 600;
            transition: background .2s;
        }
        .mirror-btn-primary:hover { background: #4f46e5; }
        .mirror-phase-note {
            display: flex; align-items: center; gap: .4rem;
            font-size: .72rem; color: #52525b;
        }
    `]
})
export class CouponsMirrorComponent {}
