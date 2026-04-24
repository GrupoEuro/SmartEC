import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
    Firestore, collection, query, where,
    orderBy, getDocs, Timestamp, limit,
} from '@angular/fire/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiTimeframe = 'MTD' | 'PAST_MONTH' | 'YTD';

export interface AiSession {
    sessionId:    string;
    source:       string;
    landingPath:  string;
    landingUrl:   string;
    // geo
    city:         string;
    region:       string;  // state / province
    country:      string;
    isp:          string;  // org / ISP
    // device
    mobile:       boolean;
    platform:     string;  // 'Windows', 'macOS', 'iPhone', 'Android', etc.
    language:     string;  // 'es-MX', 'en-US', etc.
    connection:   string;
    screenWidth:  number;
    userAgent:    string;
    // referrer
    referrer:     string;  // full referrer URL
    referrerDomain: string;
    // campaign
    campaignName: string;
    // utm
    utmSource:    string;
    utmMedium:    string;
    utmCampaign:  string;
    // meta
    timestamp:    Date;
    converted:    boolean;
}

interface DayBucket {
    date:    string;          // 'YYYY-MM-DD'
    sources: Record<string, number>;
    total:   number;
}

interface SourceRow {
    source:   string;
    count:    number;
    pct:      number;
    color:    string;
    prevCount: number;
    delta:    number | null;
}

interface LandingRow {
    path:     string;
    count:    number;
    sources:  string[];
    topSrc:   string;
}

interface GeoRow {
    label:   string;
    count:   number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const AI_COLORS: Record<string, string> = {
    chatgpt:    '#10a37f',
    perplexity: '#1fb8cd',
    gemini:     '#4285f4',
    copilot:    '#0078d4',
    claude:     '#d97706',
    'meta-ai':  '#0082fb',
    you:        '#8b5cf6',
    poe:        '#ec4899',
    kagi:       '#f59e0b',
    phind:      '#22c55e',
    mistral:    '#e11d48',
};

const ALL_SOURCES = Object.keys(AI_COLORS);

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
    selector: 'app-ai-analytics',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './ai-analytics.component.html',
    styleUrls: ['./ai-analytics.component.css'],
})
export class AiAnalyticsComponent implements OnInit {
    private fs = inject(Firestore);

    // ── State ──────────────────────────────────────────────────────────────────
    isLoading   = signal(true);
    hasError    = signal(false);
    timeframe   = signal<AiTimeframe>('MTD');

    // KPI signals
    totalSessions  = signal(0);
    totalStorefront = signal(0);  // all session_starts in period (for % calc)
    conversionCount = signal(0);
    topSource      = signal('—');

    // Chart data
    days       = signal<DayBucket[]>([]);
    sourceRows = signal<SourceRow[]>([]);

    // Tables
    landingRows = signal<LandingRow[]>([]);
    geoRows     = signal<GeoRow[]>([]);

    // Device
    mobilePct  = signal(0);
    desktopPct = signal(0);
    connectionMap = signal<{ label: string; pct: number }[]>([]);

    // Session log
    sessions      = signal<AiSession[]>([]);
    logPage       = signal(0);
    expandedRow   = signal<string | null>(null);  // sessionId of expanded row
    readonly PAGE_SIZE = 15;

    // Computed
    aiPct = computed(() => {
        const s = this.totalStorefront();
        const a = this.totalSessions();
        return s > 0 ? Math.round((a / s) * 100) : 0;
    });

    convRate = computed(() => {
        const s = this.totalSessions();
        const c = this.conversionCount();
        return s > 0 ? ((c / s) * 100).toFixed(1) : '0';
    });

    logSlice = computed(() => {
        const page = this.logPage();
        return this.sessions().slice(page * this.PAGE_SIZE, (page + 1) * this.PAGE_SIZE);
    });

    logPageCount = computed(() =>
        Math.max(1, Math.ceil(this.sessions().length / this.PAGE_SIZE))
    );

    // SVG chart helpers
    chartSources = computed(() => {
        const rows = this.sourceRows();
        return rows.filter(r => r.count > 0).map(r => r.source);
    });

    readonly timeframes: { value: AiTimeframe; label: string }[] = [
        { value: 'MTD',        label: 'This Month' },
        { value: 'PAST_MONTH', label: 'Last Month' },
        { value: 'YTD',        label: 'Year to Date' },
    ];

    ngOnInit() { this.load(); }

    setTimeframe(tf: AiTimeframe) {
        if (this.timeframe() === tf) return;
        this.timeframe.set(tf);
        this.logPage.set(0);
        this.load();
    }

    // ── Date range helpers ─────────────────────────────────────────────────────

    private getDateRange(): [Date, Date] {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        switch (this.timeframe()) {
            case 'MTD':        return [new Date(y, m, 1), now];
            case 'PAST_MONTH': return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999)];
            case 'YTD':        return [new Date(y, 0, 1), now];
        }
    }

    private getPrevDateRange(): [Date, Date] {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const d = now.getDate();
        switch (this.timeframe()) {
            case 'MTD':        return [new Date(y, m - 1, 1), new Date(y, m - 1, d, 23, 59, 59)];
            case 'PAST_MONTH': return [new Date(y, m - 2, 1), new Date(y, m - 1, 0, 23, 59, 59)];
            case 'YTD':        return [new Date(y - 1, 0, 1), new Date(y - 1, m, d, 23, 59, 59)];
        }
    }

    // ── Main data load ─────────────────────────────────────────────────────────

    async load() {
        this.isLoading.set(true);
        this.hasError.set(false);

        const [from, to]         = this.getDateRange();
        const [prevFrom, prevTo] = this.getPrevDateRange();
        const fromTs    = Timestamp.fromDate(from);
        const toTs      = Timestamp.fromDate(to);
        const prevFromTs = Timestamp.fromDate(prevFrom);
        const prevToTs   = Timestamp.fromDate(prevTo);

        try {
            const [curSnap, prevSnap, idSnap] = await Promise.all([
                // Current period session_starts
                getDocs(query(
                    collection(this.fs, 'sessionEvents'),
                    where('event', '==', 'session_start'),
                    where('timestamp', '>=', fromTs),
                    where('timestamp', '<=', toTs),
                    orderBy('timestamp', 'desc'),
                    limit(2000),
                )),
                // Prev period session_starts (for deltas)
                getDocs(query(
                    collection(this.fs, 'sessionEvents'),
                    where('event', '==', 'session_start'),
                    where('timestamp', '>=', prevFromTs),
                    where('timestamp', '<=', prevToTs),
                    orderBy('timestamp', 'desc'),
                    limit(2000),
                )),
                // user_identified events in current period (for conversion)
                getDocs(query(
                    collection(this.fs, 'sessionEvents'),
                    where('event', '==', 'user_identified'),
                    where('timestamp', '>=', fromTs),
                    where('timestamp', '<=', toTs),
                    orderBy('timestamp', 'desc'),
                    limit(2000),
                )),
            ]);

            // Build set of sessionIds that converted
            const convertedSessions = new Set<string>();
            for (const doc of idSnap.docs) {
                const d = doc.data() as any;
                if (d.sessionId) convertedSessions.add(d.sessionId);
            }

            // ── Process current period ──────────────────────────────────────────
            let storeFrontTotal = 0;
            const aiDocs: AiSession[] = [];
            const sourceMap     = new Map<string, number>();
            const landingMap    = new Map<string, { count: number; sources: Set<string> }>();
            const geoMap        = new Map<string, number>();
            const connectionCounts = new Map<string, number>();
            let mobileCount = 0;

            // Day buckets (keyed by 'YYYY-MM-DD')
            const dayMap = new Map<string, Record<string, number>>();

            for (const doc of curSnap.docs) {
                const d = doc.data() as any;
                storeFrontTotal++;

                const src       = d.attribution?.aiSource as string | undefined;
                const ts        = (d.timestamp as Timestamp).toDate();
                const dateKey   = ts.toISOString().slice(0, 10);
                const path      = d.attribution?.landingPath ?? '/';
                const city      = d.attribution?.geo?.city    ?? '';
                const country   = d.attribution?.geo?.country ?? '';
                const mobile    = d.attribution?.device?.mobile ?? false;
                const conn      = d.attribution?.device?.connection ?? '';
                const sessionId = d.sessionId ?? doc.id;

                if (!src) continue;   // not an AI session

                // KPI aggregates
                sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);

                // Day bucket
                if (!dayMap.has(dateKey)) dayMap.set(dateKey, {});
                const bucket = dayMap.get(dateKey)!;
                bucket[src] = (bucket[src] ?? 0) + 1;

                // Landing paths
                if (!landingMap.has(path)) landingMap.set(path, { count: 0, sources: new Set() });
                const lp = landingMap.get(path)!;
                lp.count++;
                lp.sources.add(src);

                // Geo
                const geoKey = city ? `${city}, ${country}` : (country || 'Unknown');
                geoMap.set(geoKey, (geoMap.get(geoKey) ?? 0) + 1);

                // Device
                if (mobile) mobileCount++;

                // Connection
                if (conn) connectionCounts.set(conn, (connectionCounts.get(conn) ?? 0) + 1);

                aiDocs.push({
                    sessionId,
                    source:       src,
                    landingPath:  path,
                    landingUrl:   d.attribution?.landingUrl ?? '',
                    city,
                    region:       d.attribution?.geo?.region  ?? '',
                    country,
                    isp:          d.attribution?.geo?.org      ?? '',
                    mobile,
                    platform:     d.attribution?.device?.platform  ?? '',
                    language:     d.attribution?.device?.language  ?? '',
                    connection:   conn,
                    screenWidth:  d.attribution?.device?.screenWidth ?? 0,
                    userAgent:    d.attribution?.device?.userAgent  ?? '',
                    referrer:     d.attribution?.referrer       ?? '',
                    referrerDomain: d.attribution?.referrerDomain ?? '',
                    campaignName: d.attribution?.campaignName   ?? '',
                    utmSource:    d.attribution?.utm?.utm_source   ?? '',
                    utmMedium:    d.attribution?.utm?.utm_medium   ?? '',
                    utmCampaign:  d.attribution?.utm?.utm_campaign ?? '',
                    timestamp:    ts,
                    converted:    convertedSessions.has(sessionId),
                });
            }

            const aiTotal = aiDocs.length;

            // ── Process prev period for deltas ─────────────────────────────────
            const prevSourceMap = new Map<string, number>();
            for (const doc of prevSnap.docs) {
                const d = doc.data() as any;
                const src = d.attribution?.aiSource as string | undefined;
                if (src) prevSourceMap.set(src, (prevSourceMap.get(src) ?? 0) + 1);
            }

            // ── Build sourceRows ───────────────────────────────────────────────
            const allSrcKeys = new Set([...sourceMap.keys(), ...prevSourceMap.keys()]);
            const sRows: SourceRow[] = [...allSrcKeys]
                .map(src => {
                    const count     = sourceMap.get(src)     ?? 0;
                    const prevCount = prevSourceMap.get(src) ?? 0;
                    const delta     = prevCount === 0 ? null : Math.round(((count - prevCount) / prevCount) * 100);
                    return {
                        source: src,
                        count,
                        prevCount,
                        pct:   aiTotal > 0 ? Math.round((count / aiTotal) * 100) : 0,
                        color: AI_COLORS[src] ?? '#8b5cf6',
                        delta,
                    };
                })
                .sort((a, b) => b.count - a.count);

            // ── Build day buckets for SVG chart ────────────────────────────────
            const sortedDays = [...dayMap.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, sources]) => ({
                    date,
                    sources,
                    total: Object.values(sources).reduce((s, n) => s + n, 0),
                }));

            // ── Landing rows ───────────────────────────────────────────────────
            const lRows: LandingRow[] = [...landingMap.entries()]
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 15)
                .map(([path, { count, sources }]) => {
                    const srcArr = [...sources];
                    const topSrc = srcArr.reduce((best, s) =>
                        (sourceMap.get(s) ?? 0) > (sourceMap.get(best) ?? 0) ? s : best
                    , srcArr[0] ?? '');
                    return { path, count, sources: srcArr, topSrc };
                });

            // ── Geo rows ───────────────────────────────────────────────────────
            const gRows: GeoRow[] = [...geoMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([label, count]) => ({ label, count }));

            // ── Device ─────────────────────────────────────────────────────────
            const mobPct  = aiTotal > 0 ? Math.round((mobileCount / aiTotal) * 100) : 0;
            const connTotal = [...connectionCounts.values()].reduce((s, n) => s + n, 0);
            const connRows = [...connectionCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, n]) => ({ label: label || 'unknown', pct: connTotal > 0 ? Math.round((n / connTotal) * 100) : 0 }));

            // ── Top source ─────────────────────────────────────────────────────
            const topSrc = sRows[0]?.source ?? '—';

            // ── Conversions ────────────────────────────────────────────────────
            const convCount = aiDocs.filter(s => s.converted).length;

            // ── Commit ─────────────────────────────────────────────────────────
            this.totalStorefront.set(storeFrontTotal);
            this.totalSessions.set(aiTotal);
            this.conversionCount.set(convCount);
            this.topSource.set(topSrc);
            this.sourceRows.set(sRows);
            this.days.set(sortedDays);
            this.landingRows.set(lRows);
            this.geoRows.set(gRows);
            this.mobilePct.set(mobPct);
            this.desktopPct.set(100 - mobPct);
            this.connectionMap.set(connRows);
            this.sessions.set(aiDocs);

        } catch (e) {
            console.error('[AiAnalytics] load error:', e);
            this.hasError.set(true);
        } finally {
            this.isLoading.set(false);
        }
    }

    // ── Log pagination + row expand ────────────────────────────────────────────
    prevPage() { if (this.logPage() > 0) this.logPage.update(p => p - 1); }
    nextPage() { if (this.logPage() < this.logPageCount() - 1) this.logPage.update(p => p + 1); }
    toggleRow(id: string) {
        this.expandedRow.update(cur => cur === id ? null : id);
    }

    // ── SVG trend chart ────────────────────────────────────────────────────────

    /** Build a polyline points string for a given source across day buckets */
    svgPoints(source: string, width: number, height: number, padding: number): string {
        const buckets = this.days();
        if (buckets.length < 2) return '';
        const maxVal = Math.max(...buckets.map(b => b.sources[source] ?? 0), 1);
        const w = width - padding * 2;
        const h = height - padding * 2;
        return buckets.map((b, i) => {
            const x = padding + (i / (buckets.length - 1)) * w;
            const y = padding + h - ((b.sources[source] ?? 0) / maxVal) * h;
            return `${x},${y}`;
        }).join(' ');
    }

    /** Max value across ALL sources for a shared Y-axis */
    svgMaxY(): number {
        return Math.max(...this.days().map(b => b.total), 1);
    }

    /** X labels: first, mid, last day */
    svgXLabels(): { x: number; label: string }[] {
        const buckets = this.days();
        if (!buckets.length) return [];
        const w = 560;
        const pad = 24;
        const points = [0, Math.floor(buckets.length / 2), buckets.length - 1]
            .filter((i, idx, arr) => arr.indexOf(i) === idx && buckets[i]);
        return points.map(i => ({
            x: pad + (i / Math.max(buckets.length - 1, 1)) * (w - pad * 2),
            label: buckets[i].date.slice(5),   // 'MM-DD'
        }));
    }

    // ── Utilities ──────────────────────────────────────────────────────────────
    color(src: string): string { return AI_COLORS[src] ?? '#8b5cf6'; }
    colorBg(src: string): string { return (AI_COLORS[src] ?? '#8b5cf6') + '22'; }
    srcLabel(src: string): string {
        const labels: Record<string, string> = {
            chatgpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini',
            copilot: 'Copilot', claude: 'Claude', 'meta-ai': 'Meta AI',
            you: 'You.com', poe: 'Poe', kagi: 'Kagi', phind: 'Phind', mistral: 'Mistral',
        };
        return labels[src] ?? src;
    }

    fmtPath(path: string): string {
        if (!path || path === '/') return 'Home';
        return path.length > 40 ? path.slice(0, 38) + '…' : path;
    }

    fmtDate(d: Date): string {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    fmtFullLocation(s: AiSession): string {
        return [s.city, s.region, s.country].filter(x => !!x).join(', ') || '—';
    }

    fmtPlatform(s: AiSession): string {
        if (!s.platform && !s.userAgent) return '—';
        const ua = s.userAgent;
        if (s.platform) {
            const p = s.platform.toLowerCase();
            if (p.includes('iphone') || p.includes('ios')) return '🍎 iOS';
            if (p.includes('ipad'))   return '🍎 iPadOS';
            if (p.includes('android')) return '🤖 Android';
            if (p.includes('mac'))    return '🍎 macOS';
            if (p.includes('win'))    return '🪟 Windows';
            if (p.includes('linux'))  return '🐧 Linux';
        }
        // Fallback: parse UA string
        if (/iPhone/i.test(ua))  return '🍎 iOS';
        if (/iPad/i.test(ua))    return '🍎 iPadOS';
        if (/Android/i.test(ua)) return '🤖 Android';
        if (/Macintosh/i.test(ua)) return '🍎 macOS';
        if (/Windows/i.test(ua))  return '🪟 Windows';
        if (/Linux/i.test(ua))    return '🐧 Linux';
        return s.platform || '—';
    }

    fmtBrowser(ua: string): string {
        if (!ua) return '—';
        if (/Edg\//i.test(ua))    return 'Edge';
        if (/OPR\//i.test(ua))    return 'Opera';
        if (/Firefox\//i.test(ua)) return 'Firefox';
        if (/Chrome\//i.test(ua)) return 'Chrome';
        if (/Safari\//i.test(ua)) return 'Safari';
        return 'Other';
    }

    fmtReferrer(url: string): string {
        if (!url) return '—';
        try {
            const u = new URL(url);
            const path = u.pathname.length > 1 ? u.pathname.slice(0, 40) : '';
            return u.hostname + path;
        } catch { return url.slice(0, 50); }
    }

    fmtLang(lang: string): string {
        if (!lang) return '—';
        const labels: Record<string, string> = {
            'es': 'Spanish', 'es-MX': 'Spanish (MX)', 'es-419': 'Spanish (LA)',
            'en': 'English', 'en-US': 'English (US)', 'en-GB': 'English (UK)',
            'pt': 'Portuguese', 'pt-BR': 'Portuguese (BR)',
            'fr': 'French', 'de': 'German',
        };
        return labels[lang] || lang;
    }

    fmtScreen(w: number): string {
        if (!w) return '—';
        if (w < 480)  return `${w}px (XS)`;
        if (w < 768)  return `${w}px (Mobile)`;
        if (w < 1024) return `${w}px (Tablet)`;
        if (w < 1440) return `${w}px (Desktop)`;
        return `${w}px (Large)`;
    }

    deltaClass(delta: number | null): string {
        if (delta === null) return 'delta-neutral';
        return delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-neutral';
    }

    deltaLabel(delta: number | null): string {
        if (delta === null) return 'New';
        return (delta > 0 ? '↑' : delta < 0 ? '↓' : '—') + ' ' + Math.abs(delta) + '%';
    }
}
