/**
 * sw-sapien-client.ts
 * Helper client for SW Sapien PAC REST APIs (Auth, Timbrado V4, PDF Generation, Cancellation V2)
 */

import { db } from './shared';

export interface SwSapienConfig {
    apiUrl?: string;         // Default: https://services.sw.com.mx (or https://services.test.sw.com.mx)
    user?: string;
    password?: string;
    token?: string;          // Direct User Token if available
    rfcEmisor: string;       // Issuer RFC
    nombreEmisor: string;    // Issuer Legal Name
    regimenFiscalEmisor: string; // Issuer Tax System (e.g., '601')
    lugarExpedicion: string; // Issuer Zip Code
    isSandbox?: boolean;     // Default: false
}

export interface SwStampResult {
    success: boolean;
    uuid?: string;
    xml?: string;
    pdfBase64?: string;
    selloSAT?: string;
    noCertificadoSAT?: string;
    fechaTimbrado?: string;
    error?: string;
}

export interface SwCancelResult {
    success: boolean;
    ackXml?: string;
    uuid?: string;
    error?: string;
}

// In-memory token cache
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Reads SW Sapien integration credentials from config/integrations -> swsapien
 */
export async function getSwSapienConfig(): Promise<SwSapienConfig> {
    const doc = await db.collection('config').doc('integrations').get();
    const config = doc.data()?.swsapien as SwSapienConfig | undefined;

    if (!config) {
        throw new Error('SW Sapien PAC is not configured in Admin → Integrations.');
    }

    if (!config.rfcEmisor || !config.nombreEmisor || !config.lugarExpedicion) {
        throw new Error('SW Sapien configuration missing required fields (rfcEmisor, nombreEmisor, lugarExpedicion).');
    }

    return config;
}

/**
 * Gets a valid Authentication Bearer Token for SW Sapien APIs
 */
export async function getSwSapienToken(config: SwSapienConfig): Promise<string> {
    // If static token is supplied, use it
    if (config.token && config.token.trim().length > 0) {
        return config.token.trim();
    }

    // Return cached token if valid for at least another 5 minutes
    if (cachedToken && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
        return cachedToken;
    }

    if (!config.user || !config.password) {
        throw new Error('SW Sapien requires user & password or static token in configuration.');
    }

    const baseUrl = getBaseUrl(config);
    const authUrl = `${baseUrl}/security/authenticate`;

    const res = await fetch(authUrl, {
        method: 'POST',
        headers: {
            'user': config.user,
            'password': config.password
        }
    });

    const json = await res.json() as any;

    if (!res.ok || json.status === 'error' || !json.data?.token) {
        const errMsg = json.message || json.messageDetail || res.statusText;
        throw new Error(`SW Sapien Auth failed: ${errMsg}`);
    }

    const token = json.data.token as string;
    cachedToken = token;
    // Set token expiration (24 hours default in SW Sapien)
    tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;

    return token;
}

/**
 * Stamps a CFDI XML string using SW Sapien Timbrado V4 REST API
 */
export async function stampCfdiXml(xmlContent: string, config: SwSapienConfig): Promise<SwStampResult> {
    try {
        const token = await getSwSapienToken(config);
        const baseUrl = getBaseUrl(config);
        const stampUrl = `${baseUrl}/cfdi33/stamp/v4`;

        // SW Sapien accepts raw XML string in multipart/form-data or body
        const formData = new FormData();
        const blob = new Blob([xmlContent], { type: 'text/xml' });
        formData.append('xml', blob, 'cfdi.xml');

        const res = await fetch(stampUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const json = await res.json() as any;

        if (!res.ok || json.status === 'error' || !json.data?.cfdi) {
            const errMsg = json.messageDetail || json.message || 'Unknown stamping error from SW Sapien';
            return { success: false, error: errMsg };
        }

        const data = json.data;
        return {
            success: true,
            uuid: data.uuid,
            xml: data.cfdi,
            selloSAT: data.selloSAT,
            noCertificadoSAT: data.noCertificadoSAT,
            fechaTimbrado: data.fechaTimbrado
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'Network error connecting to SW Sapien PAC' };
    }
}

/**
 * Generates official PDF for a stamped CFDI XML using SW Sapien PDF Service
 */
export async function generateCfdiPdf(stampedXml: string, config: SwSapienConfig): Promise<string | null> {
    try {
        const token = await getSwSapienToken(config);
        const baseUrl = getBaseUrl(config);
        const pdfUrl = `${baseUrl}/pdf/v1/generate`;

        const res = await fetch(pdfUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                xmlContent: stampedXml,
                templateId: 'generic'
            })
        });

        const json = await res.json() as any;

        if (res.ok && json.status === 'success' && json.data?.contentB64) {
            return json.data.contentB64;
        }
        return null;
    } catch (err) {
        console.error('[SW-Sapien] PDF Generation warning:', err);
        return null;
    }
}

/**
 * Cancels a CFDI by UUID using SW Sapien Cancellation V2
 */
export async function cancelCfdiXml(
    uuid: string,
    motivo: string,
    uuidSustitucion: string | null,
    config: SwSapienConfig
): Promise<SwCancelResult> {
    try {
        const token = await getSwSapienToken(config);
        const baseUrl = getBaseUrl(config);
        const cancelUrl = `${baseUrl}/v2/cfdi33/cancel/csd`;

        const payload: any = {
            uuid,
            rfc: config.rfcEmisor,
            motivo: motivo || '02'
        };

        if (motivo === '01' && uuidSustitucion) {
            payload.uuidSustitucion = uuidSustitucion;
        }

        const res = await fetch(cancelUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const json = await res.json() as any;

        if (!res.ok || json.status === 'error') {
            const errMsg = json.messageDetail || json.message || 'Error cancelling CFDI with SW Sapien';
            return { success: false, error: errMsg };
        }

        return {
            success: true,
            uuid: json.data?.uuid || uuid,
            ackXml: json.data?.acustexml
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'Network error during CFDI cancellation' };
    }
}

function getBaseUrl(config: SwSapienConfig): string {
    if (config.apiUrl && config.apiUrl.trim().length > 0) {
        return config.apiUrl.trim().replace(/\/+$/, '');
    }
    return config.isSandbox
        ? 'https://services.test.sw.com.mx'
        : 'https://services.sw.com.mx';
}
