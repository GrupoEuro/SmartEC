import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../core/services/toast.service';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

@Component({
    selector: 'app-euromind-chat',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './euromind-chat.component.html',
    styleUrls: ['./euromind-chat.component.css']
})
export class EuroMindChatComponent {
    private functions = inject(Functions);
    private toast = inject(ToastService);

    isOpen = signal(false);
    isTyping = signal(false);
    query = signal('');
    messages = signal<ChatMessage[]>([
        { role: 'assistant', content: '¡Hola! Soy EuroMind, tu asistente ejecutivo IA. ¿En qué te puedo ayudar hoy con el análisis de datos de Importadora Euro?', timestamp: new Date() }
    ]);

    toggleChat() {
        this.isOpen.update(v => !v);
    }

    async sendMessage() {
        const q = this.query().trim();
        if (!q || this.isTyping()) return;

        this.messages.update(m => [...m, { role: 'user', content: q, timestamp: new Date() }]);
        this.query.set('');
        this.isTyping.set(true);

        try {
            const askEuroMind = httpsCallable(this.functions, 'askEuroMind');
            const result: any = await askEuroMind({ query: q, isDashboardOnDemand: false });
            
            this.messages.update(m => [...m, { 
                role: 'assistant', 
                content: result.data?.reply || 'Error obteniendo respuesta.', 
                timestamp: new Date() 
            }]);
        } catch (err: any) {
            console.error('EuroMind Error:', err);
            this.toast.error('Ocurrió un error al consultar a EuroMind.');
            this.messages.update(m => [...m, { 
                role: 'assistant', 
                content: 'Disculpa, tuve un problema procesando tu solicitud.', 
                timestamp: new Date() 
            }]);
        } finally {
            this.isTyping.set(false);
        }
    }
}
