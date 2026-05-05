import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeliAiInsightsComponent } from '../meli-full/meli-ai-insights/meli-ai-insights.component';

@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [CommonModule, MeliAiInsightsComponent],
  template: `
    <div class="h-full flex flex-col pb-20 md:pb-8">
      
      <!-- HEADER -->
      <div class="flex-none p-4 md:p-8 bg-slate-900 border-b border-slate-800">
        <div class="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-3 mb-1">
              <h1 class="text-2xl md:text-3xl font-bold text-white tracking-tight">AI Insights Engine</h1>
              <span class="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold uppercase tracking-wider border border-indigo-500/20">Beta</span>
            </div>
            <p class="text-sm md:text-base text-slate-400">Analítica automatizada por Inteligencia Artificial para optimización de operaciones e-commerce.</p>
          </div>
        </div>
      </div>

      <!-- CONTENT GRID -->
      <div class="flex-1 overflow-y-auto bg-slate-950 p-4 md:p-8">
        <div class="max-w-7xl mx-auto">
          
          <div class="grid grid-cols-1 gap-8">
            
            <!-- MercadoLibre Insights Widget -->
            <section>
              <div class="flex items-center gap-2 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                <h2 class="text-xl font-semibold text-slate-200">MercadoLibre</h2>
              </div>
              <app-meli-ai-insights></app-meli-ai-insights>
            </section>

          </div>

        </div>
      </div>
    </div>
  `
})
export class AiInsightsComponent {

}
