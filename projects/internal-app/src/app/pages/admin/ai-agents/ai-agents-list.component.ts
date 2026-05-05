import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AiAgentService } from '../../../core/services/ai-agent.service';
import { AiAgent, AgentStatus, AgentStats, AFTER_HOURS_AGENT_TEMPLATE, TRIAGE_AGENT_TEMPLATE } from '../../../core/models/ai-agent.model';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../core/services/toast.service';


@Component({
    selector: 'app-ai-agents-list',
    standalone: true,
    imports: [CommonModule, RouterModule, AppIconComponent],
    template: `
<div class="p-6">

  <!-- Header -->
  <div class="flex items-start justify-between gap-4 mb-6">
    <div class="flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-400 flex-shrink-0">
        <app-icon name="cpu" [size]="22"></app-icon>
      </div>
      <div>
        <h1 class="text-2xl font-bold text-slate-100">EuroMind — Agentes IA</h1>
        <p class="text-slate-400 text-sm">Configura agentes inteligentes conectados a tus canales de comunicación.</p>
      </div>
    </div>
    <button class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold transition shadow-lg shadow-indigo-500/20 flex-shrink-0"
            (click)="openNewMenu()">
      <app-icon name="plus" [size]="16"></app-icon> Nuevo Agente
    </button>
  </div>

  <!-- Template picker -->
  @if (showNewMenu()) {
    <div class="fixed inset-0 z-40" (click)="showNewMenu.set(false)"></div>
    <div class="absolute top-28 right-6 z-50 bg-slate-800 border border-slate-700 rounded-xl p-4 min-w-80 shadow-2xl">
      <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Elige una plantilla para empezar</p>
      <div class="flex flex-col gap-2">
        <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-900 hover:border-indigo-500/40 hover:bg-indigo-500/5 cursor-pointer transition-colors" (click)="createFromTemplate('afterHours')">
          <span class="text-3xl leading-none flex-shrink-0">🤖</span>
          <div><p class="text-sm font-bold text-slate-100 mb-0.5">Asistente Fuera de Horario</p><p class="text-xs text-slate-500">Atiende clientes después del cierre y captura datos para seguimiento.</p></div>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-900 hover:border-indigo-500/40 hover:bg-indigo-500/5 cursor-pointer transition-colors" (click)="createFromTemplate('triage')">
          <span class="text-3xl leading-none flex-shrink-0">⚡</span>
          <div><p class="text-sm font-bold text-slate-100 mb-0.5">Enrutador Inteligente</p><p class="text-xs text-slate-500">Pregunta qué necesita el cliente y lo conecta con el equipo correcto.</p></div>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-900 hover:border-indigo-500/40 hover:bg-indigo-500/5 cursor-pointer transition-colors" (click)="createFromTemplate('blank')">
          <span class="text-3xl leading-none flex-shrink-0">✨</span>
          <div><p class="text-sm font-bold text-slate-100 mb-0.5">Agente en blanco</p><p class="text-xs text-slate-500">Construye tu agente desde cero con total libertad.</p></div>
        </div>
      </div>
    </div>
  }

  <!-- KPI row -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 shadow-md hover:border-slate-600 transition-colors">
      <div class="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 flex-shrink-0"><app-icon name="cpu" [size]="18"></app-icon></div>
      <div><div class="text-2xl font-extrabold text-slate-100 leading-none">{{ overallStats().activeAgents }}</div><div class="text-xs text-slate-500 mt-0.5">Agentes activos</div></div>
    </div>
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 shadow-md hover:border-slate-600 transition-colors">
      <div class="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400 flex-shrink-0"><app-icon name="message-square" [size]="18"></app-icon></div>
      <div><div class="text-2xl font-extrabold text-slate-100 leading-none">{{ overallStats().handledToday }}</div><div class="text-xs text-slate-500 mt-0.5">Atendidos hoy</div></div>
    </div>
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 shadow-md hover:border-slate-600 transition-colors">
      <div class="w-10 h-10 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-400 flex-shrink-0"><app-icon name="trending-up" [size]="18"></app-icon></div>
      <div><div class="text-2xl font-extrabold text-slate-100 leading-none">{{ overallStats().handledMonth }}</div><div class="text-xs text-slate-500 mt-0.5">Este mes</div></div>
    </div>
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 shadow-md hover:border-slate-600 transition-colors">
      <div class="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400 flex-shrink-0"><app-icon name="users" [size]="18"></app-icon></div>
      <div><div class="text-2xl font-extrabold text-slate-100 leading-none">{{ overallStats().handoffRate }}%</div><div class="text-xs text-slate-500 mt-0.5">Tasa de traspaso</div></div>
    </div>
  </div>

  <!-- Agents -->
  @if (loading()) {
    <div class="flex justify-center py-20"><div class="w-8 h-8 border-2 border-slate-700 border-t-indigo-500 rounded-full animate-spin"></div></div>
  } @else if (agents().length === 0) {
    <div class="flex flex-col items-center gap-4 py-20 text-center">
      <span class="text-6xl">🤖</span>
      <h3 class="text-lg font-bold text-slate-500">Sin agentes configurados</h3>
      <p class="text-sm text-slate-600 max-w-sm">Crea tu primer agente IA para automatizar la atención a clientes en cualquier canal.</p>
      <button class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold transition" (click)="openNewMenu()">
        <app-icon name="plus" [size]="16"></app-icon> Crear primer agente
      </button>
    </div>
  } @else {
    <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      @for (agent of agents(); track agent.id) {
        <div class="bg-slate-800 border rounded-xl p-5 flex flex-col gap-3 shadow-md hover:-translate-y-0.5 transition-all duration-200"
             [class.border-violet-500]="agent.status === 'active'"
             [class.border-slate-700]="agent.status !== 'active'">
          <!-- Top row -->
          <div class="flex items-center gap-3">
            <span class="text-3xl leading-none flex-shrink-0">{{ agent.avatarEmoji || '🤖' }}</span>
            <div class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-slate-100">{{ agent.name }}</span>
              <span class="block text-xs text-slate-500 truncate">{{ agent.description | slice:0:70 }}{{ (agent.description?.length ?? 0) > 70 ? '…' : '' }}</span>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0" [title]="agent.status === 'active' ? 'Desactivar' : 'Activar'">
              <input type="checkbox" class="sr-only peer" [checked]="agent.status === 'active'" (change)="toggleStatus(agent)" [disabled]="agent.status === 'draft'">
              <div class="w-9 h-5 bg-slate-700 rounded-full peer peer-checked:bg-violet-600 peer-checked:after:translate-x-full peer-disabled:opacity-40 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition"></div>
            </label>
          </div>

          <!-- Pills -->
          <div class="flex flex-wrap gap-1.5">
            <span class="text-xs font-bold px-2 py-0.5 rounded-full" [style.background]="svc.statusColor(agent.status) + '22'" [style.color]="svc.statusColor(agent.status)">
              {{ svc.statusLabel(agent.status) }}
            </span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">{{ svc.modelLabel(agent.modelConfig?.model ?? '') }}</span>
            @if (agent.status === 'draft') {
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Requiere activación</span>
            }
          </div>

          <!-- Channels -->
          <div class="flex flex-wrap gap-1.5">
            @for (b of agent.channelBindings; track b.channel) {
              @if (b.enabled) {
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                      [style.background]="channelColor(b.channel) + '20'" [style.color]="channelColor(b.channel)">
                  {{ channelLabel(b.channel) }}<span class="opacity-70 font-normal">{{ conditionShort(b.conditions) }}</span>
                </span>
              }
            }
            @if (!agent.channelBindings?.length) {
              <span class="text-xs text-slate-600 italic">Sin canales asignados</span>
            }
          </div>

          <!-- Stats -->
          @if (agentStats()[agent.id!]) {
            <div class="flex flex-wrap gap-3 px-3 py-2 bg-slate-900 rounded-lg border border-slate-700/50">
              <span class="flex items-center gap-1 text-xs text-slate-500"><app-icon name="message-square" [size]="11"></app-icon>{{ agentStats()[agent.id!].totalHandled }} conversaciones</span>
              <span class="flex items-center gap-1 text-xs text-slate-500"><app-icon name="users" [size]="11"></app-icon>{{ agentStats()[agent.id!].handoffRate }}% traspaso</span>
              <span class="flex items-center gap-1 text-xs text-slate-500"><app-icon name="zap" [size]="11"></app-icon>{{ agentStats()[agent.id!].avgLatencyMs }}ms</span>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center gap-2 mt-auto">
            <a [routerLink]="['/admin/ai-agents', agent.id, 'edit']"
               class="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/25 text-violet-400 text-xs font-bold hover:bg-violet-500/20 hover:border-violet-500/40 transition-colors">
              <app-icon name="settings" [size]="14"></app-icon> Configurar
            </a>
            <button class="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-500 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                    (click)="deleteAgent(agent)" title="Eliminar agente">
              <app-icon name="trash-2" [size]="14"></app-icon>
            </button>
          </div>
        </div>
      }
    </div>
  }

</div>
    `,
    styles: [`:host { display: block; position: relative; }`]
})
export class AiAgentsListComponent implements OnInit, OnDestroy {
    readonly svc   = inject(AiAgentService);
    private  toast = inject(ToastService);
    private  router = inject(Router);

    agents       = signal<AiAgent[]>([]);
    loading      = signal(true);
    showNewMenu  = signal(false);
    agentStats   = signal<Record<string, AgentStats>>({});
    overallStats = signal({ activeAgents: 0, handledToday: 0, handledMonth: 0, handoffRate: 0 });

    private sub?: Subscription;

    ngOnInit() {
        this.sub = this.svc.getAgents().subscribe(list => {
            this.agents.set(list);
            this.loading.set(false);
            this.loadStats(list);
        });
        this.svc.getOverallStats().then(s => this.overallStats.set(s)).catch(() => {});
    }

    ngOnDestroy() { this.sub?.unsubscribe(); }

    private async loadStats(list: AiAgent[]) {
        const statsMap: Record<string, AgentStats> = {};
        await Promise.allSettled(list.map(async a => {
            if (a.id) statsMap[a.id] = await this.svc.getAgentStats(a.id, '30d');
        }));
        this.agentStats.set(statsMap);
    }

    openNewMenu() { this.showNewMenu.set(!this.showNewMenu()); }

    async createFromTemplate(type: 'afterHours' | 'triage' | 'blank') {
        this.showNewMenu.set(false);
        const template =
            type === 'afterHours' ? AFTER_HOURS_AGENT_TEMPLATE :
            type === 'triage'     ? TRIAGE_AGENT_TEMPLATE : {};
        const base: Omit<AiAgent, 'id' | 'createdAt' | 'updatedAt'> = {
            name: template.name ?? 'Nuevo Agente',
            description: template.description ?? '',
            status: 'draft',
            avatarEmoji: template.avatarEmoji ?? '🤖',
            modelConfig: template.modelConfig ?? { model: 'gemini-1.5-pro', temperature: 0.7, maxTokens: 512 },
            toneConfig: template.toneConfig ?? { language: 'es-MX', tone: 'professional', useEmojis: false, maxSentences: 3 },
            systemPrompt: template.systemPrompt ?? '',
            channelBindings: template.channelBindings ?? [],
            knowledgeBaseIds: [],
            handoffRules: template.handoffRules ?? [],
            escalationDepartments: template.escalationDepartments ?? ['Atención a Clientes', 'Facturación', 'Ventas', 'Soporte'],
            contextMessageCount: template.contextMessageCount ?? 10,
        };
        try {
            const id = await this.svc.createAgent(base);
            this.toast.success('Agente creado — configurando...');
            this.router.navigate(['/admin/ai-agents', id, 'edit']);
        } catch {
            this.toast.error('Error al crear el agente');
        }
    }

    async toggleStatus(agent: AiAgent) {
        if (!agent.id) return;
        if (agent.status === 'draft') { this.toast.info('Guarda la configuración antes de activar el agente.'); return; }
        const newStatus: AgentStatus = agent.status === 'active' ? 'inactive' : 'active';
        await this.svc.setAgentStatus(agent.id, newStatus);
        this.toast.success(newStatus === 'active' ? 'Agente activado' : 'Agente desactivado');
    }

    async deleteAgent(agent: AiAgent) {
        if (!agent.id || !confirm(`¿Eliminar el agente "${agent.name}"? Esta acción no se puede deshacer.`)) return;
        await this.svc.deleteAgent(agent.id);
        this.toast.success('Agente eliminado');
    }

    channelColor(ch: string): string {
        const c: Record<string, string> = { whatsapp:'#25d366', instagram:'#e1306c', facebook:'#1877f2', telegram:'#0088cc', email:'#6366f1', website:'#8b5cf6' };
        return c[ch] ?? '#64748b';
    }
    channelLabel(ch: string): string {
        const l: Record<string, string> = { whatsapp:'WhatsApp', instagram:'Instagram', facebook:'Facebook', telegram:'Telegram', email:'Email', website:'Chat Web' };
        return l[ch] ?? ch;
    }
    conditionShort(conditions: any[]): string {
        if (!conditions?.length) return 'siempre';
        const c = conditions[0];
        if (c.type === 'afterHours')         return '· fuera horario';
        if (c.type === 'businessHours')      return '· en horario';
        if (c.type === 'firstContact')       return '· primer contacto';
        if (c.type === 'noHumanReplyWithin') return `· sin resp. ${c.minutes}min`;
        if (c.type === 'always')             return '· siempre';
        return '';
    }
}
