import { Component, signal, inject } from '@angular/core';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import * as XLSX from 'xlsx';

interface DayData {
    date:       string;
    meliTotal:  number;
    meliPaid:   number;
    fsTotal:    number;
    meliOrders: number;
    fsOrders:   number;
    delta:      number;
    missingIds: string[];
}

interface OrderDetail {
    id:          string;
    date:        string;
    meliStatus:  string;
    meliTotal:   number;        // total_amount (gross)
    meliPaid:    number;        // paid_amount (settlement ≈ XLS net)
    fsTotal:     number | null; // null = not in Firestore
    fsStatus:    string | null;
    inMeli:      boolean;
    inFirestore: boolean;
}

interface ReconciliatorResult {
    success:         boolean;
    dateFrom:        string;
    dateTo:          string;
    orders:          OrderDetail[];
    perDay:          DayData[];
    missingOrderIds: string[];
    extraOrderIds:   string[];
    summary: {
        meliOrderCount:   number;
        fsOrderCount:     number;
        missingCount:     number;
        totalMeliRevenue: number;
        totalMeliPaid:    number;
        totalFsRevenue:   number;
        totalDelta:       number;
    };
}

/** One row parsed from the MeLi XLS report */
interface XlsRow {
    orderId:  string;
    date:     string; // YYYY-MM-DD
    status:   string;
    gross:    number; // Ingresos por productos (MXN) — matches API total_amount
    total:    number; // Total (MXN) — net payout
}

/** Per-day summary from the XLS */
interface XlsDaySummary {
    date:     string;
    gross:    number;
    total:    number;
    orders:   number;
    orderIds: string[];
}

interface XlsAuditResult {
    success:         boolean;
    totalXlsOrders:  number;
    totalOk:         number;
    totalMissing:    number;
    totalMismatched: number;
    xlsGrossTotal:   number;
    xlsNetTotal:     number;
    fsTotal:         number;
    missingRevenue:  number;
    orders: Array<{
        id:          string;
        xlsDate:     string;
        xlsStatus:   string;
        xlsGross:    number;
        xlsNet:      number;
        fsTotal:     number | null;
        fsStatus:    string | null;
        fsDate:      string | null;
        inFirestore: boolean;
        grossDelta:  number;
    }>;
}

@Component({
    selector: 'app-meli-reconciliator',
    standalone: true,
    imports: [CommonModule, FormsModule, DecimalPipe, CurrencyPipe, AppIconComponent],
    template: `
    <div class="recon-page">

      <!-- Header -->
      <div class="recon-header">
        <div class="header-icon">
          <app-icon name="git-compare" [size]="22"></app-icon>
        </div>
        <div>
          <h1 class="header-title">MeLi Revenue Reconciliator</h1>
          <p class="header-sub">Cross-check MercadoLibre orders vs Firestore — find missing order ingestions</p>
        </div>
      </div>

      <!-- Controls -->
      <div class="controls-card">
        <div class="controls-row">
          <div class="date-group">
            <label class="field-label">From (Mexico City date)</label>
            <input type="date" class="date-input" [(ngModel)]="dateFrom" [max]="dateTo" />
          </div>
          <div class="date-group">
            <label class="field-label">To (Mexico City date)</label>
            <input type="date" class="date-input" [(ngModel)]="dateTo" [min]="dateFrom" [max]="todayStr" />
          </div>
          <button class="run-btn" (click)="runReconciliation()" [disabled]="isLoading()">
            @if (isLoading()) {
              <span class="spinner"></span>
              Running…
            } @else {
              <app-icon name="play" [size]="16"></app-icon>
              Run Audit
            }
          </button>
          @if (result()?.summary?.missingCount) {
          <button class="resync-btn" (click)="forceResyncAll()" [disabled]="isResyncing()">
            @if (isResyncing()) {
              <span class="spinner"></span>
              Syncing…
            } @else {
              <app-icon name="download-cloud" [size]="16"></app-icon>
              Force Sync {{ result()!.summary.missingCount }} Missing
            }
          </button>
          }
        </div>
        @if (statusMessage()) {
          <div class="status-msg" [class.success]="statusIsSuccess()">{{ statusMessage() }}</div>
        }
      </div>

      <!-- XLS Upload Panel -->
      <div class="xls-card">
        <div class="xls-header">
          <div class="xls-icon"><app-icon name="file-spreadsheet" [size]="18"></app-icon></div>
          <div style="flex:1">
            <div class="xls-title">Reporte MeLi XLS — Verdad Absoluta <span class="xls-badge">FUENTE DE VERDAD</span></div>
            <div class="xls-sub">Sube el reporte descargado desde el portal de MercadoLibre (72h recomendado). Cada orden del XLS se busca directamente en Firestore sin restricción de fechas.</div>
          </div>
          @if (xlsFileName()) {
            <span class="xls-file-name">📄 {{ xlsFileName() }}</span>
          }
        </div>
        <div class="xls-drop-row">
          <label class="xls-drop-zone" [class.has-file]="xlsRows().length > 0">
            <input type="file" accept=".xlsx,.xls" (change)="onXlsFile($event)" style="display:none" />
            @if (xlsRows().length === 0) {
              <app-icon name="upload" [size]="28"></app-icon>
              <span>Selecciona el archivo .xlsx de MeLi (12h, 24h, 48h o 72h)</span>
            } @else {
              <app-icon name="check-circle" [size]="28"></app-icon>
              <span>{{ xlsRows().length }} ventas cargadas ({{ xlsDays().length }} días) — haz clic para reemplazar</span>
            }
          </label>
          @if (xlsError()) {
            <div class="xls-error">{{ xlsError() }}</div>
          }
        </div>

        @if (xlsRows().length > 0) {
        <div class="xls-summary">
          <div class="xls-kpi"><span class="xls-kpi-label">XLS Órdenes</span><span class="xls-kpi-val">{{ xlsTotalOrders() }}</span></div>
          <div class="xls-kpi"><span class="xls-kpi-label">XLS Gross (Ingresos por productos)</span><span class="xls-kpi-val">{{ xlsTotalGross() | currency:'MXN':'symbol-narrow':'1.0-0' }}</span></div>
          <div class="xls-kpi"><span class="xls-kpi-label">XLS Neto (Tu Pago)</span><span class="xls-kpi-val" style="color:#94a3b8">{{ xlsTotalRevenue() | currency:'MXN':'symbol-narrow':'1.0-0' }}</span></div>
          <div class="xls-kpi"><span class="xls-kpi-label">Período</span><span class="xls-kpi-val" style="font-size:0.9rem">{{ xlsDays()[0]?.date }} → {{ xlsDays()[xlsDays().length-1]?.date }}</span></div>
          <button class="run-btn xls-audit-btn" (click)="runXlsAudit()" [disabled]="isXlsAuditing()">
            @if (isXlsAuditing()) { <span class="spinner"></span> Auditando… }
            @else { <app-icon name="search" [size]="15"></app-icon> Auditar XLS vs Firestore }
          </button>
        </div>
        }
      </div>

      <!-- XLS Audit Results -->
      @if (xlsAuditResult()) {
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-card" [class.delta-ok]="xlsAuditResult()!.totalMissing === 0" [class.delta-bad]="xlsAuditResult()!.totalMissing > 0">
          <span class="kpi-label">Faltantes en Firestore</span>
          <span class="kpi-value">{{ xlsAuditResult()!.totalMissing }}</span>
          <span class="kpi-sub">de {{ xlsAuditResult()!.totalXlsOrders }} en XLS</span>
        </div>
        <div class="kpi-card" [class.delta-bad]="xlsAuditResult()!.missingRevenue > 0" [class.delta-ok]="xlsAuditResult()!.missingRevenue === 0">
          <span class="kpi-label">Revenue sin ingestar</span>
          <span class="kpi-value">{{ xlsAuditResult()!.missingRevenue | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
          <span class="kpi-sub">gross de órdenes faltantes</span>
        </div>
        <div class="kpi-card" [class.delta-bad]="xlsAuditResult()!.totalMismatched > 0" [class.delta-ok]="xlsAuditResult()!.totalMismatched === 0">
          <span class="kpi-label">Montos desfasados</span>
          <span class="kpi-value">{{ xlsAuditResult()!.totalMismatched }}</span>
          <span class="kpi-sub">XLS gross ≠ Firestore total</span>
        </div>
        <div class="kpi-card delta-ok">
          <span class="kpi-label">OK (XLS = Firestore)</span>
          <span class="kpi-value">{{ xlsAuditResult()!.totalOk }}</span>
          <span class="kpi-sub">órdenes coinciden</span>
        </div>
      </div>

      <div class="table-card">
        <div class="table-header">
          <h2 class="table-title">XLS vs Firestore — Orden por Orden</h2>
          <div style="display:flex;gap:0.75rem;align-items:center">
            <input class="date-input" placeholder="Buscar ID..." [(ngModel)]="xlsAuditSearch"
                   style="padding:0.35rem 0.65rem;font-size:0.8rem;width:160px" />
            <div class="filter-chips">
              <button class="chip" [class.active]="xlsAuditFilter==='all'"     (click)="xlsAuditFilter='all'">Todos ({{ xlsAuditResult()!.totalXlsOrders }})</button>
              <button class="chip" [class.active]="xlsAuditFilter==='missing'"  (click)="xlsAuditFilter='missing'">🔴 Sin FS ({{ xlsAuditResult()!.totalMissing }})</button>
              <button class="chip" [class.active]="xlsAuditFilter==='mismatch'" (click)="xlsAuditFilter='mismatch'">⚠️ Desfase ({{ xlsAuditResult()!.totalMismatched }})</button>
              <button class="chip" [class.active]="xlsAuditFilter==='ok'"       (click)="xlsAuditFilter='ok'">✓ OK ({{ xlsAuditResult()!.totalOk }})</button>
            </div>
            @if (xlsAuditResult()!.totalMissing > 0) {
              <button class="resync-btn" (click)="forceResyncXls()" [disabled]="isResyncing()" style="margin-left:auto">
                @if (isResyncing()) { <span class="spinner"></span> Syncing… }
                @else { <app-icon name="download-cloud" [size]="15"></app-icon> Force Sync {{ xlsAuditResult()!.totalMissing }} faltantes }
              </button>
            }
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Fecha XLS</th>
                <th>Estado XLS</th>
                <th class="num">XLS Gross<br><small>(Ingresos por productos)</small></th>
                <th class="num">XLS Neto<br><small>(Tu pago)</small></th>
                <th class="num">Firestore total</th>
                <th>Fecha FS</th>
                <th>Estado FS</th>
                <th class="num">Delta (Gross-FS)</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              @for (o of filteredXlsAudit(); track o.id) {
              <tr [class.row-bad]="!o.inFirestore" [class.row-warn]="o.inFirestore && Math.abs(o.grossDelta) > 1">
                <td class="id-cell">{{ o.id }}</td>
                <td class="date-cell">{{ o.xlsDate }}</td>
                <td><span class="status-badge">{{ o.xlsStatus }}</span></td>
                <td class="num">{{ o.xlsGross | currency:'MXN':'symbol-narrow':'1.2-2' }}</td>
                <td class="num" style="color:#94a3b8">{{ o.xlsNet | currency:'MXN':'symbol-narrow':'1.2-2' }}</td>
                <td class="num">{{ o.fsTotal !== null ? (o.fsTotal | currency:'MXN':'symbol-narrow':'1.2-2') : '—' }}</td>
                <td class="date-cell">{{ o.fsDate ?? '—' }}</td>
                <td><span class="status-badge" [class.badge-ok]="o.fsStatus==='paid'" [class.badge-warn]="o.fsStatus==='payment_in_process'">{{ o.fsStatus ?? '—' }}</span></td>
                <td class="num delta-cell" [class.neg]="o.grossDelta < 0">
                  {{ o.inFirestore ? ((o.grossDelta >= 0 ? '+' : '') + (o.grossDelta | currency:'MXN':'symbol-narrow':'1.0-0')) : '—' }}
                </td>
                <td>
                  @if (!o.inFirestore) { <span class="badge-missing">🔴 Sin FS</span> }
                  @else if (Math.abs(o.grossDelta) > 1) { <span class="badge-gap">⚠️ {{ o.grossDelta | currency:'MXN':'symbol-narrow':'1.0-0' }}</span> }
                  @else { <span class="ok-tick">✓</span> }
                </td>
              </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="table-footer">Mostrando {{ filteredXlsAudit().length }} de {{ xlsAuditResult()!.orders.length }} órdenes del XLS</div>
      </div>
      }

      <!-- Summary KPIs -->
      @if (result()) {
      <div class="kpi-grid">
        <div class="kpi-card meli">
          <span class="kpi-label">MeLi API (total_amount)</span>
          <span class="kpi-value">{{ result()!.summary.totalMeliRevenue | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
          <span class="kpi-sub">{{ result()!.summary.meliOrderCount }} orders (gross buyer total)</span>
        </div>
        <div class="kpi-card meli-paid">
          <span class="kpi-label">MeLi paid_amount</span>
          <span class="kpi-value">{{ result()!.summary.totalMeliPaid | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
          <span class="kpi-sub">≈ portal settlement figure</span>
        </div>
        <div class="kpi-card fs">
          <span class="kpi-label">Firestore Revenue</span>
          <span class="kpi-value">{{ result()!.summary.totalFsRevenue | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
          <span class="kpi-sub">{{ result()!.summary.fsOrderCount }} orders</span>
        </div>
        <div class="kpi-card" [class.delta-bad]="result()!.summary.totalDelta > 100" [class.delta-ok]="result()!.summary.totalDelta <= 100">
          <span class="kpi-label">Discrepancy</span>
          <span class="kpi-value">{{ result()!.summary.totalDelta | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
          <span class="kpi-sub">{{ result()!.summary.missingCount }} missing orders</span>
        </div>
      </div>

      <!-- Per-Day Table -->
      <div class="table-card">
        <div class="table-header">
          <h2 class="table-title">API vs Firestore — Day-by-Day</h2>
          <span class="table-period">{{ result()!.dateFrom }} → {{ result()!.dateTo }}</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th class="num">MeLi API<br><small>total_amount</small></th>
                <th class="num">MeLi paid<br><small>paid_amount</small></th>
                <th class="num">Firestore</th>
                <th class="num">API vs FS</th>
                <th class="num">MeLi Orders</th>
                <th class="num">FS Orders</th>
                <th>Missing IDs</th>
              </tr>
            </thead>
            <tbody>
              @for (day of result()!.perDay; track day.date) {
              <tr [class.row-ok]="Math.abs(day.delta) < 10" [class.row-warn]="day.delta > 10 && day.delta < 1000" [class.row-bad]="day.delta >= 1000">
                <td class="date-cell">{{ day.date }}</td>
                <td class="num">{{ day.meliTotal | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                <td class="num" style="color:#94a3b8">{{ day.meliPaid | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                <td class="num">{{ day.fsTotal | currency:'MXN':'symbol-narrow':'1.0-0' }}</td>
                <td class="num delta-cell" [class.neg]="day.delta < 0">
                  {{ day.delta >= 0 ? '+' : '' }}{{ day.delta | currency:'MXN':'symbol-narrow':'1.0-0' }}
                </td>
                <td class="num">{{ day.meliOrders }}</td>
                <td class="num">{{ day.fsOrders }}</td>
                <td>
                  @if (day.missingIds.length) {
                    <div class="missing-ids">
                      @for (id of day.missingIds.slice(0, 3); track id) {
                        <span class="id-chip">{{ id }}</span>
                      }
                      @if (day.missingIds.length > 3) {
                        <span class="id-more">+{{ day.missingIds.length - 3 }} más</span>
                      }
                    </div>
                  } @else {
                    <span class="ok-tick">✓</span>
                  }
                </td>
              </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Missing Orders Detail -->
      @if (result()!.missingOrderIds.length) {
      <div class="missing-card">
        <div class="missing-header">
          <app-icon name="alert-triangle" [size]="18" class="warn-icon"></app-icon>
          <h2>Missing Orders ({{ result()!.missingOrderIds.length }})</h2>
          <span class="missing-sub">These exist on MercadoLibre but were never ingested into Firestore</span>
        </div>
        <div class="id-grid">
          @for (id of result()!.missingOrderIds; track id) {
            <span class="missing-id-pill">ML-{{ id }}</span>
          }
        </div>
      </div>
      }
      <!-- Order-by-Order Detail Table (API-driven) -->
      @if (result()!.orders.length) {
      <div class="table-card">
        <div class="table-header">
          <h2 class="table-title">API vs Firestore — Orden por Orden</h2>
          <div style="display:flex;gap:0.75rem;align-items:center">
            <input class="date-input" placeholder="Buscar ID..." [(ngModel)]="orderSearch"
                   style="padding:0.35rem 0.65rem;font-size:0.8rem;width:160px" />
            <div class="filter-chips">
              <button class="chip" [class.active]="orderFilter==='all'"    (click)="orderFilter='all'">Todos</button>
              <button class="chip" [class.active]="orderFilter==='missing'" (click)="orderFilter='missing'">Missing FS</button>
              <button class="chip" [class.active]="orderFilter==='mismatch'" (click)="orderFilter='mismatch'">Amount gap</button>
            </div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Fecha</th>
                <th>Status MeLi</th>
                <th class="num">API total_amount</th>
                <th class="num">API paid_amount</th>
                <th class="num">Firestore total</th>
                <th class="num">Delta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (o of filteredOrders(); track o.id) {
              <tr [class.row-bad]="!o.inFirestore" [class.row-warn]="o.inFirestore && getOrderAmountGap(o) > 10">
                <td class="id-cell">{{ o.id }}</td>
                <td class="date-cell">{{ o.date }}</td>
                <td><span class="status-badge" [class.badge-ok]="o.meliStatus==='paid'" [class.badge-warn]="o.meliStatus==='payment_in_process'">{{ o.meliStatus }}</span></td>
                <td class="num">{{ o.meliTotal | currency:'MXN':'symbol-narrow':'1.2-2' }}</td>
                <td class="num" style="color:#94a3b8">{{ o.meliPaid | currency:'MXN':'symbol-narrow':'1.2-2' }}</td>
                <td class="num">{{ o.fsTotal !== null ? (o.fsTotal | currency:'MXN':'symbol-narrow':'1.2-2') : '—' }}</td>
                <td class="num delta-cell" [class.neg]="getOrderAmountGap(o) < 0">
                  {{ o.fsTotal !== null ? ((getOrderAmountGap(o) >= 0 ? '+' : '') + (getOrderAmountGap(o) | currency:'MXN':'symbol-narrow':'1.0-0')) : '—' }}
                </td>
                <td>
                  @if (!o.inFirestore) { <span class="badge-missing">🔴 Sin FS</span> }
                  @else if (getOrderAmountGap(o) > 10) { <span class="badge-gap">⚠️ Gap</span> }
                  @else { <span class="ok-tick">✓</span> }
                </td>
              </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="table-footer">Mostrando {{ filteredOrders().length }} de {{ result()!.orders.length }} órdenes</div>
      </div>
      }
      } <!-- /end @if (result()) -->

      <!-- Empty state -->
      @if (!result() && !isLoading()) {
        <div class="empty-state">
          <app-icon name="search" [size]="48" class="empty-icon"></app-icon>
          <p>Select a date range and click <strong>Run Audit</strong> to compare MercadoLibre vs Firestore orders</p>
        </div>
      }

      <!-- Loading state -->
      @if (isLoading()) {
        <div class="loading-state">
          <div class="loading-pulse"></div>
          <p>Fetching orders from MercadoLibre and Firestore…</p>
          <span class="loading-sub">This may take 30-60 seconds for large date ranges</span>
        </div>
      }

    </div>
    `,
    styles: [`
      .recon-page { padding: 2rem; max-width: 1200px; font-family: 'Inter', sans-serif; }

      /* XLS Card */
      .xls-card { background: #1e2535; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }
      .xls-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .xls-icon { width: 36px; height: 36px; border-radius: 8px; background: rgba(16,185,129,0.12); color: #34d399; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .xls-title { font-size: 0.9rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 0.5rem; }
      .xls-badge { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.25); padding: 0.1rem 0.45rem; border-radius: 12px; font-size: 0.65rem; font-weight: 800; letter-spacing: 0.05em; }
      .xls-sub { font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; }
      .xls-file-name { margin-left: auto; font-size: 0.75rem; color: #94a3b8; font-family: monospace; }
      .xls-drop-row { display: flex; flex-direction: column; gap: 0.5rem; }
      .xls-drop-zone { display: flex; align-items: center; gap: 0.75rem; padding: 0.85rem 1.25rem; border: 1.5px dashed #334155; border-radius: 10px; color: #64748b; cursor: pointer; transition: all 0.2s; font-size: 0.82rem; }
      .xls-drop-zone:hover { border-color: #10b981; color: #34d399; background: rgba(16,185,129,0.04); }
      .xls-drop-zone.has-file { border-color: #10b981; color: #34d399; border-style: solid; background: rgba(16,185,129,0.05); }
      .xls-error { color: #f87171; font-size: 0.78rem; padding: 0.4rem 0.75rem; background: rgba(239,68,68,0.08); border-radius: 6px; }
      .xls-summary { display: flex; gap: 1.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #1a2236; flex-wrap: wrap; align-items: center; }
      .xls-kpi { display: flex; flex-direction: column; gap: 0.2rem; }
      .xls-kpi-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; }
      .xls-kpi-val { font-size: 1.1rem; font-weight: 800; color: #f1f5f9; font-family: monospace; }
      .xls-delta-ok .xls-kpi-val { color: #34d399; }
      .xls-delta-bad .xls-kpi-val { color: #f87171; }
      .xls-audit-btn { margin-left: auto; background: linear-gradient(135deg, #10b981, #059669); }

      /* Header */
      .recon-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
      .header-icon { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #f59e0b, #ef4444); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
      .header-title { font-size: 1.5rem; font-weight: 800; color: #f1f5f9; margin: 0 0 0.25rem; }
      .header-sub { font-size: 0.85rem; color: #64748b; margin: 0; }

      /* Controls */
      .controls-card { background: #1e2535; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }
      .controls-row { display: flex; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
      .date-group { display: flex; flex-direction: column; gap: 0.4rem; }
      .field-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
      .date-input { background: #0f1623; border: 1px solid #334155; border-radius: 8px; padding: 0.5rem 0.75rem; color: #e2e8f0; font-size: 0.9rem; outline: none; color-scheme: dark; }
      .date-input:focus { border-color: #f59e0b; }

      .run-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 1.25rem; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
      .run-btn:hover:not(:disabled) { opacity: 0.85; }
      .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .resync-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 1.25rem; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
      .resync-btn:hover:not(:disabled) { opacity: 0.85; }
      .resync-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .status-msg { margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.82rem; font-weight: 600; background: #dc2626/15; color: #f87171; border: 1px solid #dc2626/25; }
      .status-msg.success { background: rgba(16,185,129,0.1); color: #34d399; border-color: rgba(16,185,129,0.25); }

      /* KPI Grid */
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
      .kpi-card { background: #1e2535; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
      .kpi-card.meli { border-left: 4px solid #ffe600; }
      .kpi-card.meli-paid { border-left: 4px solid #f97316; }
      .kpi-card.fs { border-left: 4px solid #6366f1; }
      .kpi-card.delta-bad { border-left: 4px solid #ef4444; }
      .kpi-card.delta-ok { border-left: 4px solid #10b981; }
      .kpi-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
      .kpi-value { font-size: 1.5rem; font-weight: 800; color: #f1f5f9; font-family: 'JetBrains Mono', monospace; }
      .kpi-sub { font-size: 0.75rem; color: #94a3b8; }

      /* Table */
      .table-card { background: #1e2535; border: 1px solid #334155; border-radius: 12px; overflow: hidden; margin-bottom: 1.5rem; }
      .table-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; border-bottom: 1px solid #334155; }
      .table-title { font-size: 1rem; font-weight: 700; color: #f1f5f9; margin: 0; }
      .table-period { font-size: 0.78rem; color: #64748b; font-family: monospace; }
      .table-wrap { overflow-x: auto; }
      .data-table { width: 100%; border-collapse: collapse; }
      .data-table th { padding: 0.6rem 1rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; text-align: left; background: #0f1623; border-bottom: 1px solid #1e2535; }
      .data-table th.num { text-align: right; }
      .data-table td { padding: 0.6rem 1rem; font-size: 0.82rem; color: #cbd5e1; border-bottom: 1px solid #1a2236; vertical-align: middle; }
      .data-table td.num { text-align: right; font-family: monospace; }
      .date-cell { font-weight: 700; color: #e2e8f0; font-family: monospace; }
      .delta-cell { font-weight: 700; color: #10b981; }
      .delta-cell.neg { color: #f87171; }
      .row-ok td { background: rgba(16,185,129,0.03); }
      .row-warn td { background: rgba(245,158,11,0.04); }
      .row-bad td { background: rgba(239,68,68,0.06); }
      .ok-tick { color: #10b981; font-size: 1rem; }

      /* Order detail extras */
      .id-cell { font-family: monospace; font-size: 0.75rem; color: #94a3b8; }
      .filter-chips { display: flex; gap: 0.4rem; }
      .chip { padding: 0.25rem 0.65rem; border-radius: 20px; border: 1px solid #334155; background: transparent; color: #64748b; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
      .chip.active { background: rgba(245,158,11,0.15); color: #fbbf24; border-color: rgba(245,158,11,0.35); }
      .chip:hover:not(.active) { border-color: #475569; color: #94a3b8; }
      .status-badge { font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; background: rgba(100,116,139,0.15); color: #94a3b8; }
      .status-badge.badge-ok   { background: rgba(16,185,129,0.12); color: #34d399; }
      .status-badge.badge-warn { background: rgba(245,158,11,0.12); color: #fbbf24; }
      .badge-missing { font-size: 0.75rem; white-space: nowrap; }
      .badge-gap     { font-size: 0.75rem; }
      .table-footer { padding: 0.6rem 1.5rem; font-size: 0.75rem; color: #475569; border-top: 1px solid #1a2236; text-align: right; }

      /* Missing IDs */
      .missing-ids { display: flex; flex-wrap: wrap; gap: 0.35rem; }
      .id-chip { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.25); padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72rem; font-family: monospace; }
      .id-more { color: #94a3b8; font-size: 0.72rem; }

      /* Missing card */
      .missing-card { background: #1e2535; border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 1.25rem 1.5rem; }
      .missing-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
      .missing-header h2 { font-size: 0.95rem; font-weight: 700; color: #f1f5f9; margin: 0; }
      .missing-sub { font-size: 0.78rem; color: #94a3b8; margin-left: auto; }
      .warn-icon { color: #f59e0b; }
      .id-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .missing-id-pill { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.2); padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.75rem; font-family: monospace; }

      /* Empty / Loading */
      .empty-state { text-align: center; padding: 5rem 2rem; color: #475569; }
      .empty-icon { color: #334155; display: block; margin: 0 auto 1rem; }
      .empty-state p { font-size: 0.9rem; }
      .loading-state { text-align: center; padding: 5rem 2rem; color: #64748b; }
      .loading-pulse { width: 48px; height: 48px; border: 3px solid #334155; border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.5rem; }
      .loading-state p { font-size: 0.95rem; color: #94a3b8; margin-bottom: 0.5rem; }
      .loading-sub { font-size: 0.78rem; color: #475569; }
    `]
})
export class MeliReconciliatorComponent {
    private fns = inject(Functions);

    // State
    isLoading       = signal(false);
    isResyncing     = signal(false);
    result          = signal<ReconciliatorResult | null>(null);
    statusMessage   = signal<string>('');
    statusIsSuccess = signal(false);

    // XLS state
    xlsRows         = signal<XlsRow[]>([]);
    xlsFileName     = signal<string>('');
    xlsError        = signal<string>('');
    xlsDays         = signal<XlsDaySummary[]>([]);
    xlsTotalRevenue = signal<number>(0);  // net payout sum
    xlsTotalGross   = signal<number>(0);  // gross (Ingresos por productos) sum
    xlsTotalOrders  = signal<number>(0);
    xlsVsApiDelta   = signal<number>(0);

    // XLS Audit state
    xlsAuditResult  = signal<XlsAuditResult | null>(null);
    isXlsAuditing   = signal(false);
    xlsAuditSearch  = '';
    xlsAuditFilter: 'all' | 'missing' | 'mismatch' | 'ok' = 'all';

    filteredXlsAudit() {
        const xa = this.xlsAuditResult();
        if (!xa) return [];
        const s = this.xlsAuditSearch.trim();
        return xa.orders.filter(o => {
            if (s && !o.id.includes(s)) return false;
            if (this.xlsAuditFilter === 'missing')  return !o.inFirestore;
            if (this.xlsAuditFilter === 'mismatch') return o.inFirestore && Math.abs(o.grossDelta) > 1;
            if (this.xlsAuditFilter === 'ok')       return o.inFirestore && Math.abs(o.grossDelta) <= 1;
            return true;
        });
    }

    async runXlsAudit() {
        if (this.isXlsAuditing() || !this.xlsRows().length) return;
        this.isXlsAuditing.set(true);
        this.xlsAuditResult.set(null);
        try {
            const fn = httpsCallable<any, XlsAuditResult>(this.fns, 'meliXlsAudit');
            const payload = this.xlsRows().map(r => ({
                id:        r.orderId,
                xlsGross:  r.gross,
                xlsNet:    r.total,
                xlsDate:   r.date,
                xlsStatus: r.status,
            }));
            const res = await fn({ orders: payload });
            this.xlsAuditResult.set(res.data);
        } catch (err: any) {
            this.statusMessage.set(`XLS Audit error: ${err?.message ?? err}`);
            this.statusIsSuccess.set(false);
        } finally {
            this.isXlsAuditing.set(false);
        }
    }

    forceResyncXls() {
        const xa = this.xlsAuditResult();
        if (!xa) return;
        const missingIds = xa.orders.filter(o => !o.inFirestore).map(o => o.id);
        if (!missingIds.length) return;
        // Reuse the existing forceResync flow by injecting the missing IDs
        this.forceResyncIds(missingIds);
    }

    // XLS per-order lookup map (populated when XLS is loaded)
    private xlsOrderMap = new Map<string, number>(); // orderId → XLS net total

    // Order detail filter/search
    orderSearch = '';
    orderFilter: 'all' | 'missing' | 'mismatch' = 'all';

    filteredOrders(): OrderDetail[] {
        const r = this.result();
        if (!r?.orders) return [];
        const search = this.orderSearch.trim();
        return r.orders.filter(o => {
            if (search && !o.id.includes(search)) return false;
            if (this.orderFilter === 'missing')  return !o.inFirestore;
            if (this.orderFilter === 'mismatch') return o.inFirestore && this.getOrderAmountGap(o) > 10;
            return true;
        });
    }

    getOrderAmountGap(o: OrderDetail): number {
        if (o.fsTotal === null) return 0;
        return Math.round((o.meliTotal - o.fsTotal) * 100) / 100;
    }

    getXlsAmount(orderId: string): number | null {
        const v = this.xlsOrderMap.get(orderId);
        return v !== undefined ? v : null;
    }

    // Date range defaults: last 7 days
    todayStr = new Date().toISOString().slice(0, 10);
    dateFrom = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return d.toISOString().slice(0, 10);
    })();
    dateTo = this.todayStr;

    Math = Math;

    // ── XLS Parsing ───────────────────────────────────────────────────────────

    /** Spanish month name → 0-indexed month number */
    private readonly MESES: Record<string, number> = {
        enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5,
        julio:6, agosto:7, septiembre:8, octubre:9, noviembre:10, diciembre:11
    };

    /** Statuses in the XLS that should NOT count as revenue */
    private readonly XLS_CANCEL = [
        'cancelada', 'devoluc', 'mediación finalizada con reembolso'
    ];

    /** Parse "17 de mayo de 2026 09:37 hs." → "2026-05-17" */
    private parseMxDate(raw: string): string {
        const m = String(raw).toLowerCase().match(/^(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/);
        if (!m) return '';
        const day   = String(m[1]).padStart(2, '0');
        const month = String((this.MESES[m[2]] ?? 0) + 1).padStart(2, '0');
        return `${m[3]}-${month}-${day}`;
    }

    onXlsFile(event: Event) {
        this.xlsError.set('');
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        this.xlsFileName.set(file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const wb   = XLSX.read(data, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

                // MeLi report: real column headers are at row index 5
                const hdrs: string[] = raw[5] ?? [];
                const idxId     = hdrs.indexOf('# de venta');
                const idxDate   = hdrs.indexOf('Fecha de venta');
                const idxStatus = hdrs.indexOf('Estado');
                const idxGross  = hdrs.indexOf('Ingresos por productos (MXN)'); // = API total_amount
                const idxTotal  = hdrs.indexOf('Total (MXN)');                  // net payout

                if (idxId === -1 || idxDate === -1 || idxTotal === -1) {
                    this.xlsError.set('Formato no reconocido. ¿Es el reporte de Ventas de MercadoLibre?');
                    return;
                }

                const rows: XlsRow[] = [];
                for (let i = 6; i < raw.length; i++) {
                    const r = raw[i];
                    const status = String(r[idxStatus] ?? '').toLowerCase();
                    if (this.XLS_CANCEL.some(c => status.includes(c))) continue;

                    const orderId = String(r[idxId] ?? '').trim();
                    const date    = this.parseMxDate(String(r[idxDate] ?? ''));
                    const gross   = Number(r[idxGross]) || 0;
                    const total   = Number(r[idxTotal]) || 0;
                    if (!orderId || !date) continue;
                    // Use gross for filtering — skip orders with zero gross (truly cancelled)
                    if (gross <= 0 && total <= 0) continue;
                    rows.push({ orderId, date, status: r[idxStatus], gross, total });
                }

                // Build lookup map for API-driven order table
                this.xlsOrderMap.clear();
                for (const row of rows) {
                    this.xlsOrderMap.set(row.orderId, (this.xlsOrderMap.get(row.orderId) ?? 0) + row.gross);
                }

                // Group by day
                const dayMap = new Map<string, XlsDaySummary>();
                for (const row of rows) {
                    if (!dayMap.has(row.date)) {
                        dayMap.set(row.date, { date: row.date, gross: 0, total: 0, orders: 0, orderIds: [] });
                    }
                    const d = dayMap.get(row.date)!;
                    d.gross  += row.gross;
                    d.total  += row.total;
                    d.orders += 1;
                    d.orderIds.push(row.orderId);
                }

                const days    = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
                const totGross = days.reduce((s, d) => s + d.gross, 0);
                const totNet   = days.reduce((s, d) => s + d.total, 0);
                const totOrd   = days.reduce((s, d) => s + d.orders, 0);

                this.xlsRows.set(rows);
                this.xlsDays.set(days);
                this.xlsTotalGross.set(Math.round(totGross * 100) / 100);
                this.xlsTotalRevenue.set(Math.round(totNet * 100) / 100);
                this.xlsTotalOrders.set(totOrd);
                this.xlsAuditResult.set(null); // reset audit when new file loaded
                this.computeXlsVsApi();
            } catch (err: any) {
                this.xlsError.set(`Error al leer el archivo: ${err?.message ?? err}`);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    private computeXlsVsApi() {
        const r = this.result();
        if (!r) { this.xlsVsApiDelta.set(0); return; }
        const apiTotal = r.summary.totalMeliRevenue;
        this.xlsVsApiDelta.set(Math.round(Math.abs(this.xlsTotalRevenue() - apiTotal) * 100) / 100);
    }

    getApiDay(date: string): DayData | null {
        return this.result()?.perDay.find(d => d.date === date) ?? null;
    }

    getXlsVsApi(day: XlsDaySummary): number | null {
        const apiDay = this.getApiDay(day.date);
        return apiDay !== null ? day.total - apiDay.meliTotal : null;
    }

    getXlsVsApiStr(day: XlsDaySummary): string {
        const v = this.getXlsVsApi(day);
        if (v === null) return '—';
        const fmt = Math.round(Math.abs(v)).toLocaleString('es-MX');
        return `${v >= 0 ? '+' : '-'}$${fmt}`;
    }

    async runReconciliation() {
        if (this.isLoading()) return;
        this.isLoading.set(true);
        this.result.set(null);
        this.statusMessage.set('');

        try {
            const fn = httpsCallable<any, ReconciliatorResult>(this.fns, 'meliReconciliator');
            const res = await fn({ dateFrom: this.dateFrom, dateTo: this.dateTo });
            this.result.set(res.data);

            const s = res.data.summary;
            if (s.missingCount === 0) {
                this.statusMessage.set(`✅ Perfecto — no missing orders. Delta: ${s.totalDelta.toFixed(0)} MXN`);
                this.statusIsSuccess.set(true);
            } else {
                this.statusMessage.set(`⚠️ Found ${s.missingCount} missing orders — total discrepancy: $${s.totalDelta.toFixed(0)} MXN`);
                this.statusIsSuccess.set(false);
            }
        } catch (e: any) {
            this.statusMessage.set(`Error: ${e?.message ?? e}`);
            this.statusIsSuccess.set(false);
        } finally {
            this.isLoading.set(false);
        }
    }

    async forceResyncAll() {
        const r = this.result();
        if (!r?.missingOrderIds?.length || this.isResyncing()) return;
        await this.forceResyncIds(r.missingOrderIds);
        await this.runReconciliation();
    }

    async forceResyncIds(ids: string[]) {
        if (!ids.length || this.isResyncing()) return;
        this.isResyncing.set(true);
        this.statusMessage.set('');

        try {
            const CHUNK = 100;
            let totalSynced = 0, totalFailed = 0;
            const fn = httpsCallable<any, any>(this.fns, 'meliForceResync');
            for (let i = 0; i < ids.length; i += CHUNK) {
                const res = await fn({ orderIds: ids.slice(i, i + CHUNK) });
                totalSynced += res.data.synced ?? 0;
                totalFailed += res.data.failed ?? 0;
            }
            this.statusMessage.set(`✅ Re-sync: ${totalSynced} importadas, ${totalFailed} fallidas.`);
            this.statusIsSuccess.set(true);
            // Re-run XLS audit if that's what triggered this
            if (this.xlsAuditResult()) await this.runXlsAudit();
        } catch (e: any) {
            this.statusMessage.set(`Re-sync error: ${e?.message ?? e}`);
            this.statusIsSuccess.set(false);
        } finally {
            this.isResyncing.set(false);
        }
    }
}
