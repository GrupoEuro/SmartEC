import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PricingSignalContext } from './pricing-signal.context';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-pricing-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-200 p-8">
      <div class="max-w-7xl mx-auto space-y-8">
        
        <!-- Header -->
        <header class="flex justify-between items-center">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-white">Pricing & Costs Command Center</h1>
            <p class="text-slate-400 mt-1">Manage global floor prices, anomalies, and multi-channel profitability.</p>
          </div>
          <div class="flex gap-4">
            <a routerLink="/operations/pricing/simulation" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors border border-indigo-500/50 shadow-[0_0_15px_rgba(79,70,229,0.3)]">
              Simulation Sandbox
            </a>
            <a routerLink="/operations/pricing/grid" class="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors border border-purple-500/50 shadow-[0_0_15px_rgba(147,51,234,0.3)]">
              Smart Price Grid
            </a>
            <a routerLink="/operations/pricing/costs" class="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg transition-colors border border-slate-700">
              Cost Management Hub
            </a>
          </div>
        </header>

        <!-- Loading State -->
        <div *ngIf="ctx.isLoading()" class="flex items-center justify-center py-20">
          <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>

        <!-- Anomalies Section -->
        <section *ngIf="!ctx.isLoading() && ctx.anomalies().length > 0" class="space-y-4">
          <div class="flex items-center gap-2 text-rose-500">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <h2 class="text-xl font-semibold tracking-tight">Critical Margin Anomalies</h2>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div *ngFor="let anomaly of ctx.anomalies()" 
                 class="bg-slate-900 border border-rose-500/30 rounded-xl p-5 shadow-[0_0_20px_rgba(244,63,94,0.05)] relative overflow-hidden">
              <div class="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
              <div class="flex justify-between items-start mb-4">
                <div>
                  <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Channel</span>
                  <p class="text-lg font-medium text-white">{{ anomaly.channel_id }} ({{ anomaly.listing_type }})</p>
                </div>
                <span class="px-2.5 py-1 bg-rose-500/10 text-rose-400 text-xs font-semibold rounded-full border border-rose-500/20">
                  BELOW FLOOR
                </span>
              </div>
              
              <div class="space-y-3">
                <div class="flex justify-between items-end border-b border-slate-800 pb-2">
                  <span class="text-slate-400 text-sm">Current Price</span>
                  <span class="text-rose-400 font-mono text-lg font-semibold">{{ anomaly.current_list_price | currency:'MXN' }}</span>
                </div>
                <div class="flex justify-between items-end">
                  <span class="text-slate-400 text-sm">Global Settings Floor</span>
                  <span class="text-emerald-400 font-mono text-lg">{{ anomaly.calculated_floor_price | currency:'MXN' }}</span>
                </div>
              </div>

              <div class="mt-5 pt-4 border-t border-slate-800 flex justify-end">
                <button class="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                  Resolve in Sandbox →
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- No Anomalies Empty State -->
        <section *ngIf="!ctx.isLoading() && ctx.anomalies().length === 0" 
                 class="bg-slate-900 border border-emerald-500/20 rounded-xl p-12 text-center shadow-[0_0_30px_rgba(16,185,129,0.03)]">
          <div class="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
            <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h2 class="text-xl font-bold text-white mb-2">Margins are Healthy</h2>
          <p class="text-slate-400 max-w-md mx-auto">All synced listings across Mercado Libre and Amazon are currently pricing above their mandatory floor constraints.</p>
        </section>

      </div>
    </div>
  `
})
export class PricingDashboardComponent implements OnInit {
  ctx = inject(PricingSignalContext);

  ngOnInit() {
    this.ctx.loadInitialData();
  }
}
