import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Firestore, doc, getDoc, setDoc, addDoc, collection, Timestamp } from '@angular/fire/firestore';
import { ThemeService } from '../../../../../core/services/theme.service';
import { AuthService } from '../../../../../core/services/auth.service';
import { WebsiteTheme } from '../../../../../core/models/campaign.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-campaign-form',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterLink, AppIconComponent],
    template: `
    <div class="p-6 max-w-4xl mx-auto">
      <!-- Breadcrumb -->
      <div class="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <a routerLink="/admin/marketing/campaigns" class="hover:text-blue-600">Calendar</a>
        <span>/</span>
        <span class="text-slate-800 font-medium">{{ isEditMode() ? 'Edit' : 'New' }} Campaign</span>
      </div>

      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <form [formGroup]="form" (ngSubmit)="save()" class="p-6 space-y-8">
            
            <!-- Section 1: Basic Info -->
            <div class="space-y-4">
                <h3 class="text-lg font-bold text-slate-800 dark:text-white border-b border-slate-100 pb-2">Basic Details</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Campaign Name</label>
                        <input formControlName="name" type="text" placeholder="e.g., Halloween Sale 2025" 
                            class="w-full h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-900 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    </div>
                    
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Priority (High Overrides Low)</label>
                        <input formControlName="priority" type="number" min="1" max="10" 
                            class="w-full h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-900 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <p class="text-xs text-slate-400">10 = Highest. Use for big overrides like "Black Friday".</p>
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Description (Internal)</label>
                    <textarea formControlName="description" rows="2" 
                        class="w-full p-4 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-900 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"></textarea>
                </div>

                <div class="flex items-center gap-4">
                     <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" formControlName="isActive" class="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-gray-300">
                        <span class="text-sm font-medium text-slate-700 dark:text-slate-300">Campaign is Active</span>
                     </label>
                </div>
            </div>

            <!-- Section 2: Scheduling -->
            <div class="space-y-4">
                <h3 class="text-lg font-bold text-slate-800 dark:text-white border-b border-slate-100 pb-2">Schedule</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Start Date & Time</label>
                        <input formControlName="startDate" type="datetime-local" 
                            class="w-full h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-900 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    </div>
                    
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">End Date & Time</label>
                        <input formControlName="endDate" type="datetime-local" 
                            class="w-full h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-900 bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    </div>
                </div>
            </div>

            <!-- Section 3: Visual Takeover -->
            <div class="space-y-4">
                <h3 class="text-lg font-bold text-slate-800 dark:text-white border-b border-slate-100 pb-2">Visual Takeover</h3>
                
                <div class="space-y-4">
                    <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Website Theme</label>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        @for (theme of themes; track theme.id) {
                            <label class="relative cursor-pointer group">
                                <input type="radio" formControlName="themeId" [value]="theme.id" class="peer sr-only">
                                <div class="p-3 rounded-xl border-2 peer-checked:border-blue-500 peer-checked:ring-2 peer-checked:ring-blue-200 border-slate-200 hover:border-blue-300 transition-all text-center">
                                    <div class="w-full h-12 rounded-lg mb-2 flex items-center justify-center text-xs font-bold shadow-sm"
                                         [style.background]="theme.backgroundColor"
                                         [style.color]="theme.primaryColor"
                                         [style.border-color]="theme.primaryColor">
                                         Aa
                                    </div>
                                    <span class="text-sm font-medium block capitalize">{{ theme.id }}</span>
                                </div>
                            </label>
                        }
                    </div>
                    <p class="text-xs text-slate-500">Select a theme to preview how the website colors will adapt.</p>
                </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" routerLink="/admin/marketing/campaigns" class="px-6 py-2.5 rounded-lg text-slate-600 hover:bg-slate-100 font-medium transition-colors">
                    Cancel
                </button>
                <button type="submit" [disabled]="form.invalid || loading()" 
                    class="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md shadow-blue-600/20 transition-all flex items-center gap-2">
                    @if (loading()) {
                        <app-icon name="loader" class="animate-spin"></app-icon>
                        Saving...
                    } @else {
                        Save Campaign
                    }
                </button>
            </div>
        </form>
      </div>
    </div>
  `
})
export class CampaignFormComponent implements OnInit {
    private fb = inject(FormBuilder);
    private firestore = inject(Firestore);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private themeService = inject(ThemeService);
    private authService = inject(AuthService);

    form!: FormGroup;
    themes = this.themeService.getAvailableThemes();

    loading = signal(false);
    isEditMode = signal(false);
    campaignId: string | null = null;

    ngOnInit() {
        this.initForm();
        this.checkEditMode();
    }

    private initForm() {
        this.form = this.fb.group({
            name: ['', Validators.required],
            description: [''],
            priority: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
            isActive: [true],
            startDate: ['', Validators.required],
            endDate: ['', Validators.required],
            themeId: ['default', Validators.required],
            heroBannerId: [null],
            promoStripText: [''],
            activeCouponId: [null]
        });
    }

    private async checkEditMode() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.isEditMode.set(true);
            this.campaignId = id;
            this.loading.set(true);

            try {
                const docRef = doc(this.firestore, 'campaigns', id);
                const snapshot = await getDoc(docRef);
                if (snapshot.exists()) {
                    const data = snapshot.data();

                    // Convert Timestamps to datetime-local string format (YYYY-MM-DDTHH:mm)
                    const start = data['startDate'] ? new Date(data['startDate'].toDate()) : new Date();
                    const end = data['endDate'] ? new Date(data['endDate'].toDate()) : new Date();

                    start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
                    end.setMinutes(end.getMinutes() - end.getTimezoneOffset());

                    this.form.patchValue({
                        ...data,
                        startDate: start.toISOString().slice(0, 16),
                        endDate: end.toISOString().slice(0, 16)
                    });
                }
            } catch (err) {
                console.error('Error fetching campaign', err);
            } finally {
                this.loading.set(false);
            }
        }
    }

    async save() {
        if (this.form.invalid) return;
        this.loading.set(true);

        try {
            const val = this.form.value;
            const payload = {
                ...val,
                startDate: Timestamp.fromDate(new Date(val.startDate)),
                endDate: Timestamp.fromDate(new Date(val.endDate)),
                updatedAt: Timestamp.now()
            };

            if (this.isEditMode() && this.campaignId) {
                await setDoc(doc(this.firestore, 'campaigns', this.campaignId), payload, { merge: true });
            } else {
                payload.createdAt = Timestamp.now();

                const user = this.authService.currentUser();
                payload.createdBy = user ? (user.uid || user.email || 'admin') : 'admin';

                await addDoc(collection(this.firestore, 'campaigns'), payload);
            }

            this.router.navigate(['/admin/marketing/campaigns']);
        } catch (err) {
            console.error('Error saving campaign', err);
            alert('Failed to save campaign');
        } finally {
            this.loading.set(false);
        }
    }
}
