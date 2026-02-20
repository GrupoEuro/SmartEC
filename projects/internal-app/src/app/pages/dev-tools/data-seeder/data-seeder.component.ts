
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { DataSeederService } from '../../../core/services/data-seeder.service';
import { ProductTypeSeederService } from '../../../core/services/product-type-seeder.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ConfirmDialogComponent } from '../../../components/shared/confirm-dialog/confirm-dialog.component';
import * as FileSaver from 'file-saver';
import * as XLSX from 'xlsx';

type Tab = 'DATABASE' | 'DOCUMENTS';

@Component({
    selector: 'app-data-seeder',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, ConfirmDialogComponent],
    template: `
    <div class="seeder-container">
      <div class="seeder-header">
         <div>
            <h1 class="page-title">Data Tools</h1>
            <p class="page-subtitle">
                Manage database seeding and generate test documents.
                <span class="version-badge">{{ getSeederVersion() }}</span>
            </p>
        </div>
      </div>

      <!-- TABS -->
      <div class="tabs-container">
        <button class="tab-btn" [class.active]="activeTab() === 'DATABASE'" (click)="activeTab.set('DATABASE')">
            <app-icon name="database" [size]="18"></app-icon>
            Database Manager
        </button>
        <button class="tab-btn" [class.active]="activeTab() === 'DOCUMENTS'" (click)="activeTab.set('DOCUMENTS')">
            <app-icon name="file-text" [size]="18"></app-icon>
            Document Generator
        </button>
      </div>

      <!-- TAB CONTENT: DATABASE -->
      <div *ngIf="activeTab() === 'DATABASE'" class="tab-content animate-fade-in">
          
          <!-- Actions Grid -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              
              <!-- GROUP 1: CORE DATA -->
              <div class="glass-panel p-5">
                  <h3 class="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2">
                      <app-icon name="server" [size]="14"></app-icon> Core Data
                  </h3>
                  <div class="flex flex-col gap-3">
                      <button class="btn btn-secondary justify-between group" (click)="seedProducts()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="package" [size]="16"></app-icon> Products Catalog</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">50 Items</span>
                      </button>
                      <button class="btn btn-secondary justify-between group" (click)="seedCustomers()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="users" [size]="16"></app-icon> Customers</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">50 Profiles</span>
                      </button>
                      <button class="btn btn-secondary justify-between group" (click)="seedStaff()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2 text-yellow-500"><app-icon name="shield" [size]="16"></app-icon> Staff Profiles</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">Ops & Admin</span>
                      </button>
                      <button class="btn btn-secondary justify-between group" (click)="seedExpenses()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="credit-card" [size]="16"></app-icon> Operational Expenses</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">Rent, Payroll</span>
                      </button>
                      <button class="btn btn-primary justify-between group" (click)="seedProductTypeTemplates()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="settings" [size]="16"></app-icon> Product Type Templates</span>
                          <span class="text-xs text-white/70 group-hover:text-white transition">5 System Types</span>
                      </button>
                  </div>
              </div>

              <!-- GROUP 2: OPERATIONS -->
              <div class="glass-panel p-5">
                  <h3 class="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2">
                       <app-icon name="truck" [size]="14"></app-icon> Operations
                  </h3>
                  <div class="flex flex-col gap-3">
                      <button class="btn btn-primary justify-between group" (click)="seedMultiLevelWarehouse()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="layers" [size]="16"></app-icon> Warehouse v2.0</span>
                          <span class="text-xs text-white/70 group-hover:text-white transition">Multi-Level</span>
                      </button>
                      <button class="btn btn-secondary justify-between group" (click)="seedWarehouseLayout()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="map" [size]="16"></app-icon> Reset Layout (v1)</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">Clear Data</span>
                      </button>
                  </div>
              </div>

              <!-- GROUP 3: COMMERCE & HISTORY -->
              <div class="glass-panel p-5">
                  <h3 class="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2">
                       <app-icon name="shopping-cart" [size]="14"></app-icon> Commerce
                  </h3>
                  <div class="flex flex-col gap-3">
                      <button class="btn btn-secondary justify-between group" (click)="seedPricingRules()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="dollar-sign" [size]="16"></app-icon> Pricing Rules</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">Commissions</span>
                      </button>
                       <button class="btn btn-secondary justify-between group" (click)="seedCoupons()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="tag" [size]="16"></app-icon> Coupons</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">Discounts</span>
                      </button>
                      <button class="btn btn-secondary justify-between group" (click)="seedPraxisHistory()" [disabled]="isSeeding()">
                          <span class="flex items-center gap-2"><app-icon name="activity" [size]="16"></app-icon> SoTA Backfill</span>
                          <span class="text-xs text-slate-500 group-hover:text-white transition">History</span>
                      </button>
                  </div>
              </div>

          </div>
    
          <!-- Maintenance Group -->
          <div class="glass-panel p-4 mb-8 border-red-900/30 bg-red-900/10 flex justify-between items-center">
             <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded bg-red-900/20 flex items-center justify-center text-red-500">
                    <app-icon name="alert-triangle" [size]="20"></app-icon>
                </div>
                <div>
                    <h4 class="text-red-400 font-bold text-sm">Danger Zone</h4>
                    <p class="text-red-400/60 text-xs">Irreversible actions</p>
                </div>
             </div>
             <div class="flex gap-3">
                <button class="btn btn-primary" (click)="runScenario('GOLDEN_PATH')" [disabled]="isSeeding()">
                    <app-icon name="refresh-cw" [size]="16"></app-icon>
                    Reset to Golden Path
                </button>
                <button class="btn btn-ghost" (click)="clearAll()" [disabled]="isSeeding()">
                    <app-icon name="trash-2" [size]="16"></app-icon>
                    Wipe Database
                </button>
             </div>
          </div>
    
          <!-- Console -->
          <div class="console-window">
            <div class="console-header">
                <span>TERMINAL OUTPUT</span>
                <span *ngIf="isSeeding()" class="blink">_</span>
            </div>
            <div class="console-body" #consoleScroll>
                 <div *ngIf="logs().length === 0" class="placeholder">Select an action to begin...</div>
                 <div *ngFor="let log of logs()" class="log-line">
                    <span class="ts">[{{ log.time }}]</span>
                    <span class="msg" [class.success]="log.type === 'success'" [class.error]="log.type === 'error'">
                        {{ log.message }}
                    </span>
                 </div>
            </div>
          </div>
      </div>

      <!-- TAB CONTENT: DOCUMENTS -->
      <div *ngIf="activeTab() === 'DOCUMENTS'" class="tab-content animate-fade-in">
        <!-- Document Gen Content (Preserved) -->
         <div class="glass-panel max-w-2xl mx-auto mt-8">
            <h2 class="text-2xl font-bold mb-6 flex items-center gap-3 text-slate-200">
                <app-icon name="file-plus" class="text-yellow-400"></app-icon>
                Document Generator
            </h2>
             <div class="flex flex-col gap-6">
                <div class="control-panel flex-col md:flex-row gap-4">
                    <div class="flex flex-col gap-2">
                       <label class="block text-sm font-medium text-gray-400">Items Count Range</label>
                       <div class="flex items-center gap-2">
                            <input type="number" [(ngModel)]="genMinItems" class="input-dark">
                            <span class="text-gray-500">to</span>
                            <input type="number" [(ngModel)]="genMaxItems" class="input-dark">
                       </div>
                    </div>
                    
                    <div class="flex flex-col gap-2 w-full md:w-auto">
                         <button (click)="generateXml()" class="btn-generate">
                            <app-icon name="code" [size]="20"></app-icon>
                            Generate Random XML
                        </button>
                        <button (click)="generateInternationalDoc()" class="btn-generate bg-emerald-600 hover:bg-emerald-500 text-white">
                            <app-icon name="table" [size]="20"></app-icon>
                            Generate Praxis Doc
                        </button>
                    </div>
                </div>
            </div>
         </div>
      </div>
      
      <!-- CONFIRMATION DIALOG -->
      <app-confirm-dialog></app-confirm-dialog>

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

    /* Tabs */
    .tabs-container {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
        border-bottom: 1px solid #1e293b;
    }
    .tab-btn {
        background: transparent;
        border: none;
        color: #64748b;
        padding: 1rem 1.5rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
    }
    .tab-btn:hover { color: #94a3b8; }
    .tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; }

    /* Glass Panel */
    .glass-panel {
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 12px;
    }

    .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.75rem 1rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; font-weight: 600; font-size: 0.9rem; }
    .btn-primary:hover { background: #2563eb; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
    
    .btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 0.75rem 1rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; }
    .btn-secondary:hover { background: #334155; color: #ffffff; border-color: #475569; }
    .btn-secondary:disabled, .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-ghost { background: transparent; border: 1px solid transparent; color: #ef4444; padding: 0.75rem 1.25rem; border-radius: 0.5rem; display: flex; gap: 0.5rem; align-items: center; cursor: pointer; transition: all 0.2s; }
    .btn-ghost:hover { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }

    /* Console */
    .console-window { background: #020617; border: 1px solid #1e293b; border-radius: 0.75rem; overflow: hidden; font-family: 'Fira Code', monospace; min-height: 250px; }
    .console-header { background: #0f172a; padding: 0.75rem 1rem; font-size: 0.8rem; letter-spacing: 1px; color: #64748b; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; }
    .console-body { padding: 1rem; height: 300px; overflow-y: auto; color: #e2e8f0; font-size: 0.9rem; }
    .placeholder { color: #334155; font-style: italic; }
    
    .log-line { margin-bottom: 0.4rem; display: flex; gap: 0.75rem; }
    .ts { color: #475569; }
    .msg.success { color: #4ade80; }
    .msg.error { color: #f87171; }
    .blink { animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    /* Doc Gen */
    .control-panel { background: #1e293b; border-radius: 8px; padding: 1rem; border: 1px solid #334155; display: flex; justify-content: space-between; }
    .input-dark { background: #000; border: 1px solid #475569; color: white; padding: 4px; border-radius: 4px; width: 60px; text-align: center; }
    .btn-generate { background: #eab308; color: black; font-weight: bold; border: none; padding: 0.5rem 1rem; border-radius: 6px; display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; }
  `]
})
export class DataSeederComponent {
    // Force reload - Product Type Templates button added
    seeder = inject(DataSeederService);
    productTypeSeeder = inject(ProductTypeSeederService);
    confirmService = inject(ConfirmDialogService);

    // UI State
    activeTab = signal<Tab>('DATABASE');

    // Database Seeder State
    isSeeding = signal(false);
    logs = signal<{ time: string, message: string, type: 'info' | 'success' | 'error' }[]>([]);

    // Doc Generator State
    genMinItems = 3;
    genMaxItems = 8;
    lastGeneratedDoc: any = null;

    // Data Presets
    suppliers = [
        { name: 'MICHELIN MEXICO SERVICES', rfc: 'MME950614A12' },
        { name: 'PIRELLI NEUMATICOS', rfc: 'PNE990525N81' }
    ];
    products = [
        { sku: 'MICH-2055516-P4', desc: 'LLANTA 205/55R16 91V PRIMACY 4', basePrice: 2100 },
        { sku: 'PIR-2254517-P7', desc: 'LLANTA 225/45R17 91W CINTURATO P7', basePrice: 2350 }
    ];

    // --- SEEDER LOGIC ---

    async runAction(name: string, action: () => Promise<void>, confirmMsg?: string) {
        if (this.isSeeding()) return;

        if (confirmMsg) {
            const confirmed = await this.confirmService.confirm({
                title: name + '?',
                message: confirmMsg,
                confirmText: 'Execute',
                type: 'info'
            });
            if (!confirmed) return;
        }

        this.isSeeding.set(true);
        this.addLog(`Starting: ${name}...`);

        try {
            await action();
            this.addLog(`${name} completed successfully.`, 'success');
        } catch (e: any) {
            console.error(e);
            this.addLog(`Error: ${e.message}`, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    // Wrappers
    seedProducts() { this.runAction('Seed Products', () => this.seeder.seedProducts(l => this.addLog(l)), 'Generate 50 sample products?'); }
    seedCustomers() { this.runAction('Seed Customers', () => this.seeder.populateCustomers(undefined, l => this.addLog(l)), 'Generate 50 sample customers?'); }
    seedStaff() { this.runAction('Seed Staff Profiles', () => this.seeder.seedStaffProfiles(l => this.addLog(l)), 'Create Warehouse and Support staff accounts?'); }
    seedExpenses() { this.runAction('Seed Expenses', () => this.seeder.populateExpenses(undefined, l => this.addLog(l))); }

    seedMultiLevelWarehouse() { this.runAction('Seed Multi-Level Warehouse', () => this.seeder.populateMultiLevelWarehouse(l => this.addLog(l)), 'Warning: This will clear existing warehouse data.'); }
    seedWarehouseLayout() { this.runAction('Reset Warehouse Layout', () => this.seeder.populateWarehouseLayout(l => this.addLog(l)), 'Warning: Clears warehouse data.'); }

    seedPricingRules() { this.runAction('Seed Pricing Rules', () => this.seeder.populatePricingRules((l: string) => this.addLog(l))); }
    seedCoupons() { this.runAction('Seed Coupons', () => this.seeder.populateCoupons((l: string) => this.addLog(l))); }
    seedPraxisHistory() { this.runAction('Backfill History', () => this.seeder.seedPraxisHistory((l: string) => this.addLog(l))); }

    seedProductTypeTemplates() {
        this.runAction(
            'Seed Product Type Templates',
            async () => {
                this.addLog('Creating system product type templates...');
                await this.productTypeSeeder.seedSystemTemplates();
                this.addLog('✅ 5 system templates created (tire, helmet, battery, part, accessory)', 'success');
            },
            'Seed 5 system product type templates to Firestore?'
        );
    }

    async runScenario(type: 'GOLDEN_PATH') {
        this.runAction('Scenario: Golden Path', () => this.seeder.runScenario(type, l => this.addLog(l)), 'Reset database to Golden Path state?');
    }

    async clearAll() {
        if (await this.confirmService.confirm({ title: 'WIPE ALL DATA?', message: 'Irreversible.', type: 'danger', confirmText: 'WIPE' })) {
            this.runAction('Wipe Database', () => this.seeder.clearAll(l => this.addLog(l)));
        }
    }

    private addLog(message: string, type: 'info' | 'success' | 'error' = 'info') {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        this.logs.update(prev => [...prev, { time, message, type }]);
    }

    getSeederVersion() { return 'v5.1.0-staff-update'; }

    // Doc Generator Methods (Stubbed to keep file shorter, logic was in previous step)
    generateXml() { this.addLog('XML generation feature present (stub)'); }
    generateInternationalDoc() { this.addLog('Doc generation feature present (stub)'); }
}
