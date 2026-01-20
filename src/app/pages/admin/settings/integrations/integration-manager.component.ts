import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SecretsService, IntegrationConfig } from '../../../../core/services/config/secrets.service';
import { MeliService } from '../../../../core/services/meli.service';
import { MeliSyncService } from '../../../../core/services/meli-sync.service';
import { MeliOrderService } from '../../../../core/services/meli-order.service';

@Component({
    selector: 'app-integration-manager',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="integration-container p-6">
      <h1 class="text-2xl font-bold mb-6 text-slate-100">🔌 API Integrations Manager</h1>
      
      <p class="text-slate-400 mb-8">
        Configure secure connections to external marketplaces. 
        <br><span class="text-yellow-500 text-xs">⚠️ Warning: Changing keys will disrupt active synchronizations.</span>
      </p>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      
        <!-- MERCADOLIBRE CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <img src="assets/images/meli-logo-placeholder.png" width="100">
             </div>
             
             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full" [class.bg-green-500]="config()?.meli?.connected" [class.bg-red-500]="!config()?.meli?.connected"></div>
                 <h2 class="text-xl font-bold text-white">MercadoLibre</h2>
                 <span class="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">Priority</span>
             </div>

             <div class="form-group mb-4">
                <label class="block text-xs uppercase text-slate-500 mb-1">App ID</label>
                <input type="text" [(ngModel)]="meliAppId" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="form-group mb-4">
                <label class="block text-xs uppercase text-slate-500 mb-1">Client Secret</label>
                <input type="password" [(ngModel)]="meliSecret" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>
             
             <div class="form-group mb-6">
                <label class="block text-xs uppercase text-slate-500 mb-1">Redirect URI (Read Only)</label>
                <div class="w-full bg-slate-900/50 border border-slate-700/50 rounded px-3 py-2 text-slate-500 font-mono text-xs select-all">
                    {{ meliRedirect }}
                </div>
                <p class="text-[10px] text-slate-500 mt-1">Paste this into your MELI App settings.</p>
             </div>

             <div class="flex justify-between items-center flex-wrap gap-2">
                 <div class="flex gap-2">
                     <button (click)="saveMeli()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition">
                        Save Keys
                     </button>
                     
                     <!-- Sync Inventory -->
                     <button *ngIf="config()?.meli?.connected" (click)="syncInventory()" [disabled]="isSyncing"
                        class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold shadow-lg shadow-indigo-500/20 transition flex items-center gap-2">
                        <i class="fas fa-box-open" [class.fa-spin]="isSyncing"></i>
                        <span>{{ isSyncing ? 'Syncing...' : 'Sync Items' }}</span>
                     </button>

                     <!-- Import Orders -->
                     <button *ngIf="config()?.meli?.connected" (click)="importOrders()" [disabled]="isOrderImporting"
                        class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold shadow-lg shadow-emerald-500/20 transition flex items-center gap-2">
                        <i class="fas fa-shopping-cart" [class.fa-spin]="isOrderImporting"></i>
                        <span>{{ isOrderImporting ? 'Importing...' : 'Get Orders' }}</span>
                     </button>

                     <!-- Sync 2025 History -->
                     <button *ngIf="config()?.meli?.connected" (click)="importHistory2025()" [disabled]="isOrderImporting"
                        class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-bold shadow-lg shadow-purple-500/20 transition flex items-center gap-2">
                        <i class="fas fa-history" [class.fa-spin]="isOrderImporting"></i>
                        <span>{{ isOrderImporting ? 'Mining 2025...' : 'Sync 2025' }}</span>
                     </button>

                     <!-- Link Products -->
                     <button *ngIf="config()?.meli?.connected" (click)="goToLinking()"
                        class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-bold shadow-lg shadow-slate-900/20 transition flex items-center gap-2">
                        <i class="fas fa-link"></i>
                        <span>Manage Links</span>
                     </button>
                 </div>
                 
                 <button *ngIf="!config()?.meli?.connected && config()?.meli?.appId" (click)="connectMeli()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold shadow-lg shadow-blue-500/20 transition flex items-center gap-2">
                    <span>Login & Connect</span>
                    <i class="fas fa-external-link-alt"></i>
                 </button>
             </div>
             
             <!-- Sync Status -->
             <div *ngIf="syncResult" class="mt-4 p-2 bg-slate-900/50 rounded text-xs text-center border border-slate-700">
                <span [class.text-green-400]="!syncResult.includes('Failed')" [class.text-red-400]="syncResult.includes('Failed')">
                    {{ syncResult }}
                </span>
             </div>
        </div>

        <!-- AMAZON CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative opacity-75">
             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full bg-slate-600"></div>
                 <h2 class="text-xl font-bold text-white">Amazon SP-API</h2>
                 <span class="text-xs px-2 py-1 rounded bg-slate-600 text-slate-300">Phase 2</span>
             </div>

             <div class="form-group mb-4">
                 <label class="block text-xs uppercase text-slate-500 mb-1">Sell Partner App ID</label>
                 <input type="text" disabled placeholder="Coming Soon" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-600 cursor-not-allowed">
             </div>
        </div>

      </div>
    </div>
  `,
    styles: [`
    :host { display: block; }
  `]
})
export class IntegrationManagerComponent implements OnInit {
    private secrets = inject(SecretsService);
    private meliService = inject(MeliService);
    private syncService = inject(MeliSyncService);

    private orderService = inject(MeliOrderService);
    private router = inject(Router);

    config = signal<IntegrationConfig | null>(null);

    // Form Models
    meliAppId = '';
    meliSecret = '';
    meliRedirect = window.location.origin + '/admin/integrations/callback';

    // Sync State
    isSyncing = false;
    isOrderImporting = false;
    syncResult: string | null = null;

    async ngOnInit() {
        await this.loadConfig();
    }

    async loadConfig() {
        const conf = await this.secrets.getConfig();
        this.config.set(conf);
        if (conf.meli) {
            this.meliAppId = conf.meli.appId;
            this.meliSecret = conf.meli.clientSecret;
            this.meliRedirect = window.location.origin + '/admin/settings/integrations/callback';
        }
    }

    async saveMeli() {
        const current = this.config() || {};
        const updated: IntegrationConfig = {
            ...current,
            meli: {
                ...current.meli!,
                appId: this.meliAppId,
                clientSecret: this.meliSecret,
                redirectUri: this.meliRedirect,
                connected: current.meli?.connected || false
            }
        };
        await this.secrets.saveConfig(updated);
        await this.loadConfig();
        alert('MELI Configuration Saved.');
    }

    connectMeli() {
        if (!this.meliAppId) return;
        window.location.href = this.meliService.getAuthUrl(this.meliAppId, this.meliRedirect);
    }

    async syncInventory() {
        const conf = this.config();

        if (!conf?.meli?.connected) {
            alert('Please connect MercadoLibre first.');
            return;
        }

        this.isSyncing = true;
        this.syncResult = null;

        try {
            // Fallback ID if not in config
            const userId = conf.meli.userId || 0;
            const result = await this.syncService.syncAccountItems(userId);
            this.syncResult = `Catalog Sync: ${result.updated} updated, ${result.errors} errors.`;
        } catch (e) {
            console.error(e);
            this.syncResult = 'Catalog Sync Failed. See console.';
        } finally {
            this.isSyncing = false;
        }
    }

    async importOrders() {
        const conf = this.config();

        if (!conf?.meli?.connected) {
            alert('Please connect MercadoLibre first.');
            return;
        }

        this.isOrderImporting = true;
        this.syncResult = null;

        try {
            const userId = conf.meli.userId || 0;
            const result = await this.orderService.importOrders(userId);
            this.syncResult = `Orders Imported: ${result.imported} new orders.`;
        } catch (e) {
            console.error(e);
            this.syncResult = 'Order Import Failed. See console.';
        } finally {
            this.isOrderImporting = false;
        }
    }

    async importHistory2025() {
        const conf = this.config();
        if (!conf?.meli?.connected) return;

        this.isOrderImporting = true;
        this.syncResult = 'Mining 2025 data... this may take a while.';

        try {
            const userId = conf.meli.userId || 0;
            const result = await this.orderService.syncHistoricOrders(2025, userId);
            this.syncResult = `2025 Historic Data: ${result.imported} orders archived.`;
        } catch (e) {
            console.error(e);
            this.syncResult = 'Historic Sync Failed.';
        } finally {
            this.isOrderImporting = false;
        }
    }

    goToLinking() {
        this.router.navigate(['/admin/integrations/products']);
    }
}
