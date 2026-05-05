import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InboxService, Conversation, ConversationStatus, Channel } from '../services/inbox.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-conversations-history',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, AppIconComponent],
    templateUrl: './conversations.component.html',
    styleUrls: ['./conversations.component.css']
})
export class ConversationsComponent implements OnInit {
    private readonly svc = inject(InboxService);

    loading = signal(false);
    conversations = signal<Conversation[]>([]);

    filterStatus = signal<ConversationStatus | 'all'>('all');
    filterChannel = signal<Channel | 'all'>('all');

    readonly statusOptions = [
        { label: 'Todos los estados', value: 'all' },
        { label: 'Abiertos', value: 'open' },
        { label: 'Pendientes', value: 'pending' },
        { label: 'Resueltos', value: 'resolved' },
        { label: 'Pospuestos', value: 'snoozed' },
    ];

    readonly channelOptions = [
        { label: 'Todos los canales', value: 'all' },
        { label: 'WhatsApp', value: 'whatsapp' },
        { label: 'Instagram', value: 'instagram' },
        { label: 'Facebook', value: 'facebook' },
        { label: 'Chat Web', value: 'website' },
        { label: 'Email', value: 'email' },
        { label: 'Telegram', value: 'telegram' },
    ];

    ngOnInit() {
        this.loadData();
    }

    async loadData() {
        this.loading.set(true);
        try {
            const data = await this.svc.getConversationsHistory({
                status: this.filterStatus(),
                channel: this.filterChannel()
            });
            this.conversations.set(data);
        } catch (e) {
            console.error('[ConversationsComponent] Error loading history:', e);
        } finally {
            this.loading.set(false);
        }
    }

    onFilterChange() {
        this.loadData();
    }

    initials(name: string): string {
        return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }

    formatDate(ts: any): string {
        if (!ts?.toDate) return '-';
        const d = ts.toDate();
        return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    channelLabel(ch: string): string {
        return this.svc.channelLabel(ch as Channel);
    }
    
    channelColor(ch: string): string {
        return this.svc.channelColor(ch as Channel);
    }

    statusLabel(s: string): string {
        const m: Record<string, string> = { open: 'Abierto', pending: 'Pendiente', resolved: 'Resuelto', snoozed: 'Pospuesto' };
        return m[s] ?? s;
    }
}
