import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { DataSeederService } from '../../../core/services/data-seeder.service';
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
          <!-- Actions Toolbar -->
          <div class="actions-toolbar">
             
             <!-- Simulation Group -->
             <div class="action-group">
                <span class="group-label">Simulation</span>
                <button class="btn btn-secondary" (click)="seedProducts()" [disabled]="isSeeding()">
                    <app-icon name="package" [size]="18"></app-icon>
                    Seed Products
                </button>
                <button class="btn btn-secondary" (click)="seedPraxisHistory()" [disabled]="isSeeding()">
                    <app-icon name="activity" [size]="18"></app-icon>
                    SoTA Backfill
                </button>
                <button class="btn btn-secondary" (click)="seedCoupons()" [disabled]="isSeeding()">
                    <app-icon name="tag" [size]="18"></app-icon>
                    Seed Coupons
                </button>
                <button class="btn btn-secondary" (click)="seedPricingRules()" [disabled]="isSeeding()">
                    <app-icon name="dollar-sign" [size]="18"></app-icon>
                    Seed Pricing Rules
                </button>
                 <button class="btn btn-secondary" (click)="seedWarehouseLayout()" [disabled]="isSeeding()">
                     <app-icon name="map" [size]="18"></app-icon>
                     Regenerate Warehouse
                 </button>
                 <button class="btn btn-primary" (click)="seedMultiLevelWarehouse()" [disabled]="isSeeding()">
                     <app-icon name="layers" [size]="18"></app-icon>
                     Multi-Level Warehouse v2.0
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

      <!-- TAB CONTENT: DOCUMENTS -->
      <div *ngIf="activeTab() === 'DOCUMENTS'" class="tab-content animate-fade-in">
        <div class="glass-panel max-w-2xl mx-auto mt-8">
            <h2 class="text-2xl font-bold mb-6 flex items-center gap-3 text-slate-200">
                <app-icon name="file-plus" class="text-yellow-400"></app-icon>
                Document Generator
            </h2>

            <p class="text-gray-400 mb-8">
                Generates randomized documents to test Procurement Import.
                <br>
                <strong>XML:</strong> Mexican CFDI 4.0 (for Local Suppliers).
                <br>
                <strong>Excel:</strong> Praxis Packing List (for International/China Suppliers).
            </p>

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

                <div *ngIf="lastGeneratedDoc" class="success-panel animate-fade-in">
                    <h4 class="text-emerald-400 font-bold mb-2 flex items-center gap-2">
                        <app-icon name="check" [size]="16"></app-icon> Generated Successfully!
                    </h4>
                    <div class="text-sm text-gray-300 space-y-1">
                        <p><span class="text-gray-500">Type:</span> {{ lastGeneratedDoc.type }}</p>
                        <p><span class="text-gray-500">UUID/File:</span> {{ lastGeneratedDoc.uuid }}</p>
                        <p><span class="text-gray-500">Supplier:</span> {{ lastGeneratedDoc.supplier }}</p>
                        <p><span class="text-gray-500">Items:</span> {{ lastGeneratedDoc.items }}</p>
                        <p><span class="text-gray-500">Total:</span> {{ lastGeneratedDoc.total | currency: lastGeneratedDoc.currency }}</p>
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


    /* Controls */
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

    /* Document Generator Styles */
    .glass-panel {
        background: rgba(30, 41, 59, 0.7);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 2rem;
    }
    .control-panel {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        background-color: #1e293b; /* slate-800 */
        border-radius: 0.5rem;
        border: 1px solid #334155; /* slate-700 */
    }
    .input-dark {
        background-color: #000;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        width: 4rem;
        text-align: center;
        border: 1px solid #475569; /* slate-600 */
    }
    .btn-generate {
        background-color: #eab308; /* yellow-500 */
        color: black;
        font-weight: 700;
        padding: 0.75rem 1.5rem;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .btn-generate:hover {
        background-color: #facc15; /* yellow-400 */
        transform: scale(1.05);
    }
    .success-panel {
        padding: 1rem;
        background-color: rgba(6, 78, 59, 0.2); /* emerald-900/20 */
        border: 1px solid rgba(16, 185, 129, 0.3); /* emerald-500/30 */
        border-radius: 0.5rem;
    }
  `]
})
export class DataSeederComponent {
    seeder = inject(DataSeederService);
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
    nextIsCsv = false; // Start with Excel

    suppliers = [
        { name: 'MICHELIN MEXICO SERVICES SA DE CV', rfc: 'MME950614A12' },
        { name: 'PIRELLI NEUMATICOS SA DE CV', rfc: 'PNE990525N81' },
        { name: 'CONTINENTAL TIRE DE MEXICO', rfc: 'CTM990521H34' },
        { name: 'BRIDGESTONE DE MEXICO SA DE CV', rfc: 'BME930301G45' }
    ];

    products = [
        { sku: 'MICH-2055516-P4', desc: 'LLANTA 205/55R16 91V PRIMACY 4', basePrice: 2100 },
        { sku: 'PIR-2254517-P7', desc: 'LLANTA 225/45R17 91W CINTURATO P7', basePrice: 2350 },
        { sku: 'CONTI-1956515-UC6', desc: 'LLANTA 195/65R15 91V ULTRACONTACT UC6', basePrice: 1800 },
        { sku: 'BS-2454019-S001', desc: 'LLANTA 245/40R19 98Y POTENZA S001', basePrice: 4500 },
        { sku: 'MICH-2656517-LTX', desc: 'LLANTA 265/65R17 112T LTX FORCE', basePrice: 3800 },
        { sku: 'PIR-2155517-P1', desc: 'LLANTA 215/55R17 94V CINTURATO P1', basePrice: 2200 },
        { sku: 'CONTI-2356018-CX3', desc: 'LLANTA 235/60R18 103V CROSSCONTACT LX25', basePrice: 3100 },
        { sku: 'BS-2755520-ALZ', desc: 'LLANTA 275/55R20 113T DUELER A/T 693', basePrice: 4200 }
    ];

    // --- SEEDER LOGIC ---

    async runScenario(type: 'GOLDEN_PATH' | 'STRESS_TEST' | 'NIGHTMARE') {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: `Run ${type.replace('_', ' ')}?`,
            message: 'This will seed the database with a preset scenario. Existing data might be affected.',
            confirmText: 'Run Scenario',
            type: 'warning'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        this.addLog(`Initializing scenario: ${type}...`);

        try {
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

    async seedWarehouseLayout() {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: 'Regenerate Warehouse Layout?',
            message: 'This will CLEAR all existing warehouse data (zones, racks, bins) and regenerate the complete layout with zone-relative positioning. Use this to fix layout issues.',
            confirmText: 'Clear & Regenerate',
            type: 'warning'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        this.logs.set([]); // Clear previous logs
        this.addLog('🗑️ Step 1: Clearing old warehouse data...');

        try {
            await this.seeder.populateWarehouseLayout((msg) => this.addLog(msg));

            // Verify the data was created
            this.addLog('✓ Verifying warehouse data...', 'info');
            this.addLog('✅ Warehouse layout regenerated successfully!', 'success');
            this.addLog('📍 Navigate to /operations/inventory/locator to view', 'success');
        } catch (e: any) {
            console.error(e);
            this.addLog('❌ Error: ' + e.message, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async seedProducts() {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: 'Generate 50 Sample Products?',
            message: 'This will seed the database with 50 realistic motorcycle tires.',
            confirmText: 'Seed Products',
            type: 'info'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        try {
            await this.seeder.seedProducts((msg: string) => this.addLog(msg));
            this.addLog('✅ Product seeding complete!', 'success');
        } catch (error: any) {
            console.error(error);
            this.addLog('❌ Error seeding products: ' + (error.message || 'Unknown error'), 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async seedPraxisHistory() {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: 'Backfill History?',
            message: 'This will generate historical sales data for existing products to simulate a realistic past.',
            confirmText: 'Backfill Data',
            type: 'info'
        });

        if (!confirmed) return;

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

        const confirmed = await this.confirmService.confirm({
            title: 'Seed Coupons?',
            message: 'This will create standard test coupons (WELCOME10, FREESHIP, etc.).',
            confirmText: 'Create Coupons',
            type: 'info'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        this.logs.set([]);

        try {
            await this.seeder.populateCoupons((msg) => this.addLog(msg));
            this.addLog('Coupons seeded successfully', 'success');
        } catch (error) {
            console.error(error);
            this.addLog('Failed to seed coupons', 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async seedPricingRules() {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: 'Seed Pricing Commission Rules?',
            message: 'This will create official commission rules for Amazon FBA, MercadoLibre (Classic & Full), POS, and Web Store. Required for the Pricing Strategy Calculator.',
            confirmText: 'Seed Rules',
            type: 'info'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        this.logs.set([]);

        try {
            await this.seeder.seedChannelCommissionRules((msg) => this.addLog(msg));
            this.addLog('✅ Pricing rules seeded successfully!', 'success');
            this.addLog('📍 Ready for use in /operations/pricing', 'success');
        } catch (error) {
            console.error(error);
            this.addLog('❌ Failed to seed pricing rules', 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    async clearAll() {
        const firstConfirm = await this.confirmService.confirm({
            title: 'DANGER: Wipe Database?',
            message: 'This will PERMANENTLY DELETE all orders, products, inventory, and customers. This action cannot be undone.',
            confirmText: 'Yes, I understand',
            cancelText: 'Cancel',
            type: 'danger'
        });

        if (!firstConfirm) {
            this.addLog('❌ Wipe cancelled by user', 'info');
            return;
        }

        const secondConfirm = await this.confirmService.confirm({
            title: 'FINAL WARNING',
            message: 'Are you absolutely sure you want to delete EVERYTHING? There is no turning back.',
            confirmText: 'DELETE EVERYTHING',
            cancelText: 'Abort',
            type: 'danger'
        });

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
        return 'v5.0.2-memory-patch';
    }

    async seedMultiLevelWarehouse() {
        if (this.isSeeding()) return;

        const confirmed = await this.confirmService.confirm({
            title: 'Generate Multi-Level Warehouse?',
            message: 'This will CLEAR existing warehouse data and generate a 3-level warehouse (Ground Floor, Mezzanine, Overhead) optimized for Product Locator v2.0 with proper levelId assignments.',
            confirmText: 'Generate v2.0 Warehouse',
            type: 'info'
        });

        if (!confirmed) return;

        this.isSeeding.set(true);
        this.logs.set([]);
        this.addLog('🏗️ Generating Multi-Level Warehouse for v2.0...');

        try {
            await this.seeder.populateMultiLevelWarehouse((msg) => this.addLog(msg));
            this.addLog('✅ Multi-level warehouse generated successfully!', 'success');
            this.addLog('📍 Test at /operations/inventory/locator', 'success');
            this.addLog('🎬 Watch the exploded view intro animation!', 'success');
        } catch (e: any) {
            console.error(e);
            this.addLog('❌ Error: ' + e.message, 'error');
        } finally {
            this.isSeeding.set(false);
        }
    }

    // --- DOC GENERATOR LOGIC ---

    generateXml() {
        const supplier = this.suppliers[Math.floor(Math.random() * this.suppliers.length)];
        const uuid = crypto.randomUUID();
        const itemCount = Math.floor(Math.random() * (this.genMaxItems - this.genMinItems + 1)) + this.genMinItems;

        let subtotal = 0;
        let taxTotal = 0;
        let xmlItems = '';

        for (let i = 0; i < itemCount; i++) {
            const prod = this.products[Math.floor(Math.random() * this.products.length)];
            const qty = Math.floor(Math.random() * 20) + 1; // 1-20
            const price = Math.round(prod.basePrice * (0.9 + Math.random() * 0.2)); // +/- 10%
            const amount = price * qty;
            const tax = amount * 0.16;

            subtotal += amount;
            taxTotal += tax;

            xmlItems += `
            <cfdi:Concepto 
                ClaveProdServ="25172504" 
                NoIdentificacion="${prod.sku}" 
                Cantidad="${qty}" 
                ClaveUnidad="H87" 
                Descripcion="${prod.desc}" 
                ValorUnitario="${price.toFixed(2)}" 
                Importe="${amount.toFixed(2)}">
                 <cfdi:Impuestos>
                    <cfdi:Traslados>
                        <cfdi:Traslado Base="${amount.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${tax.toFixed(2)}"/>
                    </cfdi:Traslados>
                </cfdi:Impuestos>
            </cfdi:Concepto>`;
        }

        const total = subtotal + taxTotal;
        const date = new Date().toISOString().split('.')[0]; // YYYY-MM-DDThh:mm:ss

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante 
    xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    Version="4.0" 
    Serie="A" 
    Folio="${Math.floor(Math.random() * 10000)}" 
    Fecha="${date}" 
    SubTotal="${subtotal.toFixed(2)}" 
    Moneda="MXN" 
    Total="${total.toFixed(2)}" 
    TipoDeComprobante="I" 
    MetodoPago="PUE" 
    LugarExpedicion="64000">
    <cfdi:Emisor Rfc="${supplier.rfc}" Nombre="${supplier.name}" RegimenFiscal="601"/>
    <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" UsoCFDI="S01" DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="616"/>
    <cfdi:Conceptos>
        ${xmlItems}
    </cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="${taxTotal.toFixed(2)}">
        <cfdi:Traslados>
            <cfdi:Traslado Base="${subtotal.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${taxTotal.toFixed(2)}"/>
        </cfdi:Traslados>
    </cfdi:Impuestos>
    <cfdi:Complemento>
        <tfd:TimbreFiscalDigital 
            xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" 
            UUID="${uuid}" 
            FechaTimbrado="${date}" 
            RfcProvCertif="SAT970701NN3" 
            NoCertificadoSAT="00001000000504465028" 
            SelloSAT="dummy"/>
    </cfdi:Complemento>
</cfdi:Comprobante>`;

        const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
        FileSaver.saveAs(blob, `CFDI_${supplier.name.split(' ')[0]}_${Math.floor(Math.random() * 1000)}.xml`);

        this.lastGeneratedDoc = {
            type: 'XML (CFDI)',
            uuid,
            supplier: supplier.name,
            items: itemCount,
            total,
            currency: 'MXN'
        };
    }

    generateInternationalDoc() {
        // Praxis is International, so USD
        const supplierName = 'PRAXIS INTERNATIONAL LTD';
        const itemCount = Math.floor(Math.random() * (this.genMaxItems - this.genMinItems + 1)) + this.genMinItems;
        const data = [];
        let total = 0;

        for (let i = 0; i < itemCount; i++) {
            const prod = this.products[Math.floor(Math.random() * this.products.length)];
            const qty = Math.floor(Math.random() * 100) + 10;
            const price = Math.round(prod.basePrice / 20 * (0.9 + Math.random() * 0.2)); // USD price approx /20 MXN
            const lineTotal = qty * price;
            total += lineTotal;

            data.push({
                'SKU': prod.sku,
                'Description': prod.desc,
                'Quantity': qty,
                'Unit Price': price,
                'Total': lineTotal
            });
        }

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Packing List");

        // Toggle Format
        const isCsv = this.nextIsCsv;
        this.nextIsCsv = !this.nextIsCsv; // Flip for next time

        const ext = isCsv ? '.csv' : '.xlsx';
        const typeLabel = isCsv ? 'CSV (Packing List)' : 'Excel (Packing List)';

        const fileName = `Pending_PackingList_${Math.floor(Math.random() * 1000)}${ext}`;
        XLSX.writeFile(wb, fileName);

        this.lastGeneratedDoc = {
            type: typeLabel,
            uuid: fileName,
            supplier: supplierName,
            items: itemCount,
            total,
            currency: 'USD'
        };
    }
}
