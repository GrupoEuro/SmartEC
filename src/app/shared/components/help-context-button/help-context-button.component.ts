import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
    selector: 'app-help-context-button',
    standalone: true,
    imports: [CommonModule],
    template: `
    <button (click)="navigateToHelp()" 
            class="help-btn" 
            [title]="tooltip || 'View Help Guide'">
      <span class="icon">?</span>
      <span class="label" *ngIf="showLabel">Help</span>
    </button>
  `,
    styles: [`
    .help-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(45, 212, 191, 0.1); /* Teal 500/10 */
      border: 1px solid rgba(45, 212, 191, 0.3);
      color: #2dd4bf;
      padding: 0.35rem 0.75rem;
      border-radius: 999px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .help-btn:hover {
      background: rgba(45, 212, 191, 0.2);
      transform: translateY(-1px);
    }

    .icon {
      font-weight: 800;
      font-size: 1rem;
    }
  `]
})
export class HelpContextButtonComponent {
    @Input() topicId!: string;
    @Input() tooltip?: string;
    @Input() showLabel = true;

    private router = inject(Router);

    navigateToHelp() {
        this.router.navigate(['/help/topic', this.topicId]);
    }
}
