import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormArray } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-validation-summary',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="validation-summary" 
         [class.error-mode]="validationMode === 'error'"
         [class.info-mode]="validationMode === 'info'"
         *ngIf="hasErrors && (showAlways || hasAnyTouchedControl)">
      <div class="summary-header">
        <span class="icon">{{ validationMode === 'error' ? '⚠️' : 'ℹ️' }}</span>
        <h4>{{ getSummaryTitle() }}</h4>
      </div>
      <ul class="error-list">
        <li *ngFor="let error of getErrors()">{{ error }}</li>
      </ul>
    </div>
  `,
  styles: [`
    .validation-summary {
      position: sticky;
      top: 80px;
      z-index: 100;
      backdrop-filter: blur(8px);
      border-radius: 8px;
      padding: 1rem 1.5rem;
      margin-bottom: 2rem;
      animation: slideDown 0.3s ease-out;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    /* Error Mode - Red (for editing/submit errors) */
    .validation-summary.error-mode {
      background: rgba(239, 68, 68, 0.95);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Info Mode - Blue (for new products) */
    .validation-summary.info-mode {
      background: rgba(59, 130, 246, 0.85);
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .summary-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .icon {
      font-size: 1.25rem;
    }

    .summary-header h4 {
      margin: 0;
      color: #ffffff;
      font-size: 1rem;
      font-weight: 600;
    }

    .error-list {
      margin: 0;
      padding-left: 2rem;
      color: rgba(255, 255, 255, 0.95);
      line-height: 1.6;
    }

    .error-list li {
      margin-bottom: 0.25rem;
    }
  `]
})
export class ValidationSummaryComponent {
  @Input() form!: FormGroup;
  @Input() showAlways = false;
  @Input() fieldLabels: { [key: string]: string } = {};
  @Input() validationMode: 'error' | 'info' = 'error'; // New input for mode

  constructor(private translate: TranslateService) { }

  get hasErrors(): boolean {
    return this.form.invalid;
  }

  get hasAnyTouchedControl(): boolean {
    return this.hasAnyTouchedControlRecursive(this.form);
  }

  private hasAnyTouchedControlRecursive(group: FormGroup): boolean {
    return Object.keys(group.controls).some(key => {
      const control = group.get(key);
      if (control instanceof FormGroup) {
        return this.hasAnyTouchedControlRecursive(control);
      } else if (control instanceof FormArray) {
        return control.controls.some(c => {
          if (c instanceof FormGroup) {
            return this.hasAnyTouchedControlRecursive(c);
          }
          return c?.touched || false;
        });
      }
      return control?.touched || false;
    });
  }

  getSummaryTitle(): string {
    if (this.validationMode === 'info') {
      return this.translate.instant('VALIDATION.REQUIRED_FIELDS_INFO') || 'Please fill the following required fields';
    }
    return this.translate.instant('VALIDATION.SUMMARY_TITLE') || 'Please fix the following errors';
  }

  getErrors(): string[] {
    return this.collectErrors(this.form);
  }

  private collectErrors(group: FormGroup, prefix = ''): string[] {
    const errors: string[] = [];

    Object.keys(group.controls).forEach(key => {
      const control = group.get(key);
      const fieldKey = prefix + key;

      if (control instanceof FormGroup) {
        errors.push(...this.collectErrors(control, fieldKey + '.'));
      } else if (control?.invalid) {
        // Show if: touched OR showAlways is enabled
        if (control.touched || this.showAlways) {
          const label = this.fieldLabels[fieldKey] || this.formatFieldName(key);

          if (control.errors?.['required']) {
            this.addError(errors, 'VALIDATION.FIELD_REQUIRED', { field: label });
          }
          if (control.errors?.['min']) {
            this.addError(errors, 'VALIDATION.FIELD_MIN', {
              field: label,
              min: control.errors['min'].min
            });
          }
          if (control.errors?.['max']) {
            this.addError(errors, 'VALIDATION.FIELD_MAX', {
              field: label,
              max: control.errors['max'].max
            });
          }
          if (control.errors?.['email']) {
            this.addError(errors, 'VALIDATION.FIELD_EMAIL', { field: label });
          }
          if (control.errors?.['pattern']) {
            this.addError(errors, 'VALIDATION.FIELD_PATTERN', { field: label });
          }
        }
      }
    });

    return errors;
  }

  private addError(errors: string[], key: string, params: any) {
    // Check if translation exists, otherwise fall back to English default
    // This is a safety check in case the translation service behaves unexpectedly
    let message = this.translate.instant(key, params);
    if (message === key) {
      // Fallbacks
      if (key === 'VALIDATION.FIELD_REQUIRED') message = `${params.field} is required`;
      else if (key === 'VALIDATION.FIELD_MIN') message = `${params.field} must be at least ${params.min}`;
      else if (key === 'VALIDATION.FIELD_MAX') message = `${params.field} must be at most ${params.max}`;
      else message = `${params.field} is invalid`;
    }
    errors.push(message);
  }

  private formatFieldName(key: string): string {
    // Convert camelCase to Title Case and remove IDs
    return key
      .replace(/Id$/, '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
}
