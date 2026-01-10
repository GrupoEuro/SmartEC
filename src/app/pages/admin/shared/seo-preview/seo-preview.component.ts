import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-seo-preview',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="seo-preview">
      <div class="preview-header">
        <span class="preview-icon">🔍</span>
        <h4>{{ 'ADMIN.SEO_PREVIEW.TITLE' | translate }}</h4>
      </div>
      <p class="preview-description-text">{{ 'ADMIN.SEO_PREVIEW.DESCRIPTION' | translate }}</p>
      <div class="preview-content">
        <div class="preview-url">{{ displayUrl }}</div>
        <div class="preview-title" [class.truncated]="isTitleTooLong">
          {{ displayTitle }}
        </div>
        <div class="preview-description" [class.truncated]="isDescriptionTooLong">
          {{ displayDescription }}
        </div>
      </div>
      <div class="preview-footer">
        <small class="preview-hint">
          <span *ngIf="!isTitleTooLong && !isDescriptionTooLong" class="hint-success">
            {{ 'ADMIN.SEO_PREVIEW.LOOKS_GOOD' | translate }}
          </span>
          <span *ngIf="isTitleTooLong" class="hint-warning">
            {{ 'ADMIN.SEO_PREVIEW.TITLE_TOO_LONG' | translate }}
          </span>
          <span *ngIf="isDescriptionTooLong" class="hint-warning">
            {{ 'ADMIN.SEO_PREVIEW.DESCRIPTION_TOO_LONG' | translate }}
          </span>
        </small>
      </div>
    </div>
  `,
  styles: [`
    .seo-preview {
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 1.25rem;
      margin-top: 1rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .preview-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .preview-icon {
      font-size: 1.25rem;
    }

    .preview-header h4 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #333;
    }

    .preview-description-text {
      font-size: 0.85rem;
      color: #666;
      margin: 0 0 1rem 0;
      font-style: italic;
    }

    .preview-content {
      background: #f8f9fa;
      padding: 1rem;
      border-radius: 6px;
      font-family: Arial, sans-serif;
    }

    .preview-url {
      font-size: 0.875rem;
      color: #006621;
      margin-bottom: 0.25rem;
      line-height: 1.3;
    }

    .preview-title {
      font-size: 1.125rem;
      color: #1a0dab;
      font-weight: 400;
      margin-bottom: 0.25rem;
      line-height: 1.3;
      cursor: pointer;
      transition: text-decoration 0.2s;
    }

    .preview-title:hover {
      text-decoration: underline;
    }

    .preview-title.truncated {
      color: #8b0dab;
    }

    .preview-description {
      font-size: 0.875rem;
      color: #545454;
      line-height: 1.5;
      max-width: 600px;
    }

    .preview-description.truncated {
      color: #8b5400;
    }

    .preview-footer {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid #f0f0f0;
    }

    .preview-hint {
      display: block;
      font-size: 0.8rem;
      line-height: 1.4;
    }

    .hint-success {
      color: #28a745;
    }

    .hint-warning {
      color: #ff8c00;
    }

    @media (max-width: 768px) {
      .seo-preview {
        padding: 1rem;
      }

      .preview-title {
        font-size: 1rem;
      }

      .preview-description {
        font-size: 0.8rem;
      }
    }
  `]
})
export class SeoPreviewComponent {
  @Input() title: string = '';
  @Input() url: string = '';
  @Input() description: string = '';

  readonly TITLE_LIMIT = 60;
  readonly DESCRIPTION_LIMIT = 160;

  constructor(private translate: TranslateService) { }

  get displayTitle(): string {
    return this.title || this.translate.instant('ADMIN.SEO_PREVIEW.PLACEHOLDER_TITLE');
  }

  get displayUrl(): string {
    return this.url || 'importadora-euro.com/products/nombre-producto';
  }

  get displayDescription(): string {
    return this.description || this.translate.instant('ADMIN.SEO_PREVIEW.PLACEHOLDER_DESCRIPTION');
  }

  get isTitleTooLong(): boolean {
    return this.title.length > this.TITLE_LIMIT;
  }

  get isDescriptionTooLong(): boolean {
    return this.description.length > this.DESCRIPTION_LIMIT;
  }
}
