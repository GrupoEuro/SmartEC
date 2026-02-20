import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class DevConfigService {

    constructor() { }

    getEnvironment() {
        return environment;
    }

    getStorageSummary() {
        const local = { ...localStorage };
        const session = { ...sessionStorage };
        return {
            localStorageCount: Object.keys(local).length,
            sessionStorageCount: Object.keys(session).length,
            localStorageSize: this.calculateSize(local),
            sessionStorageSize: this.calculateSize(session)
        };
    }

    clearLocalStorage() {
        localStorage.clear();
        console.log('[DevConfig] LocalStorage cleared');
    }

    clearSessionStorage() {
        sessionStorage.clear();
        console.log('[DevConfig] SessionStorage cleared');
    }

    private readonly STORAGE_KEY_ROLE = 'dev_impersonated_role';
    private readonly STORAGE_KEY_GUARDS = 'dev_bypass_guards';
    private readonly STORAGE_KEY_FLAGS = 'dev_feature_flags';
    private readonly STORAGE_KEY_LOG_LEVEL = 'dev_log_level';

    getImpersonatedRole(): string | null {
        return localStorage.getItem(this.STORAGE_KEY_ROLE);
    }

    setImpersonatedRole(role: string | null) {
        if (role) {
            localStorage.setItem(this.STORAGE_KEY_ROLE, role);
        } else {
            localStorage.removeItem(this.STORAGE_KEY_ROLE);
        }
        window.location.reload();
    }

    shouldBypassGuards(): boolean {
        return localStorage.getItem(this.STORAGE_KEY_GUARDS) === 'true';
    }

    setBypassGuards(bypass: boolean) {
        localStorage.setItem(this.STORAGE_KEY_GUARDS, String(bypass));
    }

    // --- Feature Flags ---
    getFeatureFlags(): Record<string, boolean> {
        const stored = localStorage.getItem(this.STORAGE_KEY_FLAGS);
        const defaults = {
            enableHighFrequencyUpdates: false,
            showBetaFeatures: false,
            mockLatency: false,
            detailedTooltips: true
        };
        return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    }

    setFeatureFlag(key: string, value: boolean) {
        const current = this.getFeatureFlags();
        current[key] = value;
        localStorage.setItem(this.STORAGE_KEY_FLAGS, JSON.stringify(current));
    }

    // --- Log Level ---
    getLogLevel(): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
        return (localStorage.getItem(this.STORAGE_KEY_LOG_LEVEL) as any) || 'INFO';
    }

    setLogLevel(level: string) {
        localStorage.setItem(this.STORAGE_KEY_LOG_LEVEL, level);
        // In a real app, this would trigger a LoggerService update
        console.log(`[DevConfig] Log Level set to: ${level}`);
    }

    private calculateSize(obj: any): string {
        const str = JSON.stringify(obj);
        const bytes = new Blob([str]).size;
        return (bytes / 1024).toFixed(2) + ' KB';
    }
}
