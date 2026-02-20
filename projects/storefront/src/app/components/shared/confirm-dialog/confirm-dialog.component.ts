import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="(dialogService.state$ | async) as state">
      <div class="confirm-overlay" *ngIf="state.isOpen" (click)="onCancel()">
        <div class="confirm-dialog" [class]="'confirm-dialog-' + state.options?.type" (click)="$event.stopPropagation()">
          <div class="confirm-header">
            <h3>{{ state.options?.title }}</h3>
            <button class="close-btn" (click)="onCancel()" aria-label="Close">×</button>
          </div>
          
          <div class="confirm-body">
            <p>{{ state.options?.message }}</p>
          </div>
          
          <div class="confirm-footer">
            <button class="btn btn-secondary" (click)="onCancel()">
              {{ state.options?.cancelText }}
            </button>
            <button 
              class="btn" 
              [class.btn-danger]="state.options?.type === 'danger'"
              [class.btn-warning]="state.options?.type === 'warning'"
              [class.btn-primary]="state.options?.type === 'info'"
              (click)="onConfirm()">
              {{ state.options?.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .confirm-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .confirm-dialog {
      background: #1a1a1a;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      max-width: 500px;
      width: 90%;
      animation: slideUp 0.3s ease-out;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .confirm-dialog-danger {
      border-color: rgba(208, 44, 47, 0.3);
    }

    .confirm-dialog-warning {
      border-color: rgba(255, 215, 0, 0.3);
    }

    .confirm-header {
      padding: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .confirm-header h3 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
    }

    .close-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 2rem;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .confirm-body {
      padding: 1.5rem;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.6;
    }

    .confirm-body p {
      margin: 0;
    }

    .confirm-footer {
      padding: 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      gap: 1rem;
      justify-content: flex-end;
    }

    .btn {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.95rem;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .btn-primary {
      background: #00ACD8;
      color: #ffffff;
    }

    .btn-primary:hover {
      background: #0099c2;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 172, 216, 0.3);
    }

    .btn-warning {
      background: #FFD700;
      color: #1a1a1a;
    }

    .btn-warning:hover {
      background: #ffc700;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
    }

    .btn-danger {
      background: #D02C2F;
      color: #ffffff;
    }

    .btn-danger:hover {
      background: #b82528;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(208, 44, 47, 0.3);
    }

    @media (max-width: 768px) {
      .confirm-dialog {
        width: 95%;
      }

      .confirm-footer {
        flex-direction: column-reverse;
      }

      .btn {
        width: 100%;
      }
    }
  `]
})
export class ConfirmDialogComponent {
  dialogService = inject(ConfirmDialogService);

  onConfirm(): void {
    this.dialogService.handleResponse(true);
  }

  onCancel(): void {
    this.dialogService.handleResponse(false);
  }
}
