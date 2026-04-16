import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Firestore, doc, getDoc, setDoc, addDoc, collection, Timestamp, getDocs, query, where } from '@angular/fire/firestore';
import { ThemeService } from '../../../../../core/services/theme.service';
import { AuthService } from '../../../../../core/services/auth.service';
import { WebsiteTheme, CampaignSlide } from '../../../../../core/models/campaign.model';
import { MediaAsset } from '../../../../../core/models/media.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { MediaPickerDialogComponent } from '../../../../../shared/components/media-picker-dialog/media-picker-dialog.component';

export interface CouponOption {
    id: string;
    code: string;
    type: 'percentage' | 'fixed_amount';
    value: number;
    description?: string;
}

@Component({
    selector: 'app-campaign-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink, AppIconComponent, MediaPickerDialogComponent],
    templateUrl: './campaign-form.component.html',
    styleUrl: './campaign-form.component.css'
})
export class CampaignFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private firestore = inject(Firestore);
    private router = inject(Router);
    private location = inject(Location);
    private route = inject(ActivatedRoute);
    private themeService = inject(ThemeService);
    private authService = inject(AuthService);

    form!: FormGroup;
    themes = this.themeService.getAvailableThemes();

    loading = signal(false);
    isEditMode = signal(false);
    campaignId: string | null = null;

    // Slides state
    slides = signal<CampaignSlide[]>([]);
    showMediaPicker = signal(false);
    editingSlideIndex = signal<number | null>(null); // null = adding new, number = replacing

    // Preview
    previewIndex = signal(0);

    // ── Coupon Picker ─────────────────────────────────────────────────────────
    availableCoupons = signal<CouponOption[]>([]);
    couponSearch     = signal('');
    couponsLoading   = signal(false);

    /** Returns coupons filtered by the search term */
    get filteredCoupons(): CouponOption[] {
        const q = this.couponSearch().toLowerCase();
        return this.availableCoupons().filter(c =>
            !q || c.code.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)
        );
    }

    /** Returns the full coupon object currently linked to this campaign, or null */
    get selectedCoupon(): CouponOption | null {
        const id = this.form?.get('activeCouponId')?.value;
        return id ? (this.availableCoupons().find(c => c.id === id) ?? null) : null;
    }

    /** Human-readable label: "BLACKF20 — 20% · Descuento Black Friday" */
    couponLabel(c: CouponOption): string {
        const disc = c.type === 'percentage' ? `${c.value}%` : `$${c.value} MXN`;
        return `${c.code} — ${disc}${c.description ? ' · ' + c.description : ''}`;
    }

    /** Clear the currently linked coupon */
    clearCoupon() {
        this.form.patchValue({ activeCouponId: null });
        this.couponSearch.set('');
    }

    ngOnInit() {
        this.initForm();
        this.checkEditMode();
        this.loadCoupons();
    }

    private initForm() {
        this.form = this.fb.group({
            name:          ['', Validators.required],
            description:   [''],
            priority:      [1, [Validators.required, Validators.min(1), Validators.max(10)]],
            isActive:      [true],
            startDate:     ['', Validators.required],
            endDate:       ['', Validators.required],
            themeId:       ['default', Validators.required],
            promoStripText: [''],
            activeCouponId: [null]
        });
    }

    /** Load all active coupons from Firestore for the picker dropdown */
    private async loadCoupons() {
        this.couponsLoading.set(true);
        try {
            const snap = await getDocs(
                query(collection(this.firestore, 'coupons'), where('isActive', '==', true))
            );
            const list: CouponOption[] = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id:          d.id,
                    code:        data['code']        ?? '',
                    type:        data['type']        ?? 'percentage',
                    value:       data['value']       ?? 0,
                    description: data['description'] ?? undefined,
                };
            }).sort((a, b) => a.code.localeCompare(b.code));
            this.availableCoupons.set(list);
        } catch (e) {
            console.warn('[CampaignForm] Could not load coupons:', e);
        } finally {
            this.couponsLoading.set(false);
        }
    }

    private async checkEditMode() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.isEditMode.set(true);
            this.campaignId = id;
            this.loading.set(true);

            try {
                const docRef   = doc(this.firestore, 'campaigns', id);
                const snapshot = await getDoc(docRef);
                if (snapshot.exists()) {
                    const data  = snapshot.data();
                    const start = data['startDate'] ? new Date(data['startDate'].toDate()) : new Date();
                    const end   = data['endDate']   ? new Date(data['endDate'].toDate())   : new Date();

                    start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
                    end.setMinutes(end.getMinutes()     - end.getTimezoneOffset());

                    this.form.patchValue({
                        name:           data['name'],
                        description:    data['description'],
                        priority:       data['priority'],
                        isActive:       data['isActive'],
                        startDate:      start.toISOString().slice(0, 16),
                        endDate:        end.toISOString().slice(0, 16),
                        themeId:        data['themeId'],
                        promoStripText: data['promoStripText'],
                        activeCouponId: data['activeCouponId'] ?? null
                    });

                    // Load existing slides
                    const existingSlides: CampaignSlide[] = data['slides'] || [];
                    this.slides.set(existingSlides.sort((a, b) => a.order - b.order));
                }
            } catch (err) {
                console.error('Error fetching campaign', err);
            } finally {
                this.loading.set(false);
            }
        }
    }

    // ── Slide Management ─────────────────────────────────────────────────────

    openMediaPickerForNew() {
        this.editingSlideIndex.set(null);
        this.showMediaPicker.set(true);
    }

    openMediaPickerForEdit(index: number) {
        this.editingSlideIndex.set(index);
        this.showMediaPicker.set(true);
    }

    onMediaSelected(asset: MediaAsset) {
        this.showMediaPicker.set(false);
        const editIdx = this.editingSlideIndex();

        if (editIdx !== null) {
            // Replace image on existing slide
            this.slides.update(slides => slides.map((s, i) =>
                i === editIdx
                    ? { ...s, imageUrl: asset.publicUrl, imageStoragePath: asset.storagePath }
                    : s
            ));
        } else {
            // Add new slide
            const newSlide: CampaignSlide = {
                imageUrl:         asset.publicUrl,
                imageStoragePath: asset.storagePath,
                ctaUrl:           '',
                ctaLabel:         '',
                order:            this.slides().length,
                active:           true,
                clickCount:       0
            };
            this.slides.update(s => [...s, newSlide]);
            this.previewIndex.set(this.slides().length - 1);
        }
        this.editingSlideIndex.set(null);
    }

    updateSlideField(index: number, field: keyof CampaignSlide, value: any) {
        this.slides.update(slides => slides.map((s, i) =>
            i === index ? { ...s, [field]: value } : s
        ));
    }

    moveSlide(index: number, direction: 'up' | 'down') {
        const arr    = [...this.slides()];
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= arr.length) return;
        [arr[index], arr[target]] = [arr[target], arr[index]];
        const reordered = arr.map((s, i) => ({ ...s, order: i }));
        this.slides.set(reordered);
        this.previewIndex.set(target);
    }

    removeSlide(index: number) {
        this.slides.update(slides => {
            const filtered = slides.filter((_, i) => i !== index);
            return filtered.map((s, i) => ({ ...s, order: i }));
        });
        this.previewIndex.set(0);
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    get activePreviewSlides() {
        return this.slides().filter(s => s.active);
    }

    prevPreview() {
        const len = this.activePreviewSlides.length;
        if (!len) return;
        this.previewIndex.update(i => (i - 1 + len) % len);
    }

    nextPreview() {
        const len = this.activePreviewSlides.length;
        if (!len) return;
        this.previewIndex.update(i => (i + 1) % len);
    }

    // ── Save ─────────────────────────────────────────────────────────────────

    async save() {
        if (this.form.invalid) return;
        this.loading.set(true);

        try {
            const val     = this.form.value;
            const payload: any = {
                ...val,
                startDate:      Timestamp.fromDate(new Date(val.startDate)),
                endDate:        Timestamp.fromDate(new Date(val.endDate)),
                slides:         this.slides(),
                updatedAt:      Timestamp.now(),
                activeCouponId: val.activeCouponId || null   // persist null explicitly so Firestore clears it
            };

            if (this.isEditMode() && this.campaignId) {
                await setDoc(doc(this.firestore, 'campaigns', this.campaignId), payload, { merge: true });
            } else {
                payload.createdAt  = Timestamp.now();
                const user         = this.authService.currentUser();
                payload.createdBy  = user ? (user.uid || user.email || 'admin') : 'admin';
                await addDoc(collection(this.firestore, 'campaigns'), payload);
            }

            this.location.back();
        } catch (err) {
            console.error('Error saving campaign', err);
            alert('Failed to save campaign');
        } finally {
            this.loading.set(false);
        }
    }

    goBack() { this.location.back(); }
}
