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

/**
 * Calls the Gemini API with a system prompt and message history.
 *
 * @param forceJson - Set true only for structured-output calls (analyzeMeliInsights).
 *                    Leave false for free-text responses (EuroMind chat, weekly report).
 *                    Using responseMimeType:'application/json' on free-text calls causes
 *                    internal errors when Gemini cannot produce valid JSON.
 */
async function callGemini(
    systemPrompt: string,
    history: Array<{ role: 'user'|'model'; parts: Array<{ text: string }> }>,
    modelName = 'gemini-2.5-pro',
    temperature = 0.2,
    maxTokens = 8192,
    forceJson = false
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = await import('@google/generative-ai');
    const apiKey = functions.config().gemini?.apikey;

    if (!apiKey) {
        throw new Error('Gemini API key is not configured in Firebase environment (gemini.apikey)');
    }

    // Must have at least one user turn
    const contents = history.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: msg.parts.map(p => ({ text: p.text }))
    }));
    if (contents.length === 0) {
        throw new Error('[callGemini] history cannot be empty — at least one user message is required.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            // Only force JSON mode for structured-output calls.
            // Free-text calls (EuroMind chat, weekly report) must NOT set this.
            ...(forceJson ? { responseMimeType: 'application/json' } : {}),
        },
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
    });

    try {
        const result   = await model.generateContent({ contents });
        const response = await result.response;
        return {
            text:         response.text(),
            inputTokens:  response.usageMetadata?.promptTokenCount     ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
    } catch (err: any) {
        console.error('[callGemini] Gemini SDK error:', err.message);
        throw err;
    }
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

// ── MercadoLibre AI Insights Engine ──────────────────────────────────────────

export const analyzeMeliInsights = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .pubsub.schedule('0 2 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async (context) => {
        await runAnalyzeMeliInsightsLogic();
    });

export const testAnalyzeMeliInsights = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onRequest(async (req, res) => {
        try {
            await runAnalyzeMeliInsightsLogic();
            res.status(200).send("Success");
        } catch (e: any) {
            res.status(500).send(e.toString());
        }
    });

async function runAnalyzeMeliInsightsLogic() {
    const start = Date.now();
    console.log('[analyzeMeliInsights] Starting daily insights generation...');
    
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const convSnap = await db.collection('customer_conversations')
        .where('channel', '==', 'mercadolibre')
        .where('updatedAt', '>=', admin.firestore.Timestamp.fromDate(yesterday))
        .get();

    if (convSnap.empty) {
        console.log('[analyzeMeliInsights] No recent MercadoLibre conversations found.');
        return;
    }

    const itemQuestions: Record<string, string[]> = {};
    
    for (const doc of convSnap.docs) {
        const data = doc.data();
        if (!data.tags?.includes('Pre-Venta')) continue;
        
        const match = doc.id.match(/^meli_q_(.+)_([^_]+)$/);
        if (!match) continue;
        
        const itemId = match[1];

        const msgSnap = await db.collection(`customer_conversations/${doc.id}/messages`)
            .where('direction', '==', 'inbound')
            .get();

        if (!itemQuestions[itemId]) {
            itemQuestions[itemId] = [];
        }

        msgSnap.docs.forEach(m => {
            const text = m.data().content;
            if (text && text.trim()) {
                itemQuestions[itemId].push(text.trim());
            }
        });
    }

    const itemsToAnalyze = Object.keys(itemQuestions);
    console.log(`[analyzeMeliInsights] Found ${itemsToAnalyze.length} items with recent questions.`);

    for (const itemId of itemsToAnalyze) {
        const questions = itemQuestions[itemId];
        if (questions.length === 0) continue;

        console.log(`[analyzeMeliInsights] Analyzing ${itemId} (${questions.length} questions)...`);

        const systemPrompt = `Eres un experto en optimización de e-commerce automotriz y refacciones.
Tu objetivo es analizar preguntas reales de clientes sobre una publicación de MercadoLibre y extraer recomendaciones accionables para mejorar la descripción del producto, reducir fricción, y aumentar ventas.

Analiza este grupo de preguntas para el Item ID: ${itemId} y devuelve un objeto JSON estructurado con el siguiente formato estricto:
{
  "summary": "Resumen de las dudas principales de los clientes",
  "missingInformation": ["Falta 1", "Falta 2"],
  "actionableRecommendations": ["Agrega X a la descripción", "Aclara Y en las fotos"]
}
No devuelvas ningún texto fuera del JSON. Devuelve el JSON puro sin bloques markdown de codigo.`;

        const history = [{
            role: 'user' as const,
            parts: [{ text: `Preguntas de los clientes:\n\n${questions.map(q => '- ' + q).join('\n')}` }]
        }];

        try {
            const { text } = await callGemini(systemPrompt, history, 'gemini-2.5-pro', 0.2, 8192, true /* forceJson */);
            let parsedInsights;
            
            try {
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                parsedInsights = JSON.parse(cleanText);
            } catch (e) {
                console.error(`[analyzeMeliInsights] Failed to parse JSON for ${itemId}:`, text);
                continue;
            }

            await db.collection('meli_insights').doc(itemId).set({
                itemId,
                lastAnalyzedAt: admin.firestore.FieldValue.serverTimestamp(),
                questionCount: questions.length,
                summary: parsedInsights.summary || '',
                missingInformation: parsedInsights.missingInformation || [],
                actionableRecommendations: parsedInsights.actionableRecommendations || [],
                recentQuestions: questions.slice(0, 5) // Store top 5 as sample
            }, { merge: true });

        } catch (err: any) {
            console.error(`[analyzeMeliInsights] Gemini API error for ${itemId}:`, err.message);
        }
    }

    console.log(`[analyzeMeliInsights] Completed in ${Date.now() - start}ms. Analyzed ${itemsToAnalyze.length} items.`);
}

// ── EuroMind Executive Functions ───────────────────────────────────────────────

export const euromindWeeklyReport = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .pubsub.schedule('0 8 * * 0') // Every Sunday at 8:00 AM
    .timeZone('America/Mexico_City')
    .onRun(async (context) => {
        const start = Date.now();
        console.log('[euromindWeeklyReport] Starting weekly report generation...');
        
        const systemPrompt = `Eres EuroMind, el asistente ejecutivo de inteligencia artificial de Importadora Euro.
Tu tarea es generar un informe semanal para la directiva, analizando el desempeño de esta semana basándote en la información disponible.
Destaca fortalezas, áreas de oportunidad y sugerencias estratégicas de mejora.`;
        
        const history = [{
            role: 'user' as const,
            parts: [{ text: `Genera el informe ejecutivo de esta semana.` }]
        }];
        
        try {
            const { text, inputTokens, outputTokens } = await callGemini(systemPrompt, history, 'gemini-2.5-pro', 0.5, 8192);
            
            await db.collection('euromind_reports').add({
                type: 'weekly',
                content: text,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            
            await db.collection('ai_interactions').add({
                agentId: 'euromind',
                trigger: 'weekly_cron',
                inputTokens,
                outputTokens,
                latencyMs: Date.now() - start,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('[euromindWeeklyReport] Error generating report:', error);
        }
    });

export const askEuroMind = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { query, isDashboardOnDemand, contextData } = data;
    
    if (!query && !isDashboardOnDemand) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing query.');
    }

    const start = Date.now();
    let prompt = query;
    if (isDashboardOnDemand) {
        prompt = "Genera un reporte express On-Demand de la situación actual del día de hoy en Importadora Euro.";
    }

    if (contextData) {
        prompt += `\n\nContexto de negocio:\n${JSON.stringify(contextData)}`;
    }

    const systemPrompt = `Eres EuroMind, el asistente de inteligencia artificial exclusivo para la directiva de Importadora Euro.
Tienes acceso a los KPIs y contexto de negocio si se proporciona. Responde de forma precisa y ejecutiva a las dudas del usuario. Tu objetivo es optimizar ventas, inventario y la operación.`;

    const history = [{
        role: 'user' as const,
        parts: [{ text: prompt }]
    }];

    try {
        const { text, inputTokens, outputTokens } = await callGemini(systemPrompt, history, 'gemini-2.5-pro', 0.5, 8192);
        
        await db.collection('ai_interactions').add({
            agentId: 'euromind',
            trigger: isDashboardOnDemand ? 'on_demand' : 'user_query',
            prompt: prompt,
            response: text,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - start,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return { ok: true, reply: text };
    } catch (err: any) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
