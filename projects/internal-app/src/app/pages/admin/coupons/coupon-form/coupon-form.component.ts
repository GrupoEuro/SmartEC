import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import * as QRCode from 'qrcode';
import { CouponService } from '../../../../core/services/coupon.service';
import { Coupon, DiscountType } from '../../../../core/models/coupon.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ApprovalWorkflowService } from '../../../../core/services/approval-workflow.service';
import { CouponApprovalData } from '../../../../core/models/approval-request.model';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { Timestamp } from '@angular/fire/firestore';
import { MediaPickerDialogComponent } from '../../../../shared/components/media-picker-dialog/media-picker-dialog.component';
import { MediaAsset } from '../../../../core/models/media.model';
import { MediaService } from '../../../../core/services/media.service';

@Component({
    selector: 'app-coupon-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent, AppIconComponent, MediaPickerDialogComponent],
    templateUrl: './coupon-form.component.html',
    styleUrls: ['./coupon-form.component.css']
})
export class CouponFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private couponService = inject(CouponService);
    private mediaService = inject(MediaService);
    private approvalService = inject(ApprovalWorkflowService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private toast = inject(ToastService);

    couponForm: FormGroup;
    isEditMode = false;
    couponId: string | null = null;
    isLoading = false;
    isSaving = false;
    qrImageDataUrl: string | null = null;
    qrTrackingUrl: string | null = null;
    qrError: string | null = null;
    isMediaPickerOpen = false;
    isUploadingLogo = false;
    uploadProgress = 0;

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
            isActive: [true],
            redirectUrl: [''],
            qrLogoUrl: ['']
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
            isActive: coupon.isActive,
            redirectUrl: coupon.redirectUrl || '',
            qrLogoUrl: coupon.qrLogoUrl || ''
        });
        
        // Generate QR code for existing coupon
        this.generateQRCodeFor(coupon.code);
    }

    async generateQRCodeFor(code: string) {
        try {
            this.qrError = null;
            if (!code) {
                this.qrError = 'Code is empty';
                return;
            }
            
            const logoUrl = this.couponForm.get('qrLogoUrl')?.value;
            const utmParams = `utm_source=qr&utm_medium=print&utm_campaign=${encodeURIComponent(code)}`;
            this.qrTrackingUrl = `https://importadoraeuro.com/q/${code}?${utmParams}`;

            
            this.qrImageDataUrl = await this.couponService.generateCompositeQR(code, logoUrl);
        } catch (err: any) {
            console.error('Failed to generate QR code', err);
            this.qrError = err.message || String(err);
        }
    }
    
    downloadQR() {
        if (!this.qrImageDataUrl) return;
        const a = document.createElement('a');
        a.href = this.qrImageDataUrl;
        a.download = `QR_${this.couponForm.get('code')?.value || 'Coupon'}.png`;
        a.click();
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
            isActive: formValue.isActive,
            redirectUrl: formValue.redirectUrl,
            qrLogoUrl: formValue.qrLogoUrl
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
        this.generateQRCodeFor(result);
    }

    openMediaPicker() {
        this.isMediaPickerOpen = true;
    }

    onMediaSelected(asset: MediaAsset) {
        this.couponForm.patchValue({ qrLogoUrl: asset.publicUrl });
        this.isMediaPickerOpen = false;
        if (this.couponForm.get('code')?.value) {
            this.generateQRCodeFor(this.couponForm.get('code')?.value);
        }
    }

    removeLogo() {
        this.couponForm.patchValue({ qrLogoUrl: '' });
        if (this.couponForm.get('code')?.value) {
            this.generateQRCodeFor(this.couponForm.get('code')?.value);
        }
    }

    onDirectUpload(event: any) {
        const file = event.target.files[0];
        if (!file) return;

        this.isUploadingLogo = true;
        this.uploadProgress = 0;

        // Upload and save directly to media library using the service
        this.mediaService.uploadFile(file, 'site-assets', ['qr-logo']).subscribe({
            next: (state) => {
                this.uploadProgress = Math.round(state.progress);
                if (state.asset) {
                    this.couponForm.patchValue({ qrLogoUrl: state.asset.publicUrl });
                    if (this.couponForm.get('code')?.value) {
                        this.generateQRCodeFor(this.couponForm.get('code')?.value);
                    }
                }
            },
            error: (err) => {
                console.error('Direct upload failed', err);
                this.toast.error('Failed to upload image. Try selecting from library.');
                this.isUploadingLogo = false;
            },
            complete: () => {
                this.isUploadingLogo = false;
            }
        });
    }
}
