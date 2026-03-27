import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface ZipPlace {
    placeName: string;
    state:     string;
    stateAbbr: string;
    lat:       string;
    lon:       string;
}

interface ZipResult {
    zip:       string;
    country:   string;
    places:    ZipPlace[];
}

@Component({
    selector: 'app-zip-debug',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
<div class="debug-page">

    <!-- HEADER -->
    <div class="page-header">
        <div class="header-text">
            <h1>📍 Zippopotam.us ZIP Tester</h1>
            <p class="subtitle">Validate Mexican ZIP codes via <code>api.zippopotam.us/mx/{{ '{' }}zip{{ '}' }}</code></p>
        </div>
        <a href="/admin/integrations" class="back-link">← Back to Integrations</a>
    </div>

    <!-- INPUT BAR -->
    <div class="input-bar">
        <div class="field">
            <label>Mexican ZIP Code</label>
            <input [(ngModel)]="zip"
                   placeholder="e.g. 64000"
                   maxlength="5"
                   (keyup.enter)="lookup()" />
        </div>
        <button class="btn-run" (click)="lookup()" [disabled]="loading()">
            <span *ngIf="!loading()">🔍 Lookup</span>
            <span *ngIf="loading()">⏳ Fetching…</span>
        </button>
    </div>

    <!-- RESULT CARD -->
    <div class="result-card" *ngIf="result()">
        <div class="result-header">
            <span class="result-title">📍 ZIP Result</span>
            <span class="zip-badge">CP {{ result()!.zip }}</span>
            <span class="country-chip">{{ result()!.country }}</span>
        </div>

        <div class="places-grid">
            <div class="place-row" *ngFor="let p of result()!.places; let i = index" [class.primary]="i === 0">
                <div class="place-rank">{{ i === 0 ? '⭐' : (i + 1) }}</div>
                <div class="place-body">
                    <div class="place-name">{{ p.placeName }}</div>
                    <div class="place-meta">
                        <span class="tag">🗺 {{ p.state }}</span>
                        <span class="tag mono">{{ p.stateAbbr }}</span>
                        <span class="tag mono" *ngIf="p.lat">📡 {{ p.lat }}, {{ p.lon }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ERROR STATE -->
    <div class="error-card" *ngIf="notFound()">
        <span class="error-icon">⚠️</span>
        <div>
            <strong>ZIP not found</strong>
            <p>The code <code>{{ zip }}</code> returned no results. It may not exist or may not be covered.</p>
        </div>
    </div>

    <!-- EMPTY STATE -->
    <div class="empty-state" *ngIf="!loading() && !result() && !notFound()">
        <div class="empty-icon">🗺</div>
        <p>Enter a 5-digit Mexican ZIP code and click <strong>Lookup</strong></p>
    </div>

    <!-- RAW JSON ACCORDION -->
    <div class="debug-section" *ngIf="rawJson()">
        <button class="debug-toggle" (click)="rawOpen.set(!rawOpen())">
            <span>🔍 Raw API Response</span>
            <span class="toggle-icon">{{ rawOpen() ? '▲' : '▼' }}</span>
        </button>
        <div *ngIf="rawOpen()" class="raw-panel">
            <pre class="raw-pre">{{ rawJson() }}</pre>
        </div>
    </div>

</div>
`,
    styles: [`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.debug-page {
    padding: 2rem;
    max-width: 900px;
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
.subtitle code { background: #1e293b; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.78rem; color: #94a3b8; }
.back-link { font-size: 0.8rem; color: #64748b; text-decoration: none; white-space: nowrap; margin-top: 0.25rem; transition: color 0.15s; }
.back-link:hover { color: #94a3b8; }

/* INPUT BAR */
.input-bar { display: flex; gap: 0.75rem; align-items: flex-end; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; min-width: 180px; }
.field label { font-size: 0.65rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
.field input { background: #0a0f1e; border: 1px solid #334155; border-radius: 6px; padding: 0.5rem 0.75rem; color: #e2e8f0; font-size: 0.95rem; font-family: inherit; letter-spacing: 0.08em; }
.field input:focus { outline: none; border-color: #10b981; }
.btn-run { padding: 0.6rem 1.5rem; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 8px; font-weight: 700; font-size: 0.875rem; cursor: pointer; white-space: nowrap; font-family: inherit; transition: opacity 0.15s; }
.btn-run:disabled { opacity: 0.5; cursor: not-allowed; }

/* RESULT CARD */
.result-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; }
.result-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.result-title { font-size: 0.8rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
.zip-badge { background: #10b98120; color: #34d399; border: 1px solid #10b98140; border-radius: 20px; padding: 0.2rem 0.75rem; font-size: 0.8rem; font-weight: 700; font-family: monospace; }
.country-chip { background: #1e3a5f; color: #60a5fa; border: 1px solid #3b82f630; border-radius: 20px; padding: 0.2rem 0.6rem; font-size: 0.75rem; font-weight: 600; }

/* PLACES */
.places-grid { display: flex; flex-direction: column; gap: 0.5rem; }
.place-row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem 1rem; background: #0f172a; border: 1px solid #334155; border-radius: 8px; transition: border-color 0.15s; }
.place-row.primary { border-color: #10b98140; background: rgba(16,185,129,0.04); }
.place-rank { font-size: 1rem; min-width: 24px; text-align: center; padding-top: 2px; }
.place-body { flex: 1; }
.place-name { font-size: 0.95rem; font-weight: 600; color: #e2e8f0; margin-bottom: 0.3rem; }
.place-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.tag { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 0.15rem 0.5rem; font-size: 0.7rem; color: #94a3b8; }
.tag.mono { font-family: monospace; }

/* ERROR */
.error-card { display: flex; align-items: flex-start; gap: 1rem; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; }
.error-icon { font-size: 1.5rem; }
.error-card strong { color: #fca5a5; display: block; margin-bottom: 0.25rem; }
.error-card p { color: #94a3b8; font-size: 0.85rem; margin: 0; }
.error-card code { background: #0f172a; padding: 0.1rem 0.35rem; border-radius: 4px; font-family: monospace; color: #fca5a5; }

/* EMPTY */
.empty-state { text-align: center; padding: 3rem; color: #475569; }
.empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }

/* DEBUG ACCORDION */
.debug-section { margin-top: 1rem; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
.debug-toggle { width: 100%; background: #141c2e; border: none; padding: 0.85rem 1.25rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; color: #64748b; font-size: 0.85rem; font-family: inherit; font-weight: 600; }
.debug-toggle:hover { background: #1e293b; color: #94a3b8; }
.toggle-icon { font-size: 0.7rem; }
.raw-panel { background: #0d1525; padding: 1rem; }
.raw-pre { margin: 0; font-size: 0.72rem; color: #64748b; white-space: pre-wrap; word-break: break-all; background: #0a0f1e; padding: 0.75rem; border-radius: 6px; font-family: 'Monaco', monospace; line-height: 1.6; max-height: 400px; overflow-y: auto; }
    `]
})
export class ZipDebugComponent {
    private http = inject(HttpClient);

    zip     = '64000';
    loading = signal(false);
    result  = signal<ZipResult | null>(null);
    notFound = signal(false);
    rawJson  = signal<string | null>(null);
    rawOpen  = signal(false);

    async lookup() {
        if (!this.zip || this.zip.length !== 5) return;
        this.loading.set(true);
        this.result.set(null);
        this.notFound.set(false);
        this.rawJson.set(null);
        this.rawOpen.set(false);

        try {
            const data: any = await firstValueFrom(
                this.http.get(`https://api.zippopotam.us/mx/${this.zip}`)
            );
            this.rawJson.set(JSON.stringify(data, null, 2));
            this.result.set({
                zip:     data['post code']  ?? this.zip,
                country: data['country']    ?? 'México',
                places:  (data['places'] as any[] ?? []).map((p: any) => ({
                    placeName: p['place name']        ?? '—',
                    state:     p['state']              ?? '—',
                    stateAbbr: p['state abbreviation'] ?? '',
                    lat:       p['latitude']            ?? '',
                    lon:       p['longitude']           ?? '',
                }))
            });
        } catch {
            this.notFound.set(true);
        } finally {
            this.loading.set(false);
        }
    }
}
