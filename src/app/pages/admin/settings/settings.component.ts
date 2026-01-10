import { Component, inject, OnInit, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SettingsService, WebsiteSettings } from '../../../core/services/settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../shared/toggle-switch/toggle-switch.component';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule, RouterLink, AdminPageHeaderComponent, ToggleSwitchComponent],
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
    isAutoSaving = false;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
    activeTab: 'general' | 'social' | 'features' | 'hours' = 'general';
    lastSaved: Date | undefined = undefined;
    hasUnsavedChanges = false;
    daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    // Change history for undo/redo
    private changeHistory: any[] = [];
    private historyIndex = -1;
    canUndo = false;
    canRedo = false;

    // Character counters
    addressCharCount = 0;
    promoTextCharCount = 0;
    maxAddressChars = 200;
    maxPromoChars = 100;

    // Clipboard feedback
    copiedField: string | null = null;

    constructor() {
        this.settingsForm = this.fb.group({
            general: this.fb.group({
                companyName: [''],
                phone: [''],
                whatsapp: [''],
                email: ['', [Validators.email]],
                address: ['']
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
            })
        });
    }

    ngOnInit() {
        this.settingsService.settings$.subscribe({
            next: (settings) => {
                if (settings) {
                    this.settingsForm.patchValue(settings);
                    this.saveToHistory();
                }
                this.isLoading = false;
            },
            error: (err) => {
                console.error('Error loading settings', err);
                this.isLoading = false;
            }
        });

        // Auto-save with debouncing
        this.settingsForm.valueChanges
            .pipe(
                debounceTime(2000),
                distinctUntilChanged(),
                takeUntil(this.destroy$)
            )
            .subscribe(() => {
                if (this.hasUnsavedChanges && !this.isSaving) {
                    this.autoSave();
                }
            });

        // Track form changes for unsaved warning
        this.settingsForm.valueChanges
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => {
                this.hasUnsavedChanges = true;
                this.updateCharacterCounts();
            });

        // Initial character count
        this.updateCharacterCounts();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    @HostListener('window:beforeunload', ['$event'])
    unloadNotification($event: any): void {
        if (this.hasUnsavedChanges) {
            $event.returnValue = true;
        }
    }

    setActiveTab(tab: 'general' | 'social' | 'features' | 'hours') {
        this.activeTab = tab;
    }

    async onSubmit() {
        if (this.settingsForm.invalid) return;

        this.isSaving = true;
        try {
            const formValue = this.settingsForm.value as WebsiteSettings;
            await this.settingsService.updateSettings(formValue);
            this.lastSaved = new Date();
            this.hasUnsavedChanges = false;
            this.toast.success(this.translate.instant('SETTINGS.SUCCESS'));
        } catch (error) {
            console.error(error);
            this.toast.error(this.translate.instant('ADMIN.COMMON.ERROR'));
        } finally {
            this.isSaving = false;
        }
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
        return this.translate.instant(`SETTINGS.HOURS.${day.toUpperCase()}`);
    }

    getDayIcon(day: string): string {
        const icons: { [key: string]: string } = {
            monday: '📅',
            tuesday: '📅',
            wednesday: '📅',
            thursday: '📅',
            friday: '📅',
            saturday: '🎉',
            sunday: '☀️'
        };
        return icons[day] || '📅';
    }

    // Preset templates
    private presets = {
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

    applyPreset(event: any): void {
        const presetName = event.target.value;
        if (!presetName) return;

        const preset = this.presets[presetName as keyof typeof this.presets];
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
        this.toast.success(this.translate.instant('SETTINGS.HOURS.PRESET_APPLIED'));
    }

    copyMondayToWeekdays(): void {
        const mondayHours = this.settingsForm.get('businessHours.monday')?.value;
        if (!mondayHours) return;

        ['tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
            this.settingsForm.get(`businessHours.${day}`)?.patchValue(mondayHours);
        });

        this.toast.success(this.translate.instant('SETTINGS.HOURS.COPIED_TO_WEEKDAYS'));
    }

    openSetAllSameModal(): void {
        const time = prompt(this.translate.instant('SETTINGS.HOURS.SET_ALL_SAME_PROMPT'));
        if (!time) return;

        const [open, close] = time.split('-').map(t => t.trim());
        if (!open || !close) {
            this.toast.error(this.translate.instant('SETTINGS.HOURS.INVALID_FORMAT'));
            return;
        }

        this.daysOfWeek.forEach(day => {
            this.settingsForm.get(`businessHours.${day}`)?.patchValue({
                open,
                close,
                closed: false
            });
        });

        this.toast.success(this.translate.instant('SETTINGS.HOURS.APPLIED_TO_ALL'));
    }

    resetToDefaults(): void {
        const confirmed = confirm(this.translate.instant('SETTINGS.HOURS.RESET_CONFIRM'));
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
        this.toast.success(this.translate.instant('SETTINGS.HOURS.RESET_SUCCESS'));
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
            return this.translate.instant('SETTINGS.HOURS.CLOSED');
        }

        if (!open || !close) {
            return this.translate.instant('SETTINGS.HOURS.NOT_SET');
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

    // Auto-save functionality
    private async autoSave(): Promise<void> {
        if (this.settingsForm.invalid) return;

        this.isAutoSaving = true;
        this.saveStatus = 'saving';

        try {
            const formValue = this.settingsForm.value as WebsiteSettings;
            await this.settingsService.updateSettings(formValue);
            this.lastSaved = new Date();
            this.hasUnsavedChanges = false;
            this.saveStatus = 'saved';
            this.saveToHistory();

            // Reset status after 3 seconds
            setTimeout(() => {
                if (this.saveStatus === 'saved') {
                    this.saveStatus = 'idle';
                }
            }, 3000);
        } catch (error) {
            console.error(error);
            this.saveStatus = 'error';
        } finally {
            this.isAutoSaving = false;
        }
    }

    // Keyboard shortcuts
    @HostListener('document:keydown', ['$event'])
    handleKeyboardShortcuts(event: KeyboardEvent): void {
        // Cmd/Ctrl + S to save
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            this.onSubmit();
        }

        // Cmd/Ctrl + Z to undo
        if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey) {
            event.preventDefault();
            this.undo();
        }

        // Cmd/Ctrl + Shift + Z to redo
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'z') {
            event.preventDefault();
            this.redo();
        }

        // Escape to clear unsaved changes warning
        if (event.key === 'Escape' && this.hasUnsavedChanges) {
            const confirmed = confirm(this.translate.instant('SETTINGS.DISCARD_CHANGES'));
            if (confirmed) {
                this.settingsService.settings$.subscribe(settings => {
                    if (settings) {
                        this.settingsForm.patchValue(settings);
                        this.hasUnsavedChanges = false;
                    }
                });
            }
        }
    }

    // Clipboard functionality
    async copyToClipboard(value: string, fieldName: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(value);
            this.copiedField = fieldName;
            this.toast.success(this.translate.instant('SETTINGS.COPIED'));

            // Reset after 2 seconds
            setTimeout(() => {
                this.copiedField = null;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
            this.toast.error(this.translate.instant('SETTINGS.COPY_FAILED'));
        }
    }

    // Change history for undo/redo
    private saveToHistory(): void {
        const currentState = this.settingsForm.value;

        // Remove any future states if we're not at the end
        if (this.historyIndex < this.changeHistory.length - 1) {
            this.changeHistory = this.changeHistory.slice(0, this.historyIndex + 1);
        }

        this.changeHistory.push(JSON.parse(JSON.stringify(currentState)));
        this.historyIndex = this.changeHistory.length - 1;

        // Limit history to 20 states
        if (this.changeHistory.length > 20) {
            this.changeHistory.shift();
            this.historyIndex--;
        }

        this.updateUndoRedoState();
    }

    undo(): void {
        if (!this.canUndo) return;

        this.historyIndex--;
        const previousState = this.changeHistory[this.historyIndex];
        this.settingsForm.patchValue(previousState, { emitEvent: false });
        this.hasUnsavedChanges = true;
        this.updateUndoRedoState();
        this.toast.info(this.translate.instant('SETTINGS.UNDONE'));
    }

    redo(): void {
        if (!this.canRedo) return;

        this.historyIndex++;
        const nextState = this.changeHistory[this.historyIndex];
        this.settingsForm.patchValue(nextState, { emitEvent: false });
        this.hasUnsavedChanges = true;
        this.updateUndoRedoState();
        this.toast.info(this.translate.instant('SETTINGS.REDONE'));
    }

    private updateUndoRedoState(): void {
        this.canUndo = this.historyIndex > 0;
        this.canRedo = this.historyIndex < this.changeHistory.length - 1;
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
            ? this.translate.instant('SETTINGS.SOCIAL.ALL_SHOWN')
            : this.translate.instant('SETTINGS.SOCIAL.ALL_HIDDEN');
        this.toast.success(message);
    }

    // Character counter
    private updateCharacterCounts(): void {
        const address = this.settingsForm.get('general.address')?.value || '';
        const promoText = this.settingsForm.get('features.promoText')?.value || '';

        this.addressCharCount = address.length;
        this.promoTextCharCount = promoText.length;
    }

    getCharCountClass(current: number, max: number): string {
        const percentage = (current / max) * 100;
        if (percentage >= 90) return 'char-count-danger';
        if (percentage >= 75) return 'char-count-warning';
        return 'char-count-normal';
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

    // Form progress calculation
    getTabProgress(tab: string): number {
        const group = this.settingsForm.get(tab);
        if (!group) return 0;

        const controls = Object.keys((group as FormGroup).controls);
        const filledControls = controls.filter(key => {
            const value = group.get(key)?.value;
            return value !== null && value !== '' && value !== false;
        });

        return Math.round((filledControls.length / controls.length) * 100);
    }

    getOverallProgress(): number {
        const tabs = ['general', 'social', 'features', 'businessHours'];
        const totalProgress = tabs.reduce((sum, tab) => sum + this.getTabProgress(tab), 0);
        return Math.round(totalProgress / tabs.length);
    }
}
