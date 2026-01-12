import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface GlossaryTerm {
    term: string;
    acronym?: string;
    definition: string;
    category: 'Procurement' | 'Warehouse' | 'Customs' | 'Mexico' | 'General';
    relatedTerms?: string[];
    example?: string;
}

@Component({
    selector: 'app-help-glossary',
    standalone: true,
    imports: [CommonModule, RouterLink, AppIconComponent],
    template: `
    <div class="h-full flex flex-col bg-zinc-950">
      <!-- Header -->
      <div class="bg-zinc-900/50 border-b border-zinc-800 px-6 py-6">
        <div class="max-w-6xl mx-auto">
          <a routerLink="/help" class="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-4 transition-colors">
            <app-icon name="arrow-left" [size]="16"></app-icon>
            Back to Help
          </a>
          <h1 class="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <app-icon name="book-open" [size]="32" class="text-emerald-400"></app-icon>
            Procurement & Warehouse Glossary
          </h1>
          <p class="text-zinc-400">Essential terms for Mexican tire import operations</p>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div class="bg-zinc-900/30 border-b border-zinc-800 px-6">
        <div class="max-w-6xl mx-auto flex gap-2 overflow-x-auto py-3">
          <button *ngFor="let cat of categories"
            (click)="selectedCategory = cat"
            [class]="selectedCategory === cat 
              ? 'px-4 py-2 bg-purple-600 text-white rounded-lg font-medium transition-all'
              : 'px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-all'">
            {{ cat }}
          </button>
        </div>
      </div>

      <!-- Glossary Terms -->
      <div class="flex-1 overflow-auto p-6">
        <div class="max-w-6xl mx-auto space-y-4">
          <div *ngFor="let term of filteredTerms" 
            class="bg-zinc-900/50 border border-zinc-800 hover:border-purple-500/50 rounded-xl p-6 transition-all">
            <div class="flex items-start justify-between mb-3">
              <div>
                <h3 class="text-2xl font-bold text-white flex items-center gap-3">
                  {{ term.term }}
                  <span *ngIf="term.acronym" class="text-sm px-3 py-1 bg-purple-900/30 text-purple-400 rounded-full border border-purple-500/30">
                    {{ term.acronym }}
                  </span>
                </h3>
              </div>
              <span class="px-3 py-1 text-xs font-bold rounded-full"
                [class]="getCategoryBadgeClass(term.category)">
                {{ term.category }}
              </span>
            </div>
            
            <p class="text-zinc-300 text-lg mb-4">{{ term.definition }}</p>
            
            <div *ngIf="term.example" class="bg-zinc-800/50 border-l-4 border-emerald-500 p-4 mb-4">
              <div class="text-xs font-bold text-emerald-400 uppercase mb-1">Example</div>
              <p class="text-zinc-300 text-sm">{{ term.example }}</p>
            </div>
            
            <div *ngIf="term.relatedTerms && term.relatedTerms.length > 0" class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-zinc-500">Related:</span>
              <span *ngFor="let related of term.relatedTerms" 
                class="text-xs px-2 py-1 bg-zinc-800 text-purple-400 rounded cursor-pointer hover:bg-zinc-700 transition-colors">
                {{ related }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
    styles: [`
    :host {
      display: block;
      height: 100%;
    }
  `]
})
export class HelpGlossaryComponent {
    selectedCategory: string = 'All';
    categories = ['All', 'Procurement', 'Warehouse', 'Customs', 'Mexico', 'General'];

    terms: GlossaryTerm[] = [
        {
            term: 'CFDI',
            acronym: 'Comprobante Fiscal Digital por Internet',
            definition: 'Mexican electronic invoice format mandated by SAT (tax authority). All commercial transactions in Mexico must use CFDI version 4.0 since 2023.',
            category: 'Mexico',
            relatedTerms: ['SAT', 'UUID', 'PAC'],
            example: 'When a Mexican supplier sends you an invoice, it comes as an XML file containing the CFDI with a unique UUID'
        },
        {
            term: 'UUID',
            acronym: 'Universally Unique Identifier',
            definition: 'Unique digital stamp (Folio Fiscal) assigned to each CFDI by an authorized PAC. Used for duplicate detection and tax verification.',
            category: 'Mexico',
            relatedTerms: ['CFDI', 'PAC'],
            example: '12345678-1234-1234-1234-123456789012'
        },
        {
            term: 'PAC',
            acronym: 'Proveedor Autorizado de Certificación',
            definition: 'Authorized Certification Provider in Mexico. Validates and certifies CFDIs, applying the digital stamp before transmitting to SAT.',
            category: 'Mexico',
            relatedTerms: ['CFDI', 'SAT', 'UUID']
        },
        {
            term: 'SAT',
            acronym: 'Servicio de Administración Tributaria',
            definition: 'Mexican tax authority that manages CFDI system, customs, and tax collection.',
            category: 'Mexico',
            relatedTerms: ['CFDI', 'Pedimento']
        },
        {
            term: 'ASN',
            acronym: 'Advance Shipping Notice',
            definition: 'Notification sent before shipment arrives, containing expected products, quantities, and delivery date. Allows warehouse to prepare space and staff.',
            category: 'Warehouse',
            relatedTerms: ['GRN', 'Purchase Order', 'Putaway'],
            example: 'ASN-20260111-001 shows 100 Michelin tires arriving tomorrow'
        },
        {
            term: 'GRN',
            acronym: 'Goods Receipt Note',
            definition: 'Document recording actual quantities received, quality inspection results, and discrepancies vs ASN/PO. Links to inventory update.',
            category: 'Warehouse',
            relatedTerms: ['ASN', 'Purchase Order', 'Putaway', '3-Way Match'],
            example: 'GRN-001: Expected 100 tires, Received 98 (2 damaged and rejected)'
        },
        {
            term: 'Putaway',
            definition: 'Process of moving received goods from receiving dock to assigned warehouse bin locations. Creates putaway tasks for staff.',
            category: 'Warehouse',
            relatedTerms: ['GRN', 'Bin Location', 'Warehouse'],
            example: 'Task: Move 50 Continental 205/55 from DOCK to Bin A1-L3-B2'
        },
        {
            term: 'Purchase Order',
            acronym: 'PO',
            definition: 'Document sent to supplier authorizing purchase of products at agreed prices and quantities. Forms basis of 3-way match.',
            category: 'Procurement',
            relatedTerms: ['ASN', 'GRN', 'Invoice', '3-Way Match'],
            example: 'PO-2026-001: Order 100 Michelin 205/55 at $1,200 MXN each'
        },
        {
            term: '3-Way Match',
            definition: 'Verification process comparing Purchase Order, Supplier Invoice, and Goods Receipt Note to ensure quantities and prices match before payment approval.',
            category: 'Procurement',
            relatedTerms: ['Purchase Order', 'Invoice', 'GRN'],
            example: 'PO says 100 units, Invoice charges for 100, GRN confirms 98 received → Flag discrepancy'
        },
        {
            term: 'Pedimento',
            definition: 'Mexican customs declaration form prepared by agente aduanal. Contains HS codes, duties, taxes, and shipment details for imported goods.',
            category: 'Customs',
            relatedTerms: ['Agente Aduanal', 'HS Code', 'IVA', 'Anti-Dumping Duty'],
            example: 'Pedimento #24 47 3456 1234567 for shipment from China'
        },
        {
            term: 'Agente Aduanal',
            definition: 'Licensed Mexican customs broker authorized to file import/export declarations. Mandatory for commercial imports into Mexico.',
            category: 'Customs',
            relatedTerms: ['Pedimento', 'SAT', 'Customs Clearance'],
            example: 'Agente Aduanal License #123 handles all China tire imports'
        },
        {
            term: 'HS Code',
            acronym: 'Harmonized System Code',
            definition: 'International product classification code determining import duties and regulations. Tires use codes 4011.10 to 4011.99.',
            category: 'Customs',
            relatedTerms: ['Pedimento', 'Customs Clearance'],
            example: '4011.10.01 - New pneumatic tires for passenger cars'
        },
        {
            term: 'Anti-Dumping Duty',
            definition: 'Additional import tax on products sold below fair market value. Mexico imposed 5-32% anti-dumping duties on Chinese tires in 2024.',
            category: 'Customs',
            relatedTerms: ['Pedimento', 'IVA', 'HS Code'],
            example: 'Chinese tire brand X pays 18% anti-dumping duty on top of regular 20% tariff'
        },
        {
            term: 'IVA',
            acronym: 'Impuesto al Valor Agregado',
            definition: 'Mexican Value Added Tax (VAT), generally 16%. Applied to imports and domestic sales.',
            category: 'Mexico',
            relatedTerms: ['CFDI', 'Pedimento'],
            example: 'Tire costs $1,000 MXN + 16% IVA = $1,160 MXN total'
        },
        {
            term: 'Incoterms',
            definition: 'International Commercial Terms defining responsibilities between buyer and seller for shipping, insurance, and risk transfer.',
            category: 'General',
            relatedTerms: ['FOB', 'CIF', 'DAP', 'DDP'],
            example: 'FOB Shanghai means buyer pays shipping from Shanghai port to Mexico'
        },
        {
            term: 'FOB',
            acronym: 'Free On Board',
            definition: 'Seller delivers goods on vessel, buyer pays shipping/insurance from port of origin.',
            category: 'General',
            relatedTerms: ['Incoterms', 'CIF'],
            example: 'FOB Shanghai: Supplier loads container, you pay ocean freight to Manzanillo'
        },
        {
            term: 'CIF',
            acronym: 'Cost, Insurance, and Freight',
            definition: 'Seller pays shipping and insurance to destination port, buyer handles import clearance.',
            category: 'General',
            relatedTerms: ['Incoterms', 'FOB']
        },
        {
            term: 'DAP',
            acronym: 'Delivered At Place',
            definition: 'Seller delivers to named destination, ready for unloading. Buyer handles import duties.',
            category: 'General',
            relatedTerms: ['Incoterms', 'DDP']
        },
        {
            term: 'DDP',
            acronym: 'Delivered Duty Paid',
            definition: 'Seller pays all costs including import duties. Goods delivered ready to use.',
            category: 'General',
            relatedTerms: ['Incoterms', 'DAP']
        },
        {
            term: 'Bin Location',
            definition: 'Specific warehouse storage position identified by code (e.g., A1-L3-B2 = Aisle 1, Level 3, Bay 2).',
            category: 'Warehouse',
            relatedTerms: ['Putaway', 'Warehouse'],
            example: 'Store Michelin 205/55 in bin A1-L3-B2'
        },
        {
            term: 'SKU',
            acronym: 'Stock Keeping Unit',
            definition: 'Unique identifier for each product variant in your inventory system.',
            category: 'General',
            relatedTerms: ['Product'],
            example: 'MICH-205-55-R16-91V'
        },
        {
            term: 'Kardex',
            definition: 'Inventory movement history showing all transactions (purchases, sales, adjustments) for a product.',
            category: 'Warehouse',
            relatedTerms: ['Inventory', 'SKU'],
            example: 'Kardex shows: Jan 1: +100 units (purchase), Jan 5: -20 units (sale)'
        }
    ];

    get filteredTerms(): GlossaryTerm[] {
        if (this.selectedCategory === 'All') {
            return this.terms;
        }
        return this.terms.filter(t => t.category === this.selectedCategory);
    }

    getCategoryBadgeClass(category: string): string {
        const classes: Record<string, string> = {
            'Procurement': 'bg-blue-900/30 text-blue-400 border border-blue-500/30',
            'Warehouse': 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/30',
            'Customs': 'bg-orange-900/30 text-orange-400 border border-orange-500/30',
            'Mexico': 'bg-red-900/30 text-red-400 border border-red-500/30',
            'General': 'bg-zinc-700 text-zinc-300 border border-zinc-600'
        };
        return classes[category] || classes['General'];
    }
}
