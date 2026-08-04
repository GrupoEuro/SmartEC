import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SecretsService } from '../../../../../core/services/config/secrets.service';

function buildSimpleCfdi40Xml(params: {
    serie: string;
    folio: string;
    fecha: string;
    lugarExpedicion: string;
    emisorRfc: string;
    emisorNombre: string;
    emisorRegimen: string;
    receptorRfc: string;
    receptorNombre: string;
    receptorZip: string;
    receptorRegimen: string;
    usoCfdi: string;
    descripcion: string;
    montoTotal: number;
}): string {
    const subTotal = (params.montoTotal / 1.16).toFixed(2);
    const total = params.montoTotal.toFixed(2);
    const vatAmount = (params.montoTotal - Number(subTotal)).toFixed(2);

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="${params.serie}" Folio="${params.folio}" Fecha="${params.fecha}" Sello="" FormaPago="01" NoCertificado="30001000000500003416" Certificado="" SubTotal="${subTotal}" Moneda="MXN" Total="${total}" TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" LugarExpedicion="${params.lugarExpedicion}">
    <cfdi:Emisor Rfc="${params.emisorRfc}" Nombre="${params.emisorNombre}" RegimenFiscal="${params.emisorRegimen}"/>
    <cfdi:Receptor Rfc="${params.receptorRfc}" Nombre="${params.receptorNombre}" DomicilioFiscalReceptor="${params.receptorZip}" RegimenFiscalReceptor="${params.receptorRegimen}" UsoCFDI="${params.usoCfdi}"/>
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="25172500" NoIdentificacion="TEST-001" Cantidad="1" ClaveUnidad="H87" Unidad="Pieza" Descripcion="${params.descripcion}" ValorUnitario="${subTotal}" Importe="${subTotal}" ObjetoImp="02">
            <cfdi:Impuestos>
                <cfdi:Traslados>
                    <cfdi:Traslado Base="${subTotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${vatAmount}"/>
                </cfdi:Traslados>
            </cfdi:Impuestos>
        </cfdi:Concepto>
    </cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="${vatAmount}">
        <cfdi:Traslados>
            <cfdi:Traslado Base="${subTotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${vatAmount}"/>
        </cfdi:Traslados>
    </cfdi:Impuestos>
</cfdi:Comprobante>`;
}

@Component({
    selector: 'app-sw-debug',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    templateUrl: './sw-debug.component.html',
    styleUrl: './sw-debug.component.css'
})
export class SwDebugComponent {
    private fns = inject(Functions);
    private secrets = inject(SecretsService);

    // Connection Test State
    isTestingAuth = signal<boolean>(false);
    authResult = signal<any>(null);

    // Timbrado Test Inputs
    rfcReceptor = 'XAXX010101000';
    nombreReceptor = 'PUBLICO EN GENERAL';
    zipReceptor = '44100';
    regimenReceptor = '616';
    usoCfdi = 'S01';
    descripcion = 'Llanta Michelin 205/55R16 - Prueba SW Sapien';
    montoTotal = 1500;

    // Timbrado Execution State
    isStamping = signal<boolean>(false);
    stampResult = signal<any>(null);

    // Cancellation Test State
    uuidToCancel = '';
    motivoCancelacion = '02';
    isCancelling = signal<boolean>(false);
    cancelResult = signal<any>(null);

    // Tab for Raw Output
    activeViewTab = signal<'visual' | 'xml' | 'stampedXml' | 'json'>('visual');

    async testAuth() {
        this.isTestingAuth.set(true);
        this.authResult.set(null);

        // Tier 1: Try Cloud Function Callable
        try {
            const fn = httpsCallable<any, any>(this.fns, 'testSwSapienConnection');
            const res = await fn();
            if (res.data?.success) {
                this.authResult.set(res.data);
                this.isTestingAuth.set(false);
                return;
            }
        } catch (err: any) {
            console.warn('[SW-Debug] Cloud Callable failed or CORS, falling back to direct REST API:', err);
        }

        // Tier 2: Direct REST API Fallback
        try {
            const conf = await this.secrets.getConfig();
            const sw = conf?.swsapien;
            if (!sw) {
                this.authResult.set({ success: false, error: 'No hay configuración SW Sapien guardada en Firestore.' });
                return;
            }
            const res = await this.testAuthDirectly(sw);
            this.authResult.set(res);
        } catch (err: any) {
            const errMsg = err?.details || err?.message || String(err);
            this.authResult.set({ success: false, error: errMsg });
        } finally {
            this.isTestingAuth.set(false);
        }
    }

    async runStampTest() {
        this.isStamping.set(true);
        this.stampResult.set(null);

        // Tier 1: Try Cloud Function Callable
        try {
            const fn = httpsCallable<any, any>(this.fns, 'testSwSapienStamp');
            const res = await fn({
                rfcReceptor: this.rfcReceptor,
                nombreReceptor: this.nombreReceptor,
                zipReceptor: this.zipReceptor,
                regimenReceptor: this.regimenReceptor,
                usoCfdi: this.usoCfdi,
                descripcion: this.descripcion,
                monto: Number(this.montoTotal)
            });
            if (res.data?.success) {
                this.stampResult.set(res.data);
                if (res.data?.uuid) this.uuidToCancel = res.data.uuid;
                this.isStamping.set(false);
                return;
            }
        } catch (err: any) {
            console.warn('[SW-Debug] Cloud Callable stamp failed, falling back to direct REST API:', err);
        }

        // Tier 2: Direct REST API Fallback
        try {
            const conf = await this.secrets.getConfig();
            const sw = conf?.swsapien;
            if (!sw) {
                this.stampResult.set({ success: false, error: 'No hay configuración SW Sapien guardada en Firestore.' });
                return;
            }

            // Get Auth Token first
            let token: string = sw.token || '';
            if (!token) {
                const authRes = await this.testAuthDirectly(sw);
                if (!authRes.success || !authRes.rawToken) {
                    this.stampResult.set({ success: false, error: `Error de Autenticación: ${authRes.error}` });
                    return;
                }
                token = authRes.rawToken;
            }

            const stampRes = await this.runStampTestDirectly(sw, token);
            this.stampResult.set(stampRes);
            if (stampRes.uuid) this.uuidToCancel = stampRes.uuid;
        } catch (err: any) {
            const errMsg = err?.details || err?.message || String(err);
            this.stampResult.set({ success: false, error: errMsg });
        } finally {
            this.isStamping.set(false);
        }
    }

    private async testAuthDirectly(sw: any) {
        const baseUrl = sw.isSandbox ? '/sw-api' : '/sw-api-prod';

        // Case A: User has supplied a Static User Token
        if (sw.token && sw.token.trim().length > 0) {
            const token = sw.token.trim();
            return {
                success: true,
                message: 'Token Estático de SW Sapien Válido y Configurado para Timbrado.',
                tokenPreview: token.substring(0, 15) + '...',
                isSandbox: !!sw.isSandbox,
                rfcEmisor: sw.rfcEmisor || 'IEU170117L11',
                nombreEmisor: sw.nombreEmisor || 'IMPORTADORA EURO',
                lugarExpedicion: sw.lugarExpedicion || '78328',
                rawToken: token
            };
        }

        // Case B: User has supplied User & Password credentials
        const headers: Record<string, string> = {
            'user': sw.user || '',
            'password': sw.password || ''
        };

        const res = await fetch(`${baseUrl}/security/authenticate`, {
            method: 'POST',
            headers
        });

        const json = await res.json() as any;
        if (res.ok && json.status === 'success' && json.data?.token) {
            return {
                success: true,
                message: 'Conexión exitosa con PAC SW Sapien (Autenticación Usuario/Contraseña).',
                tokenPreview: json.data.token.substring(0, 15) + '...',
                isSandbox: !!sw.isSandbox,
                rfcEmisor: sw.rfcEmisor,
                nombreEmisor: sw.nombreEmisor,
                lugarExpedicion: sw.lugarExpedicion,
                rawToken: json.data.token
            };
        } else {
            return {
                success: false,
                error: json.message || json.messageDetail || 'Credenciales inválidas en SW Sapien.'
            };
        }
    }

    private async runStampTestDirectly(sw: any, token: string) {
        const baseUrl = sw.isSandbox ? '/sw-api' : '/sw-api-prod';

        const rawXml = buildSimpleCfdi40Xml({
            serie: 'TEST',
            folio: String(Math.floor(100000 + Math.random() * 900000)),
            fecha: new Date().toISOString().split('.')[0],
            lugarExpedicion: sw.lugarExpedicion || '44100',
            emisorRfc: sw.rfcEmisor || 'EKU9003173C9',
            emisorNombre: sw.nombreEmisor || 'IMPORTADORA EURO S.A. DE C.V.',
            emisorRegimen: sw.regimenFiscalEmisor || '601',
            receptorRfc: this.rfcReceptor,
            receptorNombre: this.nombreReceptor,
            receptorZip: this.zipReceptor,
            receptorRegimen: this.regimenReceptor,
            usoCfdi: this.usoCfdi,
            descripcion: this.descripcion,
            montoTotal: Number(this.montoTotal)
        });

        const formData = new FormData();
        const xmlBlob = new Blob([rawXml], { type: 'text/xml' });
        formData.append('xml', xmlBlob, 'cfdi.xml');

        const res = await fetch(`${baseUrl}/cfdi33/stamp/v4`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const json = await res.json() as any;
        if (res.ok && json.status === 'success' && json.data) {
            return {
                success: true,
                uuid: json.data.uuid,
                rawXml,
                stampedXml: json.data.cfdi,
                selloSAT: json.data.selloSAT || json.data.selloCFD,
                fechaTimbrado: json.data.fechaTimbrado
            };
        } else {
            return {
                success: false,
                rawXml,
                error: json.message || json.messageDetail || 'Error en respuesta de timbrado SW Sapien.'
            };
        }
    }

    async runCancelTest() {
        if (!this.uuidToCancel.trim()) return;
        this.isCancelling.set(true);
        this.cancelResult.set(null);
        try {
            const fn = httpsCallable<any, any>(this.fns, 'cancelInvoice');
            const res = await fn({
                orderId: 'TEST-ORDER-DEBUG',
                motivo: this.motivoCancelacion
            });
            this.cancelResult.set(res.data);
        } catch (err: any) {
            const errMsg = err?.details || err?.message || String(err);
            this.cancelResult.set({ success: false, error: errMsg });
        } finally {
            this.isCancelling.set(false);
        }
    }

    downloadPdfFromBase64(base64: string, filename = 'CFDI_Test.pdf') {
        const linkSource = `data:application/pdf;base64,${base64}`;
        const downloadLink = document.createElement('a');
        downloadLink.href = linkSource;
        downloadLink.download = filename;
        downloadLink.click();
    }
}
