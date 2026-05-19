import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, collection, collectionData, query, where, orderBy, Timestamp } from '@angular/fire/firestore';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { ProductService } from '../../../../core/services/product.service';
import { Subscription } from 'rxjs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderFinancials {
    id: string;
    total: number;
    marketplaceFee: number;
    retencion_iva: number;
    retencion_isr: number;
    shipping_seller_cost: number;
    refunded_amount: number;
    ml_bonus: number;
    net_receipt: number;
    is_ad_driven: boolean;
    fulfillmentType: string;
    createdAt: any;
    items?: any[];
}

type Period = '7d' | '30d' | 'mtd' | '90d';

@Component({
    selector: 'app-income-analytics',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule, AppIconComponent, CurrencyPipe, DecimalPipe, PercentPipe],
    templateUrl: './income-analytics.component.html',
    styleUrls: ['./income-analytics.component.css'],
})
export class IncomeAnalyticsComponent implements OnInit, OnDestroy {
    private firestore      = inject(Firestore);
    private productService = inject(ProductService);
    private sub?: Subscription;
    private productSub?: Subscription;

    // ── State ─────────────────────────────────────────────────────────────────
    selectedPeriod = signal<Period>('mtd');
    isLoading      = signal(true);
    orders         = signal<OrderFinancials[]>([]);
    // Product catalog for exact COGS lookup (costPrice / averageCost per SKU)
    products       = signal<any[]>([]);
    // Blended COGS % — user-editable fallback when product cost data is missing
    // Persisted to localStorage so it survives page refreshes
    cogsBlendedPct = signal<number>(
        parseFloat(localStorage.getItem('income_analytics_cogs_pct') ?? '60')
    );
    showCogsPanel  = signal(false);
    drillTarget    = signal<string | null>(null);
    // Estimated CFF % for MeLi Full orders where shipping_seller_cost === 0.
    // MeLi Full deducts the fulfillment fee from MercadoPago directly — it doesn't
    // appear in the order/shipment API. Default ~4% (blended MX auto parts tariff).
    cffEstimatedPct = signal<number>(
        parseFloat(localStorage.getItem('income_analytics_cff_pct') ?? '4')
    );

    showCffWarning = computed(() => {
        const fullWithNoCff = this.orders().filter(o =>
            (o as any).fulfillmentType === 'platform' &&
            !((o as any).shipping_seller_cost > 0)
        ).length;
        return { count: fullWithNoCff, hasMissing: fullWithNoCff > 0 };
    });

    // ── Period bounds ─────────────────────────────────────────────────────────
    readonly periods: { key: Period; label: string }[] = [
        { key: '7d',  label: 'Últimos 7 días' },
        { key: '30d', label: 'Últimos 30 días' },
        { key: 'mtd', label: 'Mes actual' },
        { key: '90d', label: 'Últimos 90 días' },
    ];

    readonly channels: { key: string; label: string; icon: string; color: string; available: boolean }[] = [
        { key: 'mercadolibre', label: 'MercadoLibre', icon: '🛒', color: '#ffe600', available: true  },
        { key: 'storefront',   label: 'Tienda Web',   icon: '🌐', color: '#6366f1', available: false },
        { key: 'pos',          label: 'POS / Mostrador', icon: '🖥️', color: '#10b981', available: false },
        { key: 'amazon',       label: 'Amazon',       icon: '📦', color: '#f59e0b', available: false },
        { key: 'on_behalf',    label: 'Venta Asistida', icon: '💼', color: '#ec4899', available: false },
    ];

    selectedChannel = signal<string>('mercadolibre');

    selectedChannelDef = computed(() =>
        this.channels.find(c => c.key === this.selectedChannel()) ?? this.channels[0]
    );

    private getDateFrom(period: Period): Date {
        const now = new Date();
        switch (period) {
            case '7d':  return new Date(now.getTime() - 7   * 86400_000);
            case '30d': return new Date(now.getTime() - 30  * 86400_000);
            case '90d': return new Date(now.getTime() - 90  * 86400_000);
            case 'mtd': return new Date(now.getFullYear(), now.getMonth(), 1);
        }
    }

    // ── Load orders + products ────────────────────────────────────────────────
    ngOnInit() {
        this.load();
        // Load product catalog once for exact COGS lookup
        this.productSub = this.productService.getProducts().subscribe(p => this.products.set(p));
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
        this.productSub?.unsubscribe();
    }

    selectPeriod(p: Period) {
        this.selectedPeriod.set(p);
        this.sub?.unsubscribe();
        this.load();
    }

    saveCogsBlended(val: number) {
        const clamped = Math.min(99, Math.max(1, val));
        this.cogsBlendedPct.set(clamped);
        localStorage.setItem('income_analytics_cogs_pct', String(clamped));
    }

    saveCffEstimated(val: number) {
        const clamped = Math.min(20, Math.max(0, val));
        this.cffEstimatedPct.set(clamped);
        localStorage.setItem('income_analytics_cff_pct', String(clamped));
    }

    private load() {
        this.isLoading.set(true);
        const dateFrom = this.getDateFrom(this.selectedPeriod());
        const ts = Timestamp.fromDate(dateFrom);

        // Query ALL orders for the date range — no sourceChannel server filter
        // (mirrors GlobalOrderCacheService strategy used by the dashboard).
        // Legacy orders may have sourceChannel undefined but still be MeLi orders;
        // we filter client-side for accuracy and to avoid missing any records.
        const q = query(
            collection(this.firestore, 'orders'),
            where('createdAt', '>=', ts),
            orderBy('createdAt', 'desc')
        );

        this.sub = collectionData(q, { idField: 'id' }).subscribe({
            next: (docs) => {
                // Same status exclusion as Operations Dashboard (EXCLUDED_FROM_REVENUE + GHOST_STATUSES)
                const EXCLUDED = new Set(['cancelled', 'refunded', 'returned',
                                          'pending_payment', 'refund_pending', 'payment_failed']);

                // Client-side MeLi filter — same logic as dashboard channelBreakdown
                const meliOrders = (docs as OrderFinancials[]).filter(o => {
                    const ch = (o as any).sourceChannel ?? '';
                    if (!(ch === 'mercadolibre' || ch === 'MELI' || ch === 'MELI_CLASSIC' || ch === 'MELI_FULL')) return false;
                    return !EXCLUDED.has((o as any).status ?? '');
                });
                this.orders.set(meliOrders);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('[IncomeAnalytics] Load error', err);
                this.isLoading.set(false);
            }
        });
    }

    // ── Aggregated Breakdown ──────────────────────────────────────────────────
    // When stored financial fields are missing (orders synced before backfill),
    // we apply the same formula as meli-orders.ts so numbers are always accurate.
    private calcFinancials(o: OrderFinancials) {
        const total   = (o as any).total || 0;
        const preIva  = total / 1.16;

        const comm    = ((o as any).marketplaceFee   || 0) > 0
                            ? (o as any).marketplaceFee
                            : Math.round(total * 0.1091 * 100) / 100;
        const iva     = ((o as any).retencion_iva    || 0) > 0
                            ? (o as any).retencion_iva
                            : Math.round(preIva * 0.08  * 100) / 100;
        const isr     = ((o as any).retencion_isr    || 0) > 0
                            ? (o as any).retencion_isr
                            : Math.round(preIva * 0.025 * 100) / 100;

        // Shipping: use stored value when available.
        // For MeLi Full orders with cff_pending (shipping_seller_cost === 0),
        // apply estimated CFF % since MeLi deducts it from MercadoPago — not in order API.
        const storedShip = (o as any).shipping_seller_cost || 0;
        const isFull     = (o as any).fulfillmentType === 'platform';
        const cffPending = (o as any).cff_pending === true || (isFull && storedShip === 0);
        const ship       = cffPending
                            ? Math.round(total * (this.cffEstimatedPct() / 100) * 100) / 100
                            : storedShip;

        const refunds = (o as any).refunded_amount || 0;
        const bonus   = (o as any).ml_bonus        || 0;
        const net     = ((o as any).net_receipt || 0) > 0 && !cffPending
                            ? (o as any).net_receipt
                            : Math.max(0, total - comm - iva - isr - ship - refunds + bonus);
        return { total, comm, iva, isr, ship, refunds, bonus, net, cffPending };
    }

    breakdown = computed(() => {
        const o = this.orders();
        let gross = 0, comm = 0, iva = 0, isr = 0, ship = 0, refunds = 0, bonus = 0, adOrders = 0;

        o.forEach(r => {
            const f = this.calcFinancials(r);
            gross   += f.total;
            comm    += f.comm;
            iva     += f.iva;
            isr     += f.isr;
            ship    += f.ship;
            refunds += f.refunds;
            bonus   += f.bonus;
            if ((r as any).is_ad_driven) adOrders++;
        });

        const net  = Math.max(0, gross - comm - iva - isr - ship - refunds + bonus);
        const n    = o.length || 1;
        // Round to 1 decimal to avoid float precision display bugs
        const pct  = (v: number) => gross > 0 ? Math.round(v / gross * 1000) / 10 : 0;

        return {
            orderCount: o.length,
            gross, comm, iva, isr, ship, refunds, bonus, net,
            netPct:    pct(net),   commPct:   pct(comm),
            ivaPct:    pct(iva),   isrPct:    pct(isr),
            shipPct:   pct(ship),  refundPct: pct(refunds),
            avgGross:  Math.round(gross / n),
            avgNet:    Math.round(net   / n),
            avgShip:   Math.round(ship  / n),
            avgComm:   Math.round(comm  / n),
            adOrders,
            adPct:    o.length > 0 ? Math.round(adOrders / o.length * 100) : 0,
            keepRate: pct(net),
        };
    });

    // ── Full P&L: adds COGS → Gross Profit → Margin ──────────────────────────
    // Strategy: look up exact cost per order item from product catalog.
    // Falls back to user-defined blended COGS % for orders with no cost data.
    pnl = computed(() => {
        const b        = this.breakdown();
        const prods    = this.products();
        const fallback = this.cogsBlendedPct() / 100;
        const orders   = this.orders();

        let cogsExact   = 0;  // from product catalog
        let cogsBlended = 0;  // fallback orders
        let exactCount  = 0;

        orders.forEach(o => {
            const items = (o as any).items as any[] | undefined;
            if (items && items.length > 0) {
                let orderCogs = 0;
                let resolved  = 0;
                items.forEach(item => {
                    const prod = prods.find(p => p.id === item.productId || p.sku === item.sku);
                    if (prod) {
                        const cost = (prod as any).averageCost || (prod as any).costPrice || 0;
                        if (cost > 0) {
                            orderCogs += cost * (item.quantity || 1);
                            resolved++;
                        }
                    }
                });
                if (resolved === items.length && orderCogs > 0) {
                    cogsExact += orderCogs;
                    exactCount++;
                } else {
                    cogsBlended += (o.total || 0) * fallback;
                }
            } else {
                cogsBlended += (o.total || 0) * fallback;
            }
        });

        const totalCogs     = cogsExact + cogsBlended;
        const net           = b.net;
        const grossProfit   = Math.max(0, net - totalCogs);
        const grossMargin   = net > 0 ? Math.round(grossProfit / net * 1000) / 10 : 0;
        const cogsAsPctNet  = net > 0 ? Math.round(totalCogs  / net * 1000) / 10 : 0;
        const cogsAsPctGross= b.gross > 0 ? Math.round(totalCogs / b.gross * 1000) / 10 : 0;
        const exactPct      = orders.length > 0 ? Math.round(exactCount / orders.length * 100) : 0;

        return {
            totalCogs, cogsExact, cogsBlended,
            grossProfit, grossMargin,
            cogsAsPctNet, cogsAsPctGross,
            exactCount, exactPct,
            // Profitability per order
            avgCogs:   orders.length > 0 ? Math.round(totalCogs   / orders.length) : 0,
            avgProfit: orders.length > 0 ? Math.round(grossProfit / orders.length) : 0,
        };
    });

    // ── Daily timeline (last N days) ─────────────────────────────────────────
    dailyTimeline = computed(() => {
        const o = this.orders();
        if (!o.length) return [];
        const byDate = new Map<string, { date: string; gross: number; net: number; orders: number }>();

        o.forEach(r => {
            let d: Date;
            if ((r as any).createdAt?.toDate) d = (r as any).createdAt.toDate();
            else if ((r as any).createdAt instanceof Date) d = (r as any).createdAt;
            else d = new Date((r as any).createdAt);

            const key  = d.toISOString().slice(0, 10);
            const prev = byDate.get(key) || { date: key, gross: 0, net: 0, orders: 0 };
            const f    = this.calcFinancials(r);
            prev.gross  += f.total;
            prev.net    += f.net;
            prev.orders += 1;
            byDate.set(key, prev);
        });

        const sorted   = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        const maxGross = Math.max(...sorted.map(d => d.gross), 1);
        return sorted.map(d => ({
            ...d,
            grossPct: Math.round(d.gross / maxGross * 100),
            netPct:   Math.round(d.net   / maxGross * 100),
            label:    d.date.slice(5),
        }));
    });

    // ── Fulfillment type breakdown ────────────────────────────────────────────
    fulfillmentBreakdown = computed(() => {
        const o = this.orders();
        const groups: Record<string, { count: number; gross: number; net: number; ship: number }> = {};
        o.forEach(r => {
            const key = (r as any).fulfillmentType === 'platform' ? 'MeLi Full ⚡' : 'Clásica (Merchant)';
            if (!groups[key]) groups[key] = { count: 0, gross: 0, net: 0, ship: 0 };
            const f = this.calcFinancials(r);
            groups[key].count++;
            groups[key].gross += f.total;
            groups[key].net   += f.net;
            groups[key].ship  += f.ship;
        });
        return Object.entries(groups).map(([label, d]) => ({
            label,
            ...d,
            keepRate: d.gross > 0 ? Math.round(d.net / d.gross * 100) : 0,
            pct: o.length > 0 ? Math.round(d.count / o.length * 100) : 0,
        })).sort((a, b) => b.gross - a.gross);
    });

    // ── Top 10 orders (highest net) ───────────────────────────────────────────
    topOrders = computed(() => {
        return this.orders()
            .map(o => ({ ...o, _net: this.calcFinancials(o).net }))
            .filter(o => o._net > 0)
            .sort((a, b) => b._net - a._net)
            .slice(0, 10);
    });

    // ── Orders with worst keep-rate (lowest net%) ─────────────────────────────
    worstOrders = computed(() => {
        return this.orders()
            .map(o => {
                const f = this.calcFinancials(o);
                return { ...o, _net: f.net, _gross: f.total,
                    keepRate: f.total > 0 ? Math.round(f.net / f.total * 100) : 0 };
            })
            .filter(o => o._gross > 0)
            .sort((a, b) => a.keepRate - b.keepRate)
            .slice(0, 10);
    });

    // ── Commission rate distribution ──────────────────────────────────────────
    commissionTiers = computed(() => {
        const o = this.orders();
        const tiers: Record<string, { count: number; net: number; gross: number }> = {
            '10% (Clásica)': { count: 0, net: 0, gross: 0 },
            '11% (Premium)': { count: 0, net: 0, gross: 0 },
            '14.5% (MSI)':   { count: 0, net: 0, gross: 0 },
            'Otro':          { count: 0, net: 0, gross: 0 },
        };
        o.forEach(r => {
            if (!(r.total > 0)) return;
            const pct = Math.round((r.marketplaceFee / r.total) * 100 * 10) / 10;
            if      (pct >= 9.5  && pct <= 10.5) tiers['10% (Clásica)'].count++;
            else if (pct >= 10.5 && pct <= 12)   tiers['11% (Premium)'].count++;
            else if (pct >= 13.5 && pct <= 15.5) tiers['14.5% (MSI)'].count++;
            else                                  tiers['Otro'].count++;
            const key = pct >= 9.5 && pct <= 10.5 ? '10% (Clásica)' :
                        pct >= 10.5 && pct <= 12   ? '11% (Premium)' :
                        pct >= 13.5 && pct <= 15.5 ? '14.5% (MSI)'  : 'Otro';
            tiers[key].gross += r.total       || 0;
            tiers[key].net   += r.net_receipt || 0;
        });
        const total = o.length || 1;
        return Object.entries(tiers)
            .filter(([, v]) => v.count > 0)
            .map(([label, v]) => ({
                label,
                ...v,
                pct: Math.round(v.count / total * 100),
                keepRate: v.gross > 0 ? Math.round(v.net / v.gross * 100) : 0,
            }))
            .sort((a, b) => b.count - a.count);
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    getOrderDate(o: OrderFinancials): Date {
        if (o.createdAt?.toDate) return o.createdAt.toDate();
        if (o.createdAt instanceof Date) return o.createdAt;
        return new Date(o.createdAt);
    }

    getFirstSku(o: any): string {
        return o.items?.[0]?.sku || o.orderNumber || o.id.slice(-8);
    }

    setDrill(target: string | null) { this.drillTarget.set(target); }

    tierColor(label: string): string {
        if (label.includes('10%')) return '#10b981';
        if (label.includes('11%')) return '#6366f1';
        if (label.includes('14.5%')) return '#f59e0b';
        return '#71717a';
    }
}
