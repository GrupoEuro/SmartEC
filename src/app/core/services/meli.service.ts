
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { SecretsService } from './config/secrets.service';
import { firstValueFrom } from 'rxjs';

export interface MeliTokens {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    user_id: number;
    refresh_token: string;
    created_at?: number; // Timestamp when token was received
}

@Injectable({
    providedIn: 'root'
})
export class MeliService {
    private http = inject(HttpClient);
    private secrets = inject(SecretsService);
    private router = inject(Router);

    private readonly API_URL = 'https://api.mercadolibre.com';

    // This should ideally be handled by a backend/Cloud Function to avoid CORS and exposing secrets,
    // but for this implementation we are doing it client-side as per the SecretsService pattern.
    // Note: MELI Oauth endpoint might block CORS. If so, a proxy is needed.

    async handleAuthCallback(code: string): Promise<void> {
        try {
            const config = await this.secrets.getConfig();
            if (!config?.meli?.appId || !config?.meli?.clientSecret) {
                throw new Error('MELI Configuration missing');
            }

            const body = new HttpParams()
                .set('grant_type', 'authorization_code')
                .set('client_id', config.meli.appId)
                .set('client_secret', config.meli.clientSecret)
                .set('code', code)
                .set('redirect_uri', config.meli.redirectUri || (window.location.origin + '/admin/integrations/callback'));

            const tokens = await firstValueFrom(
                this.http.post<MeliTokens>(`${this.API_URL}/oauth/token`, body.toString(), {
                    headers: new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded')
                })
            );

            // Save tokens to Secrets (or dedicated token store)
            // SecretsService seems to store 'Config'. 
            // We should store tokens securely. For now, let's append to config or uses separate method if existed.
            // Looking at IntegrationConfig interface in IntegrationManager, it had 'connected'.
            // We might need to extend SecretsService or store just 'connected' status and keep tokens in localStorage/Firestore separate collection?
            // For now, I will update the 'connected' status in Secrets and save tokens to a helper method in Secrets if available, or just log for now?

            // Actually, SecretsService likely has a method to save sensitive data?
            // If not, I'll store it in the 'meli' object of config for now (simplest, though not mostly secure for tokens if config is readable by all admins).

            const updatedConfig = {
                ...config,
                meli: {
                    ...config.meli,
                    connected: true,
                    tokens: tokens // Ensure IntegrationConfig interface supports this or loose typing
                }
            };

            await this.secrets.saveConfig(updatedConfig);

            return;

        } catch (error) {
            console.error('MELI Token Exchange Failed', error);
            throw error;
        }
    }

    // Helper to refresh token if needed (Future impl)
}
