import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { TranslateModule } from '@ngx-translate/core';
import { ToastService } from '../../../core/services/toast.service';
import {
    MultiChannelInventoryService,
    ChannelInventoryItem,
    ChannelStock,
    ChannelId,
    CHANNELS,
    ReplenishmentSummary,
} from '../../../core/services/multi-channel-inventory.service';

type FilterChannel = 'ALL' | ChannelId;

@Component({
    selector: 'app-replenishment-planner',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, AppIconComponent, TranslateModule, DecimalPipe, DatePipe],
    templateUrl: './replenishment-planner.component.html',
    styleUrls: ['./replenishment-planner.component.css'],
})
export class ReplenishmentPlannerComponent implements OnInit {
    private inventorySvc = inject(MultiChannelInventoryService);
    private toast        = inject(ToastService);

    // ── State ───────────────────────────────────────────────────────────────
    isLoading      = signal(false);
    isComputing    = signal(false);   // computing SKU stats from order history
    summary        = signal<ReplenishmentSummary | null>(null);
    selectedItems  = signal<Set<string>>(new Set());
    statsResult    = signal<{skusComputed:number;ordersRead:number}|null>(null);

    // Filters
    channelFilter  = signal<FilterChannel>('ALL');
    urgencyFilter  = signal<string>('ALL');
    searchQuery    = signal<string>('');

    // Expose constants to template
    readonly CHANNELS       = CHANNELS;
    readonly CHANNEL_IDS    = Object.keys(CHANNELS) as ChannelId[];

    readonly CHANNEL_TABS: { id: FilterChannel; label: string; icon: string }[] = [
        { id: 'ALL',        label: 'Todos',           icon: 'layers' },
        { id: 'MELI_FULL',  label: 'MercadoLibre Full', icon: 'shopping-bag' },
        { id: 'AMAZON_FBA', label: 'Amazon FBA',      icon: 'package' },
        { id: 'MAIN',       label: 'Almacén',         icon: 'home' },
    ];

    // ── Computed ─────────────────────────────────────────────────────────────
    filteredItems = computed(() => {
        const s = this.summary();
        if (!s) return [];

        let items = s.items;

        // Channel filter — only show items that have data for the selected channel
        const ch = this.channelFilter();
        if (ch !== 'ALL') {
            items = items.filter(i => i.channels[ch as ChannelId]);
        }

        // Urgency filter
        const urgF = this.urgencyFilter();
        if (urgF !== 'ALL') {
            items = items.filter(i => i.worstUrgency === urgF);
        }

        // Search
        const q = this.searchQuery().toLowerCase().trim();
        if (q) {
            items = items.filter(i =>
                i.sku.toLowerCase().includes(q) ||
                i.title.toLowerCase().includes(q)
            );
        }

        return items;
    });

    globalStats = computed(() => {
        const s = this.summary();
        if (!s) return null;
        const all = s.items;
        return {
            total:    all.length,
            critical: all.filter(i => i.worstUrgency === 'CRITICAL').length,
            high:     all.filter(i => i.worstUrgency === 'HIGH').length,
            medium:   all.filter(i => i.worstUrgency === 'MEDIUM').length,
            selected: this.selectedItems().size,
            selectedCost: this.selectedCost(),
            lastRefreshed: s.lastRefreshed,
        };
    });

    channelStats = computed(() => {
        const s = this.summary();
        if (!s) return null;
        return s.byChannel;
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    ngOnInit() { this.load(); }

    async load() {
        this.isLoading.set(true);
        this.selectedItems.set(new Set());
        this.statsResult.set(null);
        try {
            const result = await this.inventorySvc.loadReplenishmentData();
            this.summary.set(result);

            const critical = result.items.filter(i => i.worstUrgency === 'CRITICAL').length;
            const high     = result.items.filter(i => i.worstUrgency === 'HIGH').length;
            if (critical > 0) {
                this.toast.error(`⚠️ ${critical} producto(s) en estado CRÍTICO`);
            } else if (high > 0) {
                this.toast.info(`📦 ${high} producto(s) requieren reposición pronto`);
            } else {
                this.toast.success('✅ Inventario en niveles saludables');
            }
        } catch (err: any) {
            this.toast.error('Error cargando inventario: ' + err.message);
        } finally {
            this.isLoading.set(false);
        }
    }

    async computeSkuStats() {
        this.isComputing.set(true);
        try {
            const result = await this.inventorySvc.computeSkuStats();
            this.statsResult.set(result);
            this.toast.success(`✅ ${result.skusComputed} SKUs calculados desde ${result.ordersRead} órdenes`);
            // Reload after computing to show fresh velocity data
            await this.load();
        } catch (err: any) {
            this.toast.error('Error calculando estadísticas: ' + err.message);
        } finally {
            this.isComputing.set(false);
        }
    }

    // ── Selection ─────────────────────────────────────────────────────────────
    toggleItem(sku: string) {
        const s = new Set(this.selectedItems());
        s.has(sku) ? s.delete(sku) : s.add(sku);
        this.selectedItems.set(s);
    }

    selectAll() {
        this.selectedItems.set(new Set(this.filteredItems().map(i => i.sku)));
    }

    clearSelection() { this.selectedItems.set(new Set()); }

    private selectedCost(): number {
        const s = this.summary();
        if (!s) return 0;
        return Array.from(this.selectedItems())
            .map(sku => s.items.find(i => i.sku === sku))
            .filter(Boolean)
            .reduce((sum, i) => sum + (i?.estimatedReplenishCost ?? 0), 0);
    }

    generatePO() {
        const selected = this.selectedItems();
        if (!selected.size) { this.toast.warning('Selecciona al menos un producto'); return; }

        const items = this.summary()?.items.filter(i => selected.has(i.sku)) ?? [];

        // Group by channel for PO creation
        const byChannel = new Map<string, typeof items>();
        for (const item of items) {
            const ch = this.channelFilter() !== 'ALL'
                ? this.channelFilter()
                : Object.keys(item.channels)[0];
            if (!byChannel.has(ch)) byChannel.set(ch, []);
            byChannel.get(ch)!.push(item);
        }

        const cost = this.selectedCost();
        this.toast.success(
            `📋 ${byChannel.size} Orden(es) de Compra para ${items.length} productos — $${cost.toLocaleString('es-MX', { minimumFractionDigits: 0 })} MXN`
        );
    }

    // ── Formatters (delegate to service) ─────────────────────────────────────
    fmtVelocity(vel: number): string { return this.inventorySvc.formatVelocity(vel); }
    fmtDays(days: number): string    { return this.inventorySvc.formatDays(days); }
    urgencyLabel(lvl: string): string{ return this.inventorySvc.urgencyLabel(lvl); }

    urgencyClass(level: string): string {
        const map: Record<string, string> = {
            CRITICAL: 'urgency-critical',
            HIGH:     'urgency-high',
            MEDIUM:   'urgency-medium',
            LOW:      'urgency-low',
            OK:       'urgency-ok',
        };
        return map[level] ?? 'urgency-ok';
    }

    daysClass(days: number): string {
        if (days <= 0)   return 'days-critical';
        if (days < 7)    return 'days-critical';
        if (days < 14)   return 'days-high';
        if (days < 30)   return 'days-medium';
        return 'days-ok';
    }

    channelEntries(item: ChannelInventoryItem): ChannelStock[] {
        return (Object.keys(CHANNELS) as ChannelId[])
            .map(id => item.channels[id])
            .filter((c): c is ChannelStock => !!c);
    }

    trackBySku(_: number, item: ChannelInventoryItem) { return item.sku; }

    hasNoReplenishment(item: ChannelInventoryItem): boolean {
        return this.channelEntries(item).every(c => c.reorderQuantity <= 0);
    }

    stockBarWidth(stock: number, total: number): string {
        if (!total) return '0%';
        return Math.min(100, Math.round((stock / total) * 100)) + '%';
    }

    coverageBarWidth(days: number): string {
        if (days >= 9999) return '100%';
        return Math.min(100, Math.round((days / 60) * 100)) + '%';
    }

    coverageBarColor(days: number): string {
        if (days < 7)  return '#ef4444';
        if (days < 14) return '#f97316';
        if (days < 30) return '#eab308';
        return '#10b981';
    }
}
