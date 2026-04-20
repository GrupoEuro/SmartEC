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
            <div style="background:#0f172a;border:1px solid #1e3a5f;color:#38bdf8;font-size:0.65rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:20px;font-family:monospace">v6 · 2026-04-18</div>
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
        <button class="btn-run" (click)="runAll()" [disabled]="loading()">
            <span *ngIf="!loading()">▶ Ejecutar todas las pruebas</span>
            <span *ngIf="loading()">⏳ Probando…</span>
        </button>
    </div>

    <!-- TEST CARD INFO -->
    <div class="test-card-info">
        <span class="info-icon">ℹ️</span>
        <div>
            <strong>Tarjetas de prueba MP (sandbox):</strong><br>
            <code>5474 9254 3267 0366</code> &nbsp;·&nbsp; Mastercard &nbsp;·&nbsp;
            <code>4075 5957 1648 3764</code> &nbsp;·&nbsp; Visa<br>
            Vencimiento: <code>11/30</code> &nbsp;·&nbsp; CVV: <code>123</code> &nbsp;·&nbsp; Nombre titular: <code>APRO</code>
        </div>
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

/* TEST CARD INFO */
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
    amount      = 100;
    payerEmail  = 'test_user_123@testuser.com';
    description = 'Llanta de prueba — Eurollantas';

    // ── State ─────────────────────────────────────────────────────────────────
    loading   = signal(false);
    showRaw   = signal(false);
    isTestMode = signal(false);
    steps     = signal<StepResult[]>([]);

    allOk = computed(() => this.steps().every(s => s.ok));

    toggleRaw() { this.showRaw.set(!this.showRaw()); }

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
                    ? `✅ Preferencia creada · ID: ${d.preferenceId} · fn-ver: ${d.fnVer}`
                    : `❌ ${d?.error ?? 'Falló creación de preferencia'} · Status: ${d?.status ?? '—'} · fn-ver: ${d?.fnVer ?? '?'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 4 — Pago de Prueba', detail: `Cloud Function error: ${e.message}` });
        }

        // ── Step 5: Webhook URL reachability ──────────────────────────────────
        try {
            const fn  = httpsCallable<any, any>(this.fns, 'mpDiag');
            const res = await fn({ step: 'webhook_check' });
            const d   = res.data as any;
            results.push({
                ok:     d?.ok ?? false,
                label:  'Step 5 — Webhook Endpoint',
                detail: d?.ok
                    ? `✅ Endpoint responde correctamente (HTTP ${d.status})`
                    : `⚠️ ${d?.error ?? 'Endpoint no responde'}`,
                raw: d,
            });
        } catch (e: any) {
            results.push({ ok: false, label: 'Step 5 — Webhook Endpoint', detail: `Cloud Function error: ${e.message}` });
        }

        this.steps.set(results);
        this.loading.set(false);
    }
}
