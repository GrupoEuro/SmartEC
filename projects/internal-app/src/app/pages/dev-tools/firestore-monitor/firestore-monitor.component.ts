import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreTrackerService } from '../services/firestore-tracker.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-firestore-monitor',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="monitor-container">
      <div class="header">
        <h1 class="page-title">Firestore Monitor</h1>
        <p class="page-subtitle">Real-time session cost and usage tracking.</p>
      </div>

      <div class="grid">
        <!-- Reads -->
        <div class="card bg-blue">
            <div class="card-icon">
                <app-icon name="eye" [size]="24"></app-icon>
            </div>
            <div class="card-data">
                <div class="label">Session Reads</div>
                <div class="value">{{ tracker.reads() }}</div>
            </div>
        </div>

        <!-- Writes -->
        <div class="card bg-orange">
            <div class="card-icon">
                <app-icon name="edit" [size]="24"></app-icon>
            </div>
            <div class="card-data">
                <div class="label">Session Writes</div>
                <div class="value">{{ tracker.writes() }}</div>
            </div>
        </div>

        <!-- Cost -->
        <div class="card bg-green accent">
            <div class="card-icon">
                <app-icon name="dollar-sign" [size]="24"></app-icon>
            </div>
            <div class="card-data">
                <div class="label">Est. Session Cost</div>
                <div class="value">$ {{ tracker.estimatedCost() }}</div>
            </div>
        </div>
      </div>

      <div class="alert-box">
        <div class="alert-icon">
            <app-icon name="info" [size]="20"></app-icon>
        </div>
        <div class="alert-content">
            <strong>Note:</strong> This tracker only counts operations explicitly instrumented in the frontend services. Background triggers or un-instrumented calls are not counted.
        </div>
      </div>

      <div class="actions">
        <button (click)="tracker.reset()" class="btn-reset">
            <app-icon name="refresh-cw" [size]="16"></app-icon>
            Reset Session
        </button>
      </div>
    </div>
  `,
    styles: [`
    .monitor-container { padding: 2rem; color: #e2e8f0; }
    .header { margin-bottom: 2rem; }
    .page-title { font-size: 1.8rem; font-weight: 700; color: #fff; margin: 0 0 0.5rem 0; }
    .page-subtitle { color: #94a3b8; margin: 0; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    
    .card { background: #0f172a; border: 1px solid #1e293b; padding: 1.5rem; border-radius: 1rem; display: flex; align-items: center; gap: 1rem; }
    .bg-blue .card-icon { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    .bg-orange .card-icon { color: #f97316; background: rgba(249, 115, 22, 0.1); }
    .bg-green .card-icon { color: #10b981; background: rgba(16, 185, 129, 0.1); }
    
    .card.accent { border-color: #10b981; box-shadow: 0 0 20px rgba(16, 185, 129, 0.1); }

    .card-icon { padding: 1rem; border-radius: 0.75rem; display: flex; align-items: center; justify-content: center; }
    .label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }
    .value { font-size: 2rem; font-weight: 700; color: #fff; line-height: 1.2; }

    .alert-box { background: rgba(59, 130, 246, 0.1); border: 1px solid #1d4ed8; border-radius: 0.5rem; padding: 1rem; display: flex; gap: 1rem; margin-bottom: 2rem; color: #bfdbfe; font-size: 0.9rem; }
    
    .btn-reset { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s; font-weight: 600; }
    .btn-reset:hover { background: #334155; color: #fff; }
  `]
})
export class FirestoreMonitorComponent {
    tracker = inject(FirestoreTrackerService);
}
