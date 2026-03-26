import { Component, inject, OnInit, AfterViewInit, ElementRef, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PromotionService } from '../../../../core/services/promotion.service';
import { CouponService } from '../../../../core/services/coupon.service';
import { Coupon } from '../../../../core/models/coupon.model';
import { ToastService } from '../../../../core/services/toast.service';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';

@Component({
    selector: 'app-promotion-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './promotion-form.component.html',
    styleUrls: ['./promotion-form.component.css']
})
export class PromotionFormComponent implements OnInit, AfterViewInit {
    private el = inject(ElementRef);
    private promotionService = inject(PromotionService);
    private couponService    = inject(CouponService);
    private toast            = inject(ToastService);
    private router           = inject(Router);
    private route            = inject(ActivatedRoute);
    private fb               = inject(FormBuilder);

    isEditMode    = false;
    promotionId:  string | null = null;
    isLoading     = false;
    isSaving      = false;
    availableCoupons: Coupon[] = [];
    previewLang: 'es' | 'en' = 'es';

    form = this.fb.group({
        name:            ['', Validators.required],
        status:          ['active', Validators.required],
        emoji:           ['🎁', Validators.required],
        headline: this.fb.group({
            es: ['', Validators.required],
            en: ['', Validators.required],
        }),
        body: this.fb.group({
            es: ['', Validators.required],
            en: ['', Validators.required],
        }),
        ctaLabel: this.fb.group({
            es: ['Aplicar y Seguir Comprando', Validators.required],
            en: ['Apply & Continue Shopping', Validators.required],
        }),
        bgColor:         ['#1e293b'],
        couponCode:      [''],
        trigger:         ['exit_intent', Validators.required],
        triggerDelay:    [3000],
        scrollThreshold: [50],
        startDate:       [''],
        endDate:         [''],
        audienceNewOnly:  [false],
        audienceCartOnly: [false],
        maxShowsPerUser:  [1, [Validators.required, Validators.min(0)]],
        priority:        [10, [Validators.required, Validators.min(0)]],
    });

    ngOnInit() {
        this.promotionId = this.route.snapshot.paramMap.get('id');
        this.isEditMode  = !!this.promotionId;
        this.couponService.getActiveCoupons().subscribe(c => this.availableCoupons = c);

        if (this.isEditMode) {
            this.isLoading = true;
            this.promotionService.getById(this.promotionId!).subscribe(p => {
                if (!p) { this.toast.error('Promotion not found'); this.router.navigate(['/admin/promotions']); return; }
                this.form.patchValue({
                    ...p,
                    startDate: this.formatDate(p.startDate as Date),
                    endDate:   this.formatDate(p.endDate as Date),
                });
                this.isLoading = false;
                // Re-measure after data loads
                setTimeout(() => this.alignPreview(), 50);
            });
        }
    }

    ngAfterViewInit() {
        // Measure after first render so the DOM is settled
        setTimeout(() => this.alignPreview(), 0);
    }

    private alignPreview() {
        const firstSection = document.querySelector('.form-section') as HTMLElement;
        if (firstSection) {
            const top = firstSection.getBoundingClientRect().top;
            this.el.nativeElement.style.setProperty('--preview-top', `${top}px`);
        }
    }

    get trigger() { return this.form.get('trigger')?.value; }
    get pageTitle() { return this.isEditMode ? 'Edit Promotion' : 'New Promotion'; }

    async onSubmit() {
        if (this.form.invalid || this.isSaving) return;
        this.isSaving = true;
        const v = this.form.getRawValue();
        const data: any = {
            ...v,
            triggerDelay:    Number(v.triggerDelay),
            scrollThreshold: Number(v.scrollThreshold),
            priority:        Number(v.priority),
            maxShowsPerUser: Number(v.maxShowsPerUser),
            startDate:       v.startDate ? new Date(v.startDate) : null,
            endDate:         v.endDate   ? new Date(v.endDate)   : null,
        };
        try {
            if (this.isEditMode) {
                await this.promotionService.update(this.promotionId!, data);
                this.toast.success('Promotion updated');
            } else {
                await this.promotionService.create(data);
                this.toast.success('Promotion created');
            }
            this.router.navigate(['/admin/promotions']);
        } catch {
            this.toast.error('Failed to save promotion');
        } finally {
            this.isSaving = false;
        }
    }

    onCancel() { this.router.navigate(['/admin/promotions']); }

    private formatDate(d: Date | null): string {
        if (!d) return '';
        return new Date(d).toISOString().split('T')[0];
    }
}
