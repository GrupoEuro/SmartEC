"use strict";
/**
 * sw-sapien-client.ts
 * Helper client for SW Sapien PAC REST APIs (Auth, Timbrado V4, PDF Generation, Cancellation V2)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelCfdiXml = exports.generateCfdiPdf = exports.stampCfdiXml = exports.getSwSapienToken = exports.getSwSapienConfig = void 0;
const shared_1 = require("./shared");
// In-memory token cache
let cachedToken = null;
let tokenExpiresAt = 0;
/**
 * Reads SW Sapien integration credentials from config/integrations -> swsapien
 */
async function getSwSapienConfig() {
    var _a;
    const doc = await shared_1.db.collection('config').doc('integrations').get();
    const config = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.swsapien;
    if (!config) {
        throw new Error('SW Sapien PAC is not configured in Admin → Integrations.');
    }
    if (!config.rfcEmisor || !config.nombreEmisor || !config.lugarExpedicion) {
        throw new Error('SW Sapien configuration missing required fields (rfcEmisor, nombreEmisor, lugarExpedicion).');
    }
    return config;
}
exports.getSwSapienConfig = getSwSapienConfig;
/**
 * Gets a valid Authentication Bearer Token for SW Sapien APIs
 */
async function getSwSapienToken(config) {
    var _a;
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
    const json = await res.json();
    if (!res.ok || json.status === 'error' || !((_a = json.data) === null || _a === void 0 ? void 0 : _a.token)) {
        const errMsg = json.message || json.messageDetail || res.statusText;
        throw new Error(`SW Sapien Auth failed: ${errMsg}`);
    }
    const token = json.data.token;
    cachedToken = token;
    // Set token expiration (24 hours default in SW Sapien)
    tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    return token;
}
exports.getSwSapienToken = getSwSapienToken;
/**
 * Stamps a CFDI XML string using SW Sapien Timbrado V4 REST API
 */
async function stampCfdiXml(xmlContent, config) {
    var _a;
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
        const json = await res.json();
        if (!res.ok || json.status === 'error' || !((_a = json.data) === null || _a === void 0 ? void 0 : _a.cfdi)) {
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
    }
    catch (err) {
        return { success: false, error: err.message || 'Network error connecting to SW Sapien PAC' };
    }
}
exports.stampCfdiXml = stampCfdiXml;
/**
 * Generates official PDF for a stamped CFDI XML using SW Sapien PDF Service
 */
async function generateCfdiPdf(stampedXml, config) {
    var _a;
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
        const json = await res.json();
        if (res.ok && json.status === 'success' && ((_a = json.data) === null || _a === void 0 ? void 0 : _a.contentB64)) {
            return json.data.contentB64;
        }
        return null;
    }
    catch (err) {
        console.error('[SW-Sapien] PDF Generation warning:', err);
        return null;
    }
}
exports.generateCfdiPdf = generateCfdiPdf;
/**
 * Cancels a CFDI by UUID using SW Sapien Cancellation V2
 */
async function cancelCfdiXml(uuid, motivo, uuidSustitucion, config) {
    var _a, _b;
    try {
        const token = await getSwSapienToken(config);
        const baseUrl = getBaseUrl(config);
        const cancelUrl = `${baseUrl}/v2/cfdi33/cancel/csd`;
        const payload = {
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
        const json = await res.json();
        if (!res.ok || json.status === 'error') {
            const errMsg = json.messageDetail || json.message || 'Error cancelling CFDI with SW Sapien';
            return { success: false, error: errMsg };
        }
        return {
            success: true,
            uuid: ((_a = json.data) === null || _a === void 0 ? void 0 : _a.uuid) || uuid,
            ackXml: (_b = json.data) === null || _b === void 0 ? void 0 : _b.acustexml
        };
    }
    catch (err) {
        return { success: false, error: err.message || 'Network error during CFDI cancellation' };
    }
}
exports.cancelCfdiXml = cancelCfdiXml;
function getBaseUrl(config) {
    if (config.apiUrl && config.apiUrl.trim().length > 0) {
        return config.apiUrl.trim().replace(/\/+$/, '');
    }
    return config.isSandbox
        ? 'https://services.test.sw.com.mx'
        : 'https://services.sw.com.mx';
}
//# sourceMappingURL=sw-sapien-client.js.map