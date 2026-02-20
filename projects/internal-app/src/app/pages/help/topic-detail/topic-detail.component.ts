import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HelpContentService } from '../services/help-content.service';
import { VisualWorkflowComponent } from '../components/visual-workflow/visual-workflow.component';
import { HelpHeaderComponent } from '../components/help-header/help-header.component';
import { FeedbackWidgetComponent } from '../components/feedback-widget/feedback-widget.component';
import { switchMap } from 'rxjs';
import { TourService } from '../../../core/services/tour.service';

@Component({
  selector: 'app-topic-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, VisualWorkflowComponent, HelpHeaderComponent, FeedbackWidgetComponent],
  template: `
    <div class="topic-page-container">
      <app-help-header></app-help-header>

      <div class="topic-detail-container">
        <div class="content-wrapper">
          
          <div *ngIf="topic()" class="topic-body">
            
            <!-- Header -->
            <header class="topic-header">
              <div class="header-top">
                  <div class="meta-info">
                  <span class="category-pill">{{topic()!.category}}</span>
                  </div>
                  <!-- Tour Button -->
                  <button *ngIf="topic()!.tourId" class="btn-tour" (click)="startTour(topic()!.tourId!)">
                      <span class="icon">🚀</span>
                      Start Interactive Tour
                  </button>
              </div>
              <h1>{{topic()!.title}}</h1>
              <p>{{topic()!.description}}</p>
            </header>

            <!-- Visual Workflow Section -->
            <div *ngIf="topic()!.workflowDefinition" class="section-wrapper">
              <h2 class="section-title">
                <span class="section-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd" />
                  </svg>
                </span>
                Visual Process Map
              </h2>
              
              <div class="workflow-frame">
                 <app-visual-workflow [definition]="topic()!.workflowDefinition!"></app-visual-workflow>
              </div>
            </div>

            <!-- Documentation Content -->
            <article class="prose-content">
              <div [innerHTML]="topic()!.content"></div>
            </article>

            <!-- Feedback Widget -->
            <app-feedback-widget (feedback)="onFeedback($event)"></app-feedback-widget>

          </div>

          <!-- Not Found State -->
          <div *ngIf="!topic()" class="not-found">
            <div class="emoji-circle">🤔</div>
            <h3>Topic Not Found</h3>
            <p>The guide you are looking for doesn't exist.</p>
            <a routerLink="/help" class="btn-primary">Return to Help Center</a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background-color: #0f172a; /* Slate 900 */
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      color: #e2e8f0;
    }

    .topic-page-container {
      width: 100%;
    }

    .topic-detail-container {
      width: 100%;
      min-height: 100vh;
      padding: 0 1rem 4rem 1rem;
    }

    .content-wrapper {
      max-width: 900px; /* Slightly tighter reading content */
      margin: 0 auto;
      padding-top: 3rem;
    }

    /* Header */
    .topic-header {
      border-bottom: 1px solid #1e293b;
      padding-bottom: 2rem;
      margin-bottom: 3rem;
    }

    /* Flex container for meta info and tour button */
    .header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    }

    .category-pill {
      display: inline-block;
      padding: 0.35rem 1rem;
      background-color: rgba(45, 212, 191, 0.1);
      color: #2dd4bf;
      border: 1px solid rgba(45, 212, 191, 0.2);
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .btn-tour {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); /* Teal 600-700 */
        color: white;
        border: none;
        padding: 0.5rem 1.25rem;
        border-radius: 999px;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.9rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        transition: all 0.2s;
        animation: pulse-soft 2s infinite;
    }

    .btn-tour:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 15px -3px rgba(13, 148, 136, 0.4);
    }

    .btn-tour .icon { font-size: 1.1em; }

    @keyframes pulse-soft {
        0% { box-shadow: 0 0 0 0 rgba(13, 148, 136, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(13, 148, 136, 0); }
        100% { box-shadow: 0 0 0 0 rgba(13, 148, 136, 0); }
    }

    .topic-header h1 {
      font-size: 3rem;
      font-weight: 800;
      color: #f8fafc;
      margin: 0 0 1rem 0;
      line-height: 1.1;
      letter-spacing: -0.025em;
    }

    .topic-header p {
      font-size: 1.35rem;
      color: #94a3b8;
      line-height: 1.6;
      max-width: 100%;
    }

    /* Workflow Section */
    .section-wrapper {
      margin-bottom: 4rem;
    }

    .section-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      border-bottom: 1px solid #334155;
      padding-bottom: 1rem;
    }

    .section-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background-color: rgba(45, 212, 191, 0.1);
      color: #2dd4bf;
      border-radius: 8px;
    }

    .workflow-frame {
      background-color: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 4px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    }

    /* Prose / Content */
    .prose-content {
      color: #cbd5e1;
      font-size: 1.125rem;
      line-height: 1.8;
    }

    ::ng-deep .prose-content h2 {
      color: #fff;
      font-size: 1.75em;
      margin-top: 2.5em;
      margin-bottom: 1em;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    ::ng-deep .prose-content h3 {
      color: #f1f5f9;
      font-size: 1.4em;
      margin-top: 2em;
      margin-bottom: 0.75em;
      font-weight: 600;
      border-bottom: 1px solid #334155;
      padding-bottom: 0.5rem;
    }

    ::ng-deep .prose-content p {
      margin-bottom: 1.5em;
    }

    ::ng-deep .prose-content ul {
      margin-bottom: 1.5em;
      padding-left: 1.625em;
      list-style-type: disc;
    }

    ::ng-deep .prose-content li {
      margin-bottom: 0.5em;
      padding-left: 0.5em;
    }
    
    ::ng-deep .prose-content li::marker {
        color: #2dd4bf;
    }

    ::ng-deep .prose-content strong {
      color: #2dd4bf;
      font-weight: 600;
    }

    ::ng-deep .prose-content blockquote {
      font-style: italic;
      color: #94a3b8;
      border-left: 4px solid #2dd4bf;
      background: rgba(45, 212, 191, 0.05); /* Very subtle bg */
      padding: 1rem 1.5rem;
      margin: 2rem 0;
      border-radius: 0 8px 8px 0;
    }

    /* Not Found */
    .not-found {
      text-align: center;
      padding: 6rem 1rem;
      background: #1e293b;
      border-radius: 24px;
      border: 1px dashed #334155;
    }

    .emoji-circle {
      width: 80px;
      height: 80px;
      background-color: #0f172a;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      margin: 0 auto 1.5rem auto;
      border: 1px solid #334155;
    }

    .not-found h3 {
      font-size: 2rem;
      color: #fff;
      margin-bottom: 0.5rem;
    }

    .not-found p {
      color: #94a3b8;
      margin-bottom: 2rem;
      font-size: 1.1rem;
    }

    .btn-primary {
      display: inline-block;
      background-color: #0d9488;
      color: #fff;
      padding: 0.75rem 2rem;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.2s;
    }

    .btn-primary:hover {
      background-color: #14b8a6;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(20, 184, 166, 0.3);
    }
  `]
})
export class TopicDetailComponent {
  private route = inject(ActivatedRoute);
  private helpService = inject(HelpContentService);
  private tourService = inject(TourService);

  // Reactive data stream
  topic = toSignal(
    this.route.paramMap.pipe(
      switchMap(params => this.helpService.getTopicById(params.get('id') || ''))
    )
  );

  startTour(tourId: string) {
    this.tourService.startTour(tourId);
  }

  onFeedback(isHelpful: boolean) {
    // Placeholder for analytics tracking
    // this.analyticsService.trackEvent('help_feedback', { topicId: this.topic()!.id, helpful: isHelpful });
  }
}
