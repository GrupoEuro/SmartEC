import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AiAgentService } from '../../../core/services/ai-agent.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../core/services/toast.service';
import {
    AiAgent, AgentChannelBinding, AgentCondition, AgentKnowledgeEntry,
    DEFAULT_DEPARTMENTS, DEFAULT_MODEL_CONFIG, DEFAULT_TONE_CONFIG
} from '../../../core/models/ai-agent.model';


const CHANNELS = [
    { id: 'website',   label: 'Chat Web',   color: '#8b5cf6', icon: 'globe' },
    { id: 'whatsapp',  label: 'WhatsApp',   color: '#25d366', icon: 'message-circle' },
    { id: 'instagram', label: 'Instagram',  color: '#e1306c', icon: 'instagram' },
    { id: 'facebook',  label: 'Facebook',   color: '#1877f2', icon: 'facebook' },
    { id: 'telegram',  label: 'Telegram',   color: '#0088cc', icon: 'send' },
    { id: 'email',     label: 'Email',      color: '#6366f1', icon: 'mail' },
];

@Component({
    selector: 'app-ai-agent-form',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, RouterModule],
    templateUrl: './ai-agent-form.component.html',
    styleUrls: ['./ai-agent-form.component.css']
})
export class AiAgentFormComponent implements OnInit, OnDestroy {
    private svc   = inject(AiAgentService);
    private toast = inject(ToastService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    agentId   = signal<string | null>(null);
    step      = signal(1);
    saving    = signal(false);
    loading   = signal(false);
    testing   = signal(false);
    testInput = '';
    testOutput = signal('');

    readonly channels = CHANNELS;
    readonly DEPARTMENTS = DEFAULT_DEPARTMENTS;
    readonly CONDITION_TYPES = [
        { value: 'always',             label: 'Siempre activo' },
        { value: 'afterHours',         label: 'Fuera de horario laboral' },
        { value: 'businessHours',      label: 'En horario laboral' },
        { value: 'firstContact',       label: 'Primer contacto del cliente' },
        { value: 'noHumanReplyWithin', label: 'Sin respuesta humana en N minutos' },
        { value: 'keywordMatch',       label: 'Coincidencia de palabras clave' },
    ];

    // ── Agent form model ─────────────────────────────────────────────────────
    agent: Partial<AiAgent> = {
        name: '',
        description: '',
        status: 'draft',
        avatarEmoji: '🤖',
        modelConfig: { ...DEFAULT_MODEL_CONFIG },
        toneConfig: { ...DEFAULT_TONE_CONFIG },
        systemPrompt: '',
        channelBindings: [],
        handoffRules: [],
        escalationDepartments: [...DEFAULT_DEPARTMENTS],
        knowledgeBaseIds: [],
        contextMessageCount: 10,
    };

    knowledge = signal<AgentKnowledgeEntry[]>([]);
    newKbEntry: Partial<AgentKnowledgeEntry> = { title: '', content: '', category: 'General', enabled: true };
    kbSaving = signal(false);

    private sub?: Subscription;

    readonly EMOJI_OPTIONS = ['🤖','⚡','🌟','💬','🎯','🛡️','📞','🏆','💡','🔔'];
    readonly varHint = '{{maxSentences}}';

    ngOnInit() {
        const id = this.route.snapshot.paramMap.get('id');
        if (id) {
            this.agentId.set(id);
            this.loading.set(true);
            this.sub = this.svc.getAgent(id).subscribe(a => {
                if (a) {
                    this.agent = { ...a };
                    if (!this.agent.channelBindings) this.agent.channelBindings = [];
                }
                this.loading.set(false);
            });
            this.sub.add(
                this.svc.getKnowledge(id).subscribe(kb => this.knowledge.set(kb))
            );
        }
    }

    ngOnDestroy() { this.sub?.unsubscribe(); }

    // ── Step navigation ──────────────────────────────────────────────────────
    goStep(n: number) {
        if (n > this.step() && !this.agent.name?.trim()) {
            this.toast.info('Ingresa un nombre para el agente primero.');
            return;
        }
        this.step.set(n);
    }

    // ── Channel bindings ─────────────────────────────────────────────────────
    getBinding(channelId: string): AgentChannelBinding {
        const existing = this.agent.channelBindings?.find((b: AgentChannelBinding) => b.channel === channelId);
        if (existing) return existing;
        const nb: AgentChannelBinding = { channel: channelId, enabled: false, conditions: [], priority: 1 };
        this.agent.channelBindings = [...(this.agent.channelBindings ?? []), nb];
        return nb;
    }

    toggleChannel(channelId: string) {
        const b = this.getBinding(channelId);
        b.enabled = !b.enabled;
        if (b.enabled && !b.conditions.length) {
            b.conditions = [{ type: 'always' as const }];
        }
        this.agent.channelBindings = [...(this.agent.channelBindings ?? [])];
    }

    isChannelEnabled(channelId: string): boolean {
        return this.agent.channelBindings?.find((b: AgentChannelBinding) => b.channel === channelId)?.enabled ?? false;
    }

    addCondition(channelId: string) {
        const b = this.getBinding(channelId);
        b.conditions = [...(b.conditions ?? []), { type: 'always' as const }];
        this.agent.channelBindings = [...(this.agent.channelBindings ?? [])];
    }

    removeCondition(channelId: string, i: number) {
        const b = this.getBinding(channelId);
        b.conditions = b.conditions.filter((_: AgentCondition, idx: number) => idx !== i);
        this.agent.channelBindings = [...(this.agent.channelBindings ?? [])];
    }

    setConditionType(channelId: string, i: number, type: string) {
        const b = this.getBinding(channelId);
        const cond: AgentCondition = type === 'noHumanReplyWithin'
            ? { type: 'noHumanReplyWithin', minutes: 5 }
            : type === 'keywordMatch'
            ? { type: 'keywordMatch', keywords: [] }
            : { type: type as 'always' | 'afterHours' | 'businessHours' | 'firstContact' };
        b.conditions = b.conditions.map((c: AgentCondition, idx: number) => idx === i ? cond : c);
        this.agent.channelBindings = [...(this.agent.channelBindings ?? [])];
    }

    // ── Knowledge base ───────────────────────────────────────────────────────
    async addKbEntry() {
        const id = this.agentId();
        if (!id || !this.newKbEntry.title?.trim()) return;
        this.kbSaving.set(true);
        try {
            await this.svc.createKnowledgeEntry({
                agentId:  id,
                title:    this.newKbEntry.title!.trim(),
                content:  this.newKbEntry.content?.trim() ?? '',
                category: this.newKbEntry.category ?? 'General',
                enabled:  true,
            });
            this.newKbEntry = { title: '', content: '', category: 'General', enabled: true };
            this.toast.success('Entrada agregada');
        } finally { this.kbSaving.set(false); }
    }

    async deleteKbEntry(id: string) {
        await this.svc.deleteKnowledgeEntry(id);
        this.toast.success('Entrada eliminada');
    }

    // ── Save ─────────────────────────────────────────────────────────────────
    async save(andActivate = false) {
        if (!this.agent.name?.trim()) { this.toast.error('El nombre es obligatorio.'); return; }
        this.saving.set(true);
        try {
            const payload = {
                ...this.agent,
                status: andActivate ? 'active' : (this.agent.status ?? 'draft'),
                channelBindings: (this.agent.channelBindings ?? []).filter((b: AgentChannelBinding) => b.enabled),
            } as Omit<AiAgent, 'id' | 'createdAt' | 'updatedAt'>;

            const id = this.agentId();
            if (id) {
                await this.svc.updateAgent(id, payload);
            } else {
                const newId = await this.svc.createAgent(payload);
                this.agentId.set(newId);
            }
            this.toast.success(andActivate ? 'Agente activado ✓' : 'Cambios guardados ✓');
            if (andActivate) this.router.navigate(['/admin/ai-agents']);
        } catch (e: any) {
            this.toast.error('Error al guardar: ' + (e?.message ?? ''));
        } finally { this.saving.set(false); }
    }

    // ── Department toggle ────────────────────────────────────────────────────
    toggleDept(dept: string) {
        const depts = this.agent.escalationDepartments ?? [];
        this.agent.escalationDepartments = depts.includes(dept)
            ? depts.filter(d => d !== dept)
            : [...depts, dept];
    }

    // ── Live test ────────────────────────────────────────────────────────────
    async runTest() {
        if (!this.testInput.trim() || !this.agentId()) return;
        this.testing.set(true);
        this.testOutput.set('');
        try {
            // For test we call agentOrchestrator via a mock or show prompt preview
            this.testOutput.set('🧪 Simulación: El agente respondería basándose en el prompt configurado. Despliega y usa una conversación real para probar la respuesta de Gemini.');
        } finally { this.testing.set(false); }
    }

    onKeywordsBlur(cond: any, str: string) {
        cond.keywords = (str ?? '').split(',').map((k: string) => k.trim()).filter(Boolean);
    }

    trackByIdx(i: number) { return i; }
}
