import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { ActivatedRoute, Params } from '@angular/router';
import { HelpGlossaryService, GlossaryTerm } from '../../services/help-glossary.service';
import { combineLatest, Observable, startWith, map } from 'rxjs';
import { KatexFormulaComponent } from '../../../../shared/components/katex-formula/katex-formula.component';
import { VisualWorkflowComponent } from '../visual-workflow/visual-workflow.component';
import { FormulaSimulatorComponent, SimulationConfig } from '../formula-simulator/formula-simulator.component';
import { HelpHeaderComponent } from '../help-header/help-header.component';

@Component({
    selector: 'app-help-glossary',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule, KatexFormulaComponent, VisualWorkflowComponent, FormulaSimulatorComponent, HelpHeaderComponent],
    template: `
        <div class="page-container">
            <app-help-header></app-help-header>

            <div class="glossary-content">
                <!-- Toolbar / Filters -->
                <div class="toolbar">
                    <h2 class="section-title">Glossary</h2>
                    
                    <div class="category-filter">
                        <button 
                            *ngFor="let cat of categories" 
                            [class.active]="selectedCategory.value === cat"
                            (click)="selectedCategory.setValue(cat)"
                            class="filter-pill"
                        >
                            {{ cat }}
                        </button>
                    </div>
                </div>

                <!-- Glossary Grid -->
                <div class="term-grid">
                    <div *ngFor="let term of filteredTerms | async" class="term-card">
                        <div class="card-content-wrapper">
                            <div class="term-header">
                                <div class="term-title-row">
                                    <h2>{{ term.term }}</h2>
                                    <span class="category-badge" [ngClass]="term.category.toLowerCase()">
                                        {{ term.category }}
                                    </span>
                                </div>
                                <p class="definition">{{ term.definition }}</p>
                            </div>
                            
                            <!-- Mathematical Formula -->
                            <div *ngIf="term.formula" class="formula-section">
                                <div class="formula-container">
                                    <div class="formula-box">
                                        <app-katex-formula [formula]="term.formula"></app-katex-formula>
                                    </div>
                                    <!-- Variables Breakdown -->
                                    <div *ngIf="term.formulaExplanation" class="formula-explanation">
                                        <div class="explanation-title">Where:</div>
                                        <div class="variable-grid">
                                            <div *ngFor="let item of term.formulaExplanation | keyvalue" class="variable-row">
                                                <span class="var-key">{{ item.key }}</span>
                                                <span class="var-arrow">→</span>
                                                <span class="var-desc">{{ item.value }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Actions Area (Bottom of card) -->
                        <div class="card-actions-wrapper">
                            <div class="card-actions" *ngIf="term.visual || term.simulationConfig">
                                <!-- Visual Workflow Trigger -->
                                <!-- Visual Workflow Trigger -->
                                <button *ngIf="term.visual" (click)="openVisualModal(term)" class="btn-action btn-visual">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="icon">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                                    </svg>
                                    Visual Model
                                </button>

                                <!-- Simulation Trigger -->
                                <button *ngIf="term.simulationConfig" (click)="openSimulatorModal(term)" class="btn-action btn-simulate">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="icon">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                                    </svg>
                                    Simulator
                                </button>
                            </div>

                            <!-- Footer -->
                            <div class="card-footer" *ngIf="term.tags?.length">
                                <div class="tags">
                                    <span *ngFor="let tag of term.tags" class="tag">#{{ tag }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Empty State -->
                <div *ngIf="(filteredTerms | async)?.length === 0" class="empty-state">
                    <div class="empty-icon">🌪️</div>
                    <h3>No terms found</h3>
                    <p>Try adjusting your category filter.</p>
                    <button (click)="resetFilters()" class="btn-reset">Reset Filters</button>
                </div>
            </div>
        </div>

        <!-- Visual Model Modal -->
        <div *ngIf="activeVisualTerm" class="modal-backdrop" (click)="closeVisualModal()">
            <div class="modal-content" (click)="$event.stopPropagation()">
                <button class="btn-close" (click)="closeVisualModal()">×</button>
                <div class="modal-header">
                    <h3>{{ activeVisualTerm.term }}</h3>
                    <span class="modal-subtitle">Visual Model</span>
                </div>
                <div class="modal-visual-frame">
                    <app-visual-workflow [definition]="activeVisualTerm.visual || ''"></app-visual-workflow>
                </div>
            </div>
        </div>

        <!-- Simulator Modal -->
        <div *ngIf="activeSimulatorTerm" class="modal-backdrop" (click)="closeSimulatorModal()">
            <div class="modal-content simulator-modal" (click)="$event.stopPropagation()">
                <button class="btn-close" (click)="closeSimulatorModal()">×</button>
                <div class="modal-header">
                    <h3>{{ activeSimulatorTerm.term }}</h3>
                    <span class="modal-subtitle">Formula Simulator</span>
                </div>
                 <div *ngIf="activeSimulatorTerm.formula" class="modal-formula-preview">
                    <app-katex-formula [formula]="activeSimulatorTerm.formula"></app-katex-formula>
                </div>
                
                <div class="modal-simulator-frame">
                    <app-formula-simulator [config]="activeSimulatorTerm.simulationConfig"></app-formula-simulator>
                </div>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-height: 100vh;
            background-color: #0f172a; /* Slate 900 */
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
        }

        .page-container {
            width: 100%;
        }

        .glossary-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }

        /* Toolbar */
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 1.5rem;
            margin-bottom: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid #1e293b;
        }

        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0;
            background: linear-gradient(to right, #fff, #94a3b8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .category-filter {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
        }

        .filter-pill {
            background: rgba(30, 41, 59, 0.5);
            border: 1px solid #334155;
            color: #94a3b8;
            padding: 0.4rem 1rem;
            border-radius: 999px;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.85rem;
            transition: all 0.2s;
        }

        .filter-pill:hover {
            color: #fff;
            background: #334155;
        }

        .filter-pill.active {
            background: #2dd4bf;
            color: #0f172a;
            border-color: #2dd4bf;
            font-weight: 700;
        }

        /* Grid */
        .term-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 1.5rem;
        }

        .term-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            height: 100%; /* Important for equal height */
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s;
            position: relative;
        }

        .term-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
            border-color: #475569;
        }
        
        .card-content-wrapper {
            flex: 1; /* Pushes actions to bottom */
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .term-header {
             /* Wrapper for Title + Definition to structure content */
             display: flex;
             flex-direction: column;
             gap: 0.75rem;
        }

        .term-title-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 0.5rem;
            min-height: 3.5rem; /* Ensure consistent title height */
        }

        .term-title-row h2 {
            font-size: 1.25rem;
            font-weight: 700;
            color: #fff;
            margin: 0;
            line-height: 1.3;
        }

        .category-badge {
            font-size: 0.7rem;
            text-transform: uppercase;
            font-weight: 700;
            padding: 0.25rem 0.6rem;
            border-radius: 6px;
            border: 1px solid currentColor;
            white-space: nowrap;
            height: fit-content;
        }

        .category-badge.metric { color: #2dd4bf; background: rgba(45, 212, 191, 0.1); }
        .category-badge.process { color: #facc15; background: rgba(250, 204, 21, 0.1); }
        .category-badge.status { color: #f87171; background: rgba(248, 113, 113, 0.1); }
        .category-badge.philosophy { color: #a78bfa; background: rgba(167, 139, 250, 0.1); }

        .definition {
            color: #cbd5e1;
            line-height: 1.6;
            margin: 0;
            font-size: 0.95rem;
            min-height: 4.8rem; /* Approx 3 lines to align start of formula section */
        }

        /* Formula Box */
        .formula-section {
            margin-top: 0.5rem;
        }

        .formula-container {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid #fbbf24; /* Amber border */
            border-radius: 8px;
            padding: 1rem;
        }

        .formula-box {
            overflow-x: auto;
            text-align: center;
            padding-bottom: 0.5rem;
        }
        
        .explanation-title {
            color: #94a3b8;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            margin-bottom: 0.5rem;
            margin-top: 0.75rem;
            border-top: 1px solid rgba(251, 191, 36, 0.2);
            padding-top: 0.75rem;
        }

        .variable-grid {
            display: grid;
            gap: 0.25rem;
        }

        .variable-row {
            display: flex;
            align-items: baseline;
            font-size: 0.85rem;
            line-height: 1.4;
        }

        .var-key {
            color: #fbbf24; /* Amber 400 */
            font-family: 'Courier New', monospace;
            font-weight: 600;
            min-width: 20px;
        }

        .var-arrow {
            color: #64748b;
            margin: 0 0.5rem;
            font-size: 0.75rem;
        }

        .var-desc {
            color: #cbd5e1;
        }

        /* Card Actions Area */
        .card-actions-wrapper {
            margin-top: auto; /* Pushes entire footer area to bottom */
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .card-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); /* Consistent button width */
            gap: 0.75rem;
        }
        
        .btn-action {
             display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.75rem;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            color: #fff;
            border: 1px solid transparent;
        }

        .icon {
            width: 1.25rem;
            height: 1.25rem;
        }

        .btn-visual {
            background: rgba(13, 148, 136, 0.1);
            border-color: #14b8a6;
            color: #2dd4bf;
        }

        .btn-visual:hover {
            background: rgba(13, 148, 136, 0.2);
            transform: translateY(-2px);
        }

        .btn-simulate {
            background: rgba(217, 119, 6, 0.1);
            border-color: #f59e0b;
            color: #fbbf24;
        }

        .btn-simulate:hover {
            background: rgba(217, 119, 6, 0.2);
            transform: translateY(-2px);
        }

        /* Footer */
        .card-footer {
            padding-top: 0.75rem;
            border-top: 1px solid #334155;
        }

        .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .tag {
            font-size: 0.7rem;
            color: #94a3b8;
            background: rgba(15, 23, 42, 0.5);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
        }

        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 4rem;
            background: #1e293b;
            border-radius: 16px;
            border: 1px dashed #334155;
            margin-top: 2rem;
        }

        .empty-icon { font-size: 3rem; margin-bottom: 1rem; }
        .empty-state h3 { margin: 0 0 0.5rem 0; color: #fff; }
        .empty-state p { color: #94a3b8; margin: 0 0 1.5rem 0; }

        .btn-reset {
             background: transparent;
             border: 1px solid #2dd4bf;
             color: #2dd4bf;
             padding: 0.5rem 1rem;
             border-radius: 6px;
             cursor: pointer;
        }

        /* Modal Styles */
        .modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 2rem;
            animation: fadeIn 0.2s ease-out;
        }

        .modal-content {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            width: 100%;
            max-width: 1000px;
            height: 80vh;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
            animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .simulator-modal {
             max-width: 600px;
             height: auto;
             max-height: 90vh;
             background: #0f172a;
             border: 1px solid #fbbf24;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        .btn-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #fff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
            z-index: 10;
        }
        
        .btn-close:hover {
            background: rgba(239, 68, 68, 0.8); /* Red hover */
        }

        .modal-header {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid #334155;
        }

        .modal-header h3 {
            margin: 0;
            font-size: 1.5rem;
            color: #fff;
        }

        .modal-subtitle {
            font-size: 0.875rem;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }

        .modal-visual-frame {
            flex: 1;
            padding: 2rem;
            overflow: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
        }

        .modal-formula-preview {
            padding: 1rem 2rem;
            background: rgba(30, 41, 59, 0.5);
            border-bottom: 1px solid #334155;
            display: flex;
            justify-content: center;
        }

        .modal-simulator-frame {
            padding: 1.5rem;
        }
    `]
})
export class HelpGlossaryComponent {
    private glossaryService = inject(HelpGlossaryService);
    private route = inject(ActivatedRoute);

    // State
    selectedCategory = new FormControl('All');

    categories = ['All', 'Metric', 'Process', 'Status', 'Philosophy'];

    // Modal State
    activeVisualTerm: GlossaryTerm | null = null;
    activeSimulatorTerm: GlossaryTerm | null = null;

    filteredTerms: Observable<GlossaryTerm[]> = combineLatest([
        this.glossaryService.getTerms(),
        this.selectedCategory.valueChanges.pipe(startWith('All')),
        this.route.queryParams.pipe(startWith({}))
    ]).pipe(
        map(([terms, category, params]) => {
            let result = terms;

            // Filter by URL Search Param 'term' (from Header Search)
            if (params && (params as Params)['term']) {
                const termQuery = ((params as Params)['term'] as string).toLowerCase();
                // If a specific term is requested, start by filtering closely
                // Actually, header search usually expects result.
                result = result.filter(t => t.term.toLowerCase().includes(termQuery));
                // Optional: Override category to All if searching?
            }

            // Filter by Category
            if (category && category !== 'All') {
                result = result.filter(t => t.category === category);
            }

            // Sort Alphabetically
            return result.sort((a, b) => a.term.localeCompare(b.term));
        })
    );

    resetFilters() {
        this.selectedCategory.setValue('All');
        // Clear query params?
    }

    // Modal Actions
    openVisualModal(term: GlossaryTerm) {
        this.activeVisualTerm = term;
    }

    closeVisualModal() {
        this.activeVisualTerm = null;
    }

    openSimulatorModal(term: GlossaryTerm) {
        this.activeSimulatorTerm = term;
    }

    closeSimulatorModal() {
        this.activeSimulatorTerm = null;
    }
}
