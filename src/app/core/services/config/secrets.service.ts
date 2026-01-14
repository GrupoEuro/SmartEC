
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

export interface IntegrationConfig {
    meli?: {
        appId: string;
        clientSecret: string;
        redirectUri: string;
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        connected: boolean;
    };
    amazon?: {
        clientId: string;
        clientSecret: string;
        connected: boolean;
    };
    stripe?: {
        publishableKey: string;
        secretKey: string;
        connected: boolean;
    };
}

@Injectable({
    providedIn: 'root'
})
export class SecretsService {
    private firestore = inject(Firestore);
    private configPath = 'config/integrations'; // Single doc for simplicity in this prototype

    async getConfig(): Promise<IntegrationConfig> {
        const ref = doc(this.firestore, this.configPath);
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
            return snapshot.data() as IntegrationConfig;
        }
        return {
            meli: { appId: '', clientSecret: '', redirectUri: window.location.origin + '/admin/settings/integrations/callback', connected: false },
            amazon: { clientId: '', clientSecret: '', connected: false }
        };
    }

    async saveConfig(config: IntegrationConfig): Promise<void> {
        const ref = doc(this.firestore, this.configPath);
        await setDoc(ref, config, { merge: true });
    }
}
