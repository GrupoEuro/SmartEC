import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SecretsService } from './config/secrets.service';
import { MeliQuestion } from '../models/meli-question.model';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class MeliQuestionService {
    private http = inject(HttpClient);
    private secrets = inject(SecretsService);

    private readonly API_URL = 'https://api.mercadolibre.com';

    /**
     * Fetch Unanswered Questions from the last 30 days
     */
    async getUnansweredQuestions(): Promise<MeliQuestion[]> {
        const config = await this.secrets.getConfig();
        if (!config?.meli?.connected || !config.meli.accessToken) {
            return []; // Fail silently or throw, depends on UX. For widget, silent empty is better.
        }

        const token = config.meli.accessToken;
        // Search Resource: /my/received_questions/search?status=UNANSWERED
        const url = `${this.API_URL}/my/received_questions/search?status=UNANSWERED&access_token=${token}`;

        try {
            const response: any = await firstValueFrom(this.http.get(url));
            const questions: MeliQuestion[] = response.questions || [];

            // Enhance with Item Details (Optional, can be chunked like SyncService)
            // For now, return raw questions. The UI can fetch item details lazily or we can implement here.
            return questions;

        } catch (error) {
            console.error('Failed to fetch MELI questions', error);
            return [];
        }
    }

    /**
     * Post an answer to a question
     */
    async answerQuestion(questionId: string, text: string): Promise<void> {
        const config = await this.secrets.getConfig();
        if (!config?.meli?.accessToken) throw new Error('Not connected to MELI');

        const url = `${this.API_URL}/answers?access_token=${config.meli.accessToken}`;
        const body = {
            question_id: questionId,
            text: text
        };

        await firstValueFrom(this.http.post(url, body));
    }
}
