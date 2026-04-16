import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { WhatsappEngagementService, WaSummary, WaClick } from './whatsapp-engagement.service';

export type WaTf = 'TODAY' | 'WEEK' | 'MTD' | 'PAST_MONTH' | 'L3M' | 'ALL';

@Component({
    selector: 'app-whatsapp-engagement',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    templateUrl: './whatsapp-engagement.component.html',
    styleUrls: ['./whatsapp-engagement.component.css'],
})

export class WhatsappEngagementComponent implements OnInit {
    private svc = inject(WhatsappEngagementService);

    isLoading = signal(true);
    summary   = signal<WaSummary | null>(null);
    timeframe = signal<WaTf>('MTD');

    readonly timeframes: { value: WaTf; label: string }[] = [
        { value: 'TODAY',      label: 'Hoy'       },
        { value: 'WEEK',       label: '7 días'    },
        { value: 'MTD',        label: 'Este mes'  },
        { value: 'PAST_MONTH', label: 'Mes ant.'  },
        { value: 'L3M',        label: '3 meses'   },
        { value: 'ALL',        label: 'Todo'      },
    ];

    ngOnInit() { this.load(); }

    setTimeframe(tf: WaTf) {
        if (this.timeframe() === tf) return;
        this.timeframe.set(tf);
        this.load();
    }

    async load() {
        this.isLoading.set(true);
        const [from, to] = this.getDateRange();
        try {
            this.summary.set(await this.svc.loadReport(from, to));
        } catch (e) {
            console.error('[WAEngagement] Load error:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    private getDateRange(): [Date, Date] {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = now.getMonth();
        const d   = now.getDate();
        switch (this.timeframe()) {
            case 'TODAY':      return [new Date(y, m, d, 0, 0, 0), now];
            case 'WEEK':       { const s = new Date(now); s.setDate(s.getDate() - 7); return [s, now]; }
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59)];
            case 'L3M':        { const s = new Date(now); s.setMonth(s.getMonth() - 3); return [s, now]; }
            case 'ALL':        return [new Date(0), now];
        }
    }

    // ── Formatters ─────────────────────────────────────────────────────────────

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }

    fmtPct(v: number): string { return `${v.toFixed(1)}%`; }

    fmtTime(d?: Date): string {
        if (!d) return '—';
        return d.toLocaleString('es-MX', {
            day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit'
        });
    }

    pageLabel(page: string): string {
        if (!page || page === '/') return 'Inicio';
        if (page.includes('/product/')) return 'Ficha de Producto';
        if (page.includes('/catalog'))  return 'Catálogo';
        if (page.includes('/checkout')) return 'Checkout';
        if (page.includes('/cart'))     return 'Carrito';
        if (page.includes('/account'))  return 'Mi Cuenta';
        if (page.includes('/blog'))     return 'Blog';
        return page.split('?')[0].slice(0, 30);
    }

    deviceLabel(click: WaClick): string {
        return click.device?.mobile ? '📱 Móvil' : '🖥️ Escritorio';
    }

    geoLabel(click: WaClick): string {
        const g = click.geo;
        if (!g) return '—';
        const parts = [g.city, g.region].filter(Boolean);
        return parts.join(', ') || g.country || '—';
    }

    sourceLabel(click: WaClick): string {
        return click.utm?.source || click.referrer || 'Directo';
    }

    // bar width for chart
    barWidth(pct: number): string { return `${Math.max(pct, 1)}%`; }

    exportCsv() {
        const s = this.summary();
        if (!s || !s.recentClicks.length) return;
        const headers = ['Fecha', 'Página', 'Fuente UTM', 'Dispositivo', 'Geo', 'Carrito (MXN)', 'Artículos', 'Sesión ID', 'Usuario ID'];
        const lines = s.recentClicks.map(c => [
            `"${this.fmtTime(c.clickedAt)}"`,
            `"${c.page}"`,
            `"${this.sourceLabel(c)}"`,
            `"${this.deviceLabel(c)}"`,
            `"${this.geoLabel(c)}"`,
            c.cartValue ?? '',
            c.cartItems ?? '',
            `"${c.sessionId ?? ''}"`,
            `"${c.userId ?? ''}"`,
        ].join(','));
        const bom = '\uFEFF';
        const csv = bom + [headers.join(','), ...lines].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `whatsapp-engagement-${this.timeframe()}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
