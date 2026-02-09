import { Component, inject, OnInit, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SettingsService, WebsiteSettings } from '../../../core/services/settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../shared/toggle-switch/toggle-switch.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule, RouterLink, AdminPageHeaderComponent, ToggleSwitchComponent, AppIconComponent],
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit, OnDestroy {
    private fb = inject(FormBuilder);
    private settingsService = inject(SettingsService);
    private toast = inject(ToastService);
    private translate = inject(TranslateService);
    private destroy$ = new Subject<void>();

    settingsForm: FormGroup;
    isLoading = true;
    isSaving = false;
    activeTab: 'general' | 'social' | 'features' | 'hours' | 'seo' = 'general';
    daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    // Character counters
    addressCharCount = 0;
    maxAddressChars = 200;

    // Clipboard feedback
    copiedField: string | null = null;

    constructor() {
        this.settingsForm = this.fb.group({
            general: this.fb.group({
                companyName: [''],
                phone: [''],
                whatsapp: [''],
                email: ['', [Validators.email]],
                address: [''],
                logo: [''],
                favicon: ['']
            }),
            social: this.fb.group({
                facebook: [''],
                instagram: [''],
                linkedin: [''],
                twitter: [''],
                youtube: [''],
                tiktok: [''],
                showFacebook: [true],
                showInstagram: [true],
                showLinkedin: [true],
                showTwitter: [false],
                showYoutube: [false],
                showTiktok: [false]
            }),
            businessHours: this.fb.group({
                monday: this.fb.group({ open: ['09:00'], close: ['19:00'], closed: [false] }),
                tuesday: this.fb.group({ open: ['09:00'], close: ['19:00'], closed: [false] }),
                wednesday: this.fb.group({ open: ['09:00'], close: ['19:00'], closed: [false] }),
                thursday: this.fb.group({ open: ['09:00'], close: ['19:00'], closed: [false] }),
                friday: this.fb.group({ open: ['09:00'], close: ['19:00'], closed: [false] }),
                saturday: this.fb.group({ open: ['09:00'], close: ['14:00'], closed: [false] }),
                sunday: this.fb.group({ open: ['00:00'], close: ['00:00'], closed: [true] })
            }),
            features: this.fb.group({
                maintenanceMode: [false],
                showPromoBanner: [false],
                promoText: [''],
                enableChatWidget: [true]
            }),
            seo: this.fb.group({
                metaTitle: ['{{page_title}} | {{site_name}}'],
                metaDescription: [''],
                ogImage: ['']
            })
        });
    }

    ngOnInit() {
        this.loadSettings();

        // Track character count
        this.settingsForm.get('general.address')?.valueChanges
            .pipe(takeUntil(this.destroy$))
            .subscribe(val => this.addressCharCount = (val || '').length);
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    loadSettings() {
        this.isLoading = true;
        this.settingsService.settings$.subscribe({
            next: (settings) => {
                if (settings) {
                    this.settingsForm.patchValue(settings);
                }
                this.isLoading = false;
            },
            error: (err) => {
                console.error('Error loading settings', err);
                this.isLoading = false;
            }
        });
    }

    setActiveTab(tab: 'general' | 'social' | 'features' | 'hours' | 'seo') {
        this.activeTab = tab;
    }

    // Brand Assets Handlers
    onFileSelected(event: any, field: 'logo' | 'favicon'): void {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e: any) => {
                this.settingsForm.get(`general.${field}`)?.setValue(e.target.result);
                this.settingsForm.markAsDirty();
            };
            reader.readAsDataURL(file);
        }
    }

    removeAsset(field: 'logo' | 'favicon'): void {
        this.settingsForm.get(`general.${field}`)?.setValue('');
        this.settingsForm.markAsDirty();
    }

    async onSubmit() {
        if (this.settingsForm.invalid) return;

        this.isSaving = true;
        try {
            const formValue = this.settingsForm.value as WebsiteSettings;
            await this.settingsService.updateSettings(formValue);
            this.settingsForm.markAsPristine();
            this.toast.success(this.translate.instant('WEBSITE_SETTINGS.SUCCESS'));
        } catch (error) {
            console.error(error);
            this.toast.error(this.translate.instant('ADMIN.COMMON.ERROR'));
        } finally {
            this.isSaving = false;
        }
    }

    onCancel() {
        // Reload settings to reset changes
        this.loadSettings();
        this.settingsForm.markAsPristine();
        this.toast.info(this.translate.instant('ADMIN.COMMON.CHANGES_DISCARDED'));
    }

    // Validation helpers
    validateEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    validateUrl(url: string): boolean {
        if (!url) return true; // Empty is valid
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    validatePhone(phone: string): boolean {
        if (!phone) return true; // Empty is valid
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        return phoneRegex.test(phone.replace(/[\s()-]/g, ''));
    }

    openUrlInNewTab(url: string): void {
        if (url && this.validateUrl(url)) {
            window.open(url, '_blank');
        }
    }

    isFieldValid(fieldPath: string): boolean | null {
        const control = this.settingsForm.get(fieldPath);
        if (!control) return null;
        return control.valid && control.value && control.touched;
    }

    isFieldInvalid(fieldPath: string): boolean | null {
        const control = this.settingsForm.get(fieldPath);
        if (!control) return null;
        return control.invalid && control.touched;
    }

    getDayLabel(day: string): string {
        return this.translate.instant(`WEBSITE_SETTINGS.HOURS.${day.toUpperCase()}`);
    }

    // Preset templates
    applyBusinessHoursPreset(event: any): void {
        const presetName = event.target.value;
        if (!presetName) return;

        const presets: any = {
            standard: {
                weekdays: { open: '09:00', close: '17:00', closed: false },
                saturday: { open: '09:00', close: '13:00', closed: false },
                sunday: { open: '00:00', close: '00:00', closed: true }
            },
            retail: {
                weekdays: { open: '10:00', close: '20:00', closed: false },
                saturday: { open: '10:00', close: '20:00', closed: false },
                sunday: { open: '11:00', close: '18:00', closed: false }
            },
            restaurant: {
                weekdays: { open: '11:00', close: '22:00', closed: false },
                saturday: { open: '11:00', close: '23:00', closed: false },
                sunday: { open: '11:00', close: '21:00', closed: false }
            },
            '24x7': {
                all: { open: '00:00', close: '23:59', closed: false }
            }
        };

        const preset = presets[presetName];
        if (!preset) return;

        const businessHours = this.settingsForm.get('businessHours');
        if (!businessHours) return;

        if ('all' in preset) {
            // Apply to all days (24x7)
            this.daysOfWeek.forEach(day => {
                businessHours.get(day)?.patchValue(preset.all);
            });
        } else {
            // Apply weekday/weekend pattern
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
                businessHours.get(day)?.patchValue(preset.weekdays);
            });
            businessHours.get('saturday')?.patchValue(preset.saturday);
            businessHours.get('sunday')?.patchValue(preset.sunday);
        }

        // Reset dropdown
        event.target.value = '';
        this.toast.success(this.translate.instant('WEBSITE_SETTINGS.HOURS.PRESET_APPLIED'));
    }

    copyMondayToWeekdays(): void {
        const mondayHours = this.settingsForm.get('businessHours.monday')?.value;
        if (!mondayHours) return;

        ['tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
            this.settingsForm.get(`businessHours.${day}`)?.patchValue(mondayHours);
        });

        this.toast.success(this.translate.instant('WEBSITE_SETTINGS.HOURS.COPIED_TO_WEEKDAYS'));
    }

    openSetAllSameModal(): void {
        const time = prompt(this.translate.instant('WEBSITE_SETTINGS.HOURS.SET_ALL_SAME_PROMPT'));
        if (!time) return;

        const [open, close] = time.split('-').map(t => t.trim());
        if (!open || !close) {
            this.toast.error(this.translate.instant('WEBSITE_SETTINGS.HOURS.INVALID_FORMAT'));
            return;
        }

        this.daysOfWeek.forEach(day => {
            this.settingsForm.get(`businessHours.${day}`)?.patchValue({
                open,
                close,
                closed: false
            });
        });

        this.toast.success(this.translate.instant('WEBSITE_SETTINGS.HOURS.APPLIED_TO_ALL'));
    }

    resetToDefaults(): void {
        const confirmed = confirm(this.translate.instant('WEBSITE_SETTINGS.HOURS.RESET_CONFIRM'));
        if (!confirmed) return;

        const defaults = {
            monday: { open: '09:00', close: '19:00', closed: false },
            tuesday: { open: '09:00', close: '19:00', closed: false },
            wednesday: { open: '09:00', close: '19:00', closed: false },
            thursday: { open: '09:00', close: '19:00', closed: false },
            friday: { open: '09:00', close: '19:00', closed: false },
            saturday: { open: '09:00', close: '14:00', closed: false },
            sunday: { open: '00:00', close: '00:00', closed: true }
        };

        this.settingsForm.get('businessHours')?.patchValue(defaults);
        this.toast.success(this.translate.instant('WEBSITE_SETTINGS.HOURS.RESET_SUCCESS'));
    }

    // Time validation
    private timeErrors = new Set<string>();

    validateTimeRange(day: string): void {
        const dayGroup = this.settingsForm.get(`businessHours.${day}`);
        if (!dayGroup) return;

        const { open, close, closed } = dayGroup.value;

        if (closed) {
            this.timeErrors.delete(day);
            return;
        }

        if (open && close && open >= close) {
            this.timeErrors.add(day);
        } else {
            this.timeErrors.delete(day);
        }
    }

    hasTimeError(day: string): boolean {
        return this.timeErrors.has(day);
    }

    onClosedToggle(day: string): void {
        this.validateTimeRange(day);
    }

    // Hours preview
    getHoursPreview(day: string): string {
        const dayGroup = this.settingsForm.get(`businessHours.${day}`);
        if (!dayGroup) return '';

        const { open, close, closed } = dayGroup.value;

        if (closed) {
            return this.translate.instant('WEBSITE_SETTINGS.HOURS.CLOSED');
        }

        if (!open || !close) {
            return this.translate.instant('WEBSITE_SETTINGS.HOURS.NOT_SET');
        }

        return `${this.formatTime(open)} - ${this.formatTime(close)}`;
    }

    private formatTime(time: string): string {
        if (!time) return '';
        const [hours, minutes] = time.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:${minutes} ${ampm}`;
    }

    // Keyboard shortcuts
    @HostListener('document:keydown', ['$event'])
    handleKeyboardShortcuts(event: KeyboardEvent): void {
        // Cmd/Ctrl + S to save
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            this.onSubmit();
        }
    }

    // Clipboard functionality
    async copyToClipboard(value: string, fieldName: string): Promise<void> {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            this.copiedField = fieldName;
            this.toast.success(this.translate.instant('WEBSITE_SETTINGS.COPIED'));

            // Reset after 2 seconds
            setTimeout(() => {
                this.copiedField = null;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
            this.toast.error(this.translate.instant('WEBSITE_SETTINGS.COPY_FAILED'));
        }
    }

    // Social media bulk toggle
    toggleAllSocialMedia(show: boolean): void {
        const socialGroup = this.settingsForm.get('social');
        if (!socialGroup) return;

        socialGroup.patchValue({
            showFacebook: show,
            showInstagram: show,
            showLinkedin: show,
            showTwitter: show,
            showYoutube: show,
            showTiktok: show
        });

        const message = show
            ? this.translate.instant('WEBSITE_SETTINGS.SOCIAL.ALL_SHOWN')
            : this.translate.instant('WEBSITE_SETTINGS.SOCIAL.ALL_HIDDEN');
        this.toast.success(message);
    }

    getCharCountClass(current: number, max: number): string {
        const percentage = (current / max) * 100;
        if (percentage >= 90) return 'text-red-500';
        if (percentage >= 75) return 'text-orange-500';
        return 'text-[var(--admin-text-muted)]';
    }

    // Phone number formatting
    formatPhoneNumber(event: any, fieldPath: string): void {
        const input = event.target;
        let value = input.value.replace(/\D/g, '');

        // Format as +52 XXX XXX XXXX
        if (value.length > 0) {
            if (!value.startsWith('52')) {
                value = '52' + value;
            }
            let formatted = '+' + value.substring(0, 2);
            if (value.length > 2) {
                formatted += ' ' + value.substring(2, 5);
            }
            if (value.length > 5) {
                formatted += ' ' + value.substring(5, 8);
            }
            if (value.length > 8) {
                formatted += ' ' + value.substring(8, 12);
            }

            this.settingsForm.get(fieldPath)?.setValue(formatted, { emitEvent: false });
        }
    }

    // Email validation with suggestions
    getEmailSuggestion(email: string): string | null {
        if (!email || !email.includes('@')) return null;

        const commonDomains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com'];
        const [, domain] = email.split('@');

        if (!domain) return null;

        // Check for common typos
        const typos: { [key: string]: string } = {
            'gmial.com': 'gmail.com',
            'gmai.com': 'gmail.com',
            'yahooo.com': 'yahoo.com',
            'hotmial.com': 'hotmail.com',
            'outlok.com': 'outlook.com'
        };

        return typos[domain.toLowerCase()] || null;
    }

    applySuggestion(suggestion: string): void {
        const email = this.settingsForm.get('general.email')?.value || '';
        const [username] = email.split('@');
        this.settingsForm.get('general.email')?.setValue(`${username}@${suggestion}`);
    }
}
