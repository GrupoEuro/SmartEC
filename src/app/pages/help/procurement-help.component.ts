import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface HelpArticle {
    id: string;
    title: string;
    category: 'Procurement' | 'Warehouse' | 'Operations';
    description: string;
    icon: string;
    route: string;
}

@Component({
    selector: 'app-procurement-help',
    standalone: true,
    imports: [CommonModule, RouterLink, AppIconComponent],
    template: `
    <div class="h-full flex flex-col bg-zinc-950">
      <!-- Header -->
      <div class="bg-zinc-900/50 border-b border-zinc-800 px-6 py-6">
        <h1 class="text-3xl font-bold text-white mb-2">📚 Procurement & Warehouse Guide</h1>
        <p class="text-zinc-400">Complete documentation for Mexican tire import operations</p>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto p-6">
        <div class="max-w-6xl mx-auto space-y-8">
          
          <!-- Quick Start -->
          <section class="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-xl p-6">
            <h2 class="text-2xl font-bold text-white mb-4 flex items-center gap-3">
              <app-icon name="zap" [size]="28" class="text-yellow-400"></app-icon>
              Quick Start Guide
            </h2>
            <p class="text-zinc-300 mb-4">
              This system handles the complete flow from purchasing inventory to storing it in your warehouse.
            </p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="bg-zinc-900/50 rounded-lg p-4 border border-zinc-700">
                <div class="text-3xl mb-2">1️⃣</div>
                <h3 class="font-bold text-white mb-1">Import Invoice</h3>
                <p class="text-sm text-zinc-400">Upload CFDI XML (Mexico) or CSV/Excel (International)</p>
              </div>
              <div class="bg-zinc-900/50 rounded-lg p-4 border border-zinc-700">
                <div class="text-3xl mb-2">2️⃣</div>
                <h3 class="font-bold text-white mb-1">Receive Goods</h3>
                <p class="text-sm text-zinc-400">Click "Receive Order" to generate ASN & GRN</p>
              </div>
              <div class="bg-zinc-900/50 rounded-lg p-4 border border-zinc-700">
                <div class="text-3xl mb-2">3️⃣</div>
                <h3 class="font-bold text-white mb-1">Assign Locations</h3>
                <p class="text-sm text-zinc-400">Complete putaway tasks to update inventory</p>
              </div>
            </div>
          </section>

          <!-- Articles Grid -->
          <section>
            <h2 class="text-2xl font-bold text-white mb-6">📖 Documentation</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div *ngFor="let article of articles" 
                class="bg-zinc-900/50 border border-zinc-800 hover:border-purple-500 rounded-xl p-6 transition-all group cursor-pointer">
                <div class="flex items-start gap-4 mb-4">
                  <div class="w-12 h-12 rounded-lg bg-purple-900/30 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-500/30 transition-colors">
                    <app-icon [name]="article.icon" [size]="24" class="text-purple-400"></app-icon>
                  </div>
                  <div class="flex-1">
                    <h3 class="font-bold text-white text-lg mb-1">{{ article.title }}</h3>
                    <span class="text-xs px-2 py-1 bg-zinc-800 text-zinc-400 rounded-full">{{ article.category }}</span>
                  </div>
                </div>
                <p class="text-zinc-400 text-sm mb-4">{{ article.description }}</p>
                <div class="text-purple-400 text-sm font-medium flex items-center gap-2">
                  Read Article 
                  <app-icon name="arrow-right" [size]="16"></app-icon>
                </div>
              </div>
            </div>
          </section>

          <!-- Glossary Preview -->
          <section class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 class="text-2xl font-bold text-white mb-4 flex items-center gap-3">
              <app-icon name="book-open" [size]="24" class="text-emerald-400"></app-icon>
              Key Terms Glossary
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div *ngFor="let term of glossaryPreview" class="border-l-2 border-purple-500 pl-4">
                <h4 class="font-bold text-white mb-1">{{ term.term }}</h4>
                <p class="text-sm text-zinc-400">{{ term.definition }}</p>
              </div>
            </div>
            <a routerLink="/help/glossary" class="inline-flex items-center gap-2 mt-6 text-purple-400 hover:text-purple-300 transition-colors">
              View Full Glossary
              <app-icon name="external-link" [size]="16"></app-icon>
            </a>
          </section>

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
export class ProcurementHelpComponent {
    articles: HelpArticle[] = [
        {
            id: 'cfdi-import',
            title: 'CFDI XML Import',
            category: 'Procurement',
            description: 'How to import Mexican CFDI invoices (Comprobante Fiscal Digital)',
            icon: 'file-text',
            route: '/help/articles/cfdi-import'
        },
        {
            id: 'international-import',
            title: 'International Invoices',
            category: 'Procurement',
            description: 'Import CSV/Excel from international suppliers and customs brokers',
            icon: 'globe',
            route: '/help/articles/international-import'
        },
        {
            id: 'asn-workflow',
            title: 'ASN & Receiving',
            category: 'Warehouse',
            description: 'Understanding Advance Shipping Notices and goods receipt process',
            icon: 'truck',
            route: '/help/articles/asn-workflow'
        },
        {
            id: 'grn-process',
            title: 'Goods Receipt Notes',
            category: 'Warehouse',
            description: 'How GRNs track actual received quantities vs expected',
            icon: 'clipboard-check',
            route: '/help/articles/grn-process'
        },
        {
            id: 'putaway-guide',
            title: 'Putaway Operations',
            category: 'Warehouse',
            description: 'Assign bin locations and update inventory after receiving',
            icon: 'package',
            route: '/help/articles/putaway-guide'
        },
        {
            id: 'customs-broker',
            title: 'Customs Broker Integration',
            category: 'Procurement',
            description: 'Working with agentes aduanales and Pedimento tracking',
            icon: 'shield',
            route: '/help/articles/customs-broker'
        }
    ];

    glossaryPreview = [
        {
            term: 'CFDI',
            definition: 'Comprobante Fiscal Digital por Internet - Mexican electronic invoice format required by SAT'
        },
        {
            term: 'ASN',
            definition: 'Advance Shipping Notice - Notification of incoming shipment with expected quantities'
        },
        {
            term: 'GRN',
            definition: 'Goods Receipt Note - Document recording actual quantities received and quality status'
        },
        {
            term: 'Pedimento',
            definition: 'Mexican customs declaration form prepared by agente aduanal for imports'
        }
    ];
}
