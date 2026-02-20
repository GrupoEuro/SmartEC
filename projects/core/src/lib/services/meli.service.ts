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
    created_at?: number;
}

@Injectable({
    providedIn: 'root'
})
export class MeliService {
    private http = inject(HttpClient);
    private secrets = inject(SecretsService);
    private router = inject(Router);

    private readonly API_URL = 'https://api.mercadolibre.com';

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

            // Map external token response to internal config format
            const now = Date.now();
            const expiresAt = now + (tokens.expires_in * 1000);

            // We use 'any' to robustly merge fields that might not be in the strict Interface yet (like userId)
            const updatedConfig: any = {
                ...config,
                meli: {
                    ...config.meli,
                    connected: true,
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiresAt: expiresAt,
                    userId: tokens.user_id,
                    scope: tokens.scope
                }
            };

            await this.secrets.saveConfig(updatedConfig);
            return;

        } catch (error) {
            console.error('MELI Token Exchange Failed', error);
            throw error;
        }
    }

    getAuthUrl(appId: string, redirectUri: string): string {
        // Default to Mexico site for this project
        return `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    }
}
