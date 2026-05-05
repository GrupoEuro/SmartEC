import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

interface MeliInsight {
    itemId: string;
    lastAnalyzedAt: any;
    questionCount: number;
    summary: string;
    missingInformation: string[];
    actionableRecommendations: string[];
    recentQuestions: string[];
}

@Component({
    selector: 'app-meli-ai-insights',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mt-6">
            <div class="p-4 md:p-6 border-b border-slate-700 bg-slate-800/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg text-xl flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path>
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-lg font-semibold text-white">AI Listing Insights</h2>
                        <p class="text-sm text-slate-400">Recomendaciones generadas por Gemini basadas en las preguntas de los clientes.</p>
                    </div>
                </div>
            </div>

            <div class="p-4 md:p-6">
                <div *ngIf="insights$ | async as insights">
                    <div *ngIf="insights.length === 0" class="text-center py-12">
                        <div class="mx-auto w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-700/50 text-slate-400">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                                <circle cx="12" cy="5" r="2"></circle>
                                <path d="M12 7v4"></path>
                                <line x1="8" y1="16" x2="8" y2="16"></line>
                                <line x1="16" y1="16" x2="16" y2="16"></line>
                            </svg>
                        </div>
                        <h3 class="text-sm font-medium text-slate-200">No hay insights generados</h3>
                        <p class="text-xs text-slate-500 mt-1">El motor de IA corre todas las madrugadas para analizar las nuevas preguntas.</p>
                    </div>

                    <div class="space-y-6">
                        <div *ngFor="let insight of insights" class="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
                            
                            <div class="flex justify-between items-start mb-4">
                                <div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <a [href]="'https://articulo.mercadolibre.com.mx/' + insight.itemId" target="_blank" class="text-base font-semibold text-white hover:text-indigo-400 transition-colors flex items-center gap-1">
                                            {{insight.itemId}} 
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                                <polyline points="15 3 21 3 21 9"></polyline>
                                                <line x1="10" y1="14" x2="21" y2="3"></line>
                                            </svg>
                                        </a>
                                        <span class="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-medium text-slate-300">
                                            {{insight.questionCount}} preguntas analizadas
                                        </span>
                                    </div>
                                    <p class="text-sm text-slate-400">{{insight.summary}}</p>
                                </div>
                                <span class="text-xs text-slate-500">{{insight.lastAnalyzedAt?.toDate() | date:'short'}}</span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div class="bg-red-500/5 border border-red-500/10 rounded-lg p-4">
                                    <h4 class="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="8" x2="12" y2="12"></line>
                                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                        </svg>
                                        Información Faltante
                                    </h4>
                                    <ul class="space-y-1.5">
                                        <li *ngFor="let missing of insight.missingInformation" class="text-sm text-slate-300 flex items-start gap-2">
                                            <span class="text-red-400/50 mt-0.5">•</span>
                                            <span>{{missing}}</span>
                                        </li>
                                    </ul>
                                </div>

                                <div class="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-4">
                                    <h4 class="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                        </svg>
                                        Recomendación Accionable
                                    </h4>
                                    <ul class="space-y-1.5">
                                        <li *ngFor="let rec of insight.actionableRecommendations" class="text-sm text-slate-300 flex items-start gap-2">
                                            <span class="text-emerald-400/50 mt-0.5">•</span>
                                            <span>{{rec}}</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div class="mt-4 pt-4 border-t border-slate-700/50">
                                <p class="text-xs font-medium text-slate-400 mb-2">Preguntas de muestra:</p>
                                <div class="space-y-1">
                                    <p *ngFor="let q of insight.recentQuestions" class="text-xs text-slate-500 italic">"{{q}}"</p>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
})
export class MeliAiInsightsComponent implements OnInit {
    private fs = inject(Firestore);
    insights$!: Observable<MeliInsight[]>;

    ngOnInit() {
        const ref = collection(this.fs, 'meli_insights');
        this.insights$ = collectionData(query(ref, orderBy('lastAnalyzedAt', 'desc'), limit(20)), { idField: 'id' }) as Observable<MeliInsight[]>;
    }
}
