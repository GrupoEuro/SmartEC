import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class DevConfigService {
    private platformId = inject(PLATFORM_ID);

    constructor() { }

    getEnvironment() {
        return environment;
    }

    getStorageSummary() {
        if (!isPlatformBrowser(this.platformId)) return {
            localStorageCount: 0, sessionStorageCount: 0, localStorageSize: '0 KB', sessionStorageSize: '0 KB'
        };
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
        if (!isPlatformBrowser(this.platformId)) return;
        localStorage.clear();
        console.log('[DevConfig] LocalStorage cleared');
    }

    clearSessionStorage() {
        if (!isPlatformBrowser(this.platformId)) return;
        sessionStorage.clear();
        console.log('[DevConfig] SessionStorage cleared');
    }

    private readonly STORAGE_KEY_ROLE = 'dev_impersonated_role';
    private readonly STORAGE_KEY_GUARDS = 'dev_bypass_guards';
    private readonly STORAGE_KEY_FLAGS = 'dev_feature_flags';
    private readonly STORAGE_KEY_LOG_LEVEL = 'dev_log_level';

    getImpersonatedRole(): string | null {
        if (!isPlatformBrowser(this.platformId)) return null;
        return localStorage.getItem(this.STORAGE_KEY_ROLE);
    }

    setImpersonatedRole(role: string | null) {
        if (!isPlatformBrowser(this.platformId)) return;
        if (role) {
            localStorage.setItem(this.STORAGE_KEY_ROLE, role);
        } else {
            localStorage.removeItem(this.STORAGE_KEY_ROLE);
        }
        window.location.reload();
    }

    shouldBypassGuards(): boolean {
        if (!isPlatformBrowser(this.platformId)) return false;
        return localStorage.getItem(this.STORAGE_KEY_GUARDS) === 'true';
    }

    setBypassGuards(bypass: boolean) {
        if (!isPlatformBrowser(this.platformId)) return;
        localStorage.setItem(this.STORAGE_KEY_GUARDS, String(bypass));
    }

    // --- Feature Flags ---
    getFeatureFlags(): Record<string, boolean> {
        const defaults = {
            enableHighFrequencyUpdates: false,
            showBetaFeatures: false,
            mockLatency: false,
            detailedTooltips: true
        };
        if (!isPlatformBrowser(this.platformId)) return defaults;

        const stored = localStorage.getItem(this.STORAGE_KEY_FLAGS);
        return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    }

    setFeatureFlag(key: string, value: boolean) {
        if (!isPlatformBrowser(this.platformId)) return;
        const current = this.getFeatureFlags();
        current[key] = value;
        localStorage.setItem(this.STORAGE_KEY_FLAGS, JSON.stringify(current));
    }

    // --- Log Level ---
    getLogLevel(): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
        if (!isPlatformBrowser(this.platformId)) return 'INFO';
        return (localStorage.getItem(this.STORAGE_KEY_LOG_LEVEL) as any) || 'INFO';
    }

    setLogLevel(level: string) {
        if (!isPlatformBrowser(this.platformId)) return;
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
