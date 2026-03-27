import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface ZipInfo {
    zip:       string;
    country:   string;
    state:     string;
    city:      string;
    colonias:  string[];
}

@Component({
    selector: 'app-skydropx-debug',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
<div class="debug-page">
    <!-- HEADER -->
    <div class="page-header">
        <div class="header-text">
            <h1>🚚 Skydropx Rate Tester</h1>
            <p class="subtitle">Test live shipping rates via the Skydropx PRO API</p>
        </div>
        <div class="version-chip" *ngIf="testResult()?.version">fn {{ testResult().version }}</div>
    </div>

    <!-- INPUTS + ACTION -->
    <div class="input-bar">
        <div class="field">
            <label>Destination ZIP</label>
            <input [(ngModel)]="zipTo" placeholder="64000" maxlength="5" />
        </div>
        <div class="field sm">
            <label>Weight kg</label>
            <input type="number" [(ngModel)]="weight" min="1" />
        </div>
        <div class="field sm">
            <label>Height cm</label>
            <input type="number" [(ngModel)]="height" min="1" />
        </div>
        <div class="field sm">
            <label>Width cm</label>
            <input type="number" [(ngModel)]="width" min="1" />
        </div>
        <div class="field sm">
            <label>Length cm</label>
            <input type="number" [(ngModel)]="length" min="1" />
        </div>
        <button class="btn-run" (click)="runTest()" [disabled]="loading()">
            <span *ngIf="!loading()">▶ Get Rates</span>
            <span *ngIf="loading()">⏳ Fetching…</span>
        </button>
    </div>

    <!-- DESTINATION ZIP INFO CARD -->
    <div class="zip-info-card" *ngIf="zipInfo()">
        <div class="zip-info-header">
            <span class="zip-info-title">📍 Destination</span>
            <span class="zip-badge">CP {{ zipInfo()!.zip }}</span>
        </div>
        <div class="zip-info-grid">
            <div class="zip-field">
                <span class="zip-label">🏙 City</span>
                <span class="zip-value">{{ zipInfo()!.city }}</span>
            </div>
            <div class="zip-field">
                <span class="zip-label">🗺 State</span>
                <span class="zip-value">{{ zipInfo()!.state }}</span>
            </div>
            <div class="zip-field">
                <span class="zip-label">🌎 Country</span>
                <span class="zip-value">{{ zipInfo()!.country }}</span>
            </div>
            <div class="zip-field zip-field-colonias" *ngIf="zipInfo()!.colonias.length">
                <span class="zip-label">🏘 Colonias</span>
                <div class="colonias-list">
                    <span class="colonia-chip" *ngFor="let c of zipInfo()!.colonias">{{ c }}</span>
                </div>
            </div>
        </div>
    </div>

    <!-- CARRIER RATES TABLE -->
    <div class="rates-section" *ngIf="rates().length > 0">
        <div class="section-header">
            <h2>🏆 Shipping Options</h2>
            <span class="rate-count">{{ rates().length }} carrier{{ rates().length !== 1 ? 's' : '' }}</span>
        </div>
        <div class="rates-table-wrap">
            <table class="rates-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Carrier</th>
                        <th>Service</th>
                        <th>Status</th>
                        <th>Delivery</th>
                        <th class="price-col">Price (MXN)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr *ngFor="let r of rates(); let i = index" [class.best]="i === 0">
                        <td class="rank">
                            <span class="rank-badge" [class.gold]="i === 0" [class.silver]="i === 1" [class.bronze]="i === 2">
                                {{ i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 }}
                            </span>
                        </td>
                        <td class="carrier-cell">
                            <div class="carrier-logo" [style.background]="carrierColor(r.carrier)">
                                {{ r.carrier?.substring(0, 2)?.toUpperCase() }}
                            </div>
                            <span class="carrier-name">{{ r.carrier || '—' }}</span>
                        </td>
                        <td class="service-cell">{{ r.serviceName || '—' }}</td>
                        <td>
                            <span class="status-pill" [class.approved]="r.status === 'approved' || r.status === 'price_found_internal' || r.status === 'price_found_external'">
                                {{ statusLabel(r.status) }}
                            </span>
                        </td>
                        <td class="days-cell">
                            <span *ngIf="r.estimatedDays !== null && r.estimatedDays !== undefined">
                                {{ r.estimatedDays }} {{ r.estimatedDays === 1 ? 'day' : 'days' }}
                            </span>
                            <span *ngIf="r.estimatedDays === null || r.estimatedDays === undefined" class="muted">—</span>
                        </td>
                        <td class="price-cell">
                            <span class="price-tag">$ {{ r.price | number:'1.2-2' }}</span>
                            <span class="currency">{{ r.currency || 'MXN' }}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- EMPTY STATE -->
    <div class="empty-state" *ngIf="!loading() && !testResult()">
        <div class="empty-icon">📦</div>
        <p>Enter a destination ZIP and click <strong>Get Rates</strong></p>
    </div>

    <div class="no-rates" *ngIf="!loading() && testResult() && rates().length === 0">
        <div class="empty-icon">⚠️</div>
        <p>No rates returned — check the debug section below</p>
    </div>

    <!-- DEBUG ACCORDION -->
    <div class="debug-section" *ngIf="testResult()">
        <button class="debug-toggle" (click)="debugOpen.set(!debugOpen())">
            <span>🔍 Debug Details</span>
            <span class="toggle-icon">{{ debugOpen() ? '▲' : '▼' }}</span>
        </button>

        <div class="debug-panels" *ngIf="debugOpen()">
            <div class="debug-card" [class.ok]="testResult()?.step1_credentials?.hasApiKey" [class.err]="!testResult()?.step1_credentials?.hasApiKey">
                <div class="debug-card-title">Step 1 — Credentials
                    <span class="pill ok-pill" *ngIf="testResult()?.step1_credentials?.hasApiKey">✅ Found</span>
                    <span class="pill err-pill" *ngIf="!testResult()?.step1_credentials?.hasApiKey">❌ Missing</span>
                </div>
                <pre class="dbg-pre">{{ testResult()?.step1_credentials | json }}</pre>
            </div>

            <div class="debug-card" [class.ok]="testResult()?.step2_oauth?.status === 200" [class.err]="testResult()?.step2_oauth?.status >= 400">
                <div class="debug-card-title">Step 2 — OAuth Token
                    <span class="pill ok-pill" *ngIf="testResult()?.step2_oauth?.body?.access_token">✅ 200 OK</span>
                    <span class="pill err-pill" *ngIf="!testResult()?.step2_oauth?.body?.access_token && !testResult()?.step2_oauth?.skipped">❌ Failed</span>
                </div>
                <pre class="dbg-pre">{{ { status: testResult()?.step2_oauth?.status, has_token: !!testResult()?.step2_oauth?.body?.access_token } | json }}</pre>
            </div>

            <div class="debug-card" [class.ok]="testResult()?.step3_quotation?.status < 300" [class.err]="testResult()?.step3_quotation?.status >= 400">
                <div class="debug-card-title">Step 3 — Quotation (HTTP {{ testResult()?.step3_quotation?.status }})
                    <span class="pill ok-pill" *ngIf="testResult()?.step3_quotation?.status < 300">✅ Success</span>
                    <span class="pill err-pill" *ngIf="testResult()?.step3_quotation?.status >= 400">❌ Error</span>
                </div>
                <div class="debug-two-col">
                    <div>
                        <div class="col-label">Sent</div>
                        <pre class="dbg-pre">{{ testResult()?.step3_quotation?.sentBody | json }}</pre>
                    </div>
                    <div>
                        <div class="col-label">Response</div>
                        <pre class="dbg-pre response-pre">{{ testResult()?.step3_quotation?.response | json }}</pre>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
`,
    styles: [`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.debug-page {
    padding: 2rem;
    max-width: 1300px;
    margin: 0 auto;
    font-family: 'Inter', sans-serif;
    background: #0a0f1e;
    min-height: 100vh;
    color: #e2e8f0;
}

/* HEADER */
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.5rem; }
.page-header h1 { font-size: 1.5rem; font-weight: 700; margin: 0; }
.subtitle { color: #64748b; font-size: 0.85rem; margin: 0.2rem 0 0; }
.version-chip { background: #1e293b; border: 1px solid #334155; color: #64748b; font-size: 0.7rem; font-family: monospace; padding: 0.3rem 0.6rem; border-radius: 20px; white-space: nowrap; }

/* INPUT BAR */
.input-bar { display: flex; gap: 0.6rem; align-items: flex-end; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; min-width: 120px; }
.field.sm { min-width: 80px; }
.field label { font-size: 0.65rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
.field input { background: #0a0f1e; border: 1px solid #334155; border-radius: 6px; padding: 0.45rem 0.65rem; color: #e2e8f0; font-size: 0.88rem; font-family: inherit; }
.field input:focus { outline: none; border-color: #3b82f6; }
.btn-run { margin-left: auto; padding: 0.6rem 1.5rem; background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; border: none; border-radius: 8px; font-weight: 700; font-size: 0.875rem; cursor: pointer; white-space: nowrap; font-family: inherit; transition: opacity 0.15s; }
.btn-run:disabled { opacity: 0.5; cursor: not-allowed; }

/* RATES SECTION */
.rates-section { margin-bottom: 1.5rem; }
.section-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.section-header h2 { font-size: 1rem; font-weight: 700; margin: 0; }
.rate-count { background: #3b82f620; color: #60a5fa; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 20px; border: 1px solid #3b82f630; }

/* ZIP INFO CARD */
.zip-info-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
.zip-info-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; }
.zip-info-title { font-size: 0.8rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
.zip-badge { background: #3b82f620; color: #60a5fa; border: 1px solid #3b82f640; border-radius: 20px; padding: 0.2rem 0.7rem; font-size: 0.8rem; font-weight: 700; font-family: monospace; }
.zip-info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
.zip-field { display: flex; flex-direction: column; gap: 0.2rem; }
.zip-field-colonias { grid-column: 1 / -1; }
.zip-label { font-size: 0.65rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.zip-value { font-size: 0.9rem; font-weight: 600; color: #e2e8f0; }
.colonias-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.2rem; }
.colonia-chip { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.2rem 0.55rem; font-size: 0.72rem; color: #94a3b8; font-weight: 500; }

.rates-table-wrap { background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
.rates-table { width: 100%; border-collapse: collapse; }
.rates-table thead tr { background: #0f172a; border-bottom: 1px solid #334155; }
.rates-table th { padding: 0.75rem 1rem; text-align: left; font-size: 0.7rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
.rates-table th.price-col { text-align: right; }
.rates-table tbody tr { border-bottom: 1px solid #1e293b; transition: background 0.15s; }
.rates-table tbody tr:last-child { border-bottom: none; }
.rates-table tbody tr:hover { background: #ffffff08; }
.rates-table tbody tr.best { background: #1a2d4a; }
.rates-table td { padding: 0.85rem 1rem; vertical-align: middle; }

/* RANK */
.rank { width: 48px; }
.rank-badge { font-size: 1.1rem; }

/* CARRIER */
.carrier-cell { display: flex; align-items: center; gap: 0.6rem; }
.carrier-logo { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 800; color: white; flex-shrink: 0; }
.carrier-name { font-weight: 600; font-size: 0.875rem; }

/* SERVICE */
.service-cell { color: #94a3b8; font-size: 0.8rem; }

/* STATUS */
.status-pill { font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; background: #334155; color: #94a3b8; }
.status-pill.approved { background: #14532d40; color: #4ade80; border: 1px solid #22c55e30; }

/* DAYS */
.days-cell { font-size: 0.85rem; font-weight: 500; color: #a78bfa; }
.muted { color: #475569; }

/* PRICE */
.price-cell { text-align: right; }
.price-tag { font-size: 1.05rem; font-weight: 700; color: #e2e8f0; }
.currency { font-size: 0.7rem; color: #64748b; margin-left: 0.3rem; }

/* EMPTY STATES */
.empty-state, .no-rates { text-align: center; padding: 3rem; color: #475569; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }

/* DEBUG SECTION */
.debug-section { margin-top: 2rem; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
.debug-toggle { width: 100%; background: #141c2e; border: none; padding: 0.85rem 1.25rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; color: #64748b; font-size: 0.85rem; font-family: inherit; font-weight: 600; }
.debug-toggle:hover { background: #1e293b; color: #94a3b8; }
.toggle-icon { font-size: 0.7rem; }
.debug-panels { padding: 1rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; background: #0d1525; }
.debug-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.85rem; }
.debug-card.ok  { border-color: #22c55e30; }
.debug-card.err { border-color: #ef444430; }
.debug-card:last-child { grid-column: 1 / -1; }
.debug-card-title { font-size: 0.8rem; font-weight: 700; color: #e2e8f0; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.5rem; }
.pill { font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 3px; }
.ok-pill  { background: #14532d; color: #86efac; }
.err-pill { background: #450a0a; color: #fca5a5; }
.dbg-pre { margin: 0; font-size: 0.68rem; color: #64748b; white-space: pre-wrap; word-break: break-all; background: #0a0f1e; padding: 0.6rem; border-radius: 4px; font-family: 'Monaco', monospace; line-height: 1.5; max-height: 180px; overflow-y: auto; }
.debug-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.col-label { font-size: 0.65rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
.response-pre { max-height: 280px; overflow-y: auto; }
    `]
})
export class SkydropxDebugComponent {
    private fns  = inject(Functions);
    private http = inject(HttpClient);

    zipTo  = '64000';
    weight = 5;
    height = 30;
    width  = 30;
    length = 20;

    loading    = signal(false);
    testResult = signal<any>(null);
    debugOpen  = signal(false);
    zipInfo    = signal<ZipInfo | null>(null);

    rates = computed(() => {
        const r = this.testResult();
        if (!r?.step3_quotation?.response) return [];
        const data = r.step3_quotation.response;
        // PRO API: { rates: [...] }
        const arr: any[] = Array.isArray(data.rates) ? data.rates
                         : Array.isArray(data.data)  ? data.data
                         : Array.isArray(data)       ? data
                         : [];
        return arr
            .filter((x: any) => x && x.id && (x.total || x.amount))
            .map((x: any) => ({
                rateId:       x.id,
                carrier:      x.provider_name || x.provider_display_name || x.carrier || '',
                serviceName:  x.provider_service_name || x.provider_service_code || '',
                price:        parseFloat(String(x.total ?? x.amount ?? '0')),
                currency:     x.currency_code || 'MXN',
                estimatedDays: x.days ?? null,
                status:       x.status || '',
                success:      x.success !== false,
            }))
            .filter((x: any) => x.price > 0)
            .sort((a: any, b: any) => a.price - b.price);
    });

    carrierColor(carrier: string): string {
        const map: Record<string, string> = {
            fedex: '#4d148c', dhl: '#ffcc00', ups: '#582619', estafeta: '#0057a8',
            redpack: '#c00', paquetexpress: '#ff6600', ampm: '#e6007e',
            j_and_t: '#e30613', '99minutos': '#00b14f', mensajeros: '#1a73e8',
        };
        const key = carrier?.toLowerCase().replace(/\s/g, '_') || '';
        return map[key] ?? '#334155';
    }

    statusLabel(status: string): string {
        const map: Record<string, string> = {
            approved: 'Approved', price_found_internal: 'Found', price_found_external: 'Found',
            coverage_checked: 'Coverage OK', no_coverage: 'No Coverage',
            not_applicable: 'N/A', pending: 'Pending', tariff_price_not_found: 'No Price',
        };
        return map[status] ?? status ?? '—';
    }

    async runTest() {
        this.loading.set(true);
        this.testResult.set(null);
        this.zipInfo.set(null);
        this.debugOpen.set(false);
        // Lookup ZIP info and rates in parallel
        await Promise.all([
            this.lookupZip(this.zipTo),
            (async () => {
                try {
                    const fn  = httpsCallable(this.fns, 'skydropxRawTest');
                    const res = await fn({ zipTo: this.zipTo, parcel: { weight: this.weight, height: this.height, width: this.width, length: this.length } });
                    console.log('[SkydropxDebug] v6 result:', res.data);
                    this.testResult.set(res.data);
                    const q = (res.data as any)?.step3_quotation;
                    if (q?.status >= 400 || !q?.response?.rates?.length) this.debugOpen.set(true);
                } catch (err: any) {
                    console.error('[SkydropxDebug]', err);
                    this.testResult.set({ functionError: err.message });
                    this.debugOpen.set(true);
                }
            })()
        ]);
        this.loading.set(false);
    }

    private async lookupZip(zip: string): Promise<void> {
        if (!zip || zip.length !== 5) return;
        try {
            const data: any = await firstValueFrom(
                this.http.get(`https://api.zippopotam.us/mx/${zip}`)
            );
            this.zipInfo.set({
                zip,
                country: data['country'] ?? 'México',
                state:   data['places']?.[0]?.['state'] ?? '—',
                city:    data['places']?.[0]?.['place name'] ?? '—',
                colonias: (data['places'] as any[] ?? []).map((p: any) => p['place name']).filter(Boolean)
            });
        } catch {
            // ZIP not found — silently ignore, card just won't show
        }
    }
}
