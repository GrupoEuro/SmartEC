import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-admin-page-header',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './admin-page-header.component.html',
    styleUrls: ['./admin-page-header.component.css']
})
export class AdminPageHeaderComponent {
    // Basic Info
    @Input() icon = '📄';
    @Input() iconName = '';
    @Input() title = '';
    @Input() subtitle = '';
    @Input() variant: 'admin' | 'operations' = 'admin';

    // Optional Features
    @Input() showKeyboardHints = false;
    @Input() showStatus = false;
    @Input() showUndoRedo = false;
    @Input() showProgress = false;
    @Input() showSaveCancel = false;

    // Status & Progress
    @Input() saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
    @Input() lastSaved?: Date;
    @Input() canUndo = false;
    @Input() canRedo = false;
    @Input() progress = 0;
    @Input() isSaving = false;
    @Input() hasUnsavedChanges = false;
    @Input() isFormInvalid = false;
    @Input() confirmOnCancel = true; // Show confirmation when canceling with unsaved changes

    // Events
    @Output() onSave = new EventEmitter<void>();
    @Output() onCancel = new EventEmitter<void>();
    @Output() onUndo = new EventEmitter<void>();
    @Output() onRedo = new EventEmitter<void>();

    handleSave(): void {
        if (!this.isFormInvalid && !this.isSaving) {
            this.onSave.emit();
        }
    }

    handleCancel(): void {
        if (this.hasUnsavedChanges && this.confirmOnCancel) {
            const message = 'You have unsaved changes. Are you sure you want to leave?';
            if (confirm(message)) {
                this.onCancel.emit();
            }
        } else {
            this.onCancel.emit();
        }
    }

    handleUndo(): void {
        if (this.canUndo) {
            this.onUndo.emit();
        }
    }

    handleRedo(): void {
        if (this.canRedo) {
            this.onRedo.emit();
        }
    }
}
