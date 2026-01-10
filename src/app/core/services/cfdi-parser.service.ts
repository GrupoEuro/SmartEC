import { Injectable } from '@angular/core';

export interface CfdiData {
    uuid: string; // Folio Fiscal
    invoiceNumber: string; // Internal Serie/Folio
    date: Date;
    supplierRfc: string;
    supplierName: string;
    currency: string;
    exchangeRate: number;
    subtotal: number;
    taxTotal: number;
    total: number;
    items: CfdiItem[];
}

export interface CfdiItem {
    sku: string; // NoIdentificacion
    description: string; // Descripcion
    quantity: number; // Cantidad
    unitPrice: number; // ValorUnitario
    totalAmount: number; // Importe
    satCode: string; // ClaveProdServ
    unitCode: string; // ClaveUnidad
}

@Injectable({
    providedIn: 'root'
})
export class CfdiParserService {

    constructor() { }

    /**
     * Parses a CFDI XML string and returns structured data.
     * Supports CFDI 3.3 and 4.0
     */
    parse(xmlContent: string): CfdiData {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

        // Handle parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror');
        if (parserError.length > 0) {
            throw new Error('Invalid XML format');
        }

        // Function to get attribute from node (ignoring namespaces in tag names if needed, 
        // but attributes are standard. using getAttribute is safe).
        // Note: Tag names in CFDI usually have 'cfdi:' prefix.

        // Root: Comprobante
        let comprobante = xmlDoc.getElementsByTagName('cfdi:Comprobante')[0];
        if (!comprobante) {
            // Try without namespace if prefix is missing or different
            comprobante = xmlDoc.getElementsByTagName('Comprobante')[0];
        }

        if (!comprobante) {
            throw new Error('Missing cfdi:Comprobante node. Is this a valid CFDI?');
        }

        // 1. Metadata
        const serie = comprobante.getAttribute('Serie') || '';
        const folio = comprobante.getAttribute('Folio') || '';
        const invoiceNumber = (serie + ' ' + folio).trim();

        const dateStr = comprobante.getAttribute('Fecha') || '';
        const date = new Date(dateStr);

        const subtotal = parseFloat(comprobante.getAttribute('SubTotal') || '0');
        const total = parseFloat(comprobante.getAttribute('Total') || '0');
        const currency = comprobante.getAttribute('Moneda') || 'MXN';
        const exchangeRate = parseFloat(comprobante.getAttribute('TipoCambio') || '1');

        // 2. Issuer (Emisor)
        let emisor = xmlDoc.getElementsByTagName('cfdi:Emisor')[0];
        if (!emisor) emisor = xmlDoc.getElementsByTagName('Emisor')[0];

        const supplierRfc = emisor ? (emisor.getAttribute('Rfc') || '') : '';
        const supplierName = emisor ? (emisor.getAttribute('Nombre') || '') : '';

        // 3. UUID (TimbreFiscalDigital)
        // This is usually in a namespace 'tfd:TimbreFiscalDigital' inside 'cfdi:Complemento'
        let timbre = xmlDoc.getElementsByTagName('tfd:TimbreFiscalDigital')[0];
        if (!timbre) {
            // Search by standard tag name ignoring prefix if TFD namespace varies
            const complements = xmlDoc.getElementsByTagName('cfdi:Complemento');
            if (complements.length > 0) {
                for (let i = 0; i < complements.length; i++) {
                    const children = complements[i].children;
                    for (let j = 0; j < children.length; j++) {
                        if (children[j].localName === 'TimbreFiscalDigital') {
                            timbre = children[j] as Element;
                            break;
                        }
                    }
                }
            }
        }

        const uuid = timbre ? (timbre.getAttribute('UUID') || '') : '';

        // 4. Taxes (Impuestos - Total)
        // CFDI 4.0 usually has a global Impuestos node at the end
        let impuestos = undefined;
        const allImpuestos = xmlDoc.getElementsByTagName('cfdi:Impuestos');
        // We want the one that is a direct child of Comprobante, not Concepto
        for (let i = 0; i < allImpuestos.length; i++) {
            if (allImpuestos[i].parentNode === comprobante) {
                impuestos = allImpuestos[i];
                break;
            }
        }

        let taxTotal = 0;
        if (impuestos) {
            const trasladados = impuestos.getAttribute('TotalImpuestosTrasladados');
            if (trasladados) {
                taxTotal += parseFloat(trasladados);
            }
        } else {
            // Fallback: Calculate from Total - SubTotal (rough estimate, risky with retentions)
            // Better to leave as difference if not found
            if (total > subtotal) {
                taxTotal = total - subtotal;
            }
        }

        // 5. Line Items (Conceptos)
        const items: CfdiItem[] = [];
        const conceptos = xmlDoc.getElementsByTagName('cfdi:Concepto');

        for (let i = 0; i < conceptos.length; i++) {
            const c = conceptos[i];
            const sku = c.getAttribute('NoIdentificacion') || '';
            const description = c.getAttribute('Descripcion') || '';
            const quantity = parseFloat(c.getAttribute('Cantidad') || '0');
            const unitPrice = parseFloat(c.getAttribute('ValorUnitario') || '0');
            const totalAmount = parseFloat(c.getAttribute('Importe') || '0');
            const satCode = c.getAttribute('ClaveProdServ') || '';
            const unitCode = c.getAttribute('ClaveUnidad') || '';

            items.push({
                sku,
                description,
                quantity,
                unitPrice,
                totalAmount,
                satCode,
                unitCode
            });
        }

        return {
            uuid,
            invoiceNumber,
            date,
            supplierRfc,
            supplierName,
            currency,
            exchangeRate,
            subtotal,
            taxTotal,
            total,
            items
        };
    }
}
