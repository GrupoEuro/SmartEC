import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, getDocs, doc, setDoc, query, where } from '@angular/fire/firestore';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pricing-kit-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-200 p-6 lg:p-8 flex flex-col">
      <!-- Header -->
      <header class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 shrink-0">
        <div class="flex items-center gap-4">
          <a routerLink="/operations/pricing/dashboard" class="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </a>
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Visual Kit Builder
              <span class="px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-xs font-semibold border border-purple-500/20 uppercase tracking-wider">Combos</span>
            </h1>
            <p class="text-sm text-slate-400 mt-1">Visually map physical products to multi-pack channel listings.</p>
          </div>
        </div>
        <button (click)="saveBundle()" [disabled]="isSaving() || !bundleSku() || components().length === 0" 
                class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
          {{ isSaving() ? 'Saving...' : 'Deploy Kit Configuration' }}
        </button>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        
        <!-- Left Panel: Configuration -->
        <div class="lg:col-span-4 flex flex-col gap-6">
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
            <h2 class="text-lg font-bold text-white mb-4">1. Kit Metadata</h2>
            
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Bundle SKU (Must match listing custom field)</label>
                <input type="text" [(ngModel)]="bundleSku" placeholder="e.g. KIT-4X-MICHELIN-14" 
                       class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:ring-1 focus:ring-indigo-500 font-mono">
              </div>
              
              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Internal Kit Title</label>
                <input type="text" [(ngModel)]="bundleTitle" placeholder="e.g. Paquete 4 Llantas Michelin" 
                       class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:ring-1 focus:ring-indigo-500">
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Shipping Dimensions Override ($MXN)</label>
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span class="text-slate-500 font-mono">$</span>
                  </div>
                  <input type="number" [(ngModel)]="shippingOverride" placeholder="Estimated freight cost" 
                         class="w-full pl-8 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:ring-1 focus:ring-indigo-500 font-mono">
                </div>
                <p class="text-[10px] text-slate-500 mt-1">If blank, it will default to channel standard rates.</p>
              </div>
            </div>
          </div>

          <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex-1 flex flex-col">
            <h2 class="text-lg font-bold text-white mb-4">2. Physical Components</h2>
            
            <div class="flex-1 overflow-auto border border-slate-800 rounded-lg bg-slate-950 min-h-[200px]">
              <div *ngIf="components().length === 0" class="h-full flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                <svg class="w-12 h-12 mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                <p>No physical products added yet.</p>
                <p class="text-xs mt-1">Search and add items from the master catalog on the right.</p>
              </div>
              
              <ul class="divide-y divide-slate-800">
                <li *ngFor="let comp of components(); let i = index" class="p-3 hover:bg-slate-800/50 flex items-center justify-between group">
                  <div>
                    <p class="text-sm font-bold text-slate-300">{{ comp.sku }}</p>
                    <p class="text-[10px] text-emerald-500/80 font-mono mt-0.5">Unit Cost: {{ comp.cost | currency:'MXN' }}</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <div class="flex items-center bg-slate-900 border border-slate-700 rounded overflow-hidden">
                      <button (click)="updateQty(i, -1)" class="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700">-</button>
                      <span class="w-8 text-center font-mono text-sm text-indigo-400 font-bold bg-slate-950 py-1">{{ comp.qty }}</span>
                      <button (click)="updateQty(i, 1)" class="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700">+</button>
                    </div>
                    <button (click)="removeComponent(i)" class="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  </div>
                </li>
              </ul>
            </div>
            
            <div class="mt-4 p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex justify-between items-center">
              <span class="text-sm font-semibold text-indigo-400">Total Rollup Cost</span>
              <span class="text-xl font-bold font-mono text-white">{{ totalCost() | currency:'MXN' }}</span>
            </div>
          </div>
        </div>
        
        <!-- Right Panel: Master Catalog -->
        <div class="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div class="p-4 border-b border-slate-800 bg-slate-900/80">
            <div class="relative w-full">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg class="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <input type="text" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)"
                     placeholder="Search Master SKUs..." 
                     class="block w-full pl-10 pr-3 py-3 border border-slate-700 rounded-lg bg-slate-950 text-base placeholder-slate-500 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors shadow-sm">
            </div>
          </div>
          
          <div class="flex-1 overflow-auto p-4 relative">
            <div *ngIf="isLoading()" class="absolute inset-0 flex items-center justify-center bg-slate-900/50 z-10 backdrop-blur-sm">
              <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div *ngFor="let product of filteredProducts()" 
                   class="border border-slate-800 bg-slate-950 rounded-lg p-4 hover:border-indigo-500/50 transition-colors group flex flex-col justify-between">
                <div>
                  <h3 class="font-bold text-slate-200 text-sm line-clamp-2" [title]="product.title">{{ product.title }}</h3>
                  <p class="text-xs font-mono text-slate-500 mt-1">{{ product.sku }}</p>
                </div>
                <div class="flex items-center justify-between mt-4">
                  <span class="text-sm font-mono text-emerald-500/80">{{ (product.cost || 0) | currency:'MXN' }}</span>
                  <button (click)="addComponent(product)" class="px-3 py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white text-xs font-bold rounded transition-colors shadow">
                    Add to Kit
                  </button>
                </div>
              </div>
            </div>
            
            <div *ngIf="filteredProducts().length === 0 && !isLoading()" class="text-center py-20 text-slate-500">
              No matching SKUs found in Master Catalog.
            </div>
          </div>
        </div>
        
      </div>
    </div>
  `
})
export class PricingKitBuilderComponent implements OnInit {
  private firestore = inject(Firestore);
  
  // Kit Form
  bundleSku = signal('');
  bundleTitle = signal('');
  shippingOverride = signal<number | null>(null);
  components = signal<{sku: string, cost: number, qty: number}[]>([]);
  
  // State
  isSaving = signal(false);
  isLoading = signal(true);
  
  // Catalog
  masterProducts = signal<any[]>([]);
  searchQuery = signal('');
  
  filteredProducts = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.masterProducts().slice(0, 50); // Show max 50 default
    
    return this.masterProducts().filter(p => 
      String(p.sku).toLowerCase().includes(q) || 
      String(p.title).toLowerCase().includes(q)
    ).slice(0, 50);
  });
  
  totalCost = computed(() => {
    return this.components().reduce((acc, curr) => acc + (curr.cost * curr.qty), 0);
  });

  async ngOnInit() {
    await this.loadMasterProducts();
  }
  
  async loadMasterProducts() {
    this.isLoading.set(true);
    try {
      const snap = await getDocs(query(collection(this.firestore, 'products'), where('active', '==', true)));
      const products: any[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        products.push({
          sku: data['sku'] || doc.id,
          title: data['name']?.es || data['title'] || doc.id,
          cost: data['costPrice'] || data['averageCost'] || 0
        });
      });
      this.masterProducts.set(products);
    } catch (e) {
      console.error('Failed to load products', e);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  addComponent(product: any) {
    const current = this.components();
    const existing = current.find(c => c.sku === product.sku);
    
    if (existing) {
      existing.qty += 1;
      this.components.set([...current]);
    } else {
      this.components.set([...current, { sku: product.sku, cost: product.cost, qty: 1 }]);
    }
  }
  
  removeComponent(index: number) {
    const current = this.components();
    current.splice(index, 1);
    this.components.set([...current]);
  }
  
  updateQty(index: number, delta: number) {
    const current = this.components();
    const item = current[index];
    item.qty += delta;
    if (item.qty <= 0) {
      this.removeComponent(index);
    } else {
      this.components.set([...current]);
    }
  }
  
  async saveBundle() {
    if (!this.bundleSku() || this.components().length === 0) return;
    
    this.isSaving.set(true);
    try {
      const payload = {
        bundle_sku: this.bundleSku().toUpperCase(),
        title: this.bundleTitle(),
        shipping_profile: this.shippingOverride() || null,
        components: this.components().map(c => ({
          sku: c.sku,
          qty: c.qty
        }))
      };
      
      await setDoc(doc(this.firestore, 'bundles', payload.bundle_sku), payload);
      
      // Reset form
      this.bundleSku.set('');
      this.bundleTitle.set('');
      this.shippingOverride.set(null);
      this.components.set([]);
      
      alert('Combo successfully deployed to Firestore! The Simulation Sandbox will now calculate its margin automatically.');
    } catch (e) {
      console.error('Failed to save bundle', e);
      alert('Error saving combo.');
    } finally {
      this.isSaving.set(false);
    }
  }
}
