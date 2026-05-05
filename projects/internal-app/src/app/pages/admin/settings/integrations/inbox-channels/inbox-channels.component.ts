import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../../core/services/toast.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChannelCreds {
    // Meta (WA / IG / FB)
    verifyToken?: string;
    waToken?: string;
    waPhoneId?: string;
    igToken?: string;
    fbPageToken?: string;
    // Telegram
    botToken?: string;
    // Email
    sendgridKey?: string;
    replyFrom?: string;
}

interface ChannelDoc {
    enabled:     boolean;
    connected:   boolean;
    displayName: string;
    handle:      string;
    creds?:      ChannelCreds; // stored encrypted in a secure sub-doc
}

interface InboxDoc {
    whatsapp?:  Partial<ChannelDoc>;
    instagram?: Partial<ChannelDoc>;
    facebook?:  Partial<ChannelDoc>;
    telegram?:  Partial<ChannelDoc>;
    email?:     Partial<ChannelDoc>;
    website?:   Partial<ChannelDoc>;
    updatedAt?: any;
}

// ── Static channel metadata ────────────────────────────────────────────────────

const BASE_URL = 'https://us-central1-tiendapraxis.cloudfunctions.net';

interface ChannelMeta {
    id:         string;
    label:      string;
    color:      string;
    icon:       string;
    webhookUrl: string;
    credFields: Array<{
        key:         keyof ChannelCreds;
        label:       string;
        placeholder: string;
        hint?:       string;
        type?:       'text' | 'password';
    }>;
    handleLabel?:       string;
    handlePlaceholder?: string;
    setupGuide:         string;
    docsUrl:            string;
}

const CHANNELS: ChannelMeta[] = [
    {
        id: 'website', label: 'Chat Web', color: '#8b5cf6', icon: 'globe',
        webhookUrl: '',
        credFields: [],
        setupGuide: 'Activo automáticamente. Los visitantes de la tienda pueden chatear en tiempo real y el equipo responde desde el Inbox.',
        docsUrl: '',
    },
    {
        id: 'whatsapp', label: 'WhatsApp', color: '#25d366', icon: 'message-circle',
        webhookUrl: `${BASE_URL}/metaInboxWebhook`,
        handleLabel: 'Número de teléfono', handlePlaceholder: '+521234567890',
        credFields: [
            { key: 'verifyToken', label: 'Verify Token',       placeholder: 'mi_token_secreto',   hint: 'Crea un token libre y ponlo también en Meta for Developers' },
            { key: 'waToken',     label: 'Access Token (WA)',  placeholder: 'EAAxxxxx…',            type: 'password' },
            { key: 'waPhoneId',   label: 'Phone Number ID',    placeholder: '1234567890',           hint: 'Encuéntralo en Meta → WhatsApp → API Setup' },
        ],
        setupGuide: 'En Meta for Developers → tu App → WhatsApp → Configuration: pega la URL del webhook y el Verify Token.',
        docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks',
    },
    {
        id: 'instagram', label: 'Instagram', color: '#e1306c', icon: 'instagram',
        webhookUrl: `${BASE_URL}/metaInboxWebhook`,
        handleLabel: '@username de Instagram', handlePlaceholder: '@importadoraeuro',
        credFields: [
            { key: 'verifyToken', label: 'Verify Token',          placeholder: 'mi_token_secreto' },
            { key: 'igToken',     label: 'Page Access Token (IG)', placeholder: 'EAAxxxxx…', type: 'password' },
        ],
        setupGuide: 'Mismo webhook que WhatsApp. Activa Instagram Messaging en tu Meta App y suscríbete al evento messages.',
        docsUrl: 'https://developers.facebook.com/docs/messenger-platform/instagram',
    },
    {
        id: 'facebook', label: 'Facebook', color: '#1877f2', icon: 'facebook',
        webhookUrl: `${BASE_URL}/metaInboxWebhook`,
        handleLabel: 'Facebook Page ID', handlePlaceholder: '123456789012345',
        credFields: [
            { key: 'verifyToken',  label: 'Verify Token',            placeholder: 'mi_token_secreto' },
            { key: 'fbPageToken',  label: 'Page Access Token (FB)',   placeholder: 'EAAxxxxx…', type: 'password' },
        ],
        setupGuide: 'En tu Facebook App → Messenger → Settings → Webhooks: pega la URL y el Verify Token.',
        docsUrl: 'https://developers.facebook.com/docs/messenger-platform/webhooks',
    },
    {
        id: 'telegram', label: 'Telegram', color: '#0088cc', icon: 'send',
        webhookUrl: `${BASE_URL}/telegramInboxWebhook`,
        handleLabel: 'Bot @username', handlePlaceholder: '@EuroImportaBot',
        credFields: [
            { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEFxxxxx', type: 'password',
              hint: 'Obtenlo enviando /newbot a @BotFather en Telegram' },
        ],
        setupGuide: 'Crea tu bot con @BotFather, copia el token y pégalo aquí. Al guardar, el webhook se registra automáticamente.',
        docsUrl: 'https://core.telegram.org/bots/tutorial',
    },
    {
        id: 'email', label: 'Email', color: '#6366f1', icon: 'mail',
        webhookUrl: `${BASE_URL}/emailInboxWebhook`,
        handleLabel: 'Email de respuesta', handlePlaceholder: 'soporte@importadoraeuro.com',
        credFields: [
            { key: 'sendgridKey', label: 'SendGrid API Key',  placeholder: 'SG.xxxxxxxxxx', type: 'password',
              hint: 'En SendGrid: Settings → API Keys → Create API Key (Mail Send + Inbound Parse)' },
            { key: 'replyFrom',   label: 'Email "From"',      placeholder: 'soporte@importadoraeuro.com' },
        ],
        setupGuide: 'En SendGrid → Settings → Inbound Parse → Add Host & URL: usa la URL del webhook de arriba.',
        docsUrl: 'https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook',
    },
];

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
    selector: 'app-inbox-channels',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
<div class="page-wrap">

    <!-- Header -->
    <div class="page-header">
        <div class="page-header-left">
            <div class="header-icon">
                <app-icon name="inbox" [size]="22"></app-icon>
            </div>
            <div>
                <h1 class="page-title">Canales — Atención al Cliente</h1>
                <p class="page-sub">Conecta cada canal de mensajería al Universal Inbox en pocos pasos.</p>
            </div>
        </div>
        <a href="/customer-care/inbox" target="_blank" class="btn-secondary">
            <app-icon name="external-link" [size]="14"></app-icon>
            Abrir Inbox
        </a>
    </div>

    <!-- Analytics shortcut -->
    <div class="analytics-link-row">
        <a href="/customer-care/analytics" target="_blank" class="btn-analytics">
            <app-icon name="bar-chart-2" [size]="15"></app-icon>
            Ver Analíticas de Atención al Cliente
            <app-icon name="external-link" [size]="13"></app-icon>
        </a>
    </div>

    <!-- Loading -->
    @if (loading()) {
        <div class="state-center"><div class="spinner"></div></div>
    } @else {

        <!-- Channel cards -->
        <div class="channels-grid">
            @for (ch of channels; track ch.meta.id) {

                <div class="channel-card" [class.card-enabled]="ch.enabled">

                    <!-- Card header -->
                    <div class="card-header">
                        <div class="card-icon"
                             [style.background]="ch.meta.color + '22'"
                             [style.border-color]="ch.meta.color + '55'">
                            <app-icon [name]="ch.meta.icon" [size]="20" [style.color]="ch.meta.color"></app-icon>
                        </div>
                        <div class="card-title-row">
                            <span class="card-name">{{ ch.meta.label }}</span>
                            <span class="conn-pill" [class.connected]="ch.connected">
                                {{ ch.connected ? '✓ Conectado' : 'Sin configurar' }}
                            </span>
                        </div>
                        <!-- Enable toggle (always on for website) -->
                        @if (ch.meta.id !== 'website') {
                            <label class="toggle-wrap" [title]="ch.enabled ? 'Desactivar' : 'Activar'">
                                <input type="checkbox" [(ngModel)]="ch.enabled" (change)="autoSaveMeta(ch)">
                                <span class="toggle-track" [class.on]="ch.enabled"></span>
                            </label>
                        } @else {
                            <span class="always-on-badge">Siempre activo</span>
                        }
                    </div>

                    <!-- Collapsed: just show setup guide hint -->
                    @if (!ch.enabled && ch.meta.id !== 'website') {
                        <p class="card-hint">{{ ch.meta.setupGuide }}</p>
                    }

                    @if (ch.enabled || ch.meta.id === 'website') {
                        <div class="card-body">

                            <!-- Website channel: no credentials needed -->
                            @if (ch.meta.id === 'website') {
                                <div class="website-info">
                                    <app-icon name="check-circle" [size]="16" style="color:#10b981;flex-shrink:0"></app-icon>
                                    <span>{{ ch.meta.setupGuide }}</span>
                                </div>
                            } @else {

                                <!-- Display name -->
                                <div class="field-group">
                                    <label class="field-label">Nombre visible para clientes</label>
                                    <input class="field-input" [(ngModel)]="ch.displayName"
                                           placeholder="Importadora Euro" (blur)="autoSaveMeta(ch)">
                                </div>

                                <!-- Handle -->
                                @if (ch.meta.handleLabel) {
                                    <div class="field-group">
                                        <label class="field-label">{{ ch.meta.handleLabel }}</label>
                                        <input class="field-input" [(ngModel)]="ch.handle"
                                               [placeholder]="ch.meta.handlePlaceholder || ''"
                                               (blur)="autoSaveMeta(ch)">
                                    </div>
                                }

                                <!-- Webhook URL (read-only, copyable) -->
                                @if (ch.meta.webhookUrl) {
                                    <div class="field-group">
                                        <label class="field-label">URL del Webhook
                                            <span class="label-hint">(pegar en el panel externo)</span>
                                        </label>
                                        <div class="copy-row">
                                            <input class="field-input copy-input" [value]="ch.meta.webhookUrl" readonly>
                                            <button class="btn-copy"
                                                    (click)="copy(ch.meta.webhookUrl, ch.meta.id + '_url')"
                                                    [title]="copied() === ch.meta.id + '_url' ? 'Copiado!' : 'Copiar'">
                                                <app-icon [name]="copied() === ch.meta.id + '_url' ? 'check' : 'copy'" [size]="14"></app-icon>
                                            </button>
                                        </div>
                                    </div>
                                }

                                <!-- Credentials section -->
                                @if (ch.meta.credFields.length) {
                                    <div class="creds-section">
                                        <div class="creds-title">
                                            <app-icon name="key" [size]="13"></app-icon>
                                            Credenciales
                                        </div>

                                        @for (field of ch.meta.credFields; track field.key) {
                                            <div class="field-group">
                                                <label class="field-label">{{ field.label }}</label>
                                                @if (field.hint) {
                                                    <p class="field-hint">{{ field.hint }}</p>
                                                }
                                                <div class="secret-row">
                                                    <input class="field-input"
                                                           [type]="showSecret[ch.meta.id + '_' + field.key] ? 'text' : 'password'"
                                                           [(ngModel)]="ch.creds[field.key]"
                                                           [placeholder]="field.type === 'password' ? '••••••••••••' : field.placeholder">
                                                    <button class="btn-eye"
                                                            (click)="toggleSecret(ch.meta.id + '_' + field.key)"
                                                            type="button">
                                                        <app-icon [name]="showSecret[ch.meta.id + '_' + field.key] ? 'eye-off' : 'eye'" [size]="14"></app-icon>
                                                    </button>
                                                </div>
                                            </div>
                                        }

                                        <button class="btn-save-creds"
                                                [class.saving]="savingCreds() === ch.meta.id"
                                                [disabled]="savingCreds() === ch.meta.id"
                                                (click)="saveCredentials(ch)">
                                            @if (savingCreds() === ch.meta.id) {
                                                <div class="spinner-xs"></div> Aplicando…
                                            } @else if (savedCreds() === ch.meta.id) {
                                                <app-icon name="check" [size]="14"></app-icon> Guardado
                                            } @else {
                                                <app-icon name="save" [size]="14"></app-icon> Guardar credenciales
                                            }
                                        </button>
                                    </div>
                                }

                                <!-- Setup guide -->
                                <div class="guide-row">
                                    <app-icon name="info" [size]="13" style="flex-shrink:0;margin-top:1px"></app-icon>
                                    <span>{{ ch.meta.setupGuide }}</span>
                                    @if (ch.meta.docsUrl) {
                                        <a [href]="ch.meta.docsUrl" target="_blank" class="docs-link">
                                            Ver docs <app-icon name="external-link" [size]="11"></app-icon>
                                        </a>
                                    }
                                </div>
                            }
                        </div>
                    }
                </div>
            }
        </div>
    }

</div>
    `,
    styles: [`
        .page-wrap { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }

        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; }
        .page-header-left { display: flex; align-items: center; gap: 1rem; }
        .header-icon { width: 46px; height: 46px; border-radius: 12px; background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.25); display: flex; align-items: center; justify-content: center; color: #6ee7b7; flex-shrink: 0; }
        .page-title { font-size: 1.35rem; font-weight: 700; color: #f1f5f9; margin: 0 0 .25rem; }
        .page-sub { font-size: .82rem; color: #94a3b8; margin: 0; }

        .btn-secondary { display: flex; align-items: center; gap: .4rem; padding: .45rem .9rem; border-radius: 8px; border: 1px solid #475569; background: #334155; color: #94a3b8; font-size: .78rem; font-weight: 600; text-decoration: none; transition: all .18s; white-space: nowrap; }
        .btn-secondary:hover { background: #3e4f63; color: #cbd5e1; }

        .channels-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.25rem; }

        /* Cards match bg-slate-800 border-slate-700 */
        .channel-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; transition: border-color .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
        .channel-card.card-enabled { border-color: #475569; }

        .card-header { display: flex; align-items: center; gap: .75rem; padding: 1rem 1.1rem; }
        .card-icon { width: 40px; height: 40px; border-radius: 10px; border: 1px solid; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .card-title-row { flex: 1; display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
        .card-name { font-size: .88rem; font-weight: 700; color: #f1f5f9; }
        .conn-pill { display: inline-flex; align-items: center; font-size: .65rem; font-weight: 700; padding: .1rem .45rem; border-radius: 20px; background: #334155; color: #64748b; width: fit-content; }
        .conn-pill.connected { background: rgba(16,185,129,.12); color: #6ee7b7; }
        .always-on-badge { font-size: .68rem; font-weight: 700; color: #6ee7b7; background: rgba(16,185,129,.1); border: 1px solid rgba(16,185,129,.2); padding: .2rem .55rem; border-radius: 20px; white-space: nowrap; }

        .toggle-wrap { display: flex; align-items: center; cursor: pointer; }
        .toggle-wrap input { display: none; }
        .toggle-track { width: 36px; height: 20px; border-radius: 10px; background: #334155; border: 1px solid #475569; transition: all .2s; position: relative; flex-shrink: 0; }
        .toggle-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #64748b; transition: all .2s; }
        .toggle-track.on { background: rgba(16,185,129,.3); border-color: #10b981; }
        .toggle-track.on::after { left: 18px; background: #10b981; }

        .card-hint { padding: 0 1.1rem .875rem; font-size: .75rem; color: #64748b; margin: 0; line-height: 1.6; }

        .card-body { padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: .85rem; border-top: 1px solid #334155; }

        .website-info { display: flex; align-items: flex-start; gap: .6rem; font-size: .8rem; color: #94a3b8; line-height: 1.5; }

        .field-group { display: flex; flex-direction: column; gap: .35rem; }
        /* Labels match integration-manager uppercase slate-500 */
        .field-label { font-size: .7rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
        .label-hint { font-weight: 500; text-transform: none; letter-spacing: 0; opacity: .7; }
        .field-hint { font-size: .72rem; color: #64748b; margin: 0; line-height: 1.5; }

        /* Inputs match bg-slate-900 border-slate-700 */
        .field-input { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: .55rem .75rem; color: #e2e8f0; font-size: .82rem; outline: none; transition: border-color .18s; box-sizing: border-box; }
        .field-input:focus { border-color: rgba(16,185,129,.4); }
        .field-input[readonly] { color: #64748b; cursor: default; }

        .copy-row { display: flex; gap: .5rem; align-items: center; }
        .copy-input { flex: 1; }
        .btn-copy { width: 32px; height: 32px; border-radius: 7px; border: 1px solid #334155; background: #1e293b; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .18s; flex-shrink: 0; }
        .btn-copy:hover { border-color: rgba(16,185,129,.4); color: #6ee7b7; }

        .creds-section { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: .875rem; display: flex; flex-direction: column; gap: .7rem; }
        .creds-title { display: flex; align-items: center; gap: .4rem; font-size: .7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .06em; }

        .secret-row { display: flex; gap: .5rem; align-items: center; }
        .secret-row .field-input { flex: 1; font-family: 'JetBrains Mono', monospace; font-size: .78rem; letter-spacing: .02em; }
        .btn-eye { width: 32px; height: 34px; border-radius: 7px; border: 1px solid #334155; background: #1e293b; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .18s; flex-shrink: 0; }
        .btn-eye:hover { color: #94a3b8; }

        .btn-save-creds { display: flex; align-items: center; justify-content: center; gap: .45rem; width: 100%; padding: .6rem 1rem; border-radius: 8px; border: none; background: rgba(16,185,129,.15); color: #6ee7b7; font-size: .8rem; font-weight: 700; cursor: pointer; transition: all .2s; margin-top: .2rem; }
        .btn-save-creds:hover:not(:disabled) { background: rgba(16,185,129,.25); }
        .btn-save-creds:disabled { opacity: .6; cursor: not-allowed; }
        .btn-save-creds.saving { background: rgba(16,185,129,.1); }

        .guide-row { display: flex; align-items: flex-start; gap: .45rem; font-size: .73rem; color: #64748b; line-height: 1.55; }
        .docs-link { display: inline-flex; align-items: center; gap: .2rem; color: #818cf8; text-decoration: none; white-space: nowrap; flex-shrink: 0; font-size: .72rem; }
        .docs-link:hover { color: #a5b4fc; }

        .state-center { display: flex; justify-content: center; padding: 4rem; }
        .spinner { width: 28px; height: 28px; border: 2px solid #334155; border-top-color: #10b981; border-radius: 50%; animation: spin .7s linear infinite; }
        .spinner-xs { width: 12px; height: 12px; border: 2px solid #334155; border-top-color: #10b981; border-radius: 50%; animation: spin .7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Analytics link shortcut */
        .analytics-link-row { margin-bottom: 1.75rem; }
        .btn-analytics { display: inline-flex; align-items: center; gap: .5rem; padding: .55rem 1.1rem; border-radius: 10px; border: 1px solid rgba(59,130,246,.3); background: rgba(59,130,246,.08); color: #93c5fd; font-size: .82rem; font-weight: 600; text-decoration: none; transition: all .18s; }
        .btn-analytics:hover { background: rgba(59,130,246,.15); border-color: rgba(59,130,246,.5); color: #bfdbfe; }
    `]
})
export class InboxChannelsComponent implements OnInit {
    private firestore = inject(Firestore);
    private fns       = inject(Functions);
    private toast     = inject(ToastService);

    loading     = signal(true);
    savingCreds = signal<string | null>(null);
    savedCreds  = signal<string | null>(null);
    copied      = signal<string | null>(null);

    showSecret: Record<string, boolean> = {};

    channels: Array<{
        meta:        ChannelMeta;
        enabled:     boolean;
        connected:   boolean;
        displayName: string;
        handle:      string;
        creds:       Record<string, string>;
    }> = CHANNELS.map(meta => ({
        meta,
        enabled:     meta.id === 'website',
        connected:   meta.id === 'website',
        displayName: '',
        handle:      '',
        creds:       {},
    }));

    async ngOnInit() {
        const ref  = doc(this.firestore, 'config/inbox_channels');
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const data = snap.data() as InboxDoc;
            for (const ch of this.channels) {
                const saved = (data as any)[ch.meta.id] ?? {};
                if (ch.meta.id !== 'website') {
                    ch.enabled   = saved.enabled   ?? false;
                    ch.connected = saved.connected ?? false;
                }
                ch.displayName = saved.displayName ?? '';
                ch.handle      = saved.handle      ?? '';
                // creds are never stored in plain Firestore — leave blank (placeholder shows ••••)
            }
        }
        this.loading.set(false);
    }

    /** Auto-save non-sensitive metadata on blur / toggle */
    async autoSaveMeta(ch: typeof this.channels[0]) {
        const payload: Record<string, any> = { updatedAt: new Date() };
        for (const c of this.channels) {
            payload[c.meta.id] = {
                enabled:     c.enabled,
                connected:   c.connected,
                displayName: c.displayName,
                handle:      c.handle,
            };
        }
        try {
            await setDoc(doc(this.firestore, 'config/inbox_channels'), payload, { merge: true });
        } catch {
            this.toast.error('Error al guardar');
        }
    }

    /** Send credentials to Cloud Function which calls firebase functions:config:set server-side */
    async saveCredentials(ch: typeof this.channels[0]) {
        const id = ch.meta.id;
        this.savingCreds.set(id);
        try {
            const applyConfig = httpsCallable(this.fns, 'applyInboxChannelConfig');
            await applyConfig({ channel: id, creds: ch.creds });

            // Mark connected & persist
            ch.connected = true;
            await this.autoSaveMeta(ch);

            this.savedCreds.set(id);
            this.toast.success(`${ch.meta.label} configurado correctamente`);
            setTimeout(() => this.savedCreds.set(null), 3000);
        } catch (e: any) {
            // Fallback: if Cloud Function not yet deployed, show CLI hint
            const botToken = ch.creds['botToken'];
            if (id === 'telegram' && botToken) {
                this.toast.info('Función no disponible aún — revisa la configuración manual en la consola');
            } else {
                this.toast.error('Error al aplicar credenciales: ' + (e?.message ?? 'desconocido'));
            }
        } finally {
            this.savingCreds.set(null);
        }
    }

    toggleSecret(key: string) {
        this.showSecret[key] = !this.showSecret[key];
    }

    async copy(text: string, key: string) {
        await navigator.clipboard.writeText(text);
        this.copied.set(key);
        setTimeout(() => this.copied.set(null), 2000);
    }
}
