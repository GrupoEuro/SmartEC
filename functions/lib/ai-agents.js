"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentHandoff = exports.agentOrchestrator = exports.inboxMessageRouter = void 0;
/**
 * EuroMind IA Agents — Cloud Functions
 * inboxMessageRouter, agentOrchestrator, agentHandoff
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const db = admin.firestore();
// ── Business Hours ─────────────────────────────────────────────────────────────
function isWithinBusinessHours(config, date = new Date()) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const tz = config.timezone || 'America/Mexico_City';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    const dayName = (_c = (_b = (_a = parts.find(p => p.type === 'weekday')) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== null && _c !== void 0 ? _c : '';
    const hour = parseInt((_e = (_d = parts.find(p => p.type === 'hour')) === null || _d === void 0 ? void 0 : _d.value) !== null && _e !== void 0 ? _e : '0', 10);
    const minute = parseInt((_g = (_f = parts.find(p => p.type === 'minute')) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0 ? _g : '0', 10);
    const current = hour * 60 + minute;
    const dayMap = {
        monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
        thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
    };
    const key = dayMap[dayName];
    if (!key)
        return false;
    const sched = (_h = config.schedule) === null || _h === void 0 ? void 0 : _h[key];
    if (!(sched === null || sched === void 0 ? void 0 : sched.enabled))
        return false;
    const [openH, openM] = sched.openTime.split(':').map(Number);
    const [closeH, closeM] = sched.closeTime.split(':').map(Number);
    return current >= (openH * 60 + openM) && current < (closeH * 60 + closeM);
}
// ── Condition Evaluator ───────────────────────────────────────────────────────
async function evaluateConditions(conditions, convId, convData, businessHours) {
    var _a, _b, _c, _d;
    if (!(conditions === null || conditions === void 0 ? void 0 : conditions.length))
        return true;
    for (const cond of conditions) {
        switch (cond.type) {
            case 'always': return true;
            case 'afterHours':
                if (!businessHours || !isWithinBusinessHours(businessHours))
                    return true;
                break;
            case 'businessHours':
                if (businessHours && isWithinBusinessHours(businessHours))
                    return true;
                break;
            case 'firstContact': {
                const snap = await db
                    .collection(`customer_conversations/${convId}/messages`)
                    .where('direction', '==', 'inbound').limit(2).get();
                if (snap.size <= 1)
                    return true;
                break;
            }
            case 'keywordMatch': {
                const text = ((_b = (_a = convData.lastMessage) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '').toLowerCase();
                if (((_c = cond.keywords) !== null && _c !== void 0 ? _c : []).some((kw) => text.includes(kw.toLowerCase())))
                    return true;
                break;
            }
            case 'noHumanReplyWithin': {
                const since = new Date(Date.now() - ((_d = cond.minutes) !== null && _d !== void 0 ? _d : 5) * 60 * 1000);
                const snap = await db
                    .collection(`customer_conversations/${convId}/messages`)
                    .where('direction', '==', 'outbound')
                    .where('sentByAgent', '==', false)
                    .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(since))
                    .limit(1).get();
                if (snap.empty)
                    return true;
                break;
            }
        }
    }
    return false;
}
// ── Gemini Caller ─────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, history, model = 'gemini-1.5-pro', temperature = 0.7, maxTokens = 512) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const projectId = 'tiendapraxis';
    const location = 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const { GoogleAuth } = await Promise.resolve().then(() => require('google-auth-library'));
    const token = await (new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })).getAccessToken();
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: history,
            generationConfig: { temperature, maxOutputTokens: maxTokens, topP: 0.95 },
        }),
    });
    if (!res.ok)
        throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
        text: (_f = (_e = (_d = (_c = (_b = (_a = data.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.text) !== null && _f !== void 0 ? _f : '',
        inputTokens: (_h = (_g = data.usageMetadata) === null || _g === void 0 ? void 0 : _g.promptTokenCount) !== null && _h !== void 0 ? _h : 0,
        outputTokens: (_k = (_j = data.usageMetadata) === null || _j === void 0 ? void 0 : _j.candidatesTokenCount) !== null && _k !== void 0 ? _k : 0,
    };
}
// ── Handoff Parser ────────────────────────────────────────────────────────────
function parseHandoff(text) {
    var _a;
    const m = text.match(/\[HANDOFF:\s*department=([^\]\s]+)(?:\s+reason=([^\]]+))?\]/i);
    return m ? { department: m[1].trim(), reason: ((_a = m[2]) !== null && _a !== void 0 ? _a : '').trim() } : null;
}
function stripDirectives(text) {
    return text.replace(/\[(HANDOFF|COLLECT|REPLY)[^\]]*\]/gi, '').trim();
}
// ── Core Orchestrator ─────────────────────────────────────────────────────────
async function runAgentOrchestrator(convId, agent) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const start = Date.now();
    const convSnap = await db.collection('customer_conversations').doc(convId).get();
    if (!convSnap.exists)
        throw new Error('Conversation not found');
    const convData = convSnap.data();
    // Build history
    const msgsSnap = await db.collection(`customer_conversations/${convId}/messages`)
        .orderBy('timestamp', 'desc').limit((_a = agent.contextMessageCount) !== null && _a !== void 0 ? _a : 10).get();
    const history = [];
    msgsSnap.docs.reverse().forEach(d => {
        var _a;
        const m = d.data();
        if (!((_a = m.content) === null || _a === void 0 ? void 0 : _a.trim()) || m.isSystemNote)
            return;
        history.push({ role: m.direction === 'inbound' ? 'user' : 'model', parts: [{ text: m.content }] });
    });
    if (!history.length || history[history.length - 1].role !== 'user')
        return '';
    // Load knowledge base
    let kbContext = '';
    try {
        const kbSnap = await db.collection('ai_knowledge')
            .where('agentId', '==', agent.id).where('enabled', '==', true).limit(20).get();
        if (!kbSnap.empty) {
            kbContext = '\n\n--- BASE DE CONOCIMIENTO ---\n' +
                kbSnap.docs.map(d => { const kb = d.data(); return `[${kb.category}] ${kb.title}:\n${kb.content}`; }).join('\n\n') +
                '\n--- FIN BASE DE CONOCIMIENTO ---';
        }
    }
    catch ( /* non-blocking */_o) { /* non-blocking */ }
    // Build system prompt
    const tone = (_b = agent.toneConfig) !== null && _b !== void 0 ? _b : {};
    const maxSentences = (_c = tone.maxSentences) !== null && _c !== void 0 ? _c : 3;
    const toneInstr = {
        professional: 'Usa un tono profesional y amable, como un ejecutivo de atención a clientes mexicano.',
        friendly: 'Usa un tono cercano, cálido y amigable.',
        formal: 'Usa un tono formal y respetuoso.',
        casual: 'Usa un tono casual y relajado.',
    };
    let systemPrompt = ((_d = agent.systemPrompt) !== null && _d !== void 0 ? _d : '').replace('{{maxSentences}}', String(maxSentences));
    systemPrompt += `\n\nTono: ${(_f = toneInstr[(_e = tone.tone) !== null && _e !== void 0 ? _e : 'professional']) !== null && _f !== void 0 ? _f : ''} Máximo ${maxSentences} oraciones por respuesta. ${tone.useEmojis ? 'Puedes usar emojis con moderación.' : 'No uses emojis.'}${kbContext}`;
    // Call AI
    const mc = (_g = agent.modelConfig) !== null && _g !== void 0 ? _g : {};
    const { text, inputTokens, outputTokens } = await callGemini(systemPrompt, history, (_h = mc.model) !== null && _h !== void 0 ? _h : 'gemini-1.5-pro', (_j = mc.temperature) !== null && _j !== void 0 ? _j : 0.7, (_k = mc.maxTokens) !== null && _k !== void 0 ? _k : 512);
    const latencyMs = Date.now() - start;
    const handoff = parseHandoff(text);
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
        agentId: agent.id, conversationId: convId, channel: (_l = convData.channel) !== null && _l !== void 0 ? _l : 'unknown',
        trigger: 'inbound_message', inputTokens, outputTokens, latencyMs,
        handoffTriggered: !!handoff, handoffDepartment: (_m = handoff === null || handoff === void 0 ? void 0 : handoff.department) !== null && _m !== void 0 ? _m : null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => { });
    return replyText;
}
// ── inboxMessageRouter — Firestore trigger ────────────────────────────────────
exports.inboxMessageRouter = functions.firestore
    .document('customer_conversations/{convId}/messages/{msgId}')
    .onCreate(async (snap, context) => {
    var _a, _b;
    const msg = snap.data();
    if (msg.direction !== 'inbound' || msg.aiRouted)
        return;
    const { convId } = context.params;
    try {
        const convSnap = await db.collection('customer_conversations').doc(convId).get();
        if (!convSnap.exists)
            return;
        const convData = Object.assign({ id: convId }, convSnap.data());
        if (convData.assignedTo && !convData.aiHandled)
            return;
        let bh = null;
        try {
            const s = await db.collection('config').doc('business_hours').get();
            if (s.exists)
                bh = s.data();
        }
        catch ( /* ok */_c) { /* ok */ }
        const agentsSnap = await db.collection('ai_agents').where('status', '==', 'active').get();
        if (agentsSnap.empty)
            return;
        let bestAgent = null;
        let bestPriority = Infinity;
        for (const d of agentsSnap.docs) {
            const agent = Object.assign({ id: d.id }, d.data());
            for (const binding of ((_a = agent.channelBindings) !== null && _a !== void 0 ? _a : [])) {
                if (!binding.enabled || binding.channel !== convData.channel || binding.priority >= bestPriority)
                    continue;
                if (await evaluateConditions((_b = binding.conditions) !== null && _b !== void 0 ? _b : [], convId, convData, bh)) {
                    bestAgent = agent;
                    bestPriority = binding.priority;
                }
            }
        }
        if (!bestAgent)
            return;
        await snap.ref.update({ aiRouted: true });
        await runAgentOrchestrator(convId, bestAgent);
    }
    catch (err) {
        console.error('[inboxMessageRouter]', err.message);
    }
});
// ── agentOrchestrator — Callable ──────────────────────────────────────────────
exports.agentOrchestrator = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { conversationId, agentId } = data;
    if (!conversationId || !agentId)
        throw new functions.https.HttpsError('invalid-argument', 'Missing params.');
    const agentSnap = await db.collection('ai_agents').doc(agentId).get();
    if (!agentSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Agent not found.');
    try {
        const reply = await runAgentOrchestrator(conversationId, Object.assign({ id: agentId }, agentSnap.data()));
        return { ok: true, reply };
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ── agentHandoff — Callable ───────────────────────────────────────────────────
exports.agentHandoff = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    const { conversationId, department, reason } = data;
    if (!conversationId || !department)
        throw new functions.https.HttpsError('invalid-argument', 'Missing params.');
    await db.collection('customer_conversations').doc(conversationId).update({
        status: 'pending', assignedDepartment: department, aiHandled: false, assignedAgent: null,
        handoffNote: reason !== null && reason !== void 0 ? reason : '', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection(`customer_conversations/${conversationId}/messages`).add({
        direction: 'outbound', type: 'text',
        content: `📌 Asignado a ${department}${reason ? ': ' + reason : ''}`,
        platformMessageId: `handoff_manual_${Date.now()}`, sentByAgent: true, isSystemNote: true,
        sentByName: 'Sistema', status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
//# sourceMappingURL=ai-agents.js.map