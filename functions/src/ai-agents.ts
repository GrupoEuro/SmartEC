/**
 * EuroMind IA Agents — Cloud Functions
 * inboxMessageRouter, agentOrchestrator, agentHandoff
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ── Types ─────────────────────────────────────────────────────────────────────

type DayOfWeek = 'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
interface DaySchedule { enabled: boolean; openTime: string; closeTime: string; }
interface BusinessHoursConfig { timezone: string; schedule: Record<DayOfWeek, DaySchedule>; }

// ── Business Hours ─────────────────────────────────────────────────────────────

function isWithinBusinessHours(config: BusinessHoursConfig, date: Date = new Date()): boolean {
    const tz = config.timezone || 'America/Mexico_City';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? '';
    const hour    = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
    const minute  = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const current = hour * 60 + minute;
    const dayMap: Record<string, DayOfWeek> = {
        monday:'monday', tuesday:'tuesday', wednesday:'wednesday',
        thursday:'thursday', friday:'friday', saturday:'saturday', sunday:'sunday',
    };
    const key = dayMap[dayName];
    if (!key) return false;
    const sched = config.schedule?.[key];
    if (!sched?.enabled) return false;
    const [openH, openM]   = sched.openTime.split(':').map(Number);
    const [closeH, closeM] = sched.closeTime.split(':').map(Number);
    return current >= (openH * 60 + openM) && current < (closeH * 60 + closeM);
}

// ── Condition Evaluator ───────────────────────────────────────────────────────

async function evaluateConditions(
    conditions: any[], convId: string, convData: any,
    businessHours: BusinessHoursConfig | null
): Promise<boolean> {
    if (!conditions?.length) return true;
    for (const cond of conditions) {
        switch (cond.type) {
            case 'always': return true;
            case 'afterHours':
                if (!businessHours || !isWithinBusinessHours(businessHours)) return true;
                break;
            case 'businessHours':
                if (businessHours && isWithinBusinessHours(businessHours)) return true;
                break;
            case 'firstContact': {
                const snap = await db
                    .collection(`customer_conversations/${convId}/messages`)
                    .where('direction', '==', 'inbound').limit(2).get();
                if (snap.size <= 1) return true;
                break;
            }
            case 'keywordMatch': {
                const text = (convData.lastMessage?.text ?? '').toLowerCase();
                if ((cond.keywords ?? []).some((kw: string) => text.includes(kw.toLowerCase()))) return true;
                break;
            }
            case 'noHumanReplyWithin': {
                const since = new Date(Date.now() - (cond.minutes ?? 5) * 60 * 1000);
                const snap  = await db
                    .collection(`customer_conversations/${convId}/messages`)
                    .where('direction', '==', 'outbound')
                    .where('sentByAgent', '==', false)
                    .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(since))
                    .limit(1).get();
                if (snap.empty) return true;
                break;
            }
        }
    }
    return false;
}

// ── Gemini Caller ─────────────────────────────────────────────────────────────

async function callGemini(
    systemPrompt: string,
    history: Array<{ role: 'user'|'model'; parts: Array<{ text: string }> }>,
    model = 'gemini-1.5-pro', temperature = 0.7, maxTokens = 512
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const projectId = 'tiendapraxis';
    const location  = 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const { GoogleAuth } = await import('google-auth-library');
    const token = await (new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })).getAccessToken();
    const res   = await fetch(url, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents:           history,
            generationConfig:   { temperature, maxOutputTokens: maxTokens, topP: 0.95 },
        }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    return {
        text:         data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        inputTokens:  data.usageMetadata?.promptTokenCount     ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
}

// ── Handoff Parser ────────────────────────────────────────────────────────────

function parseHandoff(text: string): { department: string; reason: string } | null {
    const m = text.match(/\[HANDOFF:\s*department=([^\]\s]+)(?:\s+reason=([^\]]+))?\]/i);
    return m ? { department: m[1].trim(), reason: (m[2] ?? '').trim() } : null;
}
function stripDirectives(text: string): string {
    return text.replace(/\[(HANDOFF|COLLECT|REPLY)[^\]]*\]/gi, '').trim();
}

// ── Core Orchestrator ─────────────────────────────────────────────────────────

async function runAgentOrchestrator(convId: string, agent: any): Promise<string> {
    const start    = Date.now();
    const convSnap = await db.collection('customer_conversations').doc(convId).get();
    if (!convSnap.exists) throw new Error('Conversation not found');
    const convData = convSnap.data() as any;

    // Build history
    const msgsSnap = await db.collection(`customer_conversations/${convId}/messages`)
        .orderBy('timestamp', 'desc').limit(agent.contextMessageCount ?? 10).get();
    const history: Array<{ role: 'user'|'model'; parts: Array<{ text: string }> }> = [];
    msgsSnap.docs.reverse().forEach(d => {
        const m = d.data() as any;
        if (!m.content?.trim() || m.isSystemNote) return;
        history.push({ role: m.direction === 'inbound' ? 'user' : 'model', parts: [{ text: m.content }] });
    });
    if (!history.length || history[history.length - 1].role !== 'user') return '';

    // Load knowledge base
    let kbContext = '';
    try {
        const kbSnap = await db.collection('ai_knowledge')
            .where('agentId', '==', agent.id).where('enabled', '==', true).limit(20).get();
        if (!kbSnap.empty) {
            kbContext = '\n\n--- BASE DE CONOCIMIENTO ---\n' +
                kbSnap.docs.map(d => { const kb = d.data() as any; return `[${kb.category}] ${kb.title}:\n${kb.content}`; }).join('\n\n') +
                '\n--- FIN BASE DE CONOCIMIENTO ---';
        }
    } catch { /* non-blocking */ }

    // Build system prompt
    const tone = agent.toneConfig ?? {};
    const maxSentences = tone.maxSentences ?? 3;
    const toneInstr: Record<string, string> = {
        professional: 'Usa un tono profesional y amable, como un ejecutivo de atención a clientes mexicano.',
        friendly:     'Usa un tono cercano, cálido y amigable.',
        formal:       'Usa un tono formal y respetuoso.',
        casual:       'Usa un tono casual y relajado.',
    };
    let systemPrompt = (agent.systemPrompt ?? '').replace('{{maxSentences}}', String(maxSentences));
    systemPrompt += `\n\nTono: ${toneInstr[tone.tone ?? 'professional'] ?? ''} Máximo ${maxSentences} oraciones por respuesta. ${tone.useEmojis ? 'Puedes usar emojis con moderación.' : 'No uses emojis.'}${kbContext}`;

    // Call AI
    const mc = agent.modelConfig ?? {};
    const { text, inputTokens, outputTokens } = await callGemini(
        systemPrompt, history,
        mc.model ?? 'gemini-1.5-pro', mc.temperature ?? 0.7, mc.maxTokens ?? 512
    );
    const latencyMs = Date.now() - start;
    const handoff   = parseHandoff(text);
    const replyText = stripDirectives(text);

    // Write AI reply
    if (replyText.trim()) {
        await db.collection(`customer_conversations/${convId}/messages`).add({
            direction: 'outbound', type: 'text', content: replyText,
            platformMessageId: `ai_${agent.id}_${Date.now()}`,
            sentBy: agent.id, sentByName: agent.name, sentByAgent: true, agentId: agent.id,
            status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('customer_conversations').doc(convId).update({
            lastMessage: { text: replyText, direction: 'outbound', timestamp: admin.firestore.FieldValue.serverTimestamp(), agentName: agent.name },
            aiHandled: true, assignedAgent: agent.id, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // Handle handoff directive
    if (handoff) {
        await db.collection('customer_conversations').doc(convId).update({
            status: 'pending', assignedDepartment: handoff.department,
            aiHandled: false, assignedAgent: null,
            handoffNote: `${agent.name}: ${handoff.reason}`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection(`customer_conversations/${convId}/messages`).add({
            direction: 'outbound', type: 'text',
            content: `📌 Conectando con ${handoff.department}${handoff.reason ? ': ' + handoff.reason : ''}…`,
            platformMessageId: `handoff_${Date.now()}`, sentByAgent: true, isSystemNote: true,
            sentByName: 'Sistema', status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // Log usage
    await db.collection('ai_agent_logs').add({
        agentId: agent.id, conversationId: convId, channel: convData.channel ?? 'unknown',
        trigger: 'inbound_message', inputTokens, outputTokens, latencyMs,
        handoffTriggered: !!handoff, handoffDepartment: handoff?.department ?? null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return replyText;
}

// ── inboxMessageRouter — Firestore trigger ────────────────────────────────────

export const inboxMessageRouter = functions.firestore
    .document('customer_conversations/{convId}/messages/{msgId}')
    .onCreate(async (snap, context) => {
        const msg = snap.data();
        if (msg.direction !== 'inbound' || msg.aiRouted) return;
        const { convId } = context.params;
        try {
            const convSnap = await db.collection('customer_conversations').doc(convId).get();
            if (!convSnap.exists) return;
            const convData = { id: convId, ...convSnap.data() } as any;
            if (convData.assignedTo && !convData.aiHandled) return;

            let bh: BusinessHoursConfig | null = null;
            try { const s = await db.collection('config').doc('business_hours').get(); if (s.exists) bh = s.data() as BusinessHoursConfig; } catch { /* ok */ }

            const agentsSnap = await db.collection('ai_agents').where('status', '==', 'active').get();
            if (agentsSnap.empty) return;

            let bestAgent: any = null;
            let bestPriority   = Infinity;
            for (const d of agentsSnap.docs) {
                const agent = { id: d.id, ...d.data() } as any;
                for (const binding of (agent.channelBindings ?? [])) {
                    if (!binding.enabled || binding.channel !== convData.channel || binding.priority >= bestPriority) continue;
                    if (await evaluateConditions(binding.conditions ?? [], convId, convData, bh)) {
                        bestAgent = agent; bestPriority = binding.priority;
                    }
                }
            }
            if (!bestAgent) return;

            await snap.ref.update({ aiRouted: true });
            await runAgentOrchestrator(convId, bestAgent);
        } catch (err: any) {
            console.error('[inboxMessageRouter]', err.message);
        }
    });

// ── agentOrchestrator — Callable ──────────────────────────────────────────────

export const agentOrchestrator = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { conversationId, agentId } = data;
    if (!conversationId || !agentId) throw new functions.https.HttpsError('invalid-argument', 'Missing params.');
    const agentSnap = await db.collection('ai_agents').doc(agentId).get();
    if (!agentSnap.exists) throw new functions.https.HttpsError('not-found', 'Agent not found.');
    try {
        const reply = await runAgentOrchestrator(conversationId, { id: agentId, ...agentSnap.data() });
        return { ok: true, reply };
    } catch (err: any) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});

// ── agentHandoff — Callable ───────────────────────────────────────────────────

export const agentHandoff = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { conversationId, department, reason } = data;
    if (!conversationId || !department) throw new functions.https.HttpsError('invalid-argument', 'Missing params.');
    await db.collection('customer_conversations').doc(conversationId).update({
        status: 'pending', assignedDepartment: department, aiHandled: false, assignedAgent: null,
        handoffNote: reason ?? '', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection(`customer_conversations/${conversationId}/messages`).add({
        direction: 'outbound', type: 'text',
        content: `📌 Asignado a ${department}${reason ? ': ' + reason : ''}`,
        platformMessageId: `handoff_manual_${Date.now()}`, sentByAgent: true, isSystemNote: true,
        sentByName: 'Sistema', status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
