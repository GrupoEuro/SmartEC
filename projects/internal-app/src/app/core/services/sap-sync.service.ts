import { Injectable, inject } from '@angular/core';
import { Firestore, doc, collection, getDocs, setDoc, writeBatch, serverTimestamp } from '@angular/fire/firestore';

export interface SapConfig {
    host?: string;
    port?: string;
    apiKey?: string;
    isLocalProxyActive?: boolean;
}

export interface SapEndpointResult {
    ok: boolean;
    endpoint: string;
    status: number;
    time: number;
    timestamp: string;
    requestMethod?: string;
    requestUrl?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: any;
    contentType?: string;
    body?: string;
    json?: any;
    error?: string;
}

@Injectable({ providedIn: 'root' })
export class SapSyncService {
    private fs = inject(Firestore);

    private getCatalogDocId(sku: string): string {
        return sku.replace(/\//g, '__');
    }

    private getInventoryDocId(sku: string): string {
        return sku.replace(/\//g, '-').replace(/\s+/g, '_');
    }

    private detectBrand(name: string): string {
        if (!name) return 'PRAXIS';
        const upper = name.toUpperCase();

        if (
            upper.includes('MICHELIN') || upper.includes('CITY GRIP') || upper.includes('CITYGRIP') ||
            upper.includes('STARCROSS') || upper.includes('PILOT') || upper.includes('PIL.') ||
            upper.includes('TRACKER') || upper.includes('SCORCHER') || upper.includes('CITY EXTRA') ||
            upper.includes('COMMANDER') || upper.includes('ANAKEE') || upper.includes('ROAD5') ||
            upper.includes('ROAD6') || upper.includes('POWER5') || upper.includes('POWER6')
        ) return 'MICHELIN';

        if (
            upper.includes('PIRELLI') || upper.includes('DIABLO') || upper.includes('ANGEL') ||
            upper.includes('SUPERCORSA') || upper.includes('SCORPION') || upper.includes('NIGHT DRAGON')
        ) return 'PIRELLI';

        if (upper.includes('BRIDGESTONE') || upper.includes('BATTLAX') || upper.includes('EXEDRA')) return 'BRIDGESTONE';
        if (upper.includes('CONTINENTAL') || upper.includes('CONTI')) return 'CONTINENTAL';
        if (upper.includes('DUNLOP') || upper.includes('GEOMAX') || upper.includes('ROADSMART')) return 'DUNLOP';
        if (upper.includes('METZELER') || upper.includes('ROADTEC') || upper.includes('SPORTEC')) return 'METZELER';
        if (upper.includes('MAXXIS')) return 'MAXXIS';
        if (upper.includes('SHINKO')) return 'SHINKO';

        return 'PRAXIS';
    }

    public get isLocal(): boolean {
        return typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    }

    public getSapRequestUrl(endpoint: string, host = 'apib2c.grupoeuro.com.mx', port = '40405'): string {
        const cleanEndpoint = endpoint.replace(/^\/+/, '');
        if (this.isLocal) {
            return `/sap-api/${cleanEndpoint}`;
        }
        return `https://${host}:${port}/${cleanEndpoint}`;
    }

    async testConnection(host = 'apib2c.grupoeuro.com.mx', port = '40405'): Promise<SapEndpointResult> {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        const url = this.getSapRequestUrl('Auth/Test', host, port);
        const headers = { 'Accept': 'application/json' };
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(10000)
            });
            const time = Date.now() - startTime;
            const text = await res.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { /* noop */ }

            return {
                ok: res.ok,
                endpoint: 'Auth/Test',
                status: res.status,
                time,
                timestamp,
                requestMethod: 'GET',
                requestUrl: url,
                requestHeaders: headers,
                contentType: res.headers.get('content-type') || 'application/json',
                body: text,
                json
            };
        } catch (err: any) {
            return {
                ok: false,
                endpoint: 'Auth/Test',
                status: 0,
                time: Date.now() - startTime,
                timestamp,
                requestMethod: 'GET',
                requestUrl: url,
                requestHeaders: headers,
                error: err.message || 'Error de conexión con SAP B1'
            };
        }
    }

    async login(apiKey = 'fe141323-78b8-435d-b105-b0f645353d92', host = 'apib2c.grupoeuro.com.mx', port = '40405'): Promise<string> {
        const url = this.getSapRequestUrl('Auth/Login', host, port);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ key: apiKey.trim() }),
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: Autenticación fallida con SAP B1`);
        const json = await res.json() as any;
        if (!json.success || !json.data?.token) {
            throw new Error(json.message || 'Login con SAP B1 fallido');
        }
        return json.data.token;
    }

    async testEndpoint(
        endpoint: string,
        method: 'GET' | 'POST',
        token?: string,
        body?: any,
        host = 'apib2c.grupoeuro.com.mx',
        port = '40405'
    ): Promise<SapEndpointResult> {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        const url = this.getSapRequestUrl(endpoint, host, port);
        const headers: Record<string, string> = {
            'Accept': 'application/json'
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        if (body) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const res = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(20000)
            });

            const time = Date.now() - startTime;
            const text = await res.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { /* noop */ }

            return {
                ok: res.ok,
                endpoint,
                status: res.status,
                time,
                timestamp,
                requestMethod: method,
                requestUrl: url,
                requestHeaders: headers,
                requestBody: body,
                contentType: res.headers.get('content-type') || 'application/json',
                body: text,
                json
            };
        } catch (err: any) {
            return {
                ok: false,
                endpoint,
                status: 0,
                time: Date.now() - startTime,
                timestamp,
                requestMethod: method,
                requestUrl: url,
                requestHeaders: headers,
                requestBody: body,
                error: err.message || `Error de red al consultar ${endpoint}`
            };
        }
    }
}
