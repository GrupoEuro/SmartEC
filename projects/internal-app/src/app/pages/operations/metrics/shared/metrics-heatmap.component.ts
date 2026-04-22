import {
    Component, Input, OnChanges, SimpleChanges, signal, computed
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { AnalyticsDailyDoc } from '../services/metrics-analytics.service';

// ── Per-channel accent colors (rgb string for rgba()) ────────────────────────
const CHANNEL_COLORS: Record<string, string> = {
    WEB:          '99,102,241',
    POS:          '16,185,129',
    ON_BEHALF:    '167,139,250',
    MELI_FULL:    '251,146,60',
    MELI_CLASSIC: '234,179,8',
    MELI_FLEX:    '245,158,11',
    AMAZON_FBA:   '249,115,22',
    AMAZON_MFN:   '251,191,36',
};
const DEFAULT_RGB = '107,114,128';

const CHANNEL_LABELS: Record<string, string> = {
    WEB:          'Tienda Web',
    POS:          'Punto de Venta',
    ON_BEHALF:    'Tel/WA',
    MELI_FULL:    'ML Full',
    MELI_CLASSIC: 'ML Clásica',
    MELI_FLEX:    'ML Flex',
    AMAZON_FBA:   'Amazon FBA',
    AMAZON_MFN:   'Amazon MFN',
};

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface HmCell {
    key:       string;
    label:     string;
    revenue:   number;
    orders:    number;
    units:     number;
    avgTicket: number;
    bgColor:   string;
    tooltip:   string;
    isWeekend?: boolean;
}

export interface HmChannelRow {
    channelId:    string;
    label:        string;
    rgb:          string;
    totalRevenue: number;
    totalOrders:  number;
    cells:        HmCell[];
}

type HmView = 'daily' | 'weekly' | 'monthly' | 'dow';

function alphaFor(p: number, zero: boolean): number {
    if (zero) return 0;
    if (p < 0.2) return 0.12;
    if (p < 0.4) return 0.30;
    if (p < 0.6) return 0.52;
    if (p < 0.8) return 0.75;
    return 1;
}

function bgColor(rgb: string, p: number, zero: boolean): string {
    if (zero) return 'rgba(255,255,255,.04)';
    const a = alphaFor(p, false);
    return 'rgba(' + rgb + ',' + a + ')';
}

function fmtRev(rev: number): string {
    return rev.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

function richTip(line1: string, rev: number, ord: number, units: number): string {
    const ticket = ord > 0 ? rev / ord : 0;
    return line1 +
        '\n💰 ' + '$' + fmtRev(rev) +
        '  |  🛒 ' + ord + ' órd' +
        '  |  🎫 $' + fmtRev(ticket) + ' prom' +
        (units > 0 ? '  |  📦 ' + units + ' u' : '');
}

@Component({
    selector: 'app-metrics-heatmap',
    standalone: true,
    imports: [CommonModule, DecimalPipe],
    templateUrl: './metrics-heatmap.component.html',
    styleUrls:   ['./metrics-heatmap.component.scss'],
})
export class MetricsHeatmapComponent implements OnChanges {

    @Input() docs: AnalyticsDailyDoc[] = [];
    @Input() channelId: string | null = null;
    @Input() channelColor = '#fb923c';

    view   = signal<HmView>('daily');
    metric = signal<'revenue' | 'orders'>('revenue');

    readonly dowLabels   = DOW_LABELS;
    readonly legendSteps = [0.12, 0.25, 0.45, 0.65, 1];

    // ── Channel list ─────────────────────────────────────────────────────────
    private readonly channelIds = computed((): string[] => {
        if (this.channelId) return [this.channelId];
        const set = new Set<string>();
        for (const d of this.docs) {
            for (const ch of Object.keys(d.byChannel ?? {})) set.add(ch);
        }
        return Array.from(set).sort();
    });

    // ── Day headers ──────────────────────────────────────────────────────────
    readonly dayHeaders = computed(() =>
        this.docs.map(d => {
            const dt  = new Date(d.date + 'T12:00:00');
            const dow = (dt.getDay() + 6) % 7;
            return {
                key:       d.date,
                label:     d.date,
                dow:       dt.toLocaleDateString('es-MX', { weekday: 'short' }).slice(0, 2),
                isWeekend: dow >= 5,
            };
        })
    );

    // ── Week headers ─────────────────────────────────────────────────────────
    readonly weekHeaders = computed(() => {
        const seen = new Set<string>();
        return this.docs
            .map(d => {
                const dt  = new Date(d.date + 'T12:00:00');
                const dow = (dt.getDay() + 6) % 7;
                const mon = new Date(dt);
                mon.setDate(dt.getDate() - dow);
                const key = mon.toLocaleDateString('sv-SE');
                return { key, monthLabel: mon.toLocaleDateString('es-MX', { month: 'short' }) };
            })
            .filter(w => { if (seen.has(w.key)) return false; seen.add(w.key); return true; });
    });

    // ── Month headers ────────────────────────────────────────────────────────
    readonly monthHeaders = computed(() => {
        const seen = new Set<string>();
        return this.docs
            .map(d => d.date.slice(0, 7))
            .filter(m => { if (seen.has(m)) return false; seen.add(m); return true; })
            .map(m => {
                const parts = m.split('-');
                const y = Number(parts[0]);
                const mo = Number(parts[1]);
                return new Date(y, mo - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
            });
    });

    // ── DAILY rows ───────────────────────────────────────────────────────────
    readonly rows = computed((): HmChannelRow[] => {
        const channels = this.channelIds();
        const m        = this.metric();
        const docs     = this.docs;
        const headers  = this.dayHeaders();

        return channels.map(ch => {
            const rgb    = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            let totalRev = 0, totalOrd = 0;
            const dayMap = new Map<string, { revenue: number; orders: number; units: number }>();

            for (const d of docs) {
                const v = d.byChannel?.[ch];
                if (!v) continue;
                dayMap.set(d.date, {
                    revenue: v.revenue ?? 0,
                    orders:  v.orders  ?? 0,
                    units:   v.units   ?? 0,
                });
                totalRev += v.revenue ?? 0;
                totalOrd += v.orders  ?? 0;
            }

            const allVals = Array.from(dayMap.values());
            const max = m === 'revenue'
                ? Math.max(1, ...allVals.map(v => v.revenue))
                : Math.max(1, ...allVals.map(v => v.orders));

            const cells: HmCell[] = headers.map(h => {
                const v   = dayMap.get(h.key);
                const rev = v ? v.revenue : 0;
                const ord = v ? v.orders  : 0;
                const unt = v ? v.units   : 0;
                const tkt = ord > 0 ? rev / ord : 0;
                const val = m === 'revenue' ? rev : ord;
                const p   = val / max;
                const bg  = bgColor(rgb, p, val === 0);
                const tip = v
                    ? richTip(h.key, rev, ord, unt)
                    : h.key;
                return { key: h.key, label: h.key, revenue: rev, orders: ord,
                         units: unt, avgTicket: tkt,
                         bgColor: bg, tooltip: tip, isWeekend: h.isWeekend };
            });

            return { channelId: ch, label: CHANNEL_LABELS[ch] ?? ch,
                     rgb, totalRevenue: totalRev, totalOrders: totalOrd, cells };
        })
        .filter(r => r.totalRevenue > 0 || r.totalOrders > 0)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    });

    // ── DOW rows ─────────────────────────────────────────────────────────────
    readonly dowRows = computed((): HmChannelRow[] => {
        const channels = this.channelIds();
        const m        = this.metric();
        const docs     = this.docs;

        return channels.map(ch => {
            const rgb = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const buckets = Array.from({ length: 7 },
                () => ({ revenue: 0, orders: 0, count: 0 }));
            let totalRev = 0, totalOrd = 0;

            for (const d of docs) {
                const v = d.byChannel?.[ch];
                if (!v) continue;
                const dow = d.dayOfWeek ?? 0;
                buckets[dow].revenue += v.revenue ?? 0;
                buckets[dow].orders  += v.orders  ?? 0;
                buckets[dow].count++;
                totalRev += v.revenue ?? 0;
                totalOrd += v.orders  ?? 0;
            }

            const avgs = buckets.map(b => ({
                revenue: b.count > 0 ? b.revenue / b.count : 0,
                orders:  b.count > 0 ? b.orders  / b.count : 0,
            }));
            const maxVal = m === 'revenue'
                ? Math.max(1, ...avgs.map(a => a.revenue))
                : Math.max(1, ...avgs.map(a => a.orders));

            const cells: HmCell[] = avgs.map((avg, i) => {
                const val = m === 'revenue' ? avg.revenue : avg.orders;
                const p   = val / maxVal;
                const bg  = bgColor(rgb, p, val === 0);
                const tip = richTip(DOW_LABELS[i] + ' (promedio)', avg.revenue, avg.orders, 0);
                return { key: DOW_LABELS[i], label: DOW_LABELS[i],
                         revenue: avg.revenue, orders: avg.orders, units: 0,
                         avgTicket: avg.orders > 0 ? avg.revenue / avg.orders : 0,
                         bgColor: bg, tooltip: tip, isWeekend: i >= 5 };
            });

            return { channelId: ch, label: CHANNEL_LABELS[ch] ?? ch,
                     rgb, totalRevenue: totalRev, totalOrders: totalOrd, cells };
        })
        .filter(r => r.totalRevenue > 0)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    });

    // ── WEEKLY rows ──────────────────────────────────────────────────────────
    readonly weekRows = computed((): HmChannelRow[] => {
        const channels = this.channelIds();
        const m        = this.metric();
        const docs     = this.docs;
        const wHeaders = this.weekHeaders();

        return channels.map(ch => {
            const rgb    = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const weekMap = new Map<string, { revenue: number; orders: number; units: number }>();
            let totalRev = 0, totalOrd = 0;

            for (const d of docs) {
                const v = d.byChannel?.[ch];
                if (!v) continue;
                const dt  = new Date(d.date + 'T12:00:00');
                const dow = (dt.getDay() + 6) % 7;
                const mon = new Date(dt);
                mon.setDate(dt.getDate() - dow);
                const key = mon.toLocaleDateString('sv-SE');
                const cur = weekMap.get(key) ?? { revenue: 0, orders: 0, units: 0 };
                weekMap.set(key, {
                    revenue: cur.revenue + (v.revenue ?? 0),
                    orders:  cur.orders  + (v.orders  ?? 0),
                    units:   cur.units   + (v.units   ?? 0),
                });
                totalRev += v.revenue ?? 0;
                totalOrd += v.orders  ?? 0;
            }

            const allVals = Array.from(weekMap.values());
            const max = m === 'revenue'
                ? Math.max(1, ...allVals.map(v => v.revenue))
                : Math.max(1, ...allVals.map(v => v.orders));

            const cells: HmCell[] = wHeaders.map(h => {
                const v   = weekMap.get(h.key);
                const rev = v ? v.revenue : 0;
                const ord = v ? v.orders  : 0;
                const unt = v ? v.units   : 0;
                const tkt = ord > 0 ? rev / ord : 0;
                const val = m === 'revenue' ? rev : ord;
                const p   = val / max;
                const bg  = bgColor(rgb, p, val === 0);
                const tip = v
                    ? richTip('Semana ' + h.key, rev, ord, unt)
                    : ('Sem ' + h.key);
                return { key: h.key, label: h.monthLabel, revenue: rev, orders: ord,
                         units: unt, avgTicket: tkt, bgColor: bg, tooltip: tip };
            });

            return { channelId: ch, label: CHANNEL_LABELS[ch] ?? ch,
                     rgb, totalRevenue: totalRev, totalOrders: totalOrd, cells };
        })
        .filter(r => r.totalRevenue > 0)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    });

    // ── MONTHLY rows ─────────────────────────────────────────────────────────
    readonly monthRows = computed((): HmChannelRow[] => {
        const channels = this.channelIds();
        const m        = this.metric();
        const docs     = this.docs;
        const mHeaders = docs
            .map(d => d.date.slice(0, 7))
            .filter((v, i, a) => a.indexOf(v) === i);

        return channels.map(ch => {
            const rgb    = CHANNEL_COLORS[ch] ?? DEFAULT_RGB;
            const mMap   = new Map<string, { revenue: number; orders: number; units: number }>();
            let totalRev = 0, totalOrd = 0;

            for (const d of docs) {
                const v = d.byChannel?.[ch];
                if (!v) continue;
                const ym  = d.date.slice(0, 7);
                const cur = mMap.get(ym) ?? { revenue: 0, orders: 0, units: 0 };
                mMap.set(ym, {
                    revenue: cur.revenue + (v.revenue ?? 0),
                    orders:  cur.orders  + (v.orders  ?? 0),
                    units:   cur.units   + (v.units   ?? 0),
                });
                totalRev += v.revenue ?? 0;
                totalOrd += v.orders  ?? 0;
            }

            const allVals = Array.from(mMap.values());
            const max = m === 'revenue'
                ? Math.max(1, ...allVals.map(v => v.revenue))
                : Math.max(1, ...allVals.map(v => v.orders));

            const cells: HmCell[] = mHeaders.map(ym => {
                const v   = mMap.get(ym);
                const rev = v ? v.revenue : 0;
                const ord = v ? v.orders  : 0;
                const unt = v ? v.units   : 0;
                const tkt = ord > 0 ? rev / ord : 0;
                const val = m === 'revenue' ? rev : ord;
                const p   = val / max;
                const bg  = bgColor(rgb, p, val === 0);
                const parts = ym.split('-');
                const yr  = Number(parts[0]);
                const mo  = Number(parts[1]);
                const lbl = new Date(yr, mo - 1, 1).toLocaleDateString('es-MX', { month: 'short' });
                const tip = richTip(ym, rev, ord, unt);
                return { key: ym, label: lbl, revenue: rev, orders: ord,
                         units: unt, avgTicket: tkt, bgColor: bg, tooltip: tip };
            });

            return { channelId: ch, label: CHANNEL_LABELS[ch] ?? ch,
                     rgb, totalRevenue: totalRev, totalOrders: totalOrd, cells };
        })
        .filter(r => r.totalRevenue > 0)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    });

    // ── Lifecycle ────────────────────────────────────────────────────────────
    ngOnChanges(changes: SimpleChanges) {
        if (changes['docs'] && this.docs.length > 45) {
            this.view.set('weekly');
        }
    }

    setView(v: HmView) { this.view.set(v); }

    abbrev(n: number): string {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
        return n.toFixed(0);
    }

    legendBg(a: number): string {
        return 'rgba(251,146,60,' + a + ')';
    }
}
