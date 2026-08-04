import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SapSyncService, SapEndpointResult } from '../../../../../core/services/sap-sync.service';

export interface SapEndpointDoc {
    path: string;
    method: 'GET' | 'POST';
    desc: string;
    params?: string;
}

@Component({
    selector: 'app-sap-debug',
    standalone: true,
    imports: [CommonModule, FormsModule, JsonPipe, RouterLink],
    templateUrl: './sap-debug.component.html',
    styleUrls: ['./sap-debug.component.css']
})
export class SapDebugComponent implements OnInit {
    private sapService = inject(SapSyncService);

    sapHost = 'apib2c.grupoeuro.com.mx';
    sapPort = '40405';
    apiKey = 'fe141323-78b8-435d-b105-b0f645353d92';
    testPostingDate = '2026-06-15';

    setSampleDate(dateStr: string) {
        this.testPostingDate = dateStr;
    }

    sapConnected = signal(false);
    sapToken = signal<string | null>(null);
    isLoading = signal(false);
    activeAction = signal<string | null>(null);
    errorMessage = signal<string | null>(null);
    lastResult = signal<SapEndpointResult | null>(null);
    showRawResponse = signal(false);

    get isLocalProxyActive(): boolean {
        return this.sapService.isLocal;
    }

    get sapBaseUrl(): string {
        return this.sapService.getSapRequestUrl('', this.sapHost, this.sapPort);
    }

    sapEndpoints: SapEndpointDoc[] = [
        { path: 'Auth/Test', method: 'GET', desc: 'Verificar conectividad básica del servicio (GET)' },
        { path: 'Auth/Login', method: 'POST', desc: 'Autenticación con API key (POST)', params: 'Body: { "key": "<api-key>" }' },
        { path: 'Catalogos/Articulos', method: 'GET', desc: 'Catálogo de artículos (GET)', params: 'tamPagina, numPagina, ultimaActualizacion (AAAA-MM-DD)' },
        { path: 'Catalogos/Inventario', method: 'GET', desc: 'Stock por almacén y lote (GET)', params: 'tamPagina, numPagina, codigoArticulo, codigoAlmacen' },
        { path: 'MktDocs/Factura', method: 'POST', desc: 'Crear factura en SAP (POST)', params: 'Body: Factura (JSON)' },
        { path: 'Catalogos/Articulos', method: 'POST', desc: 'Catálogo de artículos (POST - Compatibilidad)', params: 'Body: { tamPagina, numPagina }' },
        { path: 'Catalogos/Inventario', method: 'POST', desc: 'Stock por almacén y lote (POST - Compatibilidad)', params: 'Body: { tamPagina, numPagina }' }
    ];

    ngOnInit() {
        this.testSapConnection();
    }

    async testSapConnection() {
        this.isLoading.set(true);
        this.activeAction.set('Auth/Test');
        this.errorMessage.set(null);
        try {
            const res = await this.sapService.testConnection(this.sapHost, this.sapPort);
            this.lastResult.set(res);
            if (res.ok) {
                this.sapConnected.set(true);
            } else {
                this.sapConnected.set(false);
                this.errorMessage.set(res.error || `HTTP ${res.status}: Respuesta inesperada del servicio SAP.`);
            }
        } catch (err: any) {
            this.sapConnected.set(false);
            this.errorMessage.set(err.message || 'Error de conexión con servicio SAP Business One.');
        } finally {
            this.isLoading.set(false);
            this.activeAction.set(null);
        }
    }

    async sapLogin() {
        this.isLoading.set(true);
        this.activeAction.set('Auth/Login');
        this.errorMessage.set(null);
        try {
            const token = await this.sapService.login(this.apiKey, this.sapHost, this.sapPort);
            this.sapToken.set(token);
            this.sapConnected.set(true);
            this.lastResult.set({
                ok: true,
                endpoint: 'Auth/Login',
                status: 200,
                time: 120,
                timestamp: new Date().toISOString(),
                requestMethod: 'POST',
                requestUrl: this.sapService.getSapRequestUrl('Auth/Login', this.sapHost, this.sapPort),
                requestHeaders: { 'Content-Type': 'application/json' },
                contentType: 'application/json',
                body: JSON.stringify({ success: true, tokenPreview: token.substring(0, 25) + '...' }, null, 2)
            });
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Error al autenticar con SAP B1.');
            this.lastResult.set({
                ok: false,
                endpoint: 'Auth/Login',
                status: 401,
                time: 0,
                timestamp: new Date().toISOString(),
                requestMethod: 'POST',
                requestUrl: this.sapService.getSapRequestUrl('Auth/Login', this.sapHost, this.sapPort),
                error: err.message
            });
        } finally {
            this.isLoading.set(false);
            this.activeAction.set(null);
        }
    }

    async testSapEndpoint(endpoint: string, method: 'GET' | 'POST') {
        this.isLoading.set(true);
        this.activeAction.set(`${method} ${endpoint}`);
        this.errorMessage.set(null);
        try {
            let token = this.sapToken();
            if (!token) {
                token = await this.sapService.login(this.apiKey, this.sapHost, this.sapPort);
                this.sapToken.set(token);
            }

            let body: any = undefined;
            if (method === 'POST') {
                if (endpoint === 'MktDocs/Factura') {
                    const selectedDate = this.testPostingDate || "2026-06-15";

                    body = {
                        idEcom: `TEST-ECOM-${Date.now()}`,
                        rfc: "XAXX010101000",
                        rfcCliente: "XAXX010101000",
                        nombreCliente: "PUBLICO EN GENERAL / CLIENTE MOSTRADOR",
                        razonSocial: "PUBLICO EN GENERAL / CLIENTE MOSTRADOR",
                        fechaContable: selectedDate,
                        fechaDocumento: selectedDate,
                        fechaVencimiento: selectedDate,
                        fechaTimbrado: new Date().toISOString(),
                        usoCfdi: "S01",
                        regimenFiscalReceptor: "616",
                        domicilioFiscalReceptor: "44100",
                        codigoPostalReceptor: "44100",
                        subtotal: 1000,
                        total: 1160,
                        moneda: "MXN",
                        formaPago: "03",
                        metodoPago: "PUE",
                        pago_CuentaContable: "100-001-0004",
                        xmlBase64: "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48Y2ZkaTpDb21wcm9iYW50ZSB4bWxuczpjZmRpPSJodHRwOi8vd3d3LnNhdC5nb2IubXgvY2ZkaS80IiAvPg==",
                        direcciones: [
                            {
                                tipoDireccion: "E",
                                calle: "Av. Salvador Nava",
                                numeroExterior: "704",
                                numeroInterior: "13",
                                colonia: "Polanco",
                                ciudad: "Guadalajara",
                                cp: "44330",
                                estado: "JAL"
                            }
                        ],
                        lineas: [
                            {
                                codigoArticulo: "998251",
                                codigoAlmacen: "CON01",
                                precioUnitario: 1000,
                                proyecto: "2",
                                centroCosto: "OP",
                                sat_claveProdServ: "25172506",
                                sat_claveUnidad: "H87",
                                lotes: [
                                    {
                                        lote: "26  81  3503  6002954",
                                        cantidad: 1
                                    }
                                ]
                            }
                        ]
                    };
                } else {
                    body = { tamPagina: 10, numPagina: 1 };
                }
            }

            const targetUrl = method === 'GET' && endpoint.includes('Catalogos') ? `${endpoint}?tamPagina=10&numPagina=1` : endpoint;

            const res = await this.sapService.testEndpoint(
                targetUrl,
                method,
                token,
                body,
                this.sapHost,
                this.sapPort
            );

            this.lastResult.set(res);
            if (!res.ok) {
                this.errorMessage.set(res.error || `Error ${res.status} al consultar ${endpoint}`);
            }
        } catch (err: any) {
            this.errorMessage.set(err.message || `Error al ejecutar ${method} ${endpoint}`);
        } finally {
            this.isLoading.set(false);
            this.activeAction.set(null);
        }
    }
}
