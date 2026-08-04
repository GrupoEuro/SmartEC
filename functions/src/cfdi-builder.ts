/**
 * cfdi-builder.ts
 * Builds valid CFDI 4.0 XML documents for Mexican fiscal compliance.
 */

export interface CfdiBuilderInput {
    serie?: string;
    folio?: string;
    fecha?: Date;
    formaPago?: string; // e.g. '01', '03', '04', '28', '99'
    metodoPago?: string; // 'PUE' or 'PPD'
    moneda?: string;
    lugarExpedicion: string; // Zip Code
    emisor: {
        rfc: string;
        nombre: string;
        regimenFiscal: string;
    };
    receptor: {
        rfc: string;
        nombre: string;
        domicilioFiscalReceptor: string; // Zip Code of customer
        regimenFiscalReceptor: string;  // e.g. '601', '612', '605', '626'
        usoCfdi: string;                // e.g. 'G01', 'G03', 'S01', 'CP01'
    };
    conceptos: Array<{
        claveProdServ?: string; // Default: '25172500' (Llantas/Auto parts)
        noIdentificacion?: string; // SKU
        cantidad: number;
        claveUnidad?: string; // Default: 'H87' (Pieza)
        unidad?: string;
        descripcion: string;
        valorUnitario: number;
    }>;
}

function escapeXml(unsafe: string): string {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function formatAmount(val: number): string {
    return val.toFixed(2);
}

function formatRate(val: number): string {
    return val.toFixed(6);
}

function formatIsoDate(d: Date): string {
    const pad = (n: number) => n < 10 ? '0' + n : '' + n;
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const mins = pad(d.getMinutes());
    const secs = pad(d.getSeconds());
    return `${year}-${month}-${day}T${hours}:${mins}:${secs}`;
}

export function buildCfdi40Xml(input: CfdiBuilderInput): string {
    const dateStr = formatIsoDate(input.fecha || new Date());
    const serie = input.serie ? `Serie="${escapeXml(input.serie)}"` : '';
    const folio = input.folio ? `Folio="${escapeXml(input.folio)}"` : '';
    const formaPago = escapeXml(input.formaPago || '99');
    const metodoPago = escapeXml(input.metodoPago || 'PUE');
    const moneda = escapeXml(input.moneda || 'MXN');

    let subtotal = 0;
    let totalIva = 0;

    // Calculate line items and taxes
    const conceptosXml = input.conceptos.map(item => {
        const qty = item.cantidad || 1;
        const unitPrice = item.valorUnitario || 0;
        const importe = qty * unitPrice;
        const baseIva = importe;
        const ivaItem = baseIva * 0.16;

        subtotal += importe;
        totalIva += ivaItem;

        const claveProdServ = escapeXml(item.claveProdServ || '25172500');
        const noIdentificacion = item.noIdentificacion ? `NoIdentificacion="${escapeXml(item.noIdentificacion)}"` : '';
        const claveUnidad = escapeXml(item.claveUnidad || 'H87');
        const unidad = item.unidad ? `Unidad="${escapeXml(item.unidad)}"` : 'Unidad="Pieza"';
        const descripcion = escapeXml(item.descripcion);

        return `    <cfdi:Concepto ClaveProdServ="${claveProdServ}" ${noIdentificacion} Cantidad="${qty}" ClaveUnidad="${claveUnidad}" ${unidad} Descripcion="${descripcion}" ValorUnitario="${formatAmount(unitPrice)}" Importe="${formatAmount(importe)}" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${formatAmount(baseIva)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${formatRate(0.16)}" Importe="${formatAmount(ivaItem)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>`;
    }).join('\n');

    const total = subtotal + totalIva;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" ${serie} ${folio} Fecha="${dateStr}" FormaPago="${formaPago}" SubTotal="${formatAmount(subtotal)}" Moneda="${moneda}" Total="${formatAmount(total)}" TipoDeComprobante="I" Exportacion="01" MetodoPago="${metodoPago}" LugarExpedicion="${escapeXml(input.lugarExpedicion)}">
  <cfdi:Emisor Rfc="${escapeXml(input.emisor.rfc)}" Nombre="${escapeXml(input.emisor.nombre)}" RegimenFiscal="${escapeXml(input.emisor.regimenFiscal)}"/>
  <cfdi:Receptor Rfc="${escapeXml(input.receptor.rfc)}" Nombre="${escapeXml(input.receptor.nombre)}" DomicilioFiscalReceptor="${escapeXml(input.receptor.domicilioFiscalReceptor)}" RegimenFiscalReceptor="${escapeXml(input.receptor.regimenFiscalReceptor)}" UsoCFDI="${escapeXml(input.receptor.usoCfdi)}"/>
  <cfdi:Conceptos>
${conceptosXml}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${formatAmount(totalIva)}">
    <cfdi:Traslados>
      <cfdi:Traslado Base="${formatAmount(subtotal)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${formatRate(0.16)}" Importe="${formatAmount(totalIva)}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;

    return xml;
}
