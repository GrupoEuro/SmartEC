import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { ChartCardComponent } from '../../../../../shared/components/chart-card/chart-card.component';
import { MeliQuestionService } from '../../../../../core/services/meli-question.service';
import { MeliQuestion } from '../../../../../core/models/meli-question.model';

@Component({
    selector: 'app-questions-dashboard-widget',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, ChartCardComponent],
    template: `
    <app-chart-card [title]="'Q&A Center'" subtitle="MercadoLibre Customer Questions">
        <div class="questions-container">
            <!-- Empty State -->
            <div *ngIf="questions().length === 0 && !loading()" class="flex flex-col items-center justify-center h-48 text-slate-400">
                <app-icon name="check-circle" [size]="32" class="text-emerald-500 mb-2"></app-icon>
                <p>All caught up! No pending questions.</p>
                <button (click)="loadQuestions()" class="mt-4 text-xs text-blue-400 hover:text-blue-300">
                    Refresh
                </button>
            </div>

            <!-- Loading -->
            <div *ngIf="loading()" class="flex flex-col items-center justify-center h-48 text-slate-500">
                <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
                <p>Checking for questions...</p>
            </div>

            <!-- List -->
            <div *ngIf="questions().length > 0" class="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-2">
                <div *ngFor="let q of questions()" class="q-card bg-slate-800/50 p-3 rounded border border-slate-700">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs text-slate-500">{{ q.date_created | date:'short' }}</span>
                        <span class="text-[10px] bg-yellow-500/20 text-yellow-500 px-1 rounded border border-yellow-500/30">UNANSWERED</span>
                    </div>
                    
                    <p class="text-sm text-slate-200 mb-3 italic">"{{ q.text }}"</p>
                    
                    <!-- Item Context (Mock if missing) -->
                    <div class="text-xs text-slate-400 mb-3 flex items-center gap-1">
                        <app-icon name="package" [size]="12"></app-icon>
                        <span>Item ID: {{ q.item_id }}</span>
                    </div>

                    <!-- Answer Input -->
                    <div class="flex gap-2">
                        <input type="text" [(ngModel)]="replyText[q.id]" placeholder="Type your answer..." 
                            class="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 outline-none">
                        <button (click)="sendAnswer(q)" [disabled]="!replyText[q.id]"
                            class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold transition">
                            Values
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </app-chart-card>
  `,
    styles: [`
    :host { display: block; height: 100%; }
    .questions-container { height: 100%; display: flex; flex-direction: column; gap: 0.5rem;}
    
    .q-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 0.75rem;
        transition: background 0.2s;
    }
    .q-card:hover { background: rgba(255, 255, 255, 0.05); }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
  `]
})
export class QuestionsDashboardWidgetComponent implements OnInit {
    private meliService = inject(MeliQuestionService);

    questions = signal<MeliQuestion[]>([]);
    loading = signal(false);
    replyText: { [key: string]: string } = {};

    ngOnInit() {
        this.loadQuestions();
    }

    async loadQuestions() {
        this.loading.set(true);
        try {
            const data = await this.meliService.getUnansweredQuestions();
            this.questions.set(data);
        } catch (e) {
            console.error(e);
        } finally {
            this.loading.set(false);
        }
    }

    async sendAnswer(q: MeliQuestion) {
        const text = this.replyText[q.id];
        if (!text) return;

        try {
            await this.meliService.answerQuestion(q.id, text);
            // Optimistic update
            this.questions.update(list => list.filter(item => item.id !== q.id));
            delete this.replyText[q.id];
        } catch (e) {
            alert('Failed to send answer. Check console.');
        }
    }
}
