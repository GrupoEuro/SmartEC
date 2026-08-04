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
            const sorted = [...(data || [])].sort((a, b) => {
                const tA = this.toJsDate(a.updatedAt || a.createdAt)?.getTime() || 0;
                const tB = this.toJsDate(b.updatedAt || b.createdAt)?.getTime() || 0;
                return tB - tA; // Recent on top
            });
            this.conversations.set(sorted);
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

    private toJsDate(ts: any): Date | null {
        if (!ts) return null;
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts instanceof Date) return ts;
        if (typeof ts === 'number') return new Date(ts);
        if (typeof ts === 'string') {
            const parsed = new Date(ts);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof ts === 'object' && ts.seconds !== undefined) {
            return new Date(ts.seconds * 1000);
        }
        return null;
    }

    formatDate(ts: any): string {
        const d = this.toJsDate(ts);
        if (!d) return '-';
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
