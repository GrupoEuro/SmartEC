import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    SearchReportService, FunnelRow, TopTermRow, ZeroResultRow, TrendingTermRow,
    RevenueAttributionRow, HeatmapRow, DailyVolumeRow
} from './search-report.service';

type Tab = 'funnel' | 'terms' | 'gaps' | 'trending' | 'revenue' | 'heatmap';
type Range = '7d' | '30d' | 'mtd';

@Component({
    selector: 'app-search-analytics-hub',
    standalone: true,
    imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe, RouterModule],
    template: `
<div class="hub-page">
  <!-- Header -->
  <div class="hub-header">
    <div>
      <h1 class="hub-title">🔍 Análisis de Búsquedas</h1>
      <p class="hub-sub">Comportamiento de búsqueda · Embudo de conversión · Brechas de catálogo</p>
    </div>
    <div class="range-pills">
      @for (r of ranges; track r.value) {
        <button [class.active]="activeRange() === r.value" (click)="setRange(r.value)">{{ r.label }}</button>
      }
    </div>
  </div>

  <!-- Funnel KPI strip -->
  @if (funnel().length) {
    <div class="funnel-strip">
      @for (step of funnelSteps(); track step.type) {
        <div class="funnel-card" [class.zero]="step.count === 0">
          <div class="funnel-icon">{{ step.icon }}</div>
          <div class="funnel-count">{{ step.count | number }}</div>
          <div class="funnel-label">{{ step.label }}</div>
          @if (step.rate !== null) {
            <div class="funnel-rate" [class.good]="step.rate > 0.3" [class.warn]="step.rate <= 0.3">
              {{ step.rate | percent:'1.1-1' }}
            </div>
          }
        </div>
      }
    </div>
  }

  <!-- Tabs -->
  <div class="hub-tabs">
    @for (t of tabs; track t.id) {
      <button [class.active]="activeTab() === t.id" (click)="activeTab.set(t.id)">{{ t.label }}</button>
    }
  </div>

  @if (isLoading()) {
    <div class="loading-state"><div class="spinner"></div><span>Consultando BigQuery…</span></div>
  } @else if (!hasData() && !isBackfilling()) {
    <!-- Empty state: BQ table not yet populated -->
    <div class="empty-state">
      <div class="empty-icon">📭</div>
      <h2 class="empty-title">Sin datos en BigQuery aún</h2>
      <p class="empty-desc">
        El pipeline está configurado: cada nueva búsqueda se envía automáticamente a BigQuery.
        Para ver datos históricos ya existentes en Firestore, ejecuta el backfill inicial.
      </p>
      <button class="backfill-btn" (click)="runBackfill()">
        ⚡ Poblar BigQuery con datos históricos
      </button>
      @if (backfillError()) {
        <p class="backfill-error">{{ backfillError() }}</p>
      }
    </div>
  } @else if (isBackfilling()) {
    <div class="loading-state"><div class="spinner"></div><span>Ejecutando backfill… puede tardar hasta 2 min.</span></div>
  } @else {

    <!-- TAB: Top Terms -->
    @if (activeTab() === 'terms') {
      <div class="panel">
        <div class="panel-header"><h2>Términos Más Buscados</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Término</th><th>Búsquedas</th><th>Clicks</th>
              <th>CTR</th><th>Sin resultados</th><th>Conversiones</th><th>Revenue</th>
            </tr></thead>
            <tbody>
              @for (row of topTerms(); track row.term) {
                <tr>
                  <td class="term-cell">
                    {{ row.term }}
                    @if (row.variants > 1) {
                      <span class="variants-badge" [title]="row.variants + ' formas escritas agrupadas'">~{{ row.variants }}</span>
                    }
                  </td>
                  <td>{{ row.searches | number }}</td>
                  <td>{{ row.clicks | number }}</td>
                  <td [class.good]="row.ctr > 0.4" [class.warn]="row.ctr < 0.2">
                    {{ row.ctr | percent:'1.0-0' }}
                  </td>
                  <td [class.danger]="row.zero_result_rate > 0.3">
                    {{ row.zero_result_rate | percent:'1.0-0' }}
                  </td>
                  <td>{{ row.conversions | number }}</td>
                  <td>{{ row.attributed_revenue | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- TAB: Catalog Gaps -->
    @if (activeTab() === 'gaps') {
      <div class="panel">
        <div class="panel-header">
          <h2>🚨 Brechas de Catálogo</h2>
          <p class="panel-desc">Términos buscados que no devolvieron ningún resultado. Señal directa de demanda no satisfecha.</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Término</th><th>Búsquedas</th><th>Sesiones únicas</th><th>Última búsqueda</th></tr></thead>
            <tbody>
              @for (row of zeroResults(); track row.term) {
                <tr>
                  <td class="term-cell gap-term">{{ row.term }}</td>
                  <td><span class="badge-red">{{ row.searches }}</span></td>
                  <td>{{ row.unique_sessions | number }}</td>
                  <td>{{ row.last_seen }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- TAB: Trending -->
    @if (activeTab() === 'trending') {
      <div class="panel">
        <div class="panel-header"><h2>📈 Términos en Tendencia</h2><p class="panel-desc">Velocidad 7 días vs. línea base 30 días.</p></div>
        <div class="trending-grid">
          @for (row of trendingTerms(); track row.term) {
            <div class="trending-card" [class.hot]="row.velocity_ratio > 2">
              <div class="trend-term">{{ row.term }}</div>
              <div class="trend-ratio">{{ row.velocity_ratio | number:'1.1-1' }}×</div>
              <div class="trend-sub">{{ row.searches_7d | number }} búsq. (7d) vs {{ row.searches_30d | number }} (30d)</div>
              <div class="trend-bar-wrap">
                <div class="trend-bar" [style.width.%]="min(row.velocity_ratio / 3 * 100, 100)"></div>
              </div>
            </div>
          }
        </div>
      </div>
    }

    <!-- TAB: Revenue Attribution -->
    @if (activeTab() === 'revenue') {
      <div class="panel">
        <div class="panel-header"><h2>💰 Revenue Atribuido a Búsquedas</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Término</th><th>Órdenes</th><th>Revenue</th><th>Ticket Prom.</th><th>Búsquedas</th><th>Tasa Compra</th></tr></thead>
            <tbody>
              @for (row of revenueAttribution(); track row.term) {
                <tr>
                  <td class="term-cell">{{ row.term }}</td>
                  <td>{{ row.attributed_orders | number }}</td>
                  <td class="revenue-cell">{{ row.attributed_revenue | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                  <td>{{ row.avg_order_value | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                  <td>{{ row.searches | number }}</td>
                  <td>{{ row.purchase_rate | percent:'1.1-1' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    <!-- TAB: Heatmap -->
    @if (activeTab() === 'heatmap') {
      <div class="panel">

        <!-- 7d: dow x hour pattern heatmap -->
        @if (activeRange() === '7d') {
          <div class="panel-header">
            <h2>🕐 Patrón Horario Semanal</h2>
            <p class="panel-desc">
              Total de búsquedas por hora y día de semana (Hora CDMX). Cada celda = suma de todas las búsquedas en esa hora/día en los últimos 7 días.
            </p>
          </div>
          @if (!heatmapRows().length) {
            <p class="hm-empty">Sin datos de horario aún.</p>
          } @else {
            <div class="heatmap-wrap">
              <div class="heatmap-y-labels">
                @for (h of hours; track h) { <span>{{ h }}h</span> }
              </div>
              <div class="heatmap-grid">
                @for (d of dowLabels; track d; let di = $index) {
                  <div class="heatmap-col">
                    <div class="heatmap-day-label">{{ d }}</div>
                    @for (h of hours; track h) {
                      <div class="heatmap-cell"
                           [style.opacity]="getCellOpacity(di + 1, h)"
                           [title]="getCellCount(di + 1, h) + ' búsquedas el ' + dowLabels[di] + ' a las ' + h + 'h'">
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
            <p class="hm-note">⚠️ Los números son totales acumulados por día/hora en el período — no promedios por día individual.</p>
          }
        }

        <!-- 30d / MTD: full calendar by month -->
        @if (activeRange() !== '7d') {
          <div class="panel-header">
            <div class="cal-header-row">
              <div>
                <h2>📅 Calendario de Búsquedas &mdash; {{ activeRange() === 'mtd' ? 'Este Mes' : 'Últimos 30 días' }}</h2>
                <p class="panel-desc">Cada celda = un día. Intensidad = volumen de búsquedas. Hover para detalle.</p>
              </div>
              <div class="cal-legend">
                <span class="cal-leg-label">Sin datos</span>
                @for (s of calLegendStops; track s) {
                  <div class="cal-leg-swatch" [style.background]="'rgba(99,102,241,' + s + ')'"></div>
                }
                <span class="cal-leg-label">Máx</span>
              </div>
            </div>
          </div>
          @if (!dailyVolume().length) {
            <p class="hm-empty">Sin datos de volumen diario aún.</p>
          } @else {
            <div class="cal-months-wrap">
              @for (month of calendarMonths(); track month.key) {
                <div class="cal-month-block">
                  <div class="cal-month-label">{{ month.label }}</div>
                  <div class="cal-grid">
                    <!-- dow headers -->
                    @for (h of calDowHeaders; track h) {
                      <div class="cal-dow-header">{{ h }}</div>
                    }
                    <!-- leading empty cells -->
                    @for (p of month.leading; track $index) {
                      <div class="cal-cell cal-cell--void"></div>
                    }
                    <!-- day cells -->
                    @for (day of month.days; track day.date) {
                      <div class="cal-cell"
                           [class.cal-cell--has-data]="day.searches > 0"
                           [class.cal-cell--today]="day.isToday"
                           [class.cal-cell--future]="day.isFuture"
                           [class.cal-cell--peak]="isPeakDay(day.searches)"
                           [style.background]="calCellBg(day.searches)"
                           [title]="day.dateLabel + ': ' + day.searches + ' búsquedas'">
                        <span class="cal-day-num" [class.cal-num--today]="day.isToday">{{ day.num }}</span>
                        @if (day.searches > 0) {
                          <span class="cal-day-val">{{ day.searches }}</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }

      </div>
    }

    <!-- TAB: Funnel detail -->
    @if (activeTab() === 'funnel') {
      <div class="panel">
        <div class="panel-header"><h2>Embudo de Conversión</h2></div>
        <div class="funnel-detail">
          @for (step of funnelSteps(); track step.type) {
            <div class="funnel-row">
              <span class="funnel-row-icon">{{ step.icon }}</span>
              <span class="funnel-row-label">{{ step.label }}</span>
              <div class="funnel-row-bar-wrap">
                <div class="funnel-row-bar" [style.width.%]="step.pct"></div>
              </div>
              <span class="funnel-row-val">{{ step.count | number }}</span>
              @if (step.rate !== null) {
                <span class="funnel-row-rate" [class.good]="step.rate > 0.3">{{ step.rate | percent:'1.1-1' }}</span>
              }
            </div>
          }
        </div>
      </div>
    }
  }
</div>
    `,
    styles: [`
        .hub-page { padding: 24px; max-width: 1400px; margin: 0 auto; font-family: 'Inter', sans-serif; }
        .hub-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .hub-title { font-size: 1.6rem; font-weight: 700; color: #f4f4f5; margin: 0 0 4px; }
        .hub-sub { color: #71717a; font-size: 0.85rem; margin: 0; }
        .range-pills { display: flex; gap: 8px; }
        .range-pills button { padding: 6px 14px; border-radius: 20px; border: 1px solid #3f3f46; background: transparent; color: #a1a1aa; cursor: pointer; font-size: 0.8rem; transition: all .2s; }
        .range-pills button.active { background: #6366f1; border-color: #6366f1; color: #fff; }

        /* Funnel strip */
        .funnel-strip { display: flex; gap: 12px; margin-bottom: 24px; }
        .funnel-card { flex: 1; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; text-align: center; }
        .funnel-card.zero { opacity: .5; }
        .funnel-icon { font-size: 1.4rem; margin-bottom: 6px; }
        .funnel-count { font-size: 1.5rem; font-weight: 700; color: #f4f4f5; }
        .funnel-label { font-size: 0.72rem; color: #71717a; text-transform: uppercase; letter-spacing: .5px; margin: 4px 0; }
        .funnel-rate { font-size: 0.8rem; font-weight: 600; }
        .funnel-rate.good { color: #10b981; }
        .funnel-rate.warn { color: #f59e0b; }

        /* Tabs */
        .hub-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 0; }
        .hub-tabs button { padding: 10px 16px; border: none; background: transparent; color: #71717a; cursor: pointer; font-size: 0.85rem; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .2s; }
        .hub-tabs button.active { color: #6366f1; border-bottom-color: #6366f1; }

        /* Panel */
        .panel { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); border-radius: 16px; padding: 24px; }
        .panel-header { margin-bottom: 20px; }
        .panel-header h2 { font-size: 1.1rem; font-weight: 600; color: #f4f4f5; margin: 0 0 4px; }
        .panel-desc { font-size: 0.8rem; color: #71717a; margin: 0; }

        /* Table */
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        th { color: #71717a; text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.06); font-weight: 500; text-transform: uppercase; font-size: 0.72rem; letter-spacing: .5px; white-space: nowrap; }
        td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.04); color: #d4d4d8; }
        tr:hover td { background: rgba(99,102,241,.05); }
        .term-cell { font-weight: 600; color: #f4f4f5; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gap-term { color: #f87171; }
        .revenue-cell { color: #10b981; font-weight: 600; }
        .good { color: #10b981; }
        .warn { color: #f59e0b; }
        .danger { color: #f87171; }
        .badge-red { background: rgba(248,113,113,.15); color: #f87171; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
        .variants-badge { display: inline-block; margin-left: 5px; padding: 1px 6px; border-radius: 10px; font-size: 0.65rem; font-weight: 700; background: rgba(99,102,241,.2); color: #818cf8; vertical-align: middle; cursor: default; }

        /* Trending */
        .trending-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px,1fr)); gap: 12px; }
        .trending-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 16px; }
        .trending-card.hot { border-color: rgba(251,146,60,.4); }
        .trend-term { font-weight: 600; color: #f4f4f5; margin-bottom: 4px; }
        .trend-ratio { font-size: 1.6rem; font-weight: 800; color: #6366f1; }
        .trending-card.hot .trend-ratio { color: #fb923c; }
        .trend-sub { font-size: 0.72rem; color: #71717a; margin: 4px 0 8px; }
        .trend-bar-wrap { background: rgba(255,255,255,.06); border-radius: 4px; height: 6px; }
        .trend-bar { height: 100%; border-radius: 4px; background: #6366f1; }
        .trending-card.hot .trend-bar { background: #fb923c; }

        /* Funnel detail */
        .funnel-detail { display: flex; flex-direction: column; gap: 12px; }
        .funnel-row { display: flex; align-items: center; gap: 12px; }
        .funnel-row-icon { font-size: 1.2rem; width: 28px; text-align: center; }
        .funnel-row-label { width: 120px; color: #a1a1aa; font-size: 0.82rem; }
        .funnel-row-bar-wrap { flex: 1; background: rgba(255,255,255,.06); border-radius: 4px; height: 8px; }
        .funnel-row-bar { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#6366f1,#8b5cf6); }
        .funnel-row-val { width: 80px; text-align: right; font-weight: 600; color: #f4f4f5; font-size: 0.9rem; }
        .funnel-row-rate { width: 60px; text-align: right; font-size: 0.8rem; color: #71717a; }
        .funnel-row-rate.good { color: #10b981; }

        /* Loading */
        .loading-state { display: flex; align-items: center; gap: 12px; padding: 60px; justify-content: center; color: #71717a; }
        .spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,.1); border-top-color: #6366f1; border-radius: 50%; animation: spin .8s linear infinite; }
        /* Heatmap */
        .heatmap-wrap { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; }
        .heatmap-y-labels { display: flex; flex-direction: column; gap: 2px; padding-top: 28px; }
        .heatmap-y-labels span { height: 18px; font-size: 0.65rem; color: #71717a; text-align: right; line-height: 18px; }
        .heatmap-grid { display: flex; gap: 3px; }
        .heatmap-col { display: flex; flex-direction: column; gap: 2px; }
        .heatmap-day-label { height: 24px; font-size: 0.7rem; color: #a1a1aa; text-align: center; line-height: 24px; }
        .heatmap-cell { width: 18px; height: 18px; border-radius: 3px; background: #6366f1; cursor: default; transition: transform .1s; }
        .heatmap-cell:hover { transform: scale(1.3); }
        .hm-empty { text-align: center; color: #71717a; font-size: 0.8rem; padding: 20px; }
        .hm-note { font-size: 0.72rem; color: #52525b; margin-top: 10px; text-align: center; }
        /* Calendar heatmap */
        .cal-header-row { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
        .cal-months-wrap { display: flex; flex-direction: row; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
        .cal-month-block { flex: 1; min-width: 280px; }
        .cal-month-label { font-size: 0.82rem; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 8px; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
        .cal-dow-header { text-align: center; font-size: 0.65rem; color: #52525b; font-weight: 600; padding: 2px 0 6px; text-transform: uppercase; }
        .cal-cell { height: 46px; border-radius: 7px; display: grid; grid-template-rows: 14px 1fr; align-items: center; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.05); cursor: default; transition: transform .12s, box-shadow .12s; min-width: 0; position: relative; overflow: hidden; padding: 4px 5px 4px; }
        .cal-cell:hover { transform: scale(1.06); box-shadow: 0 4px 16px rgba(99,102,241,.35); z-index: 2; }
        .cal-cell--void { background: transparent; border-color: transparent; pointer-events: none; }
        .cal-cell--future { opacity: .28; }
        .cal-cell--today { outline: 2px solid #6366f1; outline-offset: 1px; }
        .cal-cell--peak::after { content: ''; position: absolute; top: 0; right: 0; width: 5px; height: 5px; border-radius: 0 7px 0 4px; background: #fb923c; }
        .cal-day-num { font-size: 0.58rem; color: #52525b; font-weight: 700; line-height: 14px; }
        .cal-num--today { color: #818cf8; }
        .cal-day-val { font-size: 0.9rem; font-weight: 800; color: #f4f4f5; line-height: 1; text-align: center; }
        .cal-legend { display: flex; align-items: center; gap: 5px; }
        .cal-leg-label { font-size: 0.68rem; color: #52525b; white-space: nowrap; }
        .cal-leg-swatch { width: 14px; height: 14px; border-radius: 3px; }
        /* Empty state */
        .empty-state { text-align: center; padding: 60px 24px; }
        .empty-icon { font-size: 3rem; margin-bottom: 16px; }
        .empty-title { font-size: 1.2rem; font-weight: 600; color: #f4f4f5; margin: 0 0 8px; }
        .empty-desc { color: #71717a; font-size: 0.85rem; max-width: 480px; margin: 0 auto 24px; line-height: 1.6; }
        .backfill-btn { padding: 12px 28px; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; border: none; border-radius: 10px; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: opacity .2s; }
        .backfill-btn:hover { opacity: .85; }
        .backfill-btn:disabled { opacity: .5; cursor: not-allowed; }
        .backfill-error { color: #f87171; font-size: 0.8rem; margin-top: 12px; }
        @keyframes spin { to { transform: rotate(360deg); } }
    `]
})
export class SearchAnalyticsHubComponent implements OnInit {
    private svc = inject(SearchReportService);
    private fns = inject(Functions);

    isLoading    = signal(true);
    isBackfilling = signal(false);
    backfillError = signal<string | null>(null);
    activeTab    = signal<Tab>('terms');
    activeRange  = signal<Range>('30d');

    funnel            = signal<FunnelRow[]>([]);
    topTerms          = signal<TopTermRow[]>([]);
    zeroResults       = signal<ZeroResultRow[]>([]);
    trendingTerms     = signal<TrendingTermRow[]>([]);
    revenueAttribution = signal<RevenueAttributionRow[]>([]);
    heatmapRows   = signal<HeatmapRow[]>([]);
    dailyVolume   = signal<DailyVolumeRow[]>([]);

    readonly hours     = Array.from({length: 24}, (_, i) => i);
    readonly dowLabels = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    readonly calDowHeaders = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

    private heatmapMax     = 0;
    private dailyVolumeMax = 0;

    ranges = [
        { value: '7d' as Range,  label: '7 días' },
        { value: '30d' as Range, label: '30 días' },
        { value: 'mtd' as Range, label: 'Este mes' },
    ];

    tabs = [
        { id: 'terms'   as Tab, label: 'Términos' },
        { id: 'gaps'    as Tab, label: '🚨 Brechas Catálogo' },
        { id: 'funnel'  as Tab, label: 'Embudo' },
        { id: 'trending' as Tab, label: 'Tendencias' },
        { id: 'revenue' as Tab, label: 'Revenue' },
        { id: 'heatmap' as Tab, label: 'Horarios' },
    ];

    readonly funnelSteps = computed(() => {
        const map = new Map(this.funnel().map(r => [r.event_type, r]));
        const get = (t: string) => map.get(t)?.event_count ?? 0;
        const queries = get('query');
        const steps = [
            { type: 'query',       icon: '🔍', label: 'Búsquedas',    count: queries,          rate: null as number|null },
            { type: 'click',       icon: '👆', label: 'Clicks',        count: get('click'),      rate: queries ? get('click') / queries : null },
            { type: 'exit',        icon: '🚪', label: 'Salidas',       count: get('exit'),       rate: queries ? get('exit') / queries : null },
            { type: 'add_to_cart', icon: '🛒', label: 'Al Carrito',    count: get('add_to_cart'),rate: get('click') ? get('add_to_cart') / get('click') : null },
            { type: 'purchase',    icon: '✅', label: 'Compras',       count: get('purchase'),   rate: get('add_to_cart') ? get('purchase') / get('add_to_cart') : null },
        ];
        const max = Math.max(...steps.map(s => s.count), 1);
        return steps.map(s => ({ ...s, pct: (s.count / max) * 100 }));
    });

    async ngOnInit() { await this.load(); }

    async setRange(r: Range) {
        this.activeRange.set(r);
        await this.load();
    }

    min(a: number, b: number) { return Math.min(a, b); }

    readonly hasData = computed(() =>
        this.topTerms().length > 0 || this.funnel().some(r => r.event_count > 0)
    );

    async runBackfill() {
        this.isBackfilling.set(true);
        this.backfillError.set(null);
        try {
            const fn = httpsCallable<object, { inserted: number; errors: number }>(this.fns, 'backfillSearchEventsToBigQuery');
            const res = await fn({});
            console.log('[SearchHub] Backfill result:', res.data);
            // Reload data after backfill
            await this.load();
        } catch (e: any) {
            console.error('[SearchHub] Backfill failed:', e);
            this.backfillError.set(e?.message ?? 'Error desconocido. Intenta de nuevo.');
        } finally {
            this.isBackfilling.set(false);
        }
    }

    private getRange() {
        const r = this.activeRange();
        if (r === 'mtd') return this.svc.getMtdRange();
        return this.svc.getDateRange(r === '7d' ? 7 : 30);
    }

    getCellCount(dow: number, hour: number): number {
        const row = this.heatmapRows().find(r => r.day_of_week === dow && r.hour_of_day === hour);
        return row?.searches ?? 0;
    }

    getCellOpacity(dow: number, hour: number): number {
        const count = this.getCellCount(dow, hour);
        if (!this.heatmapMax) return 0.05;
        return Math.max(0.05, count / this.heatmapMax);
    }

    // Calendar heatmap helpers
    dayNum(dateStr: string): number { return +dateStr.slice(8); }
    isToday(dateStr: string): boolean {
        return dateStr === new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    }
    calCellBg(searches: number): string {
        if (!this.dailyVolumeMax || !searches) return 'rgba(99,102,241,.06)';
        const intensity = Math.max(0.1, searches / this.dailyVolumeMax);
        return `rgba(99,102,241,${intensity.toFixed(2)})`;
    }

    private peakThreshold = 0;
    isPeakDay(searches: number): boolean {
        return searches > 0 && searches >= this.peakThreshold;
    }
    readonly calLegendStops = [0.12, 0.3, 0.5, 0.75, 1.0];

    /**
     * Builds one entry per calendar month in the date range.
     * Each entry has:
     *   key     – 'YYYY-MM'
     *   label   – 'Abril 2026'
     *   leading – empty slots before the 1st of the month (0=Sun)
     *   days    – one slot per calendar day in that month, with search data merged in
     */
    readonly calendarMonths = computed(() => {
        const rows    = this.dailyVolume();
        const today   = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        const dataMap = new Map(rows.map(r => [r.event_date, r.searches]));

        if (!rows.length) return [];

        // Determine month range from data
        const first = rows[0].event_date;            // 'YYYY-MM-DD'
        const last  = rows[rows.length - 1].event_date;
        const [fy, fm] = first.split('-').map(Number);
        const [ly, lm] = last.split('-').map(Number);

        const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                             'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

        const months: {
            key: string; label: string;
            leading: number[];
            days: { date: string; num: number; searches: number; isToday: boolean; isFuture: boolean; dateLabel: string }[];
        }[] = [];

        let y = fy, m = fm;
        while (y < ly || (y === ly && m <= lm)) {
            const key     = `${y}-${String(m).padStart(2,'0')}`;
            const label   = `${MONTH_NAMES[m - 1]} ${y}`;
            const daysInMonth = new Date(y, m, 0).getDate();
            // JS: getDay() 0=Sun…6=Sat for the 1st
            const firstDow = new Date(y, m - 1, 1).getDay();
            const leading  = Array(firstDow).fill(0);

            const days = Array.from({ length: daysInMonth }, (_, i) => {
                const d       = String(i + 1).padStart(2, '0');
                const date    = `${key}-${d}`;
                const searches = dataMap.get(date) ?? 0;
                const isFuture = date > today;
                const dateLabel = `${i + 1} ${MONTH_NAMES[m - 1]}`;
                return { date, num: i + 1, searches, isToday: date === today, isFuture, dateLabel };
            });

            months.push({ key, label, leading, days });

            m++;
            if (m > 12) { m = 1; y++; }
        }

        return months;
    });


    private async load() {
        this.isLoading.set(true);
        const { fromDate, toDate } = this.getRange();
        const is7d = this.activeRange() === '7d';
        try {
            const [funnel, terms, zeros, trending, revenue, heatmap, daily] = await Promise.allSettled([
                this.svc.getFunnel(fromDate, toDate),
                this.svc.getTopTerms(fromDate, toDate),
                this.svc.getZeroResults(fromDate, toDate),
                this.svc.getTrendingTerms(fromDate, toDate),
                this.svc.getRevenueAttribution(fromDate, toDate),
                is7d ? this.svc.getHeatmap(fromDate, toDate) : Promise.resolve([]),
                is7d ? Promise.resolve([]) : this.svc.getDailyVolume(fromDate, toDate),
            ]);
            const ok = <T>(r: PromiseSettledResult<T>, fb: T): T =>
                r.status === 'fulfilled' ? r.value : fb;

            this.funnel.set(ok(funnel, []));
            this.topTerms.set(ok(terms, []));
            this.zeroResults.set(ok(zeros, []));
            this.trendingTerms.set(ok(trending, []));
            this.revenueAttribution.set(ok(revenue, []));

            const heatmapData = ok(heatmap, []) as HeatmapRow[];
            this.heatmapRows.set(heatmapData);
            this.heatmapMax = heatmapData.length ? Math.max(...heatmapData.map(r => r.searches)) : 0;

            const dailyData = ok(daily, []) as DailyVolumeRow[];
            this.dailyVolume.set(dailyData);
            this.dailyVolumeMax = dailyData.length ? Math.max(...dailyData.map(r => r.searches)) : 0;
            // Top-3 days get the orange peak pip
            const sorted = [...dailyData].sort((a, b) => b.searches - a.searches);
            this.peakThreshold = sorted.length >= 3 ? sorted[2].searches : (sorted[0]?.searches ?? 0);
        } catch (e) {
            console.error('[SearchHub] load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }
}
