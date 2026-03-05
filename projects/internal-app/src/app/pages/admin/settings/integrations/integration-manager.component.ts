import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SecretsService, IntegrationConfig } from '../../../../core/services/config/secrets.service';
import { MeliService } from '../../../../core/services/meli.service';
import { MeliSyncService } from '../../../../core/services/meli-sync.service';
import { MeliOrderService } from '../../../../core/services/meli-order.service';
import { SettingsService, ShippingSettings } from '../../../../core/services/settings.service';

@Component({
    selector: 'app-integration-manager',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="integration-container p-6">
      <h1 class="text-2xl font-bold mb-6 text-slate-100 flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-indigo-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
        API Integrations Manager
      </h1>
      
      <p class="text-slate-400 mb-8">
        Configure secure connections to external marketplaces. 
        <br><span class="text-yellow-500 text-xs">⚠️ Warning: Changing keys will disrupt active synchronizations.</span>
      </p>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      
        <!-- MERCADOLIBRE CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fas fa-handshake text-6xl text-slate-500"></i>
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

        <!-- AMAZON SP-API CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fab fa-amazon text-6xl text-slate-500"></i>
             </div>

             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full" [class.bg-yellow-500]="config()?.amazon?.connected" [class.bg-red-500]="!config()?.amazon?.connected"></div>
                 <h2 class="text-xl font-bold text-white">Amazon SP-API</h2>
                 <span class="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Phase 2</span>
             </div>

             <div class="grid grid-cols-2 gap-4">
                 <div class="form-group mb-2 col-span-2 md:col-span-1">
                     <label class="block text-xs uppercase text-slate-500 mb-1">LWA Client ID</label>
                     <input type="text" [(ngModel)]="amazonClientId" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
                 </div>

                 <div class="form-group mb-2 col-span-2 md:col-span-1">
                     <label class="block text-xs uppercase text-slate-500 mb-1">LWA Client Secret</label>
                     <input type="password" [(ngModel)]="amazonClientSecret" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
                 </div>

                 <div class="form-group mb-6 col-span-2 md:col-span-1">
                     <label class="block text-xs uppercase text-slate-500 mb-1">Refresh Token</label>
                     <input type="password" [(ngModel)]="amazonRefreshToken" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
                 </div>

                 <div class="form-group mb-6 col-span-2 md:col-span-1">
                     <label class="block text-xs uppercase text-slate-500 mb-1">API Region</label>
                     <select [(ngModel)]="amazonRegion" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
                         <option value="na">North America (US/MX/CA)</option>
                         <option value="eu">Europe</option>
                         <option value="fe">Far East</option>
                     </select>
                 </div>
             </div>

             <div class="flex justify-between items-center">
                 <button (click)="saveAmazon()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition font-bold shadow-lg shadow-slate-900/20">
                    Save Keys
                 </button>
             </div>
         </div>

    <!-- STRIPE CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fab fa-stripe text-6xl text-slate-500"></i>
             </div>

             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full" [class.bg-purple-500]="config()?.stripe?.connected" [class.bg-red-500]="!config()?.stripe?.connected"></div>
                 <h2 class="text-xl font-bold text-white">Stripe</h2>
                 <span class="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">Checkout</span>
             </div>

             <div class="form-group mb-4">
                 <label class="block text-xs uppercase text-slate-500 mb-1">Publishable Key (Front-end)</label>
                 <input type="text" [(ngModel)]="stripePublishableKey" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="form-group mb-6">
                 <label class="block text-xs uppercase text-slate-500 mb-1">Secret Key (Back-end)</label>
                 <input type="password" [(ngModel)]="stripeSecretKey" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="flex justify-between items-center">
                 <button (click)="saveStripe()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition font-bold shadow-lg shadow-slate-900/20">
                    Save Keys
                 </button>
             </div>
        </div>

        <!-- ZIPPOPOTAMUS INFO CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden opacity-90">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fas fa-map-marked-alt text-6xl text-slate-500"></i>
             </div>

             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full" [class.bg-green-500]="zippopotamStatus === 'online'" [class.bg-red-500]="zippopotamStatus === 'offline'" [class.bg-yellow-500]="zippopotamStatus === 'checking'"></div>
                 <h2 class="text-xl font-bold text-white">Zippopotam.us</h2>
                 <span class="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">Public API</span>
             </div>

             <p class="text-sm text-slate-400 mb-4 pr-10">
                 Free public API used globally across the storefront ad admin panels for auto-completing Mexican Zip Codes (States, Cities, Colonias). 
                 No API key or authentication is required.
             </p>
             
             <div class="p-3 bg-slate-900/50 border border-slate-700 rounded-md flex items-center gap-3">
                 <i class="fas" [class.fa-spinner]="zippopotamStatus === 'checking'" [class.fa-spin]="zippopotamStatus === 'checking'" [class.fa-check-circle]="zippopotamStatus === 'online'" [class.text-green-400]="zippopotamStatus === 'online'" [class.fa-times-circle]="zippopotamStatus === 'offline'" [class.text-red-400]="zippopotamStatus === 'offline'"></i>
                 <span class="text-sm font-medium text-slate-300">
                    {{ zippopotamStatus === 'checking' ? 'Checking connection...' : (zippopotamStatus === 'online' ? 'API is Online and Responding' : 'API Connection Failed') }}
                 </span>
             </div>
        </div>

        <!-- MERCADOPAGO CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fas fa-credit-card text-6xl text-slate-500"></i>
             </div>

             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full" [class.bg-blue-400]="config()?.mercadopago?.connected" [class.bg-red-500]="!config()?.mercadopago?.connected"></div>
                 <h2 class="text-xl font-bold text-white">MercadoPago</h2>
                 <span class="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">Checkout</span>
             </div>

             <div class="form-group mb-4">
                 <label class="block text-xs uppercase text-slate-500 mb-1">Public Key (Front-end)</label>
                 <input type="text" [(ngModel)]="mpPublicKey" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="form-group mb-6">
                 <label class="block text-xs uppercase text-slate-500 mb-1">Access Token (Back-end)</label>
                 <input type="password" [(ngModel)]="mpAccessToken" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="flex justify-between items-center">
                 <button (click)="saveMercadoPago()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition font-bold shadow-lg shadow-slate-900/20">
                    Save Keys
                 </button>
             </div>
        </div>

        <!-- SKYDROPX CARD -->
        <div class="card p-6 bg-slate-800 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden">
             <div class="absolute top-0 right-0 p-2 opacity-10">
                <i class="fas fa-truck text-6xl text-slate-500"></i>
             </div>

             <div class="flex items-center gap-3 mb-4">
                 <div class="w-3 h-3 rounded-full bg-blue-500"></div>
                 <h2 class="text-xl font-bold text-white">SkyDropX PRO</h2>
                 <span class="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">Shipping</span>
             </div>

             <p class="text-xs text-slate-400 mb-6 max-w-[85%]">
                 Configure the <strong>API Key</strong> and <strong>Origin Address</strong> here for label generation.
             </p>

             <div class="form-group mb-6">
                 <label class="block text-xs uppercase text-slate-500 mb-1">API Key (PRO)</label>
                 <input type="password" [(ngModel)]="skydropxApiKey" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200">
             </div>

             <div class="grid grid-cols-2 gap-4">
                 <div class="form-group col-span-2">
                    <label class="block text-xs uppercase text-slate-500 mb-1">Street</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.street" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="Av. Salvador Nava">
                 </div>
                 
                 <div class="form-group">
                    <label class="block text-xs uppercase text-slate-500 mb-1">Number</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.number" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="704-1">
                 </div>

                 <div class="form-group">
                    <label class="block text-xs uppercase text-slate-500 mb-1">Colonia</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.colonia" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="Col. Nuevo Paseo">
                 </div>

                 <div class="form-group col-span-2">
                    <label class="block text-xs uppercase text-slate-500 mb-1">City</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.city" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="San Luis Potosí">
                 </div>

                 <div class="form-group">
                    <label class="block text-xs uppercase text-slate-500 mb-1">State / Province</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.province" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="San Luis Potosí">
                 </div>

                 <div class="form-group">
                    <label class="block text-xs uppercase text-slate-500 mb-1">Zip Code</label>
                    <input type="text" [(ngModel)]="skydropxOrigin.zip" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200" placeholder="78140">
                 </div>
             </div>

             <div class="flex justify-start mt-6">
                 <button (click)="saveSkydropx()" [disabled]="isSavingSkydropx" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition flex items-center gap-2">
                    <i class="fas" [class.fa-save]="!isSavingSkydropx" [class.fa-spinner]="isSavingSkydropx" [class.fa-spin]="isSavingSkydropx"></i>
                    {{ isSavingSkydropx ? 'Saving...' : 'Save Origin Address' }}
                 </button>
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
    private settingsService = inject(SettingsService);

    config = signal<IntegrationConfig | null>(null);

    // Form Models
    meliAppId = '';
    meliSecret = '';
    meliRedirect = 'https://us-central1-tiendapraxis.cloudfunctions.net/meliCallback';

    amazonClientId = '';
    amazonClientSecret = '';
    amazonRefreshToken = '';
    amazonRegion = 'na';

    mpAccessToken = '';
    mpPublicKey = '';

    stripePublishableKey = '';
    stripeSecretKey = '';

    zippopotamStatus: 'checking' | 'online' | 'offline' = 'checking';

    skydropxApiKey = '';
    skydropxOrigin = {
        street: 'Av. Salvador Nava',
        number: '704-1',
        colonia: 'Col. Nuevo Paseo',
        city: 'San Luis Potosí',
        province: 'San Luis Potosí',
        zip: '78140',
        country: 'MX'
    };

    // Sync State
    isSyncing = false;
    isOrderImporting = false;
    isSavingSkydropx = false;
    syncResult: string | null = null;

    async ngOnInit() {
        this.settingsService.settings$.subscribe(settings => {
            if (settings?.shipping?.origin) {
                this.skydropxOrigin = { ...this.skydropxOrigin, ...settings.shipping.origin };
            }
        });
        await this.loadConfig();
        this.checkZippopotam();
    }

    async checkZippopotam() {
        this.zippopotamStatus = 'checking';
        try {
            const res = await fetch('https://api.zippopotam.us/mx/01000');
            if (res.ok) {
                this.zippopotamStatus = 'online';
            } else {
                this.zippopotamStatus = 'offline';
            }
        } catch (e) {
            this.zippopotamStatus = 'offline';
        }
    }

    async loadConfig() {
        const conf = await this.secrets.getConfig();
        this.config.set(conf);
        if (conf.meli) {
            this.meliAppId = conf.meli.appId;
            this.meliSecret = conf.meli.clientSecret;
            this.meliRedirect = 'https://us-central1-tiendapraxis.cloudfunctions.net/meliCallback';
        }
        if (conf.amazon) {
            this.amazonClientId = conf.amazon.clientId || '';
            this.amazonClientSecret = conf.amazon.clientSecret || '';
            this.amazonRefreshToken = conf.amazon.refreshToken || '';
            this.amazonRegion = conf.amazon.region || 'na';
        }
        if (conf.mercadopago) {
            this.mpAccessToken = conf.mercadopago.accessToken || '';
            this.mpPublicKey = conf.mercadopago.publicKey || '';
        }
        if (conf.stripe) {
            this.stripePublishableKey = conf.stripe.publishableKey || '';
            this.stripeSecretKey = conf.stripe.secretKey || '';
        }
        if (conf.skydropx) {
            this.skydropxApiKey = conf.skydropx.apiKey || '';
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

    async saveSkydropx() {
        this.isSavingSkydropx = true;
        try {
            // Save Origin
            await this.settingsService.updateSettings({
                shipping: { origin: this.skydropxOrigin }
            });

            // Save API Key
            const current = this.config() || {};
            await this.secrets.saveConfig({
                ...current,
                skydropx: {
                    apiKey: this.skydropxApiKey,
                    connected: !!this.skydropxApiKey
                }
            });

            alert('SkyDropX Settings Saved.');
        } catch (e) {
            console.error('Failed to save SkyDropX', e);
            alert('Failed to save. Check console.');
        } finally {
            this.isSavingSkydropx = false;
        }
    }

    async saveMercadoPago() {
        try {
            const current = this.config() || {};
            await this.secrets.saveConfig({
                ...current,
                mercadopago: {
                    accessToken: this.mpAccessToken,
                    publicKey: this.mpPublicKey,
                    connected: !!this.mpAccessToken
                }
            });
            alert('MercadoPago Keys Saved.');
        } catch (e) {
            console.error('Failed to save MP', e);
            alert('Failed to save. Check console.');
        }
    }

    async saveStripe() {
        try {
            const current = this.config() || {};
            await this.secrets.saveConfig({
                ...current,
                stripe: {
                    publishableKey: this.stripePublishableKey,
                    secretKey: this.stripeSecretKey,
                    connected: !!this.stripeSecretKey
                }
            });
            alert('Stripe Keys Saved.');
        } catch (e) {
            console.error('Failed to save Stripe', e);
            alert('Failed to save. Check console.');
        }
    }

    async saveAmazon() {
        try {
            const current = this.config() || {};
            await this.secrets.saveConfig({
                ...current,
                amazon: {
                    clientId: this.amazonClientId,
                    clientSecret: this.amazonClientSecret,
                    refreshToken: this.amazonRefreshToken,
                    region: this.amazonRegion,
                    connected: !!(this.amazonClientId && this.amazonRefreshToken)
                }
            });
            alert('Amazon SP-API Keys Saved.');
        } catch (e) {
            console.error('Failed to save Amazon keys', e);
            alert('Failed to save. Check console.');
        }
    }
}
