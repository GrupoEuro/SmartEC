import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CouponService } from '../../../../core/services/coupon.service';
import { Coupon, DiscountType } from '../../../../core/models/coupon.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ApprovalWorkflowService } from '../../../../core/services/approval-workflow.service';
import { CouponApprovalData } from '../../../../core/models/approval-request.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { Timestamp } from '@angular/fire/firestore';

@Component({
    selector: 'app-coupon-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent],
    templateUrl: './coupon-form.component.html',
    styleUrls: ['./coupon-form.component.css']
})
export class CouponFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private couponService = inject(CouponService);
    private approvalService = inject(ApprovalWorkflowService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private toast = inject(ToastService);

    couponForm: FormGroup;
    isEditMode = false;
    couponId: string | null = null;
    isLoading = false;
    isSaving = false;

    constructor() {
        this.couponForm = this.fb.group({
            code: ['', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z0-9]+$')]],
            description: [''],
            type: ['percentage', Validators.required],
            value: [0, [Validators.required, Validators.min(0)]],
            minPurchaseAmount: [0, [Validators.min(0)]],
            startDate: [this.formatDate(new Date()), Validators.required],
            endDate: [''],
            usageLimit: [0, [Validators.min(0)]],
            isActive: [true]
        }, { validators: this.dateRangeValidator });
    }

    ngOnInit() {
        this.couponId = this.route.snapshot.paramMap.get('id');
        if (this.couponId) {
            this.isEditMode = true;
            this.loadCoupon(this.couponId);
            this.couponForm.get('code')?.disable(); // Code cannot be changed
        }
    }

    loadCoupon(id: string) {
        this.isLoading = true;
        this.couponService.getCouponById(id).subscribe({
            next: (coupon) => {
                if (coupon) {
                    this.patchForm(coupon);
                } else {
                    this.toast.error('Coupon not found');
                    this.router.navigate(['/admin/coupons']);
                }
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading coupon:', error);
                this.toast.error('Error loading coupon details');
                this.isLoading = false;
            }
        });
    }

    patchForm(coupon: Coupon) {
        this.couponForm.patchValue({
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
            minPurchaseAmount: coupon.minPurchaseAmount || 0,
            startDate: this.formatDate(coupon.startDate),
            endDate: coupon.endDate ? this.formatDate(coupon.endDate) : '',
            usageLimit: coupon.usageLimit,
            isActive: coupon.isActive
        });
    }

    async onSubmit() {
        if (this.couponForm.invalid || this.isSaving) return;

        this.isSaving = true;
        const formValue = this.couponForm.getRawValue();

        // Prepare data
        const couponData: any = {
            code: formValue.code,
            type: formValue.type,
            value: Number(formValue.value),
            minPurchaseAmount: Number(formValue.minPurchaseAmount),
            startDate: new Date(formValue.startDate),
            usageLimit: Number(formValue.usageLimit),
            isActive: formValue.isActive
        };

        if (formValue.endDate) {
            couponData.endDate = new Date(formValue.endDate);
        } else {
            couponData.endDate = null;
        }

        // Validate percentage
        if (couponData.type === 'percentage' && couponData.value > 100) {
            this.toast.error('Percentage discount cannot exceed 100%');
            this.isSaving = false;
            return;
        }

        try {
            if (this.isEditMode && this.couponId) {
                // Edit mode - direct update (no approval needed for edits in Phase 2)
                await this.couponService.updateCoupon(this.couponId, couponData);
                this.toast.success('Coupon updated successfully');
                this.router.navigate(['/admin/coupons']);
            } else {
                // Create mode - check if approval needed
                const approvalData: CouponApprovalData = {
                    code: couponData.code,
                    type: couponData.type,
                    value: couponData.value,
                    description: formValue.description,
                    usageLimit: couponData.usageLimit,
                    startDate: Timestamp.fromDate(couponData.startDate),
                    endDate: couponData.endDate ? Timestamp.fromDate(couponData.endDate) : undefined,
                    minPurchaseAmount: couponData.minPurchaseAmount
                };

                // Check if auto-approval is possible
                const canAutoApprove = this.approvalService.canAutoApprove('COUPON_CREATION', approvalData);

                if (canAutoApprove) {
                    // Auto-approved - create directly
                    await this.couponService.createCoupon(couponData);
                    this.toast.success('Coupon created successfully (auto-approved)');
                    this.router.navigate(['/admin/coupons']);
                } else {
                    // Requires approval - create approval request
                    await this.approvalService.createApprovalRequest(
                        'COUPON_CREATION',
                        approvalData,
                        formValue.description || 'New coupon creation request'
                    );
                    this.toast.info('Coupon submitted for approval. A manager will review your request.');
                    this.router.navigate(['/admin/coupons']);
                }
            }
        } catch (error: any) {
            console.error('Error saving coupon:', error);
            if (error.message === 'Coupon code already exists') {
                this.couponForm.get('code')?.setErrors({ notUnique: true });
                this.toast.error('Coupon code already exists');
            } else {
                this.toast.error('Failed to save coupon');
            }
        } finally {
            this.isSaving = false;
        }
    }

    // Helper date formatter for input[type="date"]
    private formatDate(date: Date | Timestamp | string): string {
        if (!date) return '';
        let d: Date;
        if (date instanceof Timestamp) {
            d = date.toDate();
        } else if (typeof date === 'string') {
            d = new Date(date);
        } else {
            d = date;
        }
        return d.toISOString().split('T')[0];
    }

    // Cross-field validator
    private dateRangeValidator(group: AbstractControl): ValidationErrors | null {
        const start = group.get('startDate')?.value;
        const end = group.get('endDate')?.value;

        if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            if (endDate < startDate) {
                return { dateRangeInvalid: true };
            }
        }
        return null;
    }
    onCancel() {
        this.router.navigate(['/admin/coupons']);
    }

    generateCode() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        this.couponForm.patchValue({ code: result });
    }
}
