import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection, collectionData, doc, docData,
    getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, serverTimestamp, Timestamp,
    writeBatch
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { Observable, from, map, of } from 'rxjs';

import {
    AiAgent, AgentStatus, AgentLog, AgentStats, AgentKnowledgeEntry,
    BusinessHoursConfig, DEFAULT_BUSINESS_HOURS
} from '../models/ai-agent.model';

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AiAgentService {
    private readonly fs   = inject(Firestore);
    private readonly fns  = inject(Functions);
    private readonly auth = inject(Auth);

    // ── Agents CRUD ───────────────────────────────────────────────────────────

    /** Real-time list of all agents ordered by name */
    getAgents(): Observable<AiAgent[]> {
        return collectionData(
            query(collection(this.fs, 'ai_agents'), orderBy('name', 'asc')),
            { idField: 'id' }
        ) as Observable<AiAgent[]>;
    }

    /** Single agent (real-time) */
    getAgent(id: string): Observable<AiAgent | undefined> {
        return docData(
            doc(this.fs, `ai_agents/${id}`),
            { idField: 'id' }
        ) as Observable<AiAgent | undefined>;
    }

    /** Create a new agent */
    async createAgent(agent: Omit<AiAgent, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const uid = this.auth.currentUser?.uid ?? 'unknown';
        const ref = await addDoc(collection(this.fs, 'ai_agents'), {
            ...agent,
            createdBy: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    }

    /** Update an existing agent */
    async updateAgent(id: string, patch: Partial<AiAgent>): Promise<void> {
        await updateDoc(doc(this.fs, `ai_agents/${id}`), {
            ...patch,
            updatedAt: serverTimestamp(),
        });
    }

    /** Toggle agent status */
    async setAgentStatus(id: string, status: AgentStatus): Promise<void> {
        await updateDoc(doc(this.fs, `ai_agents/${id}`), {
            status,
            updatedAt: serverTimestamp(),
        });
    }

    /** Delete agent and its knowledge base entries */
    async deleteAgent(id: string): Promise<void> {
        const batch = writeBatch(this.fs);

        // Delete knowledge base entries
        const kbSnap = await getDocs(
            query(collection(this.fs, 'ai_knowledge'), where('agentId', '==', id))
        );
        kbSnap.forEach(d => batch.delete(d.ref));

        // Delete agent doc
        batch.delete(doc(this.fs, `ai_agents/${id}`));
        await batch.commit();
    }

    // ── Knowledge Base ────────────────────────────────────────────────────────

    /** Real-time knowledge entries for a specific agent */
    getKnowledge(agentId: string): Observable<AgentKnowledgeEntry[]> {
        return collectionData(
            query(
                collection(this.fs, 'ai_knowledge'),
                where('agentId', '==', agentId),
                orderBy('category', 'asc')
            ),
            { idField: 'id' }
        ) as Observable<AgentKnowledgeEntry[]>;
    }

    async createKnowledgeEntry(entry: Omit<AgentKnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const ref = await addDoc(collection(this.fs, 'ai_knowledge'), {
            ...entry,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    }

    async updateKnowledgeEntry(id: string, patch: Partial<AgentKnowledgeEntry>): Promise<void> {
        await updateDoc(doc(this.fs, `ai_knowledge/${id}`), {
            ...patch,
            updatedAt: serverTimestamp(),
        });
    }

    async deleteKnowledgeEntry(id: string): Promise<void> {
        await deleteDoc(doc(this.fs, `ai_knowledge/${id}`));
    }

    // ── Business Hours ────────────────────────────────────────────────────────

    /** Get current business hours config (one-time read) */
    async getBusinessHours(): Promise<BusinessHoursConfig> {
        const snap = await getDoc(doc(this.fs, 'config/business_hours'));
        if (snap.exists()) {
            return snap.data() as BusinessHoursConfig;
        }
        return DEFAULT_BUSINESS_HOURS;
    }

    /** Real-time business hours (for admin settings page) */
    getBusinessHoursLive(): Observable<BusinessHoursConfig> {
        return docData(doc(this.fs, 'config/business_hours')) as Observable<BusinessHoursConfig>;
    }

    /** Save business hours config */
    async saveBusinessHours(config: BusinessHoursConfig): Promise<void> {
        await setDoc(doc(this.fs, 'config/business_hours'), {
            ...config,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }

    // ── Agent Analytics ───────────────────────────────────────────────────────

    /** Get logs for a specific agent (last N) */
    getAgentLogs(agentId: string, count = 100): Observable<AgentLog[]> {
        return collectionData(
            query(
                collection(this.fs, 'ai_agent_logs'),
                where('agentId', '==', agentId),
                orderBy('timestamp', 'desc'),
                limit(count)
            ),
            { idField: 'id' }
        ) as Observable<AgentLog[]>;
    }

    /** Compute stats from logs for a specific agent */
    async getAgentStats(agentId: string, period: '7d' | '30d' = '30d'): Promise<AgentStats> {
        const days = period === '7d' ? 7 : 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const snap = await getDocs(
            query(
                collection(this.fs, 'ai_agent_logs'),
                where('agentId', '==', agentId),
                where('timestamp', '>=', Timestamp.fromDate(since)),
                orderBy('timestamp', 'desc'),
                limit(500)
            )
        );

        let totalHandled = 0;
        let handoffs = 0;
        let totalLatency = 0;
        let totalInput = 0;
        let totalOutput = 0;

        snap.forEach(d => {
            const log = d.data() as AgentLog;
            totalHandled++;
            if (log.handoffTriggered)  handoffs++;
            totalLatency += log.latencyMs      ?? 0;
            totalInput   += log.inputTokens    ?? 0;
            totalOutput  += log.outputTokens   ?? 0;
        });

        return {
            agentId,
            totalHandled,
            handoffRate:        totalHandled ? Math.round((handoffs / totalHandled) * 100) : 0,
            avgLatencyMs:       totalHandled ? Math.round(totalLatency / totalHandled) : 0,
            totalInputTokens:   totalInput,
            totalOutputTokens:  totalOutput,
            period,
        };
    }

    /** Get overall AI analytics across all agents */
    async getOverallStats(): Promise<{
        activeAgents: number;
        handledToday: number;
        handledMonth: number;
        handoffRate: number;
    }> {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // Active agents count
        const agentsSnap = await getDocs(
            query(collection(this.fs, 'ai_agents'), where('status', '==', 'active'))
        );

        // Today's logs
        const todaySnap = await getDocs(
            query(
                collection(this.fs, 'ai_agent_logs'),
                where('timestamp', '>=', Timestamp.fromDate(todayStart)),
                limit(1000)
            )
        );

        // Monthly logs
        const monthSnap = await getDocs(
            query(
                collection(this.fs, 'ai_agent_logs'),
                where('timestamp', '>=', Timestamp.fromDate(monthStart)),
                limit(2000)
            )
        );

        let handoffs = 0;
        monthSnap.forEach(d => {
            if ((d.data() as AgentLog).handoffTriggered) handoffs++;
        });

        return {
            activeAgents: agentsSnap.size,
            handledToday: todaySnap.size,
            handledMonth: monthSnap.size,
            handoffRate:  monthSnap.size ? Math.round((handoffs / monthSnap.size) * 100) : 0,
        };
    }

    // ── Cloud Function calls ──────────────────────────────────────────────────

    /** Manually trigger the agent orchestrator for a conversation */
    async triggerAgent(conversationId: string, agentId: string): Promise<{ ok: boolean; reply?: string }> {
        const fn = httpsCallable<
            { conversationId: string; agentId: string },
            { ok: boolean; reply?: string }
        >(this.fns, 'agentOrchestrator');
        const result = await fn({ conversationId, agentId });
        return result.data;
    }

    /** Manually trigger a handoff to a human department */
    async triggerHandoff(conversationId: string, department: string, reason: string): Promise<void> {
        const fn = httpsCallable<{ conversationId: string; department: string; reason: string }, void>(
            this.fns, 'agentHandoff'
        );
        await fn({ conversationId, department, reason });
    }

    // ── Config Helpers ────────────────────────────────────────────────────────

    async getDepartmentsConfig(): Promise<{ departments: any[] } | null> {
        const snap = await getDoc(doc(this.fs, 'config/departments'));
        return snap.exists() ? snap.data() as any : null;
    }

    async saveDepartmentsConfig(data: { departments: any[] }): Promise<void> {
        await setDoc(doc(this.fs, 'config/departments'), {
            ...data, updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async getGeminiConfig(): Promise<any | null> {
        const snap = await getDoc(doc(this.fs, 'config/gemini'));
        return snap.exists() ? snap.data() : null;
    }

    async saveGeminiConfig(data: any): Promise<void> {
        await setDoc(doc(this.fs, 'config/gemini'), {
            ...data, updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async getNotifConfig(): Promise<any | null> {
        const snap = await getDoc(doc(this.fs, 'config/ai_notifications'));
        return snap.exists() ? snap.data() : null;
    }

    async saveNotifConfig(data: any): Promise<void> {
        await setDoc(doc(this.fs, 'config/ai_notifications'), {
            ...data, updatedAt: serverTimestamp()
        }, { merge: true });
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /** Check if a time (default: now) is within business hours */
    isWithinBusinessHours(config: BusinessHoursConfig, date: Date = new Date()): boolean {
        // Convert to business timezone
        const tz = config.timezone || 'America/Mexico_City';
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'long',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
        }).formatToParts(date);

        const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() as any;
        const hour    = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
        const minute  = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
        const current = hour * 60 + minute;

        const dayMap: Record<string, string> = {
            monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
            thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
        };
        const key = dayMap[dayName] as keyof typeof config.schedule;
        const schedule = config.schedule?.[key];
        if (!schedule?.enabled) return false;

        const [openH,  openM]  = schedule.openTime.split(':').map(Number);
        const [closeH, closeM] = schedule.closeTime.split(':').map(Number);
        const openMins  = openH  * 60 + openM;
        const closeMins = closeH * 60 + closeM;

        return current >= openMins && current < closeMins;
    }

    modelLabel(model: string): string {
        const labels: Record<string, string> = {
            'gemini-1.5-pro':   'Gemini 1.5 Pro',
            'gemini-1.5-flash': 'Gemini 1.5 Flash',
            'gemini-2.0-flash': 'Gemini 2.0 Flash',
        };
        return labels[model] ?? model;
    }

    statusColor(status: AgentStatus): string {
        const colors: Record<AgentStatus, string> = {
            active:   '#10b981',
            draft:    '#f59e0b',
            inactive: '#6b7280',
        };
        return colors[status] ?? '#6b7280';
    }

    statusLabel(status: AgentStatus): string {
        const labels: Record<AgentStatus, string> = {
            active:   'Activo',
            draft:    'Borrador',
            inactive: 'Inactivo',
        };
        return labels[status] ?? status;
    }

    conditionLabel(type: string): string {
        const labels: Record<string, string> = {
            always:              'Siempre activo',
            afterHours:          'Fuera de horario',
            businessHours:       'En horario de atención',
            firstContact:        'Primer contacto',
            keywordMatch:        'Coincidencia de palabras',
            noHumanReplyWithin:  'Sin respuesta humana en N minutos',
        };
        return labels[type] ?? type;
    }
}
