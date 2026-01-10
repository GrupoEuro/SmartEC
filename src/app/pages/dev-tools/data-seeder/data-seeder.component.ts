import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { DataSeederService } from '../../../core/services/data-seeder.service';

@Component({
    selector: 'app-data-seeder',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="seeder-container">
      <div class="seeder-header">
         <div>
            <h1 class="page-title">Database Manager</h1>
            <p class="page-subtitle">
                Reset, wipe, or seed simulation data. 
                <span class="version-badge">{{ getSeederVersion() }}</span>
            </p>
        </div>
      </div>

      <!-- Actions Toolbar -->
      <div class="actions-toolbar">
         
         <!-- Simulation Group -->
         <div class="action-group">
            <span class="group-label">Simulation</span>
            <button class="btn btn-secondary" (click)="seedPraxisHistory()" [disabled]="isSeeding()">
                <app-icon name="activity" [size]="18"></app-icon>
                SoTA Backfill
            </button>
            <button class="btn btn-secondary" (click)="seedCoupons()" [disabled]="isSeeding()">
                <app-icon name="tag" [size]="18"></app-icon>
                Seed Coupons
            </button> 
         </div>

         <!-- Maintenance Group -->
         <div class="action-group danger-zone">
            <span class="group-label">Maintenance</span>
            <button class="btn btn-primary" (click)="runScenario('GOLDEN_PATH')" [disabled]="isSeeding()">
                <app-icon name="refresh-cw" [size]="18"></app-icon>
                Reset to Default
            </button>
            <button class="btn btn-ghost" (click)="clearAll()" [disabled]="isSeeding()">
                <app-icon name="trash-2" [size]="18"></app-icon>
                Wipe All Data
            </button>
         </div>

      </div>

      <!-- Scenarios Grid -->
      <div class="scenarios-grid">
        
        <!-- Golden Path -->
        <div class="scenario-card golden" (click)="runScenario('GOLDEN_PATH')" [class.disabled]="isSeeding()">
            <div class="card-glow"></div>
            <div class="card-content">
                <div class="icon-bubble">
                    <app-icon name="sun" [size]="32"></app-icon>
                </div>
                <h2>The Golden Path</h2>
                <p>Ideal state. Healthy growth curves, perfect margins, no alerts. Great for demos.</p>
                <div class="stats">
                    <span><app-icon name="check" [size]="14"></app-icon> 150 Orders</span>
                    <span><app-icon name="check" [size]="14"></app-icon> 50 VIPs</span>
                </div>
            </div>
        </div>

        <!-- Stress Test -->
        <div class="scenario-card stress" (click)="runScenario('STRESS_TEST')" [class.disabled]="isSeeding()">
             <div class="card-glow"></div>
             <div class="card-content">
                <div class="icon-bubble">
                    <app-icon name="activity" [size]="32"></app-icon>
                </div>
                <h2>Stress Test</h2>
                <p>High volume load. 2,000 orders in 24h, heavy pagination, concurrent users.</p>
                <div class="stats">
                    <span><app-icon name="alert-triangle" [size]="14"></app-icon> 2k Records</span>
                    <span><app-icon name="server" [size]="14"></app-icon> Heavy Load</span>
                </div>
            </div>
        </div>

        <!-- Nightmare -->
        <div class="scenario-card nightmare" (click)="runScenario('NIGHTMARE')" [class.disabled]="isSeeding()">
             <div class="card-glow"></div>
             <div class="card-content">
                <div class="icon-bubble">
                    <app-icon name="alert-octagon" [size]="32"></app-icon>
                </div>
                <h2>Operational Nightmare</h2>
                <p>Chaos mode. Failed payments, returns, negative margins, and stockouts.</p>
                 <div class="stats">
                    <span><app-icon name="x-circle" [size]="14"></app-icon> Errors</span>
                    <span><app-icon name="bell" [size]="14"></app-icon> Alerts</span>
                </div>
            </div>
        </div>

      </div>

      <!-- Console -->
      <div class="console-window">
        <div class="console-header">
            <span>TERMINAL OUTPUT</span>
            <span *ngIf="isSeeding()" class="blink">_</span>
        </div>
        <div class="console-body" #consoleScroll>
             <div *ngIf="logs().length === 0" class="placeholder">Select a scenario to begin simulation...</div>
             <div *ngFor="let log of logs()" class="log-line">
                <span class="ts">[{{ log.time }}]</span>
                <span class="msg" [class.success]="log.type === 'success'" [class.error]="log.type === 'error'">
                    {{ log.message }}
                </span>
             </div>
        </div>
      </div>

    </div>
  `,
    styles: [`
    .seeder-container { padding: 2rem; max-width: 1200px; margin: 0 auto; color: #fff; }
    .seeder-header { margin-bottom: 2rem; }
    .page-title { font-size: 2.5rem; font-weight: 800; letter-spacing: -1px; margin: 0; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .page-subtitle { color: #64748b; font-size: 1.1rem; margin-top: 0.5rem; }
    .version-badge { 
        display: inline-block;
        background: rgba(59, 130, 246, 0.15);
        color: #60a5fa;
        padding: 0.25rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        border: 1px solid rgba(59, 130, 246, 0.3);
        margin-left: 0.5rem;
        font-family: 'Courier New', monospace;
    }

    .actions-toolbar {
        display: flex;
        gap: 2rem;
        margin-bottom: 3rem;
        background: #0f172a;
        padding: 1.5rem;
        border-radius: 1rem;
        border: 1px solid #1e293b;
        flex-wrap: wrap;
    }

    .action-group {
        display: flex;
        align-items: center;
        gap: 1rem;
        position: relative;
    }

    .action-group:not(:last-child)::after {
        content: '';
        width: 1px;
        height: 60%;
        background: #334155;
        margin-left: 1rem;
        display: block;
    }

    .group-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #64748b;
        font-weight: 700;
        margin-right: 0.5rem;
    }

    .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.25rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; font-weight: 600; }
    .btn-primary:hover { background: #2563eb; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
    
    .btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 0.75rem 1.25rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; }
    .btn-secondary:hover { background: #334155; color: #ffffff; border-color: #475569; }

    .btn-warning { background: #ca8a04; color: #fff; border: none; padding: 0.75rem 1.25rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; font-weight: 600; }
    .btn-warning:hover { background: #a16207; }

    .btn-ghost { background: transparent; border: 1px solid transparent; color: #ef4444; padding: 0.75rem 1.25rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; }
    .btn-ghost:hover { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
    .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Scenarios Grid */
    .scenarios-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin-bottom: 3rem; }
    
    .scenario-card { position: relative; background: #0f172a; border: 1px solid #1e293b; border-radius: 1rem; padding: 2rem; cursor: pointer; transition: all 0.3s ease; overflow: hidden; height: 100%; min-height: 280px; display: flex; flex-direction: column; }
    .scenario-card:hover { transform: translateY(-5px); border-color: #334155; }
    .scenario-card.disabled { opacity: 0.5; pointer-events: none; filter: grayscale(1); }

    .card-content { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; }
    .icon-bubble { width: 60px; height: 60px; border-radius: 1rem; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
    
    .scenario-card h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
    .scenario-card p { color: #94a3b8; line-height: 1.6; flex-grow: 1; margin-bottom: 2rem; }
    
    .stats { display: flex; gap: 1rem; font-size: 0.9rem; font-weight: 600; opacity: 0.8; }
    .stats span { display: flex; align-items: center; gap: 0.4rem; }

    /* Themes */
    .scenario-card.golden .icon-bubble { background: rgba(251, 191, 36, 0.1); color: #fbbf24; }
    .scenario-card.golden:hover .card-glow { opacity: 0.1; background: radial-gradient(circle at center, #fbbf24, transparent 70%); }
    .scenario-card.golden h2 { color: #fbbf24; }

    .scenario-card.stress .icon-bubble { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }
    .scenario-card.stress:hover .card-glow { opacity: 0.1; background: radial-gradient(circle at center, #38bdf8, transparent 70%); }
    .scenario-card.stress h2 { color: #38bdf8; }

    .scenario-card.nightmare .icon-bubble { background: rgba(248, 113, 113, 0.1); color: #f87171; }
    .scenario-card.nightmare:hover .card-glow { opacity: 0.1; background: radial-gradient(circle at center, #f87171, transparent 70%); }
    .scenario-card.nightmare h2 { color: #f87171; }

    .card-glow { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 0.5s ease; z-index: 1; pointer-events: none; }

    /* Console */
    .console-window { background: #020617; border: 1px solid #1e293b; border-radius: 0.75rem; overflow: hidden; font-family: 'Fira Code', monospace; }
    .console-header { background: #0f172a; padding: 0.75rem 1rem; font-size: 0.8rem; letter-spacing: 1px; color: #64748b; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; }
    .console-body { padding: 1rem; height: 200px; overflow-y: auto; color: #e2e8f0; font-size: 0.9rem; }
    .placeholder { color: #334155; font-style: italic; }
    
    .log-line { margin-bottom: 0.4rem; display: flex; gap: 0.75rem; }
    .ts { color: #475569; }
    .msg.success { color: #4ade80; }
    .msg.error { color: #f87171; }
    .blink { animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
  `]
})
export class DataSeederComponent {
    seeder = inject(DataSeederService);
    isSeeding = signal(false);
    logs = signal<{ time: string, message: string, type: 'info' | 'success' | 'error' }[]>([]);

    async runScenario(type: 'GOLDEN_PATH' | 'STRESS_TEST' | 'NIGHTMARE') {
        if (this.isSeeding()) return;
        this.isSeeding.set(true);
        this.addLog(`Initializing scenario: ${type}...`);

        try {
            // Pass callback to capture all service logs
            await this.seeder.runScenario(type, (message: string) => {
                this.addLog(message);
            });
            this.addLog(`Scenario ${type} completed successfully.`, 'success');
        } catch (e: any) {
            console.error(e);
            this.addLog(`Simulation failed: ${e.message}`, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async seedPraxisHistory() {
        if (this.isSeeding()) return;
        this.isSeeding.set(true);
        this.addLog('Backfilling history for existing products...');
        try {
            await this.seeder.seedPraxisHistory((msg) => this.addLog(msg));
            this.addLog('Success!', 'success');
        } catch (e: any) {
            console.error(e);
            this.addLog('Error: ' + e.message, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async seedCoupons() {
        if (this.isSeeding()) return;
        this.isSeeding.set(true);
        this.logs.set([]);

        try {
            await this.seeder.populateCoupons();
            this.addLog('Coupons seeded successfully', 'success');
        } catch (error) {
            console.error(error);
            this.addLog('Failed to seed coupons', 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async clearAll() {
        // Triple-check confirmation with detailed warning
        const warning =
            '⚠️ DANGER: DELETE ALL DATA?\n\n' +
            'This will PERMANENTLY remove:\n' +
            '  ✗ All orders and customers\n' +
            '  ✗ All products, brands, and categories\n' +
            '  ✗ All locations and inventory\n' +
            '  ✗ All expenses and approvals\n' +
            '  ✗ All notifications and assignments\n\n' +
            'This action CANNOT be undone!\n\n' +
            'Are you absolutely sure?';

        if (!confirm(warning)) {
            this.addLog('❌ Wipe cancelled by user', 'info');
            return;
        }

        // Second confirmation
        const secondConfirm = confirm(
            '⚠️ FINAL WARNING!\n\n' +
            'You are about to delete EVERYTHING.\n' +
            'This is your last chance to cancel.\n\n' +
            'Click OK to proceed with deletion.'
        );

        if (!secondConfirm) {
            this.addLog('❌ Wipe cancelled by user', 'info');
            return;
        }

        this.isSeeding.set(true);
        this.addLog('🗑️ Wiping database...');
        try {
            await this.seeder.clearAll((message: string) => {
                this.addLog(message);
            });
            this.addLog('✅ Database cleared successfully.', 'success');
        } catch (e: any) {
            this.addLog(`❌ Error: ${e.message}`, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    private addLog(message: string, type: 'info' | 'success' | 'error' = 'info') {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        this.logs.update(prev => [...prev, { time, message, type }]);
    }

    getSeederVersion(): string {
        return 'v3.0.0-praxis-live-history';
    }
}
