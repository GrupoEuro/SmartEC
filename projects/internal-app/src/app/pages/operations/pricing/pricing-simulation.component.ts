import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PricingSignalContext, MasterSku, ChannelListing } from './pricing-signal.context';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pricing-simulation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-200 p-6 lg:p-8 flex flex-col h-screen">
      <!-- Header -->
      <header class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 shrink-0">
        <div class="flex items-center gap-4">
          <a routerLink="/operations/pricing/anomalies" class="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </a>
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Simulation Sandbox
              <span class="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold border border-indigo-500/20 uppercase tracking-wider">What-If Mode</span>
            </h1>
          </div>
        </div>
        <button (click)="saveSimulation()" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
          Save Scenario
        </button>
      </header>

      <!-- Command Bar (3 Rows) -->
      <div class="flex flex-col gap-4 mb-6 shrink-0">
        
        <!-- Row 1: Channels Segmented Control -->
        <div class="flex p-1 bg-slate-900/80 border border-slate-800 rounded-lg overflow-x-auto hide-scrollbar shadow-sm w-max max-w-full">
          <button *ngFor="let tab of channelTabs" 
                  (click)="selectedChannel.set(tab.id); resetPage()"
                  [ngClass]="selectedChannel() === tab.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'"
                  class="px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all flex items-center gap-1.5">
            <span [innerHTML]="tab.icon"></span>
            {{ tab.label }}
          </button>
        </div>
        
        <!-- Row 2: Search -->
        <div class="relative w-full">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <input type="text" [ngModel]="searchQuery()" (ngModelChange)="setSearch($event)"
                 placeholder="Search SKU or Title..." 
                 class="block w-full pl-10 pr-3 py-2.5 border border-slate-700 rounded-lg bg-slate-900 text-sm placeholder-slate-500 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors shadow-sm">
        </div>

        <!-- Row 3: Global Overrides -->
        <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row gap-6 items-start md:items-center shadow-inner">
          <div class="flex items-center gap-2 w-32 shrink-0">
            <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            <h3 class="text-xs font-bold text-slate-300 tracking-wider uppercase">Overrides</h3>
          </div>
          
          <div class="flex flex-wrap items-center gap-6 flex-1">
            <!-- Commission -->
            <div class="flex items-center gap-2">
              <label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-20">Comm. Hike</label>
              <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
                <button (click)="commissionBump.set(commissionBump() - 1)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">-</button>
                <div class="w-12 text-center font-mono text-xs font-bold text-indigo-400">
                  {{ commissionBump() > 0 ? '+' : '' }}{{ commissionBump() }}%
                </div>
                <button (click)="commissionBump.set(commissionBump() + 1)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">+</button>
              </div>
            </div>
            
            <!-- Shipping -->
            <div class="flex items-center gap-2">
              <label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-20">Ship. Hike</label>
              <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
                <button (click)="shippingBump.set(shippingBump() - 10)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">-</button>
                <div class="w-12 text-center font-mono text-xs font-bold text-indigo-400">
                  +{{ shippingBump() }}
                </div>
                <button (click)="shippingBump.set(shippingBump() + 10)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">+</button>
              </div>
            </div>

            <!-- Discount -->
            <div class="flex items-center gap-2">
              <label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-16">Discount</label>
              <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
                <button (click)="discountBump.set(discountBump() - 1)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">-</button>
                <div class="w-12 text-center font-mono text-xs font-bold text-rose-400">
                  -{{ discountBump() }}%
                </div>
                <button (click)="discountBump.set(discountBump() + 1)" class="w-6 h-6 flex items-center justify-center bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-xs">+</button>
              </div>
            </div>
          </div>
          
          <button (click)="resetSimulation()" title="Reset Variables" class="p-2 bg-slate-950 hover:bg-rose-900/30 text-slate-500 hover:text-rose-400 rounded-lg border border-slate-800 hover:border-rose-900/50 transition-colors shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          </button>
        </div>
      </div>

      <!-- Data Grid Container -->
      <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col min-h-0">
        <div class="overflow-auto flex-1 relative">
          <table class="w-full text-left border-collapse min-w-[1000px] table-fixed">
            <thead class="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 shadow-sm">
              <tr>
                <th class="p-4 w-[5%] text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">#</th>
                <th class="p-4 w-[35%] text-xs font-semibold text-slate-500 uppercase tracking-wider">Product & Channel</th>
                <th class="p-4 w-[12%] text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Base Cost</th>
                <th class="p-4 w-[12%] text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Floor Price</th>
                <th class="p-4 w-[10%] text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Live Price</th>
                <th class="p-4 w-[14%] text-xs font-bold text-indigo-400 uppercase tracking-wider text-right bg-indigo-500/10 border-b-2 border-indigo-500/50">Simulated Price</th>
                <th class="p-4 w-[12%] text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Margin Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/50">
              <ng-container *ngFor="let sku of paginatedSkus(); let i = index">
                <tr *ngFor="let list of sku.listings; let first = first" class="hover:bg-slate-800/30 transition-colors group">
                  <!-- Row Index -->
                  <td class="p-4 text-center text-xs text-slate-600 font-mono">
                    <span *ngIf="first">{{ (currentPage() - 1) * pageSize() + i + 1 }}</span>
                  </td>
                  
                  <!-- Product Title & SKU & Channel -->
                  <td class="p-4">
                    <div *ngIf="first" class="mb-1">
                      <div class="flex items-center gap-2 mb-1">
                        <span *ngIf="sku.is_bundle" class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 text-[10px] font-bold uppercase tracking-wider">Combo</span>
                        <div class="font-bold text-slate-200 truncate max-w-sm" [title]="sku.title">{{ sku.title }}</div>
                      </div>
                      <div class="text-xs font-mono text-slate-500 mt-0.5">{{ sku.sku }}</div>
                      <div *ngIf="sku.is_bundle && sku.components?.length" class="mt-2 pl-2 border-l-2 border-slate-700">
                        <div *ngFor="let comp of sku.components" class="text-[10px] text-slate-400 font-mono">
                          {{ comp.qty }}x {{ comp.sku }}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 mt-2" [ngClass]="{'mt-0': !first}">
                      <span class="w-2 h-2 rounded-full" 
                            [ngClass]="{
                              'bg-indigo-500': list.listing_type === 'Web',
                              'bg-yellow-500': list.listing_type === 'Full' || list.listing_type === 'Classic',
                              'bg-orange-500': list.listing_type === 'FBA'
                            }"></span>
                      <span class="text-sm font-medium text-slate-300">{{ list.channel_id }}</span>
                      <span class="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 uppercase tracking-wide">{{ list.listing_type }}</span>
                    </div>
                  </td>
                  
                  <!-- Cost & Prices -->
                  <td class="p-4 text-right font-mono text-sm">
                    <span *ngIf="sku.base_cost > 0" class="text-slate-400">{{ sku.base_cost | currency:'MXN' }}</span>
                    <span *ngIf="!sku.base_cost" class="px-2 py-0.5 rounded bg-slate-800 text-slate-500 text-xs uppercase tracking-wider border border-slate-700">No Cost</span>
                  </td>
                  <td class="p-4 text-right font-mono text-sm">
                    <span *ngIf="list.calculated_floor_price > 0" class="text-emerald-500/80">{{ list.calculated_floor_price | currency:'MXN' }}</span>
                    <span *ngIf="!list.calculated_floor_price || list.calculated_floor_price === 0" class="text-slate-600">-</span>
                  </td>
                  <td class="p-4 text-right text-slate-300 font-mono text-sm group-hover:text-white transition-colors">
                    {{ list.current_list_price | currency:'MXN' }}
                  </td>
                  
                  <!-- Simulated Price -->
                  <td class="p-4 text-right font-mono text-sm font-semibold bg-indigo-500/5 relative">
                    <!-- Glassmorphism Left Border -->
                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-500/20"></div>
                    
                    <ng-container *ngIf="getSimulatedPrice(sku, list) !== null; else noSim">
                      <div [ngClass]="getSimulatedPrice(sku, list)! < list.calculated_floor_price ? 'text-rose-400' : 'text-indigo-400'">
                        {{ getSimulatedPrice(sku, list) | currency:'MXN' }}
                      </div>
                      
                      <!-- Diff Indicator -->
                      <div *ngIf="getSimulatedPrice(sku, list)! !== list.current_list_price" class="text-[10px] mt-1 font-bold"
                           [ngClass]="getSimulatedPrice(sku, list)! > list.current_list_price ? 'text-emerald-500' : 'text-rose-500'">
                        {{ getSimulatedPrice(sku, list)! > list.current_list_price ? '↑' : '↓' }} 
                        {{ Math.abs(getSimulatedPrice(sku, list)! - list.current_list_price) | currency:'MXN' }}
                      </div>
                    </ng-container>
                    <ng-template #noSim>
                      <span class="text-slate-600 font-normal text-xs uppercase">No Baseline</span>
                    </ng-template>
                  </td>
                  
                  <!-- Margin Status -->
                  <td class="p-4 text-center">
                    <ng-container *ngIf="getSimulatedPrice(sku, list) !== null; else noMargin">
                      <span *ngIf="getSimulatedPrice(sku, list)! >= list.calculated_floor_price" 
                            class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                        HEALTHY
                      </span>
                      <span *ngIf="getSimulatedPrice(sku, list)! < list.calculated_floor_price" 
                            class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)] animate-pulse">
                        LOSS
                      </span>
                    </ng-container>
                    <ng-template #noMargin>
                      <span class="text-slate-600">-</span>
                    </ng-template>
                  </td>
                </tr>
              </ng-container>
              
              <!-- Empty States -->
              <tr *ngIf="paginatedSkus().length === 0 && !ctx.isLoading()">
                <td colspan="7" class="p-16 text-center">
                  <div class="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700 text-slate-500">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                  </div>
                  <h3 class="text-lg font-medium text-slate-300 mb-1">No items found</h3>
                  <p class="text-slate-500 text-sm">Try adjusting your search query or channel filters.</p>
                </td>
              </tr>
              <tr *ngIf="ctx.isLoading()">
                <td colspan="7" class="p-16 text-center text-slate-500">
                  <div class="inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <div class="text-sm font-medium">Synchronizing live catalog data...</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <!-- Pagination Footer -->
        <div class="bg-slate-900 border-t border-slate-800 p-4 px-6 flex items-center justify-between shrink-0">
          <div class="text-sm text-slate-400">
            Showing <span class="font-medium text-white">{{ (currentPage() - 1) * pageSize() + 1 }}</span> to 
            <span class="font-medium text-white">{{ Math.min(currentPage() * pageSize(), filteredSkus().length) }}</span> of 
            <span class="font-medium text-white">{{ filteredSkus().length }}</span> Master SKUs
          </div>
          
          <div class="flex items-center gap-2">
            <button (click)="prevPage()" [disabled]="currentPage() === 1" 
                    class="px-3 py-1.5 bg-slate-950 text-slate-300 border border-slate-800 rounded-lg text-sm font-medium hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              Previous
            </button>
            <span class="px-3 text-sm font-medium text-slate-400">Page {{ currentPage() }} of {{ totalPages() || 1 }}</span>
            <button (click)="nextPage()" [disabled]="currentPage() === totalPages() || totalPages() === 0" 
                    class="px-3 py-1.5 bg-slate-950 text-slate-300 border border-slate-800 rounded-lg text-sm font-medium hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PricingSimulationComponent implements OnInit {
  ctx = inject(PricingSignalContext);
  Math = Math; // Expose Math to template

  // Local state for the UI controls bound to inputs
  commissionBump = signal<number>(0);
  shippingBump = signal<number>(0);
  discountBump = signal<number>(0);

  // Search & Filters
  searchQuery = signal<string>('');
  selectedChannel = signal<string>('ALL');
  
  channelTabs = [
    { id: 'ALL', label: 'Todos', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>' },
    { id: 'WEB', label: 'Tienda En Línea', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>' },
    { id: 'POS', label: 'Punto De Venta', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>' },
    { id: 'AMAZON_MFN', label: 'Amazon MFN', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>' },
    { id: 'AMAZON_FBA', label: 'Amazon FBA', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>' },
    { id: 'MELI_CLASSIC', label: 'MercadoLibre (Clásico)', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 0a2 2 0 100 4 2 2 0 000-4z"></path></svg>' },
    { id: 'MELI_FULL', label: 'MercadoLibre Full', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>' },
    { id: 'B2B', label: 'Venta Asistida (B2B)', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>' }
  ];

  // Pagination
  currentPage = signal<number>(1);
  pageSize = signal<number>(50);

  // Computed filtered list for the UI
  filteredSkus = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const chan = this.selectedChannel();
    
    return this.ctx.masterSkus().map(sku => {
      // 1. Filter the listings array based on the segmented control
      const filteredListings = sku.listings.filter(l => {
        if (chan === 'ALL') return true;
        if (chan === 'WEB' && l.listing_type === 'Web') return true;
        if (chan === 'MELI_FULL' && l.listing_type === 'Full') return true;
        if (chan === 'MELI_CLASSIC' && l.listing_type === 'Classic') return true;
        if (chan === 'AMAZON_FBA' && l.listing_type === 'FBA') return true;
        return false;
      });

      return { ...sku, listings: filteredListings };
    }).filter(sku => {
      // 2. Only keep SKUs with at least one visible listing
      if (sku.listings.length === 0) return false;
      
      // 3. Apply Text Search
      if (query) {
        return sku.sku.toLowerCase().includes(query) || sku.title.toLowerCase().includes(query);
      }
      return true;
    });
  });

  // Computed pagination
  paginatedSkus = computed(() => {
    const skus = this.filteredSkus();
    const startIndex = (this.currentPage() - 1) * this.pageSize();
    return skus.slice(startIndex, startIndex + this.pageSize());
  });

  totalPages = computed(() => Math.ceil(this.filteredSkus().length / this.pageSize()));

  ngOnInit() {
    if (this.ctx.masterSkus().length === 0) {
      this.ctx.loadInitialData();
    }
  }

  // Calculate simulated price dynamically based on formula:
  // (Base Cost + Floor Margin + Outbound Shipping + Fixed Fees) / (1 - (Channel Commission + Discounts))
  getSimulatedPrice(sku: MasterSku, list: ChannelListing): number | null {
    if (!sku.base_cost || sku.base_cost === 0) return null;

    const floorMargin = sku.base_cost * (sku.minimum_margin_multiplier - 1);
    
    // Apply bumps
    const activeComm = list.commission_percentage + (this.commissionBump() / 100);
    const activeShip = list.shipping_profile + this.shippingBump();
    const activeDiscount = this.discountBump() / 100;
    
    const numerator = sku.base_cost + floorMargin + activeShip + list.fixed_fees;
    const denominator = 1 - activeComm - activeDiscount;

    if (denominator <= 0) return 99999; // Cap it out
    return Number((numerator / denominator).toFixed(2));
  }

  resetSimulation() {
    this.commissionBump.set(0);
    this.shippingBump.set(0);
    this.discountBump.set(0);
  }

  saveSimulation() {
    alert('Simulation saved to draft! Ready for managerial review.');
  }

  setSearch(val: string) {
    this.searchQuery.set(val);
    this.resetPage();
  }

  resetPage() {
    this.currentPage.set(1);
  }

  prevPage() {
    if (this.currentPage() > 1) {
      this.currentPage.set(this.currentPage() - 1);
    }
  }

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.set(this.currentPage() + 1);
    }
  }
}
