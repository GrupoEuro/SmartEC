import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
    Firestore, collection, getDocs, query, where,
    orderBy, limit, Timestamp
} from '@angular/fire/firestore';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ConvStats { open: number; today: number; unread: number; resolved: number; total: number; }
interface ChannelStat { id: string; label: string; color: string; count: number; pct: number; }
interface DayStat     { label: string; count: number; pct: number; }

const CHANNEL_META: Record<string, { label: string; color: string }> = {
    whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
    instagram: { label: 'Instagram', color: '#e1306c' },
    facebook:  { label: 'Facebook',  color: '#1877f2' },
    telegram:  { label: 'Telegram',  color: '#229ed9' },
    email:     { label: 'Email',     color: '#6366f1' },
    website:   { label: 'Chat Web',  color: '#8b5cf6' },
};

@Component({
    selector: 'app-care-analytics',
    standalone: true,
    imports: [CommonModule, RouterModule, AppIconComponent],
    templateUrl: './care-analytics.component.html',
    styleUrls:  ['./care-analytics.component.css'],
})
export class CareAnalyticsComponent implements OnInit {
    private fs = inject(Firestore);

    loading    = signal(true);
    period     = signal<'7d' | '30d' | '90d'>('30d');

    // ── KPI stats ────────────────────────────────────────────────────────────
    stats = signal<ConvStats>({ open: 0, today: 0, unread: 0, resolved: 0, total: 0 });

    // ── Channel breakdown ────────────────────────────────────────────────────
    rawChannelCounts = signal<Record<string, number>>({});
    channelStats = computed<ChannelStat[]>(() => {
        const counts = this.rawChannelCounts();
        const total  = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
        return Object.entries(counts)
            .filter(([, n]) => n > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([id, count]) => ({
                id,
                label: CHANNEL_META[id]?.label ?? id,
                color: CHANNEL_META[id]?.color ?? '#64748b',
                count,
                pct:   Math.round((count / total) * 100),
            }));
    });

    // ── Volume trend (last 7 days) ───────────────────────────────────────────
    volumeTrend = signal<DayStat[]>([]);

    // ── Status breakdown ─────────────────────────────────────────────────────
    statusBreakdown = computed(() => {
        const s = this.stats();
        const total = s.total || 1;
        return [
            { label: 'Abiertas',  count: s.open,     color: '#60a5fa', pct: Math.round((s.open     / total) * 100) },
            { label: 'Sin leer',  count: s.unread,   color: '#fcd34d', pct: Math.round((s.unread   / total) * 100) },
            { label: 'Resueltas', count: s.resolved, color: '#6ee7b7', pct: Math.round((s.resolved / total) * 100) },
        ];
    });

    ngOnInit() {
        this.loadAnalytics();
    }

    async setPeriod(p: '7d' | '30d' | '90d') {
        this.period.set(p);
        this.loading.set(true);
        await this.loadAnalytics();
    }

    private async loadAnalytics() {
        try {
            const now         = new Date();
            const todayStart  = new Date(now); todayStart.setHours(0, 0, 0, 0);
            const days        = this.period() === '7d' ? 7 : this.period() === '30d' ? 30 : 90;
            const periodStart = new Date(now.getTime() - days * 86_400_000);

            const col  = collection(this.fs, 'customer_conversations');
            const q = query(col, where('updatedAt', '>=', periodStart));
            const snap = await getDocs(q);

            let open = 0, today = 0, unread = 0, resolved = 0, total = 0;
            const counts: Record<string, number> = {};

            // Daily buckets for last 7 days trend
            const dailyMap: Record<string, number> = {};
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 86_400_000);
                dailyMap[this.dayKey(d)] = 0;
            }

            snap.forEach(doc => {
                const data = doc.data() as any;
                total++;
                if (data.status === 'open')     open++;
                if (data.status === 'resolved') resolved++;
                if ((data.unreadCount ?? 0) > 0) unread++;

                const createdAt: Timestamp | undefined = data.createdAt;
                if (createdAt) {
                    const ts = createdAt.toDate ? createdAt.toDate() : new Date(createdAt as any);
                    if (ts >= todayStart) today++;
                    if (ts >= periodStart) {
                        const ch: string = data.channel ?? 'website';
                        counts[ch] = (counts[ch] ?? 0) + 1;
                    }
                    const key = this.dayKey(ts);
                    if (key in dailyMap) dailyMap[key]++;
                } else {
                    const ch: string = data.channel ?? 'website';
                    counts[ch] = (counts[ch] ?? 0) + 1;
                }
            });

            this.stats.set({ open, today, unread, resolved, total });
            this.rawChannelCounts.set(counts);

            // Build trend array
            const maxDay = Math.max(...Object.values(dailyMap), 1);
            const trend: DayStat[] = Object.entries(dailyMap).map(([key, count]) => ({
                label: this.dayLabel(key),
                count,
                pct:   Math.round((count / maxDay) * 100),
            }));
            this.volumeTrend.set(trend);

        } catch (e) {
            console.warn('[CareAnalytics] load failed', e);
        } finally {
            this.loading.set(false);
        }
    }

    private dayKey(d: Date): string {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    private dayLabel(key: string): string {
        const [, m, d] = key.split('-');
        return `${d}/${m}`;
    }

    resolutionRate = computed(() => {
        const s = this.stats();
        if (!s.total) return 0;
        return Math.round((s.resolved / s.total) * 100);
    });
}
