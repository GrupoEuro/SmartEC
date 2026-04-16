import {
    Component, OnInit, signal, computed, inject
} from '@angular/core';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';
import {
    PriceIntelligenceService,
    PriceScan, CompetitorPrice, MotoEntry, MEXICO_MOTO_DB
} from './price-intelligence.service';

// ─── Channel Commission Config ────────────────────────────────────────────────
const CHANNEL_COMMISSIONS = [
    { id: 'web',                label: 'Web / Directo',         rate: 0,      icon: 'globe',      color: 'teal' },
    { id: 'pos',                label: 'POS / Local',           rate: 0,      icon: 'store',      color: 'zinc' },
    { id: 'meli_clasico',       label: 'MeLi Clásico',          rate: 0.133,  icon: 'shopping-bag', color: 'yellow' },
    { id: 'meli_premium',       label: 'MeLi Premium',          rate: 0.195,  icon: 'star',       color: 'orange' },
    { id: 'meli_full_clasico',  label: 'MeLi Full Clásico',     rate: 0.133,  icon: 'truck',      color: 'amber', fulfillmentFee: 35 },
    { id: 'meli_full_premium',  label: 'MeLi Full Premium',     rate: 0.195,  icon: 'truck',      color: 'red', fulfillmentFee: 35 },
    { id: 'amazon',             label: 'Amazon MX',             rate: 0.12,   icon: 'box',        color: 'blue' },
] as const;

type ActiveTab = 'scanner' | 'market' | 'costs';

@Component({
    selector: 'app-price-intelligence',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, RouterLink, AppIconComponent, AdminPageHeaderComponent, DecimalPipe, CurrencyPipe],
    template: `
<div class="p-6 max-w-7xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-2xl font-bold text-white flex items-center gap-2">
                <app-icon name="trending-up" [size]="28" class="text-violet-400"></app-icon>
                Price Intelligence
            </h1>
            <p class="text-zinc-400 text-sm mt-0.5">Análisis de precios competidores · MercadoLibre México · Márgenes por canal</p>
        </div>
        <div class="text-[10px] text-zinc-600 font-mono">v1.0.0 · MeLi API · MLM</div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-1">
        @for (tab of tabs; track tab.id) {
        <button (click)="activeTab.set(tab.id)"
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center"
            [class]="activeTab() === tab.id
                ? 'bg-violet-600 text-white shadow-lg'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/40'">
            <app-icon [name]="tab.icon" [size]="16"></app-icon>
            {{ tab.label }}
        </button>
        }
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 1: COMPETITOR SCANNER
    ══════════════════════════════════════════════════════════════════════ -->
    @if (activeTab() === 'scanner') {
    <div class="space-y-5">

        <!-- Search Box -->
        <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5">
            <label class="block text-zinc-300 text-sm font-semibold mb-3">
                Buscar precios por medida de llanta
            </label>
            <div class="flex gap-3">
                <div class="relative flex-1">
                    <app-icon name="search" [size]="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"></app-icon>
                    <input [(ngModel)]="searchQuery"
                        (keydown.enter)="runScan()"
                        placeholder="ej. 2.75-17  /  80/100-17  /  110/80-17"
                        class="w-full pl-10 pr-4 py-3 bg-zinc-700/50 border border-zinc-600/60 rounded-lg text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all" />
                </div>
                <button (click)="runScan()" [disabled]="isScanning()"
                    class="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all text-sm shrink-0">
                    @if (isScanning()) {
                        <app-icon name="loader" [size]="16" class="animate-spin"></app-icon> Buscando...
                    } @else {
                        <app-icon name="zap" [size]="16"></app-icon> Escanear
                    }
                </button>
            </div>
            <!-- Quick size chips -->
            <div class="flex flex-wrap gap-2 mt-3">
                <span class="text-xs text-zinc-500 self-center">Rápidos:</span>
                @for (sz of quickSizes; track sz) {
                <button (click)="quickScan(sz)"
                    class="px-3 py-1 text-xs bg-zinc-700/60 hover:bg-violet-600/30 hover:text-violet-300 border border-zinc-600/60 hover:border-violet-500/40 rounded-full text-zinc-400 transition-all font-mono">
                    {{ sz }}
                </button>
                }
            </div>
        </div>

        <!-- Scan Results -->
        @if (currentScan()) {
        <div class="space-y-4">

            <!-- Stats Summary -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                @for (stat of scanStats(); track stat.label) {
                <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 text-center">
                    <div [class]="'text-2xl font-bold ' + stat.color">{{ stat.value }}</div>
                    <div class="text-xs text-zinc-500 mt-1">{{ stat.label }}</div>
                </div>
                }
            </div>

            <!-- Listings Grid -->
            <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
                <div class="flex items-center justify-between p-4 border-b border-zinc-700/50">
                    <h3 class="text-white font-semibold flex items-center gap-2">
                        <app-icon name="shopping-bag" [size]="18" class="text-violet-400"></app-icon>
                        {{ currentScan()!.results.length }} resultados en MercadoLibre MX
                        <span class="text-xs text-zinc-500 font-normal">· {{ currentScan()!.normalizedSize }}</span>
                    </h3>
                    <span class="text-[10px] text-zinc-600">{{ currentScan()!.fetchedAt | date:'HH:mm:ss' }}</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="border-b border-zinc-700/50 bg-zinc-900/30">
                                <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide">Producto</th>
                                <th class="text-right px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide">Precio</th>
                                <th class="text-right px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden md:table-cell">Vendidos</th>
                                <th class="text-center px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden md:table-cell">Envío</th>
                                <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Vendedor</th>
                                <th class="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (item of currentScan()!.results.slice(0, showAll() ? 999 : 15); track item.url) {
                            <tr class="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors">
                                <td class="px-4 py-3">
                                    <div class="flex items-center gap-3">
                                        @if (item.thumbnail) {
                                        <img [src]="item.thumbnail" class="w-10 h-10 object-contain rounded bg-white/5 shrink-0" [alt]="item.title" />
                                        }
                                        <div class="min-w-0">
                                            <p class="text-zinc-200 text-xs font-medium line-clamp-2 leading-tight">{{ item.title }}</p>
                                            <span [class]="'inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ' +
                                                (item.condition === 'new' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-600/40 text-zinc-400')">
                                                {{ item.condition === 'new' ? 'Nuevo' : 'Usado' }}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td class="px-4 py-3 text-right">
                                    <span [class]="'font-bold text-base ' + getPriceColor(item.price)">
                                        {{ item.price | currency:'MXN':'symbol-narrow':'1.0-0' }}
                                    </span>
                                </td>
                                <td class="px-4 py-3 text-right text-zinc-400 text-xs hidden md:table-cell">
                                    {{ item.soldQty ?? 0 | number }}
                                </td>
                                <td class="px-4 py-3 text-center hidden md:table-cell">
                                    <span [class]="'text-xs ' + (item.freeShipping ? 'text-emerald-400' : 'text-zinc-500')">
                                        {{ item.freeShipping ? '✓ Gratis' : '—' }}
                                    </span>
                                </td>
                                <td class="px-4 py-3 text-xs text-zinc-500 hidden lg:table-cell truncate max-w-[120px]">{{ item.seller }}</td>
                                <td class="px-4 py-3">
                                    <a [href]="item.url" target="_blank" rel="noopener"
                                        class="p-1.5 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors inline-flex">
                                        <app-icon name="external-link" [size]="14"></app-icon>
                                    </a>
                                </td>
                            </tr>
                            }
                        </tbody>
                    </table>
                </div>
                @if (!showAll() && currentScan()!.results.length > 15) {
                <button (click)="showAll.set(true)"
                    class="w-full py-3 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30 transition-colors text-center border-t border-zinc-700/50">
                    Ver {{ currentScan()!.results.length - 15 }} resultados más ↓
                </button>
                }
            </div>

            <!-- Motos that use this size -->
            @if (motosForSize().length) {
            <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5">
                <h3 class="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                    <app-icon name="zap" [size]="16" class="text-amber-400"></app-icon>
                    Motos que usan la medida {{ currentScan()!.normalizedSize }}
                </h3>
                <div class="flex flex-wrap gap-2">
                    @for (moto of motosForSize(); track moto.model) {
                    <div class="flex items-center gap-2 px-3 py-2 bg-zinc-700/40 border border-zinc-600/40 rounded-lg text-xs">
                        <span class="font-semibold text-zinc-200">{{ moto.brand }} {{ moto.model }}</span>
                        <span class="text-zinc-500">·</span>
                        <span class="text-zinc-400">{{ moto.segment }}</span>
                        <span [class]="'px-1.5 py-0.5 rounded font-medium ' + getPopularityStyle(moto.popularity)">
                            {{ moto.popularity }}
                        </span>
                    </div>
                    }
                </div>
            </div>
            }
        </div>
        }

        <!-- Empty state -->
        @if (!currentScan() && !isScanning()) {
        <div class="text-center py-16 text-zinc-500">
            <app-icon name="search" [size]="40" class="mx-auto mb-4 text-zinc-700"></app-icon>
            <p class="text-sm">Ingresa una medida de llanta para ver precios en MercadoLibre MX</p>
            <p class="text-xs mt-1 text-zinc-600">Datos en tiempo real · Sin autenticación requerida</p>
        </div>
        }
    </div>
    }

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 2: MARKET MAP (TAM)
    ══════════════════════════════════════════════════════════════════════ -->
    @if (activeTab() === 'market') {
    <div class="space-y-4">
        <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
            <div class="p-4 border-b border-zinc-700/50">
                <h3 class="text-white font-semibold flex items-center gap-2">
                    <app-icon name="map" [size]="18" class="text-amber-400"></app-icon>
                    Mercado de Motos México — Medidas de Llantas
                </h3>
                <p class="text-xs text-zinc-500 mt-1">Base de datos de modelos top + sus medidas originales · Haz clic en una medida para escanear precios</p>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-zinc-700/50 bg-zinc-900/30">
                            <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide">Marca / Modelo</th>
                            <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden md:table-cell">Segmento</th>
                            <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide">Delantera</th>
                            <th class="text-left px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide">Trasera</th>
                            <th class="text-center px-4 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide hidden md:table-cell">Popularidad</th>
                            <th class="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (moto of allMotos; track moto.model) {
                        <tr class="border-b border-zinc-700/30 hover:bg-zinc-700/20 transition-colors group">
                            <td class="px-4 py-3">
                                <div>
                                    <span class="font-semibold text-zinc-200">{{ moto.brand }}</span>
                                    <span class="text-zinc-400 ml-1">{{ moto.model }}</span>
                                    @if (moto.notes) {
                                    <div class="text-[10px] text-amber-400/70 mt-0.5">{{ moto.notes }}</div>
                                    }
                                </div>
                            </td>
                            <td class="px-4 py-3 text-zinc-500 text-xs hidden md:table-cell">{{ moto.segment }}</td>
                            <td class="px-4 py-3">
                                <button (click)="quickScanAndSwitch(moto.frontSize)"
                                    class="font-mono text-xs text-violet-300 hover:text-violet-100 hover:underline transition-colors">
                                    {{ moto.frontSize }}
                                </button>
                            </td>
                            <td class="px-4 py-3">
                                <button (click)="quickScanAndSwitch(moto.rearSize)"
                                    class="font-mono text-xs text-violet-300 hover:text-violet-100 hover:underline transition-colors">
                                    {{ moto.rearSize }}
                                </button>
                            </td>
                            <td class="px-4 py-3 text-center hidden md:table-cell">
                                <span [class]="'text-xs px-2 py-0.5 rounded-full font-medium ' + getPopularityStyle(moto.popularity)">
                                    {{ moto.popularity }}
                                </span>
                            </td>
                            <td class="px-4 py-3">
                                <button (click)="quickScanAndSwitch(moto.rearSize)"
                                    class="opacity-0 group-hover:opacity-100 p-1.5 bg-violet-600/20 hover:bg-violet-600/40 rounded-lg text-violet-400 transition-all text-xs flex items-center gap-1">
                                    <app-icon name="zap" [size]="12"></app-icon> Scan
                                </button>
                            </td>
                        </tr>
                        }
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    }

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 3: COST ANALYZER + CHANNEL MARGINS
    ══════════════════════════════════════════════════════════════════════ -->
    @if (activeTab() === 'costs') {
    <div class="space-y-5">
        <!-- Input card -->
        <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5 space-y-4">
            <h3 class="text-white font-semibold text-sm">Calculadora de Márgenes por Canal</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-xs text-zinc-400 mb-1.5">Costo de importación (MXN)</label>
                    <input type="number" [(ngModel)]="costInput"
                        placeholder="ej. 280"
                        class="w-full px-3 py-2.5 bg-zinc-700/50 border border-zinc-600/60 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500 transition-all" />
                </div>
                <div>
                    <label class="block text-xs text-zinc-400 mb-1.5">Precio de venta (MXN)</label>
                    <input type="number" [(ngModel)]="priceInput"
                        placeholder="ej. 590"
                        class="w-full px-3 py-2.5 bg-zinc-700/50 border border-zinc-600/60 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500 transition-all" />
                </div>
                <div>
                    <label class="block text-xs text-zinc-400 mb-1.5">Precio de referencia mercado (MXN)</label>
                    <input type="number" [(ngModel)]="marketPriceInput"
                        [placeholder]="currentScan() ? currentScan()!.median.toFixed(0) : 'ej. 550'"
                        class="w-full px-3 py-2.5 bg-zinc-700/50 border border-zinc-600/60 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500 transition-all" />
                </div>
            </div>
        </div>

        <!-- Channel breakdown -->
        @if (costInput > 0 && priceInput > 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (ch of channelAnalysis(); track ch.id) {
            <div [class]="'bg-zinc-800/60 border rounded-xl p-4 ' + (ch.netMarginPct >= 20 ? 'border-emerald-500/30' : ch.netMarginPct >= 10 ? 'border-zinc-600/50' : 'border-red-500/30')">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <app-icon [name]="ch.icon" [size]="16" class="text-zinc-400"></app-icon>
                        <span class="text-sm font-semibold text-zinc-200">{{ ch.label }}</span>
                    </div>
                    <span [class]="'text-xs font-bold px-2 py-0.5 rounded-full ' +
                        (ch.netMarginPct >= 20 ? 'bg-emerald-500/20 text-emerald-400' :
                         ch.netMarginPct >= 10 ? 'bg-zinc-600/40 text-zinc-300' :
                         'bg-red-500/20 text-red-400')">
                        {{ ch.netMarginPct | number:'1.1-1' }}%
                    </span>
                </div>
                <div class="space-y-1.5 text-xs">
                    <div class="flex justify-between text-zinc-400">
                        <span>Precio venta</span>
                        <span class="text-zinc-200 font-mono">{{ priceInput | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    @if (ch.commissionAmt > 0) {
                    <div class="flex justify-between text-zinc-400">
                        <span>Comisión ({{ (ch.commissionRate * 100) | number:'1.1-1' }}%)</span>
                        <span class="text-red-400 font-mono">−{{ ch.commissionAmt | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    }
                    @if (ch.fulfillmentFee > 0) {
                    <div class="flex justify-between text-zinc-400">
                        <span>Fulfillment</span>
                        <span class="text-red-400 font-mono">−{{ ch.fulfillmentFee | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    }
                    <div class="flex justify-between text-zinc-400 border-t border-zinc-700/50 pt-1 mt-1">
                        <span>Costo</span>
                        <span class="text-zinc-300 font-mono">−{{ costInput | currency:'MXN':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    <div class="flex justify-between font-semibold border-t border-zinc-600/50 pt-1.5 mt-1">
                        <span [class]="ch.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'">Utilidad neta</span>
                        <span [class]="'font-mono ' + (ch.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400')">
                            {{ ch.netProfit | currency:'MXN':'symbol-narrow':'1.0-0' }}
                        </span>
                    </div>
                </div>
                @if (marketPriceInput > 0) {
                <div class="mt-3 pt-3 border-t border-zinc-700/40 text-[10px]">
                    <span class="text-zinc-500">vs mercado: </span>
                    <span [class]="priceInput <= marketPriceInput ? 'text-emerald-400' : 'text-amber-400'">
                        {{ priceInput <= marketPriceInput ? '✓ Competitivo' : '▲ +' + ((priceInput - marketPriceInput) | currency:'MXN':'symbol-narrow':'1.0-0') + ' sobre mercado' }}
                    </span>
                </div>
                }
            </div>
            }
        </div>

        <!-- Break-even analysis -->
        <div class="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5">
            <h4 class="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <app-icon name="target" [size]="16" class="text-violet-400"></app-icon>
                Precio mínimo de equilibrio por canal (con 15% margen mínimo)
            </h4>
            <div class="flex flex-wrap gap-3">
                @for (ch of breakEvenPrices(); track ch.id) {
                <div class="bg-zinc-700/40 rounded-lg px-3 py-2 text-xs">
                    <div class="text-zinc-500">{{ ch.label }}</div>
                    <div class="font-mono font-bold text-violet-300 text-sm">{{ ch.breakEven | currency:'MXN':'symbol-narrow':'1.0-0' }}</div>
                </div>
                }
            </div>
        </div>
        }
    </div>
    }

</div>
    `,
    styles: [`
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    `]
})
export class PriceIntelligenceComponent implements OnInit {
    private priceService = inject(PriceIntelligenceService);

    // ── State ──
    activeTab = signal<ActiveTab>('scanner');
    isScanning = signal(false);
    currentScan = signal<PriceScan | null>(null);
    showAll = signal(false);
    searchQuery = '';

    // ── Cost Analyzer ──
    costInput = 0;
    priceInput = 0;
    marketPriceInput = 0;

    // ── Data ──
    allMotos = MEXICO_MOTO_DB;
    quickSizes = ['2.50-17', '2.75-17', '3.00-17', '2.75-18', '3.00-18', '80/100-17', '90/90-17', '110/80-17', '100/80-17', '130/70-17'];

    tabs = [
        { id: 'scanner' as ActiveTab, label: 'Scanner Precios', icon: 'search' },
        { id: 'market'  as ActiveTab, label: 'Mapa de Mercado',  icon: 'map' },
        { id: 'costs'   as ActiveTab, label: 'Análisis de Costos', icon: 'dollar-sign' },
    ];

    // ── Computed ──
    motosForSize = computed(() => {
        const scan = this.currentScan();
        if (!scan) return [];
        return this.priceService.getMotosForSize(scan.normalizedSize);
    });

    scanStats = computed(() => {
        const scan = this.currentScan();
        if (!scan) return [];
        return [
            { label: 'Mínimo MeLi', value: this.priceService.formatCurrencyMXN(scan.min), color: 'text-emerald-400' },
            { label: 'Mediana',     value: this.priceService.formatCurrencyMXN(scan.median), color: 'text-violet-300' },
            { label: 'Promedio',    value: this.priceService.formatCurrencyMXN(scan.avg), color: 'text-blue-400' },
            { label: 'Máximo',      value: this.priceService.formatCurrencyMXN(scan.max), color: 'text-zinc-300' },
        ];
    });

    channelAnalysis = computed(() => {
        return CHANNEL_COMMISSIONS.map(ch => {
            const commissionAmt  = this.priceInput * ch.rate;
            const fulfillmentFee = (ch as any).fulfillmentFee ?? 0;
            const netRevenue     = this.priceInput - commissionAmt - fulfillmentFee;
            const netProfit      = netRevenue - this.costInput;
            const netMarginPct   = this.priceInput > 0 ? (netProfit / this.priceInput) * 100 : 0;
            return {
                ...ch,
                commissionAmt,
                fulfillmentFee,
                netRevenue,
                netProfit,
                netMarginPct,
                commissionRate: ch.rate,
            };
        });
    });

    breakEvenPrices = computed(() => {
        const minMargin = 0.15; // 15% minimum
        return CHANNEL_COMMISSIONS.map(ch => {
            const ff = (ch as any).fulfillmentFee ?? 0;
            // price = (cost + ff) / (1 - commission - minMargin)
            const denom = 1 - ch.rate - minMargin;
            const breakEven = denom > 0 ? Math.ceil((this.costInput + ff) / denom) : 0;
            return { id: ch.id, label: ch.label, breakEven };
        });
    });

    ngOnInit() {}

    async runScan() {
        const query = this.searchQuery.trim();
        if (!query) return;
        this.isScanning.set(true);
        this.showAll.set(false);
        try {
            const scan = await this.priceService.scanCompetitorPrices(query);
            this.currentScan.set(scan);
            // Pre-fill market price with median
            if (scan.median > 0 && this.marketPriceInput === 0) {
                this.marketPriceInput = Math.round(scan.median);
            }
        } finally {
            this.isScanning.set(false);
        }
    }

    quickScan(size: string) {
        this.searchQuery = size;
        this.runScan();
    }

    quickScanAndSwitch(size: string) {
        this.searchQuery = size;
        this.activeTab.set('scanner');
        this.runScan();
    }

    getPriceColor(price: number): string {
        const scan = this.currentScan();
        if (!scan || scan.median === 0) return 'text-zinc-200';
        if (price <= scan.min * 1.05)  return 'text-emerald-400';
        if (price <= scan.median * 1.1) return 'text-zinc-200';
        return 'text-amber-300';
    }

    getPopularityStyle(pop: string): string {
        switch (pop) {
            case 'muy alta': return 'bg-emerald-500/20 text-emerald-400';
            case 'alta':     return 'bg-blue-500/20 text-blue-400';
            case 'media':    return 'bg-zinc-600/40 text-zinc-400';
            case 'nueva':    return 'bg-violet-500/20 text-violet-400';
            default:         return 'bg-zinc-600/40 text-zinc-400';
        }
    }
}
