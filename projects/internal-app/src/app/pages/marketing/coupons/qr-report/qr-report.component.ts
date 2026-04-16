import {
    Component, inject, OnInit,
    signal, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { QrAnalyticsService, QrScan, QrFunnelStats, CartItem } from '../../../admin/coupons/coupon-analytics/qr-analytics.service';

type SortCol  = 'scannedAt' | 'cartValue' | 'orderTotal' | 'cartStatus' | 'converted';
type ScanFilter = 'all' | 'converted' | 'cart_only' | 'no_action' | 'wa_clicked';

interface TimelinePoint  { label: string; count: number; }
interface HeatmapBucket  { hour: number; label: string; count: number; }


@Component({
    selector: 'app-qr-report',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './qr-report.component.html',
    styleUrls: ['./qr-report.component.css'],
})
export class QrReportComponent implements OnInit {
    private route  = inject(ActivatedRoute);
    private router = inject(Router);
    private svc    = inject(QrAnalyticsService);

    couponId  = '';
    coupon    = signal<any>(null);
    scans     = signal<QrScan[]>([]);
    stats     = signal<QrFunnelStats | null>(null);
    isLoading    = signal(true);
    expandedScanId = signal<string | null>(null);

    // Table controls
    sortCol = signal<SortCol>('scannedAt');
    sortDir = signal<'asc' | 'desc'>('desc');
    filter  = signal<ScanFilter>('all');
    search  = signal('');

    readonly filterOptions: { id: ScanFilter; label: string; icon: string }[] = [
        { id: 'all',        label: 'Todos',         icon: 'flash'    },
        { id: 'converted',  label: 'Convertidos',   icon: 'check'    },
        { id: 'cart_only',  label: 'Carrito',       icon: 'cart'     },
        { id: 'wa_clicked', label: 'WhatsApp',      icon: 'wa'       },
        { id: 'no_action',  label: 'Sin acción',    icon: 'ghost'    },
    ];

    filteredScans = computed(() => {
        let rows = [...this.scans()];
        const f = this.filter();
        const q = this.search().toLowerCase().trim();

        if (f === 'converted')  rows = rows.filter(s => !!s.orderId);
        if (f === 'cart_only')  rows = rows.filter(s => (s.cartValue ?? 0) > 0 && !s.orderId);
        if (f === 'no_action')  rows = rows.filter(s => !(s.cartValue) && !s.orderId);
        if (f === 'wa_clicked') rows = rows.filter(s => s.waClicked);
        if (q) rows = rows.filter(s =>
            s.sessionId?.toLowerCase().includes(q) ||
            s.email?.toLowerCase().includes(q)     ||
            s.city?.toLowerCase().includes(q)      ||
            s.source?.toLowerCase().includes(q)    ||
            s.device?.toLowerCase().includes(q)
        );

        const col = this.sortCol();
        const dir = this.sortDir() === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const av = (a as any)[col] ?? 0;
            const bv = (b as any)[col] ?? 0;
            return av < bv ? -dir : av > bv ? dir : 0;
        });
        return rows;
    });

    // Timeline (last 30 days)
    timeline = computed<TimelinePoint[]>(() => {
        const now   = Date.now();
        const days  = 30;
        const buckets = new Map<string, number>();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now - i * 86400000);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            buckets.set(key, 0);
        }
        for (const s of this.scans()) {
            if (!s.scannedAt) continue;
            const d = new Date(s.scannedAt);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        return [...buckets.entries()].map(([label, count]) => ({ label, count }));
    });

    timelineMax = computed(() => Math.max(1, ...this.timeline().map(p => p.count)));

    // ── Time-of-day heatmap (24 buckets, local timezone) ──────────────────────
    hourlyHeatmap = computed<HeatmapBucket[]>(() => {
        const buckets = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
            count: 0,
        }));
        for (const s of this.scans()) {
            if (!s.scannedAt) continue;
            const h = new Date(s.scannedAt).getHours();
            buckets[h].count++;
        }
        return buckets;
    });

    heatmapMax  = computed(() => Math.max(1, ...this.hourlyHeatmap().map(b => b.count)));
    peakHour    = computed(() => {
        const peak = this.hourlyHeatmap().reduce((best, b) => b.count > best.count ? b : best, this.hourlyHeatmap()[0]);
        return peak.count > 0 ? peak : null;
    });

    // ── Repeat scan detection ─────────────────────────────────────────────────
    repeatScans = computed(() => {
        const freq = new Map<string, number>();
        for (const s of this.scans()) {
            freq.set(s.sessionId, (freq.get(s.sessionId) ?? 0) + 1);
        }
        return {
            repeaters:    [...freq.values()].filter(v => v > 1).length,
            totalSessions: freq.size,
            repeatRate:   freq.size > 0
                ? ([...freq.values()].filter(v => v > 1).length / freq.size) * 100
                : 0,
        };
    });

    // ── Scan-to-cart latency ──────────────────────────────────────────────────
    /** Median minutes from first scan of a session to first cart add (sessions that converted to cart only) */
    medianLatencyMin = computed(() => {
        const cartScans = this.scans().filter(s => s.scannedAt && (s.cartValue ?? 0) > 0);
        if (cartScans.length === 0) return null;

        // Group by session, take earliest scan as reference
        const sessionFirst = new Map<string, number>();
        for (const s of this.scans()) {
            if (!s.scannedAt) continue;
            const prev = sessionFirst.get(s.sessionId);
            if (!prev || s.scannedAt < prev) sessionFirst.set(s.sessionId, s.scannedAt);
        }

        const latencies: number[] = [];
        for (const s of cartScans) {
            const first = sessionFirst.get(s.sessionId) ?? s.scannedAt;
            latencies.push((s.scannedAt - first) / 60000); // ms → minutes
        }
        latencies.sort((a, b) => a - b);
        const mid = Math.floor(latencies.length / 2);
        return latencies.length % 2 === 0
            ? (latencies[mid - 1] + latencies[mid]) / 2
            : latencies[mid];
    });


    // Funnel steps
    funnelSteps(s: QrFunnelStats) {
        const base = s.totalScans || 1;
        return [
            { label: 'Escaneos',   value: s.totalScans,    pct: 100,                                   color: '#6366f1', dropPct: null },
            { label: 'Carrito',    value: s.cartAdds,       pct: (s.cartAdds / base) * 100,             color: '#3b82f6', dropPct: base > 0 ? (1 - s.cartAdds / base) * 100 : 0 },
            { label: 'Checkout',   value: s.checkoutStarts, pct: (s.checkoutStarts / base) * 100,       color: '#f59e0b', dropPct: s.cartAdds > 0 ? (1 - s.checkoutStarts / s.cartAdds) * 100 : 0 },
            { label: 'Orden',      value: s.orders,         pct: (s.orders / base) * 100,               color: '#22c55e', dropPct: s.checkoutStarts > 0 ? (1 - s.orders / s.checkoutStarts) * 100 : 0 },
        ];
    }

    ngOnInit() {
        this.couponId = this.route.snapshot.paramMap.get('id') ?? '';
        if (!this.couponId) { this.router.navigate(['/marketing/coupons']); return; }
        this.load();
    }

    private async load() {
        this.isLoading.set(true);
        try {
            const [coupon, scans] = await Promise.all([
                this.svc.getCoupon(this.couponId),
                this.svc.getScansForCoupon(this.couponId),
            ]);
            this.coupon.set(coupon);
            this.scans.set(scans);
            const computedStats = this.svc.computeStats(scans);
            this.stats.set(computedStats);
        } catch (e) {
            console.error('[QR Report] Failed to load:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    setFilter(f: ScanFilter)  { this.filter.set(f); }
    onSearch(e: Event) { this.search.set((e.target as HTMLInputElement).value); }

    sortBy(col: SortCol) {
        if (this.sortCol() === col) {
            this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortCol.set(col);
            this.sortDir.set('desc');
        }
    }

    toggleExpand(scanId: string) {
        this.expandedScanId.update(cur => cur === scanId ? null : scanId);
    }

    scanStatus(scan: QrScan): { label: string; css: string; key: string } {
        if (scan.orderId)                                    return { label: 'Orden',     css: 'pill-success', key: 'ORDER'     };
        if (scan.cartStatus === 'checkout_started')          return { label: 'Checkout',  css: 'pill-info',    key: 'CHECKOUT'  };
        if ((scan.cartValue ?? 0) > 0)                       return { label: 'Carrito',   css: 'pill-warn',    key: 'CART'      };
        if (scan.waClicked)                                  return { label: 'WhatsApp',  css: 'pill-wa',      key: 'WA'        };
        return                                                      { label: 'Solo scan', css: 'pill-dim',     key: 'SCAN'      };
    }

    // ── Formatters ────────────────────────────────────────────────────────────
    fmtMXN(n: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
    }

    fmtPct(n: number): string { return n.toFixed(1) + '%'; }

    fmtDate(ms: number): string {
        if (!ms) return '—';
        return new Date(ms).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    fmtRelative(ms: number): string {
        if (!ms) return '—';
        const diff  = Date.now() - ms;
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins  < 2)  return 'Ahora';
        if (mins  < 60) return `Hace ${mins}m`;
        if (hours < 24) return `Hace ${hours}h`;
        return `Hace ${days}d`;
    }


    /** Safely format coupon end date — handles Firestore Timestamp, JS Date, or ms number */
    fmtEndDate(v: any): string {
        if (!v) return '';
        try {
            if (typeof v?.toDate === 'function') return v.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            if (v instanceof Date) return v.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            if (typeof v === 'number') return new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            return '';
        } catch { return ''; }
    }

    // ── CSV Export ────────────────────────────────────────────────────────────
    exportCsv() {
        const rows = this.filteredScans();
        const header = [
            'Session ID', 'Fecha', 'Email', 'Ciudad', 'Dispositivo',
            'Fuente', 'Referrer', 'Valor Carrito', 'Estado Carrito',
            'WhatsApp', 'Orden ID', 'Total Orden', 'Estado',
        ];
        const lines = rows.map(s => [
            s.sessionId,
            this.fmtDate(s.scannedAt),
            s.email ?? '',
            s.city ?? '',
            s.device ?? '',
            s.source ?? '',
            s.referrer ?? '',
            s.cartValue ?? '',
            s.cartStatus ?? '',
            s.waClicked ? 'Sí' : 'No',
            s.orderId ?? '',
            s.orderTotal ?? '',
            this.scanStatus(s).label,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv  = [header.join(','), ...lines].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `qr-report-${this.coupon()?.code ?? this.couponId}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
