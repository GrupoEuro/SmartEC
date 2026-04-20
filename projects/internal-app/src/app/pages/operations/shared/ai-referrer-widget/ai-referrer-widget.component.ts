import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
    Firestore, collection, query, where,
    orderBy, limit, getDocs, Timestamp,
} from '@angular/fire/firestore';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

interface AiVisit {
    source:      string;
    count:       number;
    landingPath: string;
    lastSeen:    Date;
}

interface AiSummary {
    source:   string;
    count:    number;
    lastSeen: Date;
    label:    string;
    icon:     string;
    color:    string;
}

const SOURCE_META: Record<string, { label: string; icon: string; color: string }> = {
    chatgpt:    { label: 'ChatGPT',    icon: '🤖', color: 'var(--color-emerald, #10b981)' },
    perplexity: { label: 'Perplexity', icon: '🔍', color: 'var(--color-violet, #8b5cf6)' },
    claude:     { label: 'Claude',     icon: '🧠', color: 'var(--color-amber, #f59e0b)' },
    gemini:     { label: 'Gemini',     icon: '✨', color: 'var(--color-blue, #3b82f6)' },
    copilot:    { label: 'Copilot',    icon: '🪟', color: 'var(--color-sky, #0ea5e9)' },
    'meta-ai':  { label: 'Meta AI',    icon: '🌐', color: 'var(--color-indigo, #6366f1)' },
    perplexita: { label: 'Perplexity', icon: '🔍', color: 'var(--color-violet, #8b5cf6)' },
    you:        { label: 'You.com',    icon: '🔎', color: 'var(--color-rose, #f43f5e)' },
    phind:      { label: 'Phind',      icon: '💻', color: 'var(--color-cyan, #06b6d4)' },
};

@Component({
    selector: 'app-ai-referrer-widget',
    standalone: true,
    imports: [CommonModule, RouterModule, AppIconComponent],
    template: `
    <div class="widget-card">
      <!-- Header -->
      <div class="widget-header" (click)="toggle()">
        <div class="widget-title-group">
          <span class="widget-icon">🤖</span>
          <div>
            <h3 class="widget-title">Tráfico desde IA</h3>
            <p class="widget-subtitle">ChatGPT · Perplexity · Gemini · Claude</p>
          </div>
        </div>
        <div class="header-right">
          @if (!isLoading() && totalVisits() > 0) {
            <span class="total-badge">{{ totalVisits() }} visitas</span>
          }
          <button class="collapse-btn" [class.rotated]="isCollapsed()">
            <app-icon name="chevron_down" [size]="16" />
          </button>
        </div>
      </div>

      <!-- Body -->
      @if (!isCollapsed()) {
        <div class="widget-body">

          @if (isLoading()) {
            <div class="loading-rows">
              @for (_ of [1,2,3]; track $index) {
                <div class="skeleton-row"></div>
              }
            </div>
          } @else if (summaries().length === 0) {
            <div class="empty-state">
              <span class="empty-icon">📡</span>
              <p class="empty-title">Sin tráfico de IA aún</p>
              <p class="empty-hint">Cuando alguien llegue desde ChatGPT, Gemini o Perplexity aparecerá aquí.</p>
              <p class="empty-hint-sub">Últimos 30 días · Datos de sessionEvents</p>
            </div>
          } @else {
            <!-- Source breakdown -->
            <div class="source-list">
              @for (s of summaries(); track s.source) {
                <div class="source-row">
                  <div class="source-left">
                    <span class="source-emoji">{{ s.icon }}</span>
                    <div class="source-info">
                      <span class="source-label">{{ s.label }}</span>
                      <span class="source-last">Última visita: {{ s.lastSeen | date:'d MMM, H:mm' }}</span>
                    </div>
                  </div>
                  <div class="source-right">
                    <span class="source-count">{{ s.count }}</span>
                    <div class="source-bar-wrap">
                      <div class="source-bar"
                           [style.width.%]="(s.count / maxCount()) * 100"
                           [style.background]="s.color">
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Top landing pages -->
            @if (topPaths().length > 0) {
              <div class="section-divider"></div>
              <h4 class="section-label">Páginas de entrada desde IA</h4>
              <div class="path-list">
                @for (p of topPaths(); track p.path) {
                  <div class="path-row">
                    <span class="path-url">{{ p.path }}</span>
                    <span class="path-count">{{ p.count }}</span>
                  </div>
                }
              </div>
            }

            <p class="footer-note">Últimos 30 días · sessionEvents con aiSource</p>
          }
        </div>
      }
    </div>
    `,
    styles: [`
      .widget-card {
        background: rgba(24,24,27,0.7);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 14px;
        overflow: hidden;
        backdrop-filter: blur(12px);
      }
      .widget-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        transition: background .15s;
      }
      .widget-header:hover { background: rgba(255,255,255,0.03); }
      .widget-title-group { display: flex; align-items: center; gap: 10px; }
      .widget-icon { font-size: 20px; }
      .widget-title { font-size: 13px; font-weight: 600; color: #e4e4e7; margin: 0; }
      .widget-subtitle { font-size: 11px; color: #71717a; margin: 0; }
      .header-right { display: flex; align-items: center; gap: 8px; }
      .total-badge {
        background: rgba(99,102,241,.2); color: #a5b4fc;
        font-size: 11px; font-weight: 600; padding: 2px 8px;
        border-radius: 20px; border: 1px solid rgba(99,102,241,.3);
      }
      .collapse-btn {
        background: none; border: none; color: #52525b;
        cursor: pointer; padding: 2px; display: flex; transition: transform .2s;
      }
      .collapse-btn.rotated { transform: rotate(180deg); }

      .widget-body { padding: 14px 16px 12px; }

      /* Loading */
      .loading-rows { display: flex; flex-direction: column; gap: 8px; }
      .skeleton-row {
        height: 40px; border-radius: 8px;
        background: linear-gradient(90deg, rgba(255,255,255,.04) 25%,
                    rgba(255,255,255,.08) 50%, rgba(255,255,255,.04) 75%);
        background-size: 200% 100%; animation: shimmer 1.5s infinite;
      }
      @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

      /* Empty */
      .empty-state { text-align: center; padding: 20px 0; }
      .empty-icon { font-size: 28px; }
      .empty-title { font-size: 13px; font-weight: 600; color: #a1a1aa; margin: 8px 0 4px; }
      .empty-hint { font-size: 11px; color: #52525b; margin: 0; }
      .empty-hint-sub { font-size: 10px; color: #3f3f46; margin: 8px 0 0; }

      /* Source list */
      .source-list { display: flex; flex-direction: column; gap: 10px; }
      .source-row { display: flex; align-items: center; justify-content: space-between; }
      .source-left { display: flex; align-items: center; gap: 10px; flex: 1; }
      .source-emoji { font-size: 18px; width: 24px; text-align: center; flex-shrink: 0; }
      .source-info { display: flex; flex-direction: column; }
      .source-label { font-size: 12px; font-weight: 600; color: #d4d4d8; }
      .source-last { font-size: 10px; color: #52525b; }
      .source-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 80px; }
      .source-count { font-size: 13px; font-weight: 700; color: #e4e4e7; }
      .source-bar-wrap { width: 80px; height: 4px; background: rgba(255,255,255,.06); border-radius: 2px; }
      .source-bar { height: 4px; border-radius: 2px; transition: width .4s ease; }

      /* Paths */
      .section-divider { height: 1px; background: rgba(255,255,255,.05); margin: 12px 0; }
      .section-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #52525b; margin: 0 0 8px; }
      .path-list { display: flex; flex-direction: column; gap: 4px; }
      .path-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 8px; border-radius: 6px; background: rgba(255,255,255,.03);
      }
      .path-url { font-size: 11px; color: #a1a1aa; font-family: monospace; }
      .path-count { font-size: 11px; font-weight: 600; color: #6366f1; }

      .footer-note { font-size: 10px; color: #3f3f46; margin: 10px 0 0; text-align: right; }
    `]
})
export class AiReferrerWidgetComponent implements OnInit {
    private fs = inject(Firestore);

    isLoading   = signal(true);
    isCollapsed = signal(false);
    private _visits = signal<AiVisit[]>([]);

    summaries = computed<AiSummary[]>(() => {
        const grouped: Record<string, { count: number; lastSeen: Date }> = {};
        for (const v of this._visits()) {
            if (!grouped[v.source]) grouped[v.source] = { count: 0, lastSeen: v.lastSeen };
            grouped[v.source].count += v.count;
            if (v.lastSeen > grouped[v.source].lastSeen) grouped[v.source].lastSeen = v.lastSeen;
        }
        return Object.entries(grouped)
            .map(([source, data]) => ({
                source,
                ...data,
                label: SOURCE_META[source]?.label ?? source,
                icon:  SOURCE_META[source]?.icon  ?? '🔗',
                color: SOURCE_META[source]?.color ?? '#6366f1',
            }))
            .sort((a, b) => b.count - a.count);
    });

    topPaths = computed(() => {
        const pathMap: Record<string, number> = {};
        for (const v of this._visits()) {
            pathMap[v.landingPath] = (pathMap[v.landingPath] || 0) + v.count;
        }
        return Object.entries(pathMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([path, count]) => ({ path, count }));
    });

    totalVisits = computed(() => this.summaries().reduce((s, c) => s + c.count, 0));
    maxCount    = computed(() => Math.max(1, ...this.summaries().map(s => s.count)));

    ngOnInit() { this.load(); }

    toggle() { this.isCollapsed.update(v => !v); }

    private async load() {
        try {
            // Query sessionEvents where aiSource is set, last 30 days
            const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const snap = await getDocs(query(
                collection(this.fs, 'sessionEvents'),
                where('attribution.capturedAt', '>=', since),
                orderBy('attribution.capturedAt', 'desc'),
                limit(500),
            ));

            const visits: AiVisit[] = [];
            snap.docs.forEach(d => {
                const data = d.data();
                const aiSource = data['attribution']?.['aiSource'];
                if (!aiSource) return;
                const ts: Timestamp | undefined = data['timestamp'];
                visits.push({
                    source:      aiSource,
                    count:       1,
                    landingPath: data['attribution']?.['landingPath'] ?? '/',
                    lastSeen:    ts?.toDate() ?? new Date(),
                });
            });

            this._visits.set(visits);
        } catch (e) {
            console.warn('[AiReferrerWidget] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }
}
