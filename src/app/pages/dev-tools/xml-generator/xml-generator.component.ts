import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import * as FileSaver from 'file-saver';
import * as XLSX from 'xlsx';

@Component({
    selector: 'app-xml-generator',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="p-8">
      <div class="glass-panel max-w-2xl mx-auto">
        <h2 class="text-2xl font-bold mb-6 flex items-center gap-3">
            <app-icon name="file-text" class="text-yellow-400"></app-icon>
            Document Generator (Dev Tool)
        </h2>

        <p class="text-gray-400 mb-8">
            Generates randomized documents to test Procurement Import.
            <br>
            <strong>XML:</strong> Mexican CFDI 4.0 (for Local Suppliers).
            <br>
            <strong>Excel:</strong> Praxis Packing List (for International/China Suppliers).
        </p>

        <div class="flex flex-col gap-6">
            <div class="control-panel flex-col md:flex-row gap-4">
                <div class="flex flex-col gap-2">
                   <label class="block text-sm font-medium text-gray-400">Items Count Range</label>
                   <div class="flex items-center gap-2">
                        <input type="number" [(ngModel)]="minItems" class="input-dark">
                        <span class="text-gray-500">to</span>
                        <input type="number" [(ngModel)]="maxItems" class="input-dark">
                   </div>
                </div>
                
                <div class="flex flex-col gap-2 w-full md:w-auto">
                     <button (click)="generate()" class="btn-generate">
                        <app-icon name="code" [size]="20"></app-icon>
                        Generate Random XML
                    </button>
                    <button (click)="generateInternational()" class="btn-generate bg-emerald-600 hover:bg-emerald-500 text-white">
                        <app-icon name="table" [size]="20"></app-icon>
                        Generate Praxis Doc
                    </button>
                </div>
            </div>

            <div *ngIf="lastGenerated" class="success-panel animate-fade-in">
                <h4 class="text-emerald-400 font-bold mb-2 flex items-center gap-2">
                    <app-icon name="check" [size]="16"></app-icon> Generated Successfully!
                </h4>
                <div class="text-sm text-gray-300 space-y-1">
                    <p><span class="text-gray-500">Type:</span> {{ lastGenerated.type }}</p>
                    <p><span class="text-gray-500">UUID/File:</span> {{ lastGenerated.uuid }}</p>
                    <p><span class="text-gray-500">Supplier:</span> {{ lastGenerated.supplier }}</p>
                    <p><span class="text-gray-500">Items:</span> {{ lastGenerated.items }}</p>
                    <p><span class="text-gray-500">Total:</span> {{ lastGenerated.total | currency: lastGenerated.currency }}</p>
                </div>
            </div>
        </div>
      </div>
    </div>
  `,
    styles: [`
    .glass-panel {
        background: rgba(30, 41, 59, 0.7);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 2rem;
    }
    .control-panel {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        background-color: #1e293b; /* slate-800 */
        border-radius: 0.5rem;
        border: 1px solid #334155; /* slate-700 */
    }
    .input-dark {
        background-color: #000;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        width: 4rem;
        text-align: center;
        border: 1px solid #475569; /* slate-600 */
    }
    .btn-generate {
        background-color: #eab308; /* yellow-500 */
        color: black;
        font-weight: 700;
        padding: 0.75rem 1.5rem;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .btn-generate:hover {
        background-color: #facc15; /* yellow-400 */
        transform: scale(1.05);
    }
    .success-panel {
        padding: 1rem;
        background-color: rgba(6, 78, 59, 0.2); /* emerald-900/20 */
        border: 1px solid rgba(16, 185, 129, 0.3); /* emerald-500/30 */
        border-radius: 0.5rem;
    }
  `]
})
export class XmlGeneratorComponent {
    minItems = 3;
    maxItems = 8;
    lastGenerated: any = null;
    nextIsCsv = false; // Start with Excel

    suppliers = [
        { name: 'MICHELIN MEXICO SERVICES SA DE CV', rfc: 'MME950614A12' },
        { name: 'PIRELLI NEUMATICOS SA DE CV', rfc: 'PNE990525N81' },
        { name: 'CONTINENTAL TIRE DE MEXICO', rfc: 'CTM990521H34' },
        { name: 'BRIDGESTONE DE MEXICO SA DE CV', rfc: 'BME930301G45' }
    ];

    products = [
        { sku: 'MICH-2055516-P4', desc: 'LLANTA 205/55R16 91V PRIMACY 4', basePrice: 2100 },
        { sku: 'PIR-2254517-P7', desc: 'LLANTA 225/45R17 91W CINTURATO P7', basePrice: 2350 },
        { sku: 'CONTI-1956515-UC6', desc: 'LLANTA 195/65R15 91V ULTRACONTACT UC6', basePrice: 1800 },
        { sku: 'BS-2454019-S001', desc: 'LLANTA 245/40R19 98Y POTENZA S001', basePrice: 4500 },
        { sku: 'MICH-2656517-LTX', desc: 'LLANTA 265/65R17 112T LTX FORCE', basePrice: 3800 },
        { sku: 'PIR-2155517-P1', desc: 'LLANTA 215/55R17 94V CINTURATO P1', basePrice: 2200 },
        { sku: 'CONTI-2356018-CX3', desc: 'LLANTA 235/60R18 103V CROSSCONTACT LX25', basePrice: 3100 },
        { sku: 'BS-2755520-ALZ', desc: 'LLANTA 275/55R20 113T DUELER A/T 693', basePrice: 4200 }
    ];

    generate() {
        const supplier = this.suppliers[Math.floor(Math.random() * this.suppliers.length)];
        const uuid = crypto.randomUUID();
        const itemCount = Math.floor(Math.random() * (this.maxItems - this.minItems + 1)) + this.minItems;

        let subtotal = 0;
        let taxTotal = 0;
        let xmlItems = '';

        for (let i = 0; i < itemCount; i++) {
            const prod = this.products[Math.floor(Math.random() * this.products.length)];
            const qty = Math.floor(Math.random() * 20) + 1; // 1-20
            const price = Math.round(prod.basePrice * (0.9 + Math.random() * 0.2)); // +/- 10%
            const amount = price * qty;
            const tax = amount * 0.16;

            subtotal += amount;
            taxTotal += tax;

            xmlItems += `
            <cfdi:Concepto 
                ClaveProdServ="25172504" 
                NoIdentificacion="${prod.sku}" 
                Cantidad="${qty}" 
                ClaveUnidad="H87" 
                Descripcion="${prod.desc}" 
                ValorUnitario="${price.toFixed(2)}" 
                Importe="${amount.toFixed(2)}">
                 <cfdi:Impuestos>
                    <cfdi:Traslados>
                        <cfdi:Traslado Base="${amount.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${tax.toFixed(2)}"/>
                    </cfdi:Traslados>
                </cfdi:Impuestos>
            </cfdi:Concepto>`;
        }

        const total = subtotal + taxTotal;
        const date = new Date().toISOString().split('.')[0]; // YYYY-MM-DDThh:mm:ss

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante 
    xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    Version="4.0" 
    Serie="A" 
    Folio="${Math.floor(Math.random() * 10000)}" 
    Fecha="${date}" 
    SubTotal="${subtotal.toFixed(2)}" 
    Moneda="MXN" 
    Total="${total.toFixed(2)}" 
    TipoDeComprobante="I" 
    MetodoPago="PUE" 
    LugarExpedicion="64000">
    <cfdi:Emisor Rfc="${supplier.rfc}" Nombre="${supplier.name}" RegimenFiscal="601"/>
    <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" UsoCFDI="S01" DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="616"/>
    <cfdi:Conceptos>
        ${xmlItems}
    </cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="${taxTotal.toFixed(2)}">
        <cfdi:Traslados>
            <cfdi:Traslado Base="${subtotal.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${taxTotal.toFixed(2)}"/>
        </cfdi:Traslados>
    </cfdi:Impuestos>
    <cfdi:Complemento>
        <tfd:TimbreFiscalDigital 
            xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" 
            UUID="${uuid}" 
            FechaTimbrado="${date}" 
            RfcProvCertif="SAT970701NN3" 
            NoCertificadoSAT="00001000000504465028" 
            SelloSAT="dummy"/>
    </cfdi:Complemento>
</cfdi:Comprobante>`;

        const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
        FileSaver.saveAs(blob, `CFDI_${supplier.name.split(' ')[0]}_${Math.floor(Math.random() * 1000)}.xml`);

        this.lastGenerated = {
            type: 'XML (CFDI)',
            uuid,
            supplier: supplier.name,
            items: itemCount,
            total,
            currency: 'MXN'
        };
    }

    generateInternational() {
        // Praxis is International, so USD
        const supplierName = 'PRAXIS INTERNATIONAL LTD';
        const itemCount = Math.floor(Math.random() * (this.maxItems - this.minItems + 1)) + this.minItems;
        const data = [];
        let total = 0;

        for (let i = 0; i < itemCount; i++) {
            const prod = this.products[Math.floor(Math.random() * this.products.length)];
            const qty = Math.floor(Math.random() * 100) + 10;
            const price = Math.round(prod.basePrice / 20 * (0.9 + Math.random() * 0.2)); // USD price approx /20 MXN
            const lineTotal = qty * price;
            total += lineTotal;

            data.push({
                'SKU': prod.sku,
                'Description': prod.desc,
                'Quantity': qty,
                'Unit Price': price,
                'Total': lineTotal
            });
        }

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Packing List");

        // Toggle Format
        const isCsv = this.nextIsCsv;
        this.nextIsCsv = !this.nextIsCsv; // Flip for next time

        const ext = isCsv ? '.csv' : '.xlsx';
        const typeLabel = isCsv ? 'CSV (Packing List)' : 'Excel (Packing List)';

        const fileName = `Pending_PackingList_${Math.floor(Math.random() * 1000)}${ext}`;
        XLSX.writeFile(wb, fileName);

        this.lastGenerated = {
            type: typeLabel,
            uuid: fileName,
            supplier: supplierName,
            items: itemCount,
            total,
            currency: 'USD'
        };
    }
}
