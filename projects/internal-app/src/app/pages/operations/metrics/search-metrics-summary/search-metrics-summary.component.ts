import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SearchReportService, ZeroResultRow, TopTermRow } from '../../../marketing/busquedas/search-report.service';

@Component({
    selector: 'app-search-metrics-summary',
    standalone: true,
    imports: [CommonModule, DecimalPipe, RouterModule],
    template: `
<div class="page">
  <div class="page-header">
    <div>
      <h1 class="page-title">🔍 Análisis de Búsquedas</h1>
      <p class="page-sub">Vista operativa · Brechas de catálogo · Demanda no satisfecha</p>
    </div>
    <a routerLink="/marketing/busquedas" class="full-report-btn">
      Ver análisis completo →
    </a>
  </div>

  <!-- KPI strip -->
  <div class="kpi-strip">
    <div class="kpi-card">
      <div class="kpi-val">{{ totalSearches() | number }}</div>
      <div class="kpi-label">Búsquedas (30d)</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-val">{{ zeroResults().length }}</div>
      <div class="kpi-label">Términos sin resultado</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">{{ avgCtr() }}%</div>
      <div class="kpi-label">CTR promedio</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">{{ topTerms().length }}</div>
      <div class="kpi-label">Términos activos</div>
    </div>
  </div>

  <div class="two-col">
    <!-- Zero results = catalog gaps -->
    <div class="panel">
      <div class="panel-header">
        <h2>🚨 Brechas de Catálogo</h2>
        <p>Términos sin resultados — demanda sin cubrir</p>
      </div>
      @if (isLoading()) {
        <div class="loading"><div class="spinner"></div></div>
      } @else if (!zeroResults().length) {
        <div class="empty">¡Sin brechas detectadas en los últimos 30 días! 🎉</div>
      } @else {
        <table>
          <thead><tr><th>Término</th><th>Búsquedas</th><th>Última vez</th></tr></thead>
          <tbody>
            @for (row of zeroResults(); track row.term) {
              <tr>
                <td class="term">{{ row.term }}</td>
                <td><span class="badge">{{ row.searches }}</span></td>
                <td class="muted">{{ row.last_seen }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    <!-- Top terms -->
    <div class="panel">
      <div class="panel-header">
        <h2>📈 Top Términos Buscados</h2>
        <p>Volumen · CTR · Conversiones</p>
      </div>
      @if (isLoading()) {
        <div class="loading"><div class="spinner"></div></div>
      } @else {
        <table>
          <thead><tr><th>Término</th><th>Búsquedas</th><th>CTR</th><th>Conversiones</th></tr></thead>
          <tbody>
            @for (row of topTerms().slice(0,15); track row.term) {
              <tr>
                <td class="term">{{ row.term }}</td>
                <td>{{ row.searches | number }}</td>
                <td [class.good]="row.ctr > 0.4" [class.warn]="row.ctr < 0.2">
                  {{ (row.ctr * 100).toFixed(0) }}%
                </td>
                <td>{{ row.conversions | number }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  </div>

  <div class="full-link-row">
    <a routerLink="/marketing/busquedas" class="full-report-btn">
      📊 Ver análisis completo: embudo, tendencias, revenue atribuido →
    </a>
  </div>
</div>
    `,
    styles: [`
        .page { padding: 24px; max-width: 1200px; margin: 0 auto; font-family: 'Inter', sans-serif; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .page-title { font-size: 1.5rem; font-weight: 700; color: #f4f4f5; margin: 0 0 4px; }
        .page-sub { color: #71717a; font-size: 0.82rem; margin: 0; }
        .full-report-btn { padding: 8px 18px; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; border-radius: 8px; text-decoration: none; font-size: 0.82rem; font-weight: 600; white-space: nowrap; }

        .kpi-strip { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; }
        .kpi-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px 20px; }
        .kpi-card.danger { border-color: rgba(248,113,113,.3); background: rgba(248,113,113,.05); }
        .kpi-val { font-size: 1.8rem; font-weight: 800; color: #f4f4f5; }
        .kpi-card.danger .kpi-val { color: #f87171; }
        .kpi-label { font-size: 0.75rem; color: #71717a; margin-top: 4px; }

        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .panel { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); border-radius: 14px; padding: 20px; }
        .panel-header { margin-bottom: 16px; }
        .panel-header h2 { font-size: 1rem; font-weight: 600; color: #f4f4f5; margin: 0 0 2px; }
        .panel-header p { font-size: 0.75rem; color: #71717a; margin: 0; }

        table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        th { color: #71717a; text-align: left; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.06); font-weight: 500; font-size: 0.7rem; text-transform: uppercase; }
        td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.04); color: #d4d4d8; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(99,102,241,.05); }
        .term { font-weight: 600; color: #f4f4f5; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .muted { color: #71717a; }
        .badge { background: rgba(248,113,113,.15); color: #f87171; padding: 2px 8px; border-radius: 20px; font-weight: 700; font-size: 0.78rem; }
        .good { color: #10b981; font-weight: 600; }
        .warn { color: #f59e0b; }
        .loading { display: flex; justify-content: center; padding: 40px; }
        .spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.1); border-top-color: #6366f1; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty { text-align: center; padding: 40px; color: #71717a; font-size: 0.85rem; }
        .full-link-row { display: flex; justify-content: center; }
    `]
})
export class SearchMetricsSummaryComponent implements OnInit {
    private svc: SearchReportService = inject(SearchReportService);

    isLoading   = signal(true);
    topTerms    = signal<TopTermRow[]>([]);
    zeroResults = signal<ZeroResultRow[]>([]);

    totalSearches() {
        return this.topTerms().reduce((s, r) => s + r.searches, 0);
    }

    avgCtr() {
        const rows = this.topTerms();
        if (!rows.length) return '0';
        const avg = rows.reduce((s, r) => s + r.ctr, 0) / rows.length;
        return (avg * 100).toFixed(0);
    }

    async ngOnInit() {
        const { fromDate, toDate } = this.svc.getDateRange(30);
        try {
            const [terms, zeros] = await Promise.all([
                this.svc.getTopTerms(fromDate, toDate, 50),
                this.svc.getZeroResults(fromDate, toDate, 50),
            ]);
            this.topTerms.set(terms);
            this.zeroResults.set(zeros);
        } catch (e) {
            console.error('[SearchMetricsSummary] load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }
}
