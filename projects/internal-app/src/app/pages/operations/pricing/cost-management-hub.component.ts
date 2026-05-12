import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PricingSignalContext } from './pricing-signal.context';

@Component({
  selector: 'app-cost-management-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-200 p-8">
      <div class="max-w-7xl mx-auto space-y-8">
        
        <!-- Header -->
        <header class="flex justify-between items-center border-b border-slate-800 pb-6">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Cost Management Hub
            </h1>
            <p class="text-slate-400 mt-1">Manage global cost ingestion, ETL uploads, and marketplace SKU mappings.</p>
          </div>
          <div class="flex gap-4">
            <a routerLink="/operations/pricing/anomalies" class="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors border border-slate-700">
              Pricing Anomalies
            </a>
            <a routerLink="/operations/pricing/grid" class="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors border border-purple-500/50 shadow-[0_0_15px_rgba(147,51,234,0.3)]">
              Smart Price Grid
            </a>
          </div>
        </header>

        <!-- Loading State -->
        <div *ngIf="ctx.isLoading()" class="flex items-center justify-center py-20">
          <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>

        <div *ngIf="!ctx.isLoading()">
          <!-- Tabs -->
          <div class="flex border-b border-slate-800 mb-6">
            <button 
              class="px-6 py-3 font-medium text-sm transition-colors border-b-2"
              [class.text-indigo-400]="activeTab() === 'mapping'"
              [class.border-indigo-500]="activeTab() === 'mapping'"
              [class.text-slate-400]="activeTab() !== 'mapping'"
              [class.border-transparent]="activeTab() !== 'mapping'"
              [class.hover:text-slate-300]="activeTab() !== 'mapping'"
              (click)="activeTab.set('mapping')"
            >
              Unmapped Listings ({{ orphanListings().length }})
            </button>
            <button 
              class="px-6 py-3 font-medium text-sm transition-colors border-b-2"
              [class.text-indigo-400]="activeTab() === 'etl'"
              [class.border-indigo-500]="activeTab() === 'etl'"
              [class.text-slate-400]="activeTab() !== 'etl'"
              [class.border-transparent]="activeTab() !== 'etl'"
              [class.hover:text-slate-300]="activeTab() !== 'etl'"
              (click)="activeTab.set('etl')"
            >
              Data Ingestion (ETL)
            </button>
          </div>

          <!-- Tab Content: Unmapped Listings -->
          <div *ngIf="activeTab() === 'mapping'" class="space-y-6">

            <!-- Channel Filters Bar -->
            <div class="flex overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl p-1.5 hide-scrollbar shadow-sm">
              <button *ngFor="let filter of availableFilters" 
                (click)="channelFilter.set(filter)"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                [ngClass]="channelFilter() === filter ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'">
                <!-- Filter Icons -->
                <svg *ngIf="filter === 'Todos'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                <svg *ngIf="filter === 'Tienda En Línea'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                <svg *ngIf="filter === 'Punto De Venta'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                <svg *ngIf="filter === 'Amazon MFN' || filter === 'Amazon FBA'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                <svg *ngIf="filter === 'MercadoLibre (Clásico)'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                <svg *ngIf="filter === 'MercadoLibre Full'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <svg *ngIf="filter === 'Venta Asistida (B2B)'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                
                {{ filter }}
              </button>
            </div>
            
            <div *ngIf="filteredOrphanListings().length === 0" class="bg-slate-900 border border-emerald-500/20 rounded-xl p-12 text-center shadow-[0_0_30px_rgba(16,185,129,0.03)]">
              <div class="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <h2 class="text-xl font-bold text-white mb-2">All {{ channelFilter() !== 'Todos' ? channelFilter() : '' }} Listings Mapped</h2>
              <p class="text-slate-400 max-w-md mx-auto">No unmapped orphans found for the current filter criteria.</p>
            </div>

            <div *ngIf="filteredOrphanListings().length > 0" class="grid grid-cols-1 gap-4">
              <div *ngFor="let orphan of filteredOrphanListings()" class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-6">
                
                <!-- Listing Header -->
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-3 mb-1">
                      <span class="px-2 py-0.5 bg-slate-800 text-slate-300 text-xs font-medium rounded border border-slate-700 uppercase">
                        {{ orphan.listings[0]?.channel_id || 'Marketplace' }} {{ orphan.listings[0]?.listing_type === 'Full' ? '(Full)' : '' }}
                      </span>
                      <span class="text-xs font-mono text-slate-400">{{ orphan.listings[0]?.id }}</span>
                    </div>
                    <h3 class="text-lg font-medium text-white truncate" [title]="orphan.title">{{ orphan.title }}</h3>
                    <p class="text-sm text-slate-400 mt-1">Marketplace SKU: <span class="font-mono text-slate-300">{{ orphan.sku }}</span></p>
                  </div>
                  
                  <!-- Mapping Mode Toggle -->
                  <div class="flex bg-slate-950 rounded-lg p-1 border border-slate-800 shrink-0">
                    <button 
                      (click)="setMappingMode(orphan.id, 'single')"
                      class="px-4 py-1.5 text-sm font-medium rounded-md transition-colors"
                      [ngClass]="getMappingMode(orphan.id) === 'single' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'">
                      Single SKU
                    </button>
                    <button 
                      (click)="setMappingMode(orphan.id, 'kit')"
                      class="px-4 py-1.5 text-sm font-medium rounded-md transition-colors"
                      [ngClass]="getMappingMode(orphan.id) === 'kit' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'">
                      Build Kit / Bundle
                    </button>
                  </div>
                </div>

                <hr class="border-slate-800">

                <!-- Mode: Single SKU Mapping -->
                <div *ngIf="getMappingMode(orphan.id) === 'single'" class="flex flex-col md:flex-row items-center gap-3 bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                  <div class="flex-1 w-full relative">
                    <select [(ngModel)]="selectedMappings[orphan.id]" class="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 appearance-none">
                      <option [ngValue]="undefined" disabled selected>Select Master SKU to Link...</option>
                      <option *ngFor="let mSku of realSkus()" [value]="mSku.sku">
                        {{ mSku.sku }} - {{ (mSku.title.length > 50) ? (mSku.title | slice:0:50) + '...' : mSku.title }}
                      </option>
                    </select>
                    <!-- Custom Arrow -->
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                  </div>
                  <button 
                    (click)="mapListing(orphan.listings[0]?.id, selectedMappings[orphan.id])"
                    [disabled]="!selectedMappings[orphan.id]"
                    class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors whitespace-nowrap w-full md:w-auto shadow-sm">
                    Link Master SKU
                  </button>
                </div>

                <!-- Mode: Kit / Bundle Builder -->
                <div *ngIf="getMappingMode(orphan.id) === 'kit'" class="space-y-4">
                  <div class="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-sm text-indigo-200 flex gap-2">
                    <svg class="w-5 h-5 flex-shrink-0 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <p>Map this listing to multiple components. The Pricing Engine will dynamically aggregate the Base Costs.</p>
                  </div>

                  <!-- Kit Components List -->
                  <div *ngIf="kitComponents[orphan.id]?.length" class="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                    <table class="w-full text-left text-sm">
                      <thead class="bg-slate-900 border-b border-slate-800 text-slate-400 text-xs">
                        <tr>
                          <th class="px-4 py-2 font-medium">Component SKU</th>
                          <th class="px-4 py-2 font-medium w-24 text-center">Qty</th>
                          <th class="px-4 py-2 font-medium w-16"></th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-800/50">
                        <tr *ngFor="let comp of kitComponents[orphan.id]; let i = index" class="hover:bg-slate-900/50">
                          <td class="px-4 py-2.5 font-mono text-slate-300">{{ comp.sku }}</td>
                          <td class="px-4 py-2.5 text-center font-medium">{{ comp.qty }}x</td>
                          <td class="px-4 py-2.5 text-right">
                            <button (click)="removeKitComponent(orphan.id, i)" class="text-rose-400 hover:text-rose-300 p-1">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- Add Component Row -->
                  <div class="flex gap-3">
                    <div class="flex-1 relative">
                      <select [(ngModel)]="newKitSku[orphan.id]" class="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 appearance-none">
                        <option [ngValue]="undefined" disabled selected>Add Component SKU...</option>
                        <option *ngFor="let mSku of realSkus()" [value]="mSku.sku">{{ mSku.sku }} - {{ (mSku.title.length > 40) ? (mSku.title | slice:0:40) + '...' : mSku.title }}</option>
                      </select>
                      <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                      </div>
                    </div>
                    <div class="w-24">
                      <input type="number" [(ngModel)]="newKitQty[orphan.id]" min="1" placeholder="Qty" class="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-center">
                    </div>
                    <button 
                      (click)="addKitComponent(orphan.id)"
                      [disabled]="!newKitSku[orphan.id]"
                      class="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors whitespace-nowrap border border-slate-700 shadow-sm">
                      Add
                    </button>
                  </div>

                  <div class="pt-4 flex justify-end">
                     <button 
                      (click)="saveKitMapping(orphan.listings[0]?.id, orphan.id)"
                      [disabled]="!kitComponents[orphan.id]?.length"
                      class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors whitespace-nowrap shadow-sm">
                      Save Kit Mapping
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <!-- Tab Content: Data Ingestion (ETL) -->
          <div *ngIf="activeTab() === 'etl'" class="max-w-4xl mx-auto space-y-8">
            <div class="mb-6">
              <h2 class="text-xl font-bold text-white flex items-center gap-3">
                Data Ingestion (ETL)
                <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20 uppercase tracking-wider">Cloud Storage Trigger</span>
              </h2>
              <p class="text-slate-400 mt-1">Upload supplier CFDI 4.0 XMLs or bulk Excel files to automatically update base costs.</p>
            </div>
            
            <!-- Drag & Drop Zone -->
            <div 
              class="border-2 border-dashed border-slate-700 rounded-2xl p-12 text-center transition-colors relative overflow-hidden"
              [ngClass]="isDragging() ? 'bg-indigo-900/20 border-indigo-500' : 'bg-slate-900 hover:bg-slate-800/80 hover:border-slate-600'"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave($event)"
              (drop)="onDrop($event)"
            >
              <div *ngIf="uploadStatus() === 'idle'" class="space-y-4">
                <div class="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
                  <svg class="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                </div>
                <h3 class="text-xl font-semibold text-white">Drag & Drop Files Here</h3>
                <p class="text-slate-400 max-w-sm mx-auto">Supports .xlsx, .csv, and CFDI 4.0 .xml files. The import will process in the background.</p>
                <div class="pt-4">
                  <button class="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg transition-colors border border-slate-700 text-sm shadow-sm relative overflow-hidden">
                    <input type="file" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept=".xml,.csv,.xlsx" (change)="onFileSelected($event)" />
                    Browse Files
                  </button>
                </div>
              </div>

              <!-- Uploading State -->
              <div *ngIf="uploadStatus() === 'uploading'" class="space-y-6 py-4">
                <div class="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <div>
                  <h3 class="text-lg font-semibold text-white">Uploading to Cloud Storage...</h3>
                  <p class="text-slate-400 mt-1 text-sm">{{ selectedFile()?.name }}</p>
                </div>
                <div class="max-w-md mx-auto bg-slate-950 rounded-full h-2.5 border border-slate-800 overflow-hidden">
                  <div class="bg-indigo-500 h-2.5 rounded-full transition-all duration-300" [style.width.%]="uploadProgress()"></div>
                </div>
              </div>

              <!-- Processing / Completed State -->
              <div *ngIf="uploadStatus() === 'processing'" class="space-y-4 py-4">
                <div class="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                  <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <h3 class="text-xl font-semibold text-white">Upload Complete!</h3>
                <p class="text-slate-400 max-w-sm mx-auto text-sm">The Cloud Function 'processPricingUpload' is now analyzing the file in the background. Pricing Engine will update Master SKUs shortly.</p>
                <div class="pt-4">
                  <button (click)="resetUpload()" class="px-5 py-2 text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                    Upload another file
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CostManagementHubComponent implements OnInit {
  ctx = inject(PricingSignalContext);
  activeTab = signal<'mapping' | 'etl'>('mapping');

  // Filters State
  availableFilters = [
    'Todos', 'Tienda En Línea', 'Punto De Venta', 
    'Amazon MFN', 'Amazon FBA', 'MercadoLibre (Clásico)', 
    'MercadoLibre Full', 'Venta Asistida (B2B)'
  ];
  channelFilter = signal<string>('Todos');

  // ETL State
  isDragging = signal(false);
  uploadStatus = signal<'idle' | 'uploading' | 'processing'>('idle');
  uploadProgress = signal(0);
  selectedFile = signal<File | null>(null);

  // Single Mapping State
  selectedMappings: Record<string, string> = {};

  // Kit Mapping State
  mappingModes: Record<string, 'single' | 'kit'> = {};
  kitComponents: Record<string, {sku: string, qty: number}[]> = {};
  newKitSku: Record<string, string> = {};
  newKitQty: Record<string, number> = {};

  orphanListings = computed(() => {
    return this.ctx.masterSkus().filter(s => s.id.startsWith('orphan-'));
  });

  filteredOrphanListings = computed(() => {
    const orphans = this.orphanListings();
    const filter = this.channelFilter();
    if (filter === 'Todos') return orphans;
    
    return orphans.filter(o => {
      const list = o.listings[0];
      if (!list) return false;
      
      switch (filter) {
        case 'Tienda En Línea': return list.channel_id === 'Tienda Web';
        case 'Punto De Venta': return list.channel_id === 'POS';
        case 'Amazon MFN': return list.channel_id === 'Amazon' && list.listing_type === 'MFN';
        case 'Amazon FBA': return list.channel_id === 'Amazon' && list.listing_type === 'FBA';
        case 'MercadoLibre (Clásico)': return list.channel_id === 'Mercado Libre' && list.listing_type === 'Classic';
        case 'MercadoLibre Full': return list.channel_id === 'Mercado Libre' && list.listing_type === 'Full';
        case 'Venta Asistida (B2B)': return list.channel_id === 'B2B';
        default: return true;
      }
    });
  });

  realSkus = computed(() => {
    return this.ctx.masterSkus()
      .filter(s => !s.id.startsWith('orphan-'))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  });

  ngOnInit() {
    this.ctx.loadInitialData();
  }

  // --- Mapping Methods ---
  getMappingMode(orphanId: string) {
     return this.mappingModes[orphanId] || 'single';
  }

  setMappingMode(orphanId: string, mode: 'single' | 'kit') {
     this.mappingModes[orphanId] = mode;
     if (mode === 'kit' && !this.kitComponents[orphanId]) {
        this.kitComponents[orphanId] = [];
        this.newKitQty[orphanId] = 1;
     }
  }

  async mapListing(listingId: string | undefined, targetSku: string | undefined) {
    if (!listingId || !targetSku) return;
    try {
      await this.ctx.mapListingToSku(listingId, targetSku);
    } catch (e) {
      alert('Error mapping listing.');
    }
  }

  // --- Kit Builder Methods ---
  addKitComponent(orphanId: string) {
     const sku = this.newKitSku[orphanId];
     const qty = this.newKitQty[orphanId] || 1;
     if (!sku) return;
     
     this.kitComponents[orphanId].push({ sku, qty });
     // Reset
     this.newKitSku[orphanId] = undefined as any;
     this.newKitQty[orphanId] = 1;
  }
  
  removeKitComponent(orphanId: string, index: number) {
     this.kitComponents[orphanId].splice(index, 1);
  }

  async saveKitMapping(listingId: string | undefined, orphanId: string) {
     if (!listingId) return;
     const comps = this.kitComponents[orphanId];
     if (!comps || comps.length === 0) return;
     
     try {
       await this.ctx.mapListingToBundle(listingId, comps);
     } catch (e) {
       alert('Error saving kit mapping.');
     }
  }

  // --- ETL Methods ---
  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    if (event.dataTransfer?.files?.length) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  onFileSelected(event: any) {
    if (event.target.files?.length) {
      this.handleFile(event.target.files[0]);
    }
  }

  private handleFile(file: File) {
    this.selectedFile.set(file);
    this.simulateUpload();
  }

  private simulateUpload() {
    this.uploadStatus.set('uploading');
    this.uploadProgress.set(0);
    
    const interval = setInterval(() => {
      this.uploadProgress.update(p => {
        if (p >= 100) {
          clearInterval(interval);
          this.uploadStatus.set('processing');
          return 100;
        }
        return p + 20;
      });
    }, 400);
  }

  resetUpload() {
    this.uploadStatus.set('idle');
    this.uploadProgress.set(0);
    this.selectedFile.set(null);
  }
}
