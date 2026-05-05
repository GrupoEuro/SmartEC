import { Timestamp } from '@angular/fire/firestore';


// ── Tone & Language ────────────────────────────────────────────────────────────

export type AgentLanguage = 'es-MX' | 'en-US' | 'auto';
export type AgentTone     = 'professional' | 'friendly' | 'formal' | 'casual';

export interface AgentToneConfig {
    language:       AgentLanguage;
    tone:           AgentTone;
    useEmojis:      boolean;
    maxSentences:   number;   // 1–5, max sentences per reply
}

// ── AI Model Config ────────────────────────────────────────────────────────────

export type AgentModel = 'gemini-1.5-pro' | 'gemini-1.5-flash' | 'gemini-2.0-flash';

export interface AgentModelConfig {
    model:       AgentModel;
    temperature: number;   // 0.0–1.0
    maxTokens:   number;   // 256–4096
    topK?:       number;
    topP?:       number;
}

// ── Conditions ─────────────────────────────────────────────────────────────────

export type AgentConditionType =
    | 'always'
    | 'afterHours'
    | 'businessHours'
    | 'firstContact'
    | 'keywordMatch'
    | 'noHumanReplyWithin';

export type AgentCondition =
    | { type: 'always' }
    | { type: 'afterHours' }
    | { type: 'businessHours' }
    | { type: 'firstContact' }
    | { type: 'keywordMatch';       keywords: string[] }
    | { type: 'noHumanReplyWithin'; minutes: number   };

// ── Channel Binding ────────────────────────────────────────────────────────────

export interface AgentChannelBinding {
    id?:             string;
    channel:         string; // Channel type
    enabled:         boolean;
    conditions:      AgentCondition[];
    priority:        number;          // 1 = highest priority
    greetingMessage?: string;         // Optional override first message
}

// ── Knowledge Base Entry ───────────────────────────────────────────────────────

export interface AgentKnowledgeEntry {
    id?:      string;
    agentId:  string;
    title:    string;
    content:  string;    // Plain text Q&A or FAQ content
    category: string;
    enabled:  boolean;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

// ── Escalation / Handoff ───────────────────────────────────────────────────────

export interface AgentHandoffRule {
    triggerPhrases:   string[];   // e.g., ['hablar con alguien', 'vendedor', 'humano']
    department:       string;     // e.g., 'Ventas'
    reason?:          string;     // Description for the human receiving the handoff
}

// ── Agent Status ───────────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'inactive' | 'draft';

// ── Main Agent Interface ───────────────────────────────────────────────────────

export interface AiAgent {
    id?:                  string;
    name:                 string;
    description:          string;
    status:               AgentStatus;
    avatarEmoji:          string;         // e.g., '🤖', '⚡', '🌟'
    modelConfig:          AgentModelConfig;
    toneConfig:           AgentToneConfig;
    systemPrompt:         string;         // Full personality + instructions
    channelBindings:      AgentChannelBinding[];
    knowledgeBaseIds:     string[];       // References to /ai_knowledge docs
    handoffRules:         AgentHandoffRule[];
    escalationDepartments: string[];      // Available departments
    contextMessageCount:  number;         // How many past messages to include (5–25)
    createdAt?:           Timestamp;
    updatedAt?:           Timestamp;
    createdBy?:           string;
}

// ── Agent Analytics Log ────────────────────────────────────────────────────────

export interface AgentLog {
    id?:               string;
    agentId:           string;
    conversationId:    string;
    channel:           string;
    trigger:           string;            // Which condition matched
    inputTokens:       number;
    outputTokens:      number;
    latencyMs:         number;
    handoffTriggered:  boolean;
    handoffDepartment?: string;
    timestamp:         Timestamp;
}

// ── Agent Stats (computed for list view) ──────────────────────────────────────

export interface AgentStats {
    agentId:            string;
    totalHandled:       number;    // Conversations AI responded to
    handoffRate:        number;    // % that ended in human handoff
    avgLatencyMs:       number;
    totalInputTokens:   number;
    totalOutputTokens:  number;
    period:             '7d' | '30d';
}

// ── Business Hours ─────────────────────────────────────────────────────────────

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface DaySchedule {
    enabled:   boolean;
    openTime:  string;   // "HH:mm" 24h format e.g. "09:00"
    closeTime: string;   // "HH:mm" 24h format e.g. "18:00"
}

export interface BusinessHoursConfig {
    timezone: string;   // e.g. "America/Mexico_City"
    schedule: Record<DayOfWeek, DaySchedule>;
    updatedAt?: Timestamp;
}

// ── Default values ─────────────────────────────────────────────────────────────

export const DEFAULT_DEPARTMENTS = [
    'Atención a Clientes',
    'Facturación',
    'Ventas',
    'Soporte',
];

export const DEFAULT_MODEL_CONFIG: AgentModelConfig = {
    model:       'gemini-1.5-pro',
    temperature: 0.7,
    maxTokens:   512,
};

export const DEFAULT_TONE_CONFIG: AgentToneConfig = {
    language:     'es-MX',
    tone:         'professional',
    useEmojis:    false,
    maxSentences: 3,
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
    timezone: 'America/Mexico_City',
    schedule: {
        monday:    { enabled: true,  openTime: '09:00', closeTime: '18:00' },
        tuesday:   { enabled: true,  openTime: '09:00', closeTime: '18:00' },
        wednesday: { enabled: true,  openTime: '09:00', closeTime: '18:00' },
        thursday:  { enabled: true,  openTime: '09:00', closeTime: '18:00' },
        friday:    { enabled: true,  openTime: '09:00', closeTime: '18:00' },
        saturday:  { enabled: true,  openTime: '09:00', closeTime: '14:00' },
        sunday:    { enabled: false, openTime: '09:00', closeTime: '14:00' },
    },
};

export const AFTER_HOURS_AGENT_TEMPLATE: Partial<AiAgent> = {
    name:        'EuroBot — Asistente Fuera de Horario',
    description: 'Atiende clientes fuera del horario de atención, responde preguntas generales y captura datos para seguimiento.',
    avatarEmoji: '🤖',
    status:      'draft',
    modelConfig: DEFAULT_MODEL_CONFIG,
    toneConfig:  DEFAULT_TONE_CONFIG,
    systemPrompt: `Eres EuroBot, el asistente virtual de Importadora Euro, empresa líder en neumáticos y rines en México.

En este momento la tienda está fuera del horario de atención. Tu misión es:
1. Responder preguntas generales sobre productos, servicios y la empresa.
2. Si el cliente necesita cotización exacta o quiere hacer un pedido, captura su nombre y número de teléfono para que un asesor lo contacte en el próximo horario hábil.
3. Informar amablemente los horarios de atención.

Reglas estrictas:
- Responde siempre en español mexicano, tono profesional y amable.
- Máximo {{maxSentences}} oraciones por respuesta.
- NO inventes precios exactos; menciona que los precios varían según medida y marca.
- Si el cliente dice "hablar con persona", "asesor" o "vendedor" → usa [HANDOFF: department=Atención a Clientes reason=Cliente solicita atención humana]
- Nunca prometas tiempos de entrega específicos.`,
    channelBindings: [
        { channel: 'website', enabled: true, conditions: [{ type: 'afterHours' }], priority: 1 }
    ],
    handoffRules: [
        {
            triggerPhrases: ['hablar con persona', 'asesor', 'vendedor', 'humano', 'agente'],
            department: 'Atención a Clientes',
        }
    ],
    escalationDepartments: DEFAULT_DEPARTMENTS,
    contextMessageCount: 10,
};

export const TRIAGE_AGENT_TEMPLATE: Partial<AiAgent> = {
    name:        'EuroTriage — Enrutador Inteligente',
    description: 'Recibe a los clientes, hace UNA pregunta de triaje y los conecta con el equipo correcto.',
    avatarEmoji: '⚡',
    status:      'draft',
    modelConfig: { ...DEFAULT_MODEL_CONFIG, temperature: 0.3 },
    toneConfig:  { ...DEFAULT_TONE_CONFIG, useEmojis: true, maxSentences: 2 },
    systemPrompt: `Eres el asistente de bienvenida de Importadora Euro.

Tu única tarea es hacer UNA pregunta al cliente para entender qué necesita, y luego conectarlo con el equipo correcto.

Equipos disponibles:
- Ventas: compra de llantas, rines, kits, cotizaciones, disponibilidad
- Facturación: facturas, pagos, comprobantes fiscales
- Atención a Clientes: dudas generales, seguimiento de pedidos, devoluciones
- Soporte: problemas técnicos, garantías, quejas

Tu primer mensaje SIEMPRE debe ser:
"¡Hola! 👋 Bienvenido a Importadora Euro. ¿En qué te podemos ayudar hoy?\n\n🔵 Compra / Cotización\n🟢 Facturación\n🟡 Seguimiento de pedido\n🔴 Soporte / Garantías"

Cuando el cliente responda, analiza su intención y usa EXACTAMENTE:
[HANDOFF: department=Ventas reason=Cliente interesado en compra de neumáticos]

Reemplaza el department y reason con los valores correctos.`,
    channelBindings: [
        { channel: 'website',  enabled: true, conditions: [{ type: 'firstContact' }], priority: 1 },
        { channel: 'whatsapp', enabled: true, conditions: [{ type: 'firstContact' }], priority: 1 },
    ],
    handoffRules: [
        { triggerPhrases: ['comprar', 'cotizar', 'precio', 'llanta', 'rin', 'cuánto'], department: 'Ventas' },
        { triggerPhrases: ['factura', 'cfdi', 'pago', 'comprobante'],                  department: 'Facturación' },
        { triggerPhrases: ['garantía', 'queja', 'problema', 'defecto', 'soporte'],     department: 'Soporte' },
    ],
    escalationDepartments: DEFAULT_DEPARTMENTS,
    contextMessageCount: 5,
};
