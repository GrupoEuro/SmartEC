import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-validation-summary',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="validation-summary" *ngIf="hasErrors && (form.touched || showAlways)">
      <div class="summary-header">
        <span class="icon">⚠️</span>
        <h4>{{ 'VALIDATION.SUMMARY_TITLE' | translate }}</h4>
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
      background: rgba(239, 68, 68, 0.95);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      padding: 1rem 1.5rem;
      margin-bottom: 2rem;
      animation: slideDown 0.3s ease-out;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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

  constructor(private translate: TranslateService) { }

  get hasErrors(): boolean {
    return this.form.invalid;
  }

  getErrors(): string[] {
    const errors: string[] = [];

    Object.keys(this.form.controls).forEach(key => {
      const control = this.form.get(key);
      if (control?.invalid && (control.touched || this.showAlways)) {
        const label = this.fieldLabels[key] || this.formatFieldName(key);

        if (control.errors?.['required']) {
          errors.push(this.translate.instant('VALIDATION.FIELD_REQUIRED', { field: label }));
        }
        if (control.errors?.['min']) {
          errors.push(this.translate.instant('VALIDATION.FIELD_MIN', {
            field: label,
            min: control.errors['min'].min
          }));
        }
        if (control.errors?.['max']) {
          errors.push(this.translate.instant('VALIDATION.FIELD_MAX', {
            field: label,
            max: control.errors['max'].max
          }));
        }
        if (control.errors?.['email']) {
          errors.push(this.translate.instant('VALIDATION.FIELD_EMAIL', { field: label }));
        }
        if (control.errors?.['pattern']) {
          errors.push(this.translate.instant('VALIDATION.FIELD_PATTERN', { field: label }));
        }
      }
    });

    return errors;
  }

  private formatFieldName(key: string): string {
    // Convert camelCase to Title Case
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
}
