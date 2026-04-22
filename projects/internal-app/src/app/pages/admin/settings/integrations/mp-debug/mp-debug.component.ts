import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

interface StepResult {
    ok:     boolean;
    label:  string;
    detail: string;
    raw?:   any;
}

@Component({
    selector:    'app-mp-debug',
    standalone:  true,
    imports:     [CommonModule, FormsModule],
    template: `
<div class="debug-page">

    <!-- HEADER -->
    <div class="page-header">
        <div class="header-left">
            <h1>💳 MercadoPago Tester</h1>
            <p class="subtitle">Verifica credenciales, token, cuenta y flujo de pago de prueba</p>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
            <div class="mode-chip" [class.test-mode]="isTestMode()">
                {{ isTestMode() ? '🧪 MODO TEST' : '🚀 PRODUCCIÓN' }}
            </div>
            <div style="background:#0f172a;border:1px solid #1e3a5f;color:#38bdf8;font-size:0.65rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:20px;font-family:monospace">v7 · 2026-04-20</div>
        </div>
    </div>

    <!-- PAYMENT INPUTS -->
    <div class="input-bar">
        <div class="field">
            <label>Monto (MXN)</label>
            <input type="number" [(ngModel)]="amount" min="10" />
        </div>
        <div class="field wide">
            <label>Email comprador</label>
            <input type="email" [(ngModel)]="payerEmail" placeholder="test_user&#64;testuser.com" />
        </div>
        <div class="field wide">
            <label>Descripción</label>
            <input [(ngModel)]="description" placeholder="Llanta de prueba" />
        </div>
        <div class="field wide">
            <label>Email comprador sandbox</label>
            <input type="email" [(ngModel)]="buyerEmailInput" placeholder="email del test-user comprador" />
        </div>
        <button class="btn-run" (click)="runAll()" [disabled]="loading()">
            <span *ngIf="!loading()">▶ Ejecutar todas las pruebas</span>
            <span *ngIf="loading()">⏳ Probando…</span>
        </button>
        <button class="btn-secondary" (click)="fetchWebhookSecret()" [disabled]="loading()" style="margin-left:8px;padding:10px 16px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);border-radius:8px;color:#a5b4fc;cursor:pointer;font-size:13px;">
            🔑 Obtener Clave Secreta (MP API)
        </button>
        <button class="btn-secondary" (click)="configureWebhook()" [disabled]="loading()" style="margin-left:8px;padding:10px 16px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);border-radius:8px;color:#86efac;cursor:pointer;font-size:13px;">
            🔗 Configurar Webhook (MP API)
        </button>
    </div>
    <div *ngIf="webhookSecretResult()" style="margin:12px 24px;padding:12px;background:#0f172a;border:1px solid #334155;border-radius:8px;font-size:12px;">
        <strong style="color:#a5b4fc;">API Result</strong>
        <pre style="color:#94a3b8;margin-top:8px;white-space:pre-wrap;word-break:break-all;">{{ webhookSecretResult() | json }}</pre>
    </div>

    <!-- CREDENTIAL SAVE PANEL -->
    <div style="margin:12px 24px;padding:14px 16px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:10px;">
        <div style="color:#a5b4fc;font-weight:600;font-size:13px;margin-bottom:10px;">🔐 Actualizar Credenciales MP (Firestore)</div>
        <div style="display:grid;gap:8px;">
            <input type="text" [(ngModel)]="credAccessToken" placeholder="Access Token (TEST-...)"
                   style="padding:8px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:12px;font-family:monospace;" />
            <input type="text" [(ngModel)]="credPublicKey" placeholder="Public Key (TEST-...)"
                   style="padding:8px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:12px;font-family:monospace;" />
            <button (click)="saveCredentials()" [disabled]="loading()"
                    style="padding:8px 16px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.5);border-radius:6px;color:#a5b4fc;cursor:pointer;font-size:13px;width:fit-content;">
                💾 Guardar Credenciales
            </button>
        </div>
        <div *ngIf="credSaveResult()" style="margin-top:8px;font-size:12px;"
             [style.color]="credSaveResult()?.ok ? '#86efac' : '#fca5a5'">
             {{ credSaveResult()?.ok ? '✅ ' + credSaveResult().message : '❌ ' + credSaveResult()?.error }}
        </div>
    </div>

    <!-- TEST CARD GRID -->
    <div class="tc-section">
        <div class="tc-section-title">🧪 Tarjetas de prueba MercadoPago (sandbox)</div>
        <div class="tc-grid">

            <!-- Mastercard -->
            <div class="tc-card tc-mc">
                <div class="tc-top">
                    <span class="tc-type">Mastercard</span>
                    <span class="tc-badge">Crédito</span>
                </div>
                <div class="tc-number" (click)="copyCard('5474925432670366')" title="Clic para copiar">
                    5474 9254 3267 0366
                </div>
                <div class="tc-bottom">
                    <div class="tc-field">
                        <span class="tc-field-label">CVV</span>
                        <span class="tc-field-val">123</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Vence</span>
                        <span class="tc-field-val">11/30</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Titular</span>
                        <span class="tc-field-val">APRO</span>
                    </div>
                </div>
            </div>

            <!-- Visa -->
            <div class="tc-card tc-visa">
                <div class="tc-top">
                    <span class="tc-type">Visa</span>
                    <span class="tc-badge">Crédito</span>
                </div>
                <div class="tc-number" (click)="copyCard('4075595716483764')" title="Clic para copiar">
                    4075 5957 1648 3764
                </div>
                <div class="tc-bottom">
                    <div class="tc-field">
                        <span class="tc-field-label">CVV</span>
                        <span class="tc-field-val">123</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Vence</span>
                        <span class="tc-field-val">11/30</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Titular</span>
                        <span class="tc-field-val">APRO</span>
                    </div>
                </div>
            </div>

            <!-- Mastercard Débito -->
            <div class="tc-card tc-mc tc-debit">
                <div class="tc-top">
                    <span class="tc-type">Mastercard</span>
                    <span class="tc-badge tc-badge-debit">Débito</span>
                </div>
                <div class="tc-number" (click)="copyCard('5579053461482647')" title="Clic para copiar">
                    5579 0534 6148 2647
                </div>
                <div class="tc-bottom">
                    <div class="tc-field">
                        <span class="tc-field-label">CVV</span>
                        <span class="tc-field-val">1234</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Vence</span>
                        <span class="tc-field-val">11/30</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Titular</span>
                        <span class="tc-field-val">APRO</span>
                    </div>
                </div>
            </div>

            <!-- Visa Débito -->
            <div class="tc-card tc-visa tc-debit">
                <div class="tc-top">
                    <span class="tc-type">Visa</span>
                    <span class="tc-badge tc-badge-debit">Débito</span>
                </div>
                <div class="tc-number" (click)="copyCard('4189141221267633')" title="Clic para copiar">
                    4189 1412 2126 7633
                </div>
                <div class="tc-bottom">
                    <div class="tc-field">
                        <span class="tc-field-label">CVV</span>
                        <span class="tc-field-val">123</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Vence</span>
                        <span class="tc-field-val">11/30</span>
                    </div>
                    <div class="tc-field">
                        <span class="tc-field-label">Titular</span>
                        <span class="tc-field-val">APRO</span>
                    </div>
                </div>
            </div>

        </div>
        <div class="tc-hint" *ngIf="copied()">✅ Número copiado al portapapeles</div>
    </div>


    <!-- BUYER TEST ACCOUNT -->
    <div class="ta-section">
        <div class="tc-section-title">👤 Cuenta compradora de prueba (Sandbox)</div>
        <div class="ta-card">
            <div class="ta-row">
                <div class="ta-field">
                    <span class="ta-label">Usuario</span>
                    <span class="ta-val mono" (click)="copyText('TESTUSER7146576788719579772')" title="Clic para copiar">TESTUSER7146576788719579772</span>
                </div>
                <div class="ta-field ta-field-sm">
                    <span class="ta-label">Contraseña</span>
                    <span class="ta-val mono" (click)="copyText('aP0I8bxKiJ')" title="Clic para copiar">aP0I8bxKiJ</span>
                </div>
                <div class="ta-field ta-field-sm">
                    <span class="ta-label">User ID</span>
                    <span class="ta-val mono">3347553101</span>
                </div>
                <div class="ta-field ta-field-sm">
                    <span class="ta-label">Cód. verificación</span>
                    <span class="ta-val mono">553101</span>
                </div>
            </div>
            <div class="ta-hint">
                ℹ️ Cuando el checkout sandbox pida iniciar sesión en MercadoPago,
                    usa este usuario como <strong>comprador</strong>.
                    El <em>vendedor</em> es tu cuenta con el Access Token TEST-.
            </div>
        </div>
        <div class="tc-hint" *ngIf="copiedText()">✅ Copiado: {{ copiedText() }}</div>
    </div>

    <!-- STEP RESULTS -->
    <div class="steps-grid" *ngIf="steps().length > 0">
        <div class="step-card" *ngFor="let step of steps()" [class.ok]="step.ok" [class.err]="!step.ok">
            <div class="step-header">
                <span class="step-icon">{{ step.ok ? '✅' : '❌' }}</span>
                <span class="step-label">{{ step.label }}</span>
            </div>
            <p class="step-detail">{{ step.detail }}</p>
            <pre class="step-raw" *ngIf="step.raw && showRaw()">{{ step.raw | json }}</pre>
        </div>
    </div>


    <!-- VERDICT -->
    <div class="verdict" *ngIf="steps().length > 0" [class.verdict-ok]="allOk()" [class.verdict-err]="!allOk()">
        {{ allOk()
            ? '✅ Integración MercadoPago completamente funcional'
            : '⚠️ Hay problemas — revisa los pasos en rojo arriba' }}
    </div>

    <!-- RAW TOGGLE -->
    <button class="raw-toggle" *ngIf="steps().length > 0" (click)="toggleRaw()">
        {{ showRaw() ? '▲ Ocultar JSON' : '▼ Ver JSON raw' }}
    </button>

    <!-- EMPTY -->
    <div class="empty-state" *ngIf="!loading() && steps().length === 0">
        <div class="empty-icon">💳</div>
        <p>Haz clic en <strong>Ejecutar todas las pruebas</strong> para verificar la integración</p>
    </div>

</div>
`,
    styles: [`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.debug-page {
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
    font-family: 'Inter', sans-serif;
    background: #0a0f1e;
    min-height: 100vh;
    color: #e2e8f0;
}

/* HEADER */
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.5rem; gap: 1rem; }
.page-header h1 { font-size: 1.5rem; font-weight: 700; margin: 0; }
.subtitle { color: #64748b; font-size: 0.85rem; margin: 0.25rem 0 0; }
.mode-chip {
    padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.72rem; font-weight: 700;
    background: #1e293b; border: 1px solid #334155; color: #64748b; white-space: nowrap;
}
.mode-chip.test-mode { background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.3); color: #fbbf24; }

/* INPUT BAR */
.input-bar {
    display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap;
    background: #1e293b; border: 1px solid #334155; border-radius: 12px;
    padding: 1rem 1.25rem; margin-bottom: 1rem;
}
.field { display: flex; flex-direction: column; min-width: 100px; }
.field.wide { min-width: 200px; flex: 1; }
.field label { font-size: 0.65rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
.field input { background: #0a0f1e; border: 1px solid #334155; border-radius: 6px; padding: 0.45rem 0.65rem; color: #e2e8f0; font-size: 0.88rem; font-family: inherit; min-width: 0; }
.field input:focus { outline: none; border-color: #3b82f6; }
.btn-run {
    padding: 0.6rem 1.5rem; background: linear-gradient(135deg, #009ee3, #00b1ea);
    color: white; border: none; border-radius: 8px; font-weight: 700;
    font-size: 0.875rem; cursor: pointer; white-space: nowrap; font-family: inherit;
    transition: opacity .15s; flex-shrink: 0;
}
.btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-run:hover:not(:disabled) { opacity: 0.88; }

/* TEST CARD GRID */
.tc-section {
    margin-bottom: 1.5rem;
}
.tc-section-title {
    font-size: 0.72rem; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.07em;
    margin-bottom: 0.75rem;
}
.tc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.6rem;
}
.tc-card {
    border-radius: 12px;
    padding: 0.9rem 1rem;
    border: 1px solid rgba(255,255,255,0.07);
    background: #111827;
    display: flex; flex-direction: column; gap: 0.7rem;
    position: relative; overflow: hidden;
    transition: transform .15s, box-shadow .15s;
}
.tc-card:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
/* Accent stripe top */
.tc-card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 3px;
    border-radius: 12px 12px 0 0;
}
.tc-mc::before   { background: linear-gradient(90deg, #eb5f00, #f7931a); }
.tc-visa::before { background: linear-gradient(90deg, #1a1f71, #3b82f6); }
.tc-debit { opacity: 0.88; }

.tc-top {
    display: flex; align-items: center; justify-content: space-between;
}
.tc-type {
    font-size: 0.85rem; font-weight: 700; color: #e2e8f0;
}
.tc-badge {
    font-size: 0.6rem; font-weight: 700; padding: 0.15rem 0.5rem;
    border-radius: 20px; background: rgba(59,130,246,0.15);
    color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);
    text-transform: uppercase; letter-spacing: 0.05em;
}
.tc-badge-debit {
    background: rgba(245,158,11,0.12);
    color: #fbbf24; border-color: rgba(245,158,11,0.3);
}
.tc-number {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.95rem; font-weight: 600;
    letter-spacing: 0.08em; color: #f1f5f9;
    cursor: pointer; user-select: all;
    padding: 0.35rem 0.5rem;
    background: rgba(255,255,255,0.04);
    border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);
    transition: background .12s;
}
.tc-number:hover { background: rgba(255,255,255,0.08); }
.tc-bottom {
    display: flex; gap: 0.5rem;
}
.tc-field {
    display: flex; flex-direction: column; gap: 2px; flex: 1;
}
.tc-field-label {
    font-size: 0.58rem; font-weight: 700; color: #475569;
    text-transform: uppercase; letter-spacing: 0.06em;
}
.tc-field-val {
    font-family: 'Monaco', monospace; font-size: 0.82rem;
    font-weight: 600; color: #94a3b8;
}
.tc-hint {
    margin-top: 0.5rem; font-size: 0.78rem;
    color: #4ade80; font-weight: 600;
    animation: fadeIn .2s ease;
}
@keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }

/* BUYER TEST ACCOUNT */
.ta-section { margin-bottom: 1.5rem; }
.ta-card {
    background: rgba(16,185,129,0.06);
    border: 1px solid rgba(16,185,129,0.18);
    border-radius: 12px; padding: 1rem 1.25rem;
    display: flex; flex-direction: column; gap: 0.85rem;
}
.ta-row { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: flex-start; }
.ta-field { display: flex; flex-direction: column; gap: 3px; min-width: 140px; }
.ta-field-sm { min-width: 90px; }
.ta-label {
    font-size: 0.58rem; font-weight: 700; color: #475569;
    text-transform: uppercase; letter-spacing: 0.06em;
}
.ta-val {
    font-size: 0.88rem; font-weight: 600; color: #a7f3d0;
}
.ta-val.mono {
    font-family: "Monaco", monospace; font-size: 0.82rem;
    cursor: pointer; transition: color .12s;
}
.ta-val.mono:hover { color: #6ee7b7; }
.ta-hint {
    font-size: 0.78rem; color: #64748b; line-height: 1.55;
}
.ta-hint strong { color: #94a3b8; }
.ta-hint em { font-style: normal; color: #fbbf24; }

/* TEST CARD INFO — legacy, kept for safety */
.test-card-info {
    display: flex; align-items: flex-start; gap: 0.75rem;
    background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.25);
    border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 1.5rem;
    font-size: 0.82rem; color: #a5b4fc;
}
.info-icon { font-size: 1rem; flex-shrink: 0; }
.test-card-info code { font-family: monospace; background: rgba(0,0,0,0.3); padding: 0.1rem 0.4rem; border-radius: 4px; }

/* STEPS */
.steps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
.step-card {
    background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 1rem;
    transition: border-color .2s;
}
.step-card.ok  { border-color: rgba(34,197,94,0.35); }
.step-card.err { border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.04); }
.step-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.step-icon { font-size: 1rem; }
.step-label { font-size: 0.85rem; font-weight: 700; color: #e2e8f0; }
.step-detail { font-size: 0.78rem; color: #94a3b8; margin: 0; line-height: 1.5; }
.step-raw { margin: 0.6rem 0 0; font-size: 0.65rem; color: #64748b; white-space: pre-wrap; word-break: break-all; background: #0a0f1e; padding: 0.5rem; border-radius: 4px; font-family: 'Monaco', monospace; max-height: 200px; overflow-y: auto; }

/* VERDICT */
.verdict { text-align: center; padding: 0.85rem 1.5rem; border-radius: 10px; font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; }
.verdict-ok  { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3); color: #4ade80; }
.verdict-err { background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.3); color: #f87171; }

/* RAW TOGGLE */
.raw-toggle { width: 100%; background: #141c2e; border: 1px solid #1e293b; padding: 0.65rem 1rem; border-radius: 8px; cursor: pointer; color: #64748b; font-size: 0.8rem; font-family: inherit; font-weight: 600; transition: background .15s; }
.raw-toggle:hover { background: #1e293b; color: #94a3b8; }

/* EMPTY */
.empty-state { text-align: center; padding: 3rem; color: #475569; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
    `]
})
export class MpDebugComponent {
    private fns = inject(Functions);
    private fs  = inject(Firestore);

    // ── Inputs ────────────────────────────────────────────────────────────────
    amount           = 100;
    payerEmail       = 'test_user_123@testuser.com';
    description      = 'Llanta de prueba — Eurollantas';
    buyerEmailInput  = 'test_comprador_sandbox@test.com'; // any email ≠ seller email works in sandbox

    // ── State ─────────────────────────────────────────────────────────────────
    loading    = signal(false);
    showRaw    = signal(false);
    isTestMode = signal(false);
    copied     = signal(false);
    copiedText = signal<string>('');
    steps      = signal<StepResult[]>([]);

    allOk = computed(() => this.steps().every(s => s.ok));

    toggleRaw() { this.showRaw.set(!this.showRaw()); }

    copyCard(number: string): void {
        navigator.clipboard.writeText(number).then(() => {
            this.copied.set(true);
            setTimeout(() => this.copied.set(false), 2000);
        });
    }

    copyText(text: string): void {
        navigator.clipboard.writeText(text).then(() => {
            this.copiedText.set(text.substring(0, 18) + (text.length > 18 ? '…' : ''));
            setTimeout(() => this.copiedText.set(''), 2000);
        });
    }

    webhookSecretResult = signal<any>(null);
    credAccessToken = 'TEST-398646544825942-022715-cbec23472732e892da3798593de42e85-1178500066';
    credPublicKey   = 'TEST-26a04055-43d8-4f69-97c5-7829d3d413bf';
    credSaveResult  = signal<any>(null);

    async saveCredentials() {
        this.loading.set(true);
        this.credSaveResult.set(null);
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({
                step:        'save_credentials',
                accessToken: this.credAccessToken.trim(),
                publicKey:   this.credPublicKey.trim(),
            });
            this.credSaveResult.set(res.data);
        } catch (e: any) {
            this.credSaveResult.set({ ok: false, error: e.message });
        } finally {
            this.loading.set(false);
        }
    }

    async fetchWebhookSecret() {
        this.loading.set(true);
        this.webhookSecretResult.set(null);
        try {
            const fn = httpsCallable<any, any>(this.fns, 'mpDiag');
            // Run both checks in parallel
            const [credRes, secretRes] = await Promise.all([
                fn({ step: 'check_credentials' }),
                fn({ step: 'fetch_webhook_secret' }),
            ]);
            this.webhookSecretResult.set({
                credentials:    credRes.data,
                webhookSecrets: secretRes.data,
            });
        } catch (e: any) {
            this.webhookSecretResult.set({ error: e.message });
        } finally {
            this.loading.set(false);
        }
    }

    async configureWebhook() {
        this.loading.set(true);
        this.webhookSecretResult.set(null);
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'configure_webhook' });
            this.webhookSecretResult.set(res.data);
        } catch (e: any) {
            this.webhookSecretResult.set({ error: e.message });
        } finally {
            this.loading.set(false);
        }
    }

    async runAll() {
        this.loading.set(true);
        this.steps.set([]);
        this.showRaw.set(false);
        const results: StepResult[] = [];

        // ── Step 1: Load credentials from Firestore ───────────────────────────
        let accessToken = '';
        let publicKey   = '';
        try {
            const snap = await getDoc(doc(this.fs, 'config', 'integrations'));
            const mp   = snap.data()?.['mercadopago'] ?? {};
            accessToken = mp['accessToken'] ?? '';
            publicKey   = mp['publicKey']   ?? '';
            const isTest = accessToken.startsWith('TEST-');
            this.isTestMode.set(isTest);
            const hasToken = !!accessToken;
            results.push({
                ok:     hasToken,
                label:  'Step 1 — Credenciales',
                detail: hasToken
                    ? `Access Token: ${accessToken.substring(0, 12)}… · Public Key: ${publicKey.substring(0, 12)}… · ${isTest ? '🧪 Modo TEST' : '🚀 Producción'}`
                    : 'No se encontró Access Token en Firestore (config/integrations → mercadopago)',
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 1 — Credenciales', detail: `Error leyendo Firestore: ${e.message}` });
            this.steps.set(results);
            this.loading.set(false);
            return;
        }

        if (!accessToken) {
            this.steps.set(results);
            this.loading.set(false);
            return;
        }

        // ── Step 2: Validate token via /users/me ──────────────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'users_me' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 2 — Token / /users/me',
                detail: d?.ok
                    ? `Cuenta: ${d.nickname} (ID: ${d.userId}) · País: ${d.site_id}`
                    : `Error: ${d?.error ?? 'Token inválido o expirado'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 2 — Token / /users/me', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 3: Payment methods available ─────────────────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'payment_methods' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 3 — Métodos de Pago',
                detail: d?.ok
                    ? `${d.count} métodos disponibles (${d.sample?.join(', ') ?? ''})`
                    : `Error: ${d?.error ?? 'No se pudieron obtener métodos de pago'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 3 — Métodos de Pago', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 4: Test payment (simulate token + charge) ────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({
                step:        'test_payment',
                amount:      this.amount,
                payerEmail:  this.payerEmail,
                description: this.description,
            });
            const d = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 4 — Preferencia de Checkout',
                detail: d?.ok
                    ? `✅ Preferencia creada · ID: ${d.preferenceId} · Abrir: ${d.initPoint} · fn-ver: ${d.fnVer}`
                    : `❌ ${d?.error ?? 'Falló creación de preferencia'} · Status: ${d?.status ?? '—'} · fn-ver: ${d?.fnVer ?? '?'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 4 — Pago de Prueba', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 4.5: Card tokenization — all 4 test cards ────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'card_token' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 4.5 — Tokenización de Tarjetas',
                detail: d?.ok
                    ? `✅ Las 4 tarjetas tokenizadas correctamente · ${d.summary ?? ''}`
                    : `❌ ${d?.summary ?? d?.error ?? 'Falló tokenización'} · fn-ver: ${d?.fnVer ?? '?'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 4.5 — Tokenización', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 5: Verify buyer test account ─────────────────────────────────
        let buyerTestEmail: string | null = null;
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'verify_buyer' });
            const d   = res.data as any;
            buyerTestEmail = d?.email ?? null;   // ← capture for Step 6
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 5 — Cuenta Compradora (ID 3347553101)',
                detail: d?.ok
                    ? `✅ Usuario: ${d.nickname} · Email: ${d.email} · Site: ${d.site_id} · Tipo: ${d.type}`
                    : `❌ ${d?.error ?? 'No encontrado'} · ${d?.hint ?? ''} · Verifica el Developer Portal.`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 5 — Cuenta Compradora', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 6: Tokenización (Credenciales de producción) ─────────────────
        let directPaymentId: string | null = null;
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'pay_with_token' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 6 — Tokenización (Credenciales de producción)',
                detail: d?.ok
                    ? `✅ Token creado · ID: ${d.tokenId} · ${d.lastFour ? '****' + d.lastFour : ''} · ${d.cardType}`
                    : `❌ Tokenización falló · HTTP ${d?.httpStatus ?? '?'} — ${d?.detail ?? d?.error ?? 'Error desconocido'}`,
                raw: d,
            });
            directPaymentId = null;
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 6 — Tokenización', detail: `Error: ${e.message}` });
        }


                // ── Step 7: Payment status query ──────────────────────────────────────
        if (directPaymentId) {
            try {
                const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
                const res = await fn({ step: 'payment_status', paymentId: directPaymentId });
                const d   = res.data as any;
                results.push({
                    ok:     d?.ok ?? false,
                    label:  'Step 7 — Estado del Pago',
                    detail: d?.ok
                        ? `✅ Status: ${d.status} · ${d.statusDetail} · Aprobado: ${d.dateApproved ?? 'N/A'}`
                        : `❌ ${d?.error ?? 'No se pudo consultar el pago'}`,
                    raw: d,
                });
            } catch (e: any) {
                results.push({ ok: false, label: 'Step 7 — Estado del Pago', detail: `Cloud Function error: ${e.message}` });
            }
        } else {
            results.push({ ok: false, label: 'Step 7 — Estado del Pago', detail: '⏭ Saltado — Step 6 no generó paymentId' });
        }

        // ── Step 8: Full refund ───────────────────────────────────────────────
        if (directPaymentId) {
            try {
                const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
                const res = await fn({ step: 'refund_payment', paymentId: directPaymentId });
                const d   = res.data as any;
                results.push({
                    ok:     d?.ok ?? false,
                    label:  'Step 8 — Devolución Completa',
                    detail: d?.ok
                        ? `✅ Refund ID: ${d.refundId} · Status: ${d.status} · Monto: ${d.amount}`
                        : `❌ ${d?.error ?? 'Falló la devolución'}`,
                    raw: d,
                });
            } catch (e: any) {
                results.push({ ok: false, label: 'Step 8 — Devolución Completa', detail: `Cloud Function error: ${e.message}` });
            }
        } else {
            results.push({ ok: false, label: 'Step 8 — Devolución Completa', detail: '⏭ Saltado — Step 6 no generó paymentId' });
        }

        // ── Step 9: Installments (meses sin intereses) ────────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'check_installments' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 9 — Meses Sin Intereses',
                detail: d?.ok
                    ? `✅ ${d.count} opciones de pago: ${(d.installments as number[]).map(i => `${i}x`).join(', ')}`
                    : `❌ ${d?.error ?? 'No se encontraron opciones de meses'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 9 — Meses Sin Intereses', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 10: Webhook Secret (x-signature capability) ─────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'verify_webhook_secret' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 10 — Webhook Secret (x-signature)',
                detail: d?.ok
                    ? `✅ ${d.message}`
                    : `⚠️ ${d?.error ?? 'Sin configurar'} — ${d?.hint ?? 'Agrega webhookSecret a Firestore'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 10 — Webhook Secret', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 11: Webhook URL reachability ─────────────────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'webhook_check' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 11 — Webhook Endpoint',
                detail: d?.ok
                    ? `✅ Endpoint responde correctamente (HTTP ${d.status})`
                    : `⚠️ ${d?.error ?? 'Endpoint no responde'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 11 — Webhook Endpoint', detail: `Cloud Function error: ${e.message}` });
        }

        this.steps.set(results);
        this.loading.set(false);
    }
}

