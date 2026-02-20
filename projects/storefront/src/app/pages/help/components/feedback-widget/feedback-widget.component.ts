import { Component, EventEmitter, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-feedback-widget',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="feedback-container">
      <ng-container *ngIf="!submitted()">
        <span class="question">Was this helpful?</span>
        <div class="actions">
          <button (click)="submit(true)" class="btn-vote up" title="Yes">
             👍
          </button>
          <button (click)="submit(false)" class="btn-vote down" title="No">
             👎
          </button>
        </div>
      </ng-container>

      <div *ngIf="submitted()" class="thank-you">
        <span>Thanks for your feedback! 🚀</span>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .feedback-container {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      background: rgba(30, 41, 59, 0.3);
      padding: 1rem 1.5rem;
      border-radius: 12px;
      width: fit-content;
    }

    .question {
      color: #94a3b8;
      font-weight: 500;
      font-size: 0.9rem;
    }

    .actions {
      display: flex;
      gap: 0.75rem;
    }

    .btn-vote {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.1rem;
      transition: all 0.2s;
    }

    .btn-vote:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
    }

    .btn-vote.up:hover { border-color: #22c55e; }
    .btn-vote.down:hover { border-color: #ef4444; }

    .thank-you {
      color: #2dd4bf; /* Teal 400 */
      font-weight: 600;
      font-size: 0.95rem;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class FeedbackWidgetComponent {
  @Output() feedback = new EventEmitter<boolean>();
  submitted = signal(false);

  submit(isHelpful: boolean) {
    this.submitted.set(true);
    this.feedback.emit(isHelpful);
    this.feedback.emit(isHelpful);
    // TODO: Connect to Analytics Service
    console.info(`[Analytics] Article Feedback: ${isHelpful ? '👍' : '👎'}`);
  }
}
