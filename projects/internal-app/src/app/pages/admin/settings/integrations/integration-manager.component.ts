import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SecretsService, IntegrationConfig } from '../../../../core/services/config/secrets.service';
import { MeliService } from '../../../../core/services/meli.service';
import { MeliSyncService } from '../../../../core/services/meli-sync.service';
import { MeliOrderService } from '../../../../core/services/meli-order.service';
import { SettingsService, ShippingSettings } from '../../../../core/services/settings.service';

@Component({
    selector: 'app-integration-manager',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './integration-manager.component.html',
    styleUrls: ['./integration-manager.component.css']
})
export class IntegrationManagerComponent implements OnInit {
    private secrets = inject(SecretsService);
    private meliService = inject(MeliService);
    private syncService = inject(MeliSyncService);
    private orderService = inject(MeliOrderService);
    private router = inject(Router);
    private settingsService = inject(SettingsService);
    private functions = inject(Functions);

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
    skydropxApiSecret = '';
    skydropxTestResult: string | null = null;
    isTestingSkydropx = false;
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
            this.skydropxApiSecret = conf.skydropx.apiSecret || '';
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

    async testSkydropxConnection() {
        this.isTestingSkydropx = true;
        this.skydropxTestResult = null;
        try {
            // Cannot call api.skydropx.com directly from browser (CORS) —
            // route through the skydropxTestConnection Cloud Function instead.
            const testFn = httpsCallable<void, { success: boolean; message: string }>(
                this.functions, 'skydropxTestConnection'
            );
            const result = await testFn();
            if (result.data.success) {
                this.skydropxTestResult = 'ok';
            } else {
                this.skydropxTestResult = result.data.message || 'Connection failed — check your API key';
            }
        } catch (e: any) {
            this.skydropxTestResult = e?.message || 'Cloud Function error — check Firebase console';
        } finally {
            this.isTestingSkydropx = false;
        }
    }

    async saveSkydropx() {
        this.isSavingSkydropx = true;
        try {
            // Save Origin
            await this.settingsService.updateSettings({
                shipping: { origin: this.skydropxOrigin }
            });

            // Save API Key + Secret
            const current = this.config() || {};
            await this.secrets.saveConfig({
                ...current,
                skydropx: {
                    apiKey: this.skydropxApiKey,
                    apiSecret: this.skydropxApiSecret,
                    connected: !!(this.skydropxApiKey && this.skydropxApiSecret)
                }
            });

            await this.loadConfig();
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
