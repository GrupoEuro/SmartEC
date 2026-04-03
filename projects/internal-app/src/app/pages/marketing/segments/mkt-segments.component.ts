import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    Firestore, collection, query,
    where, orderBy, Timestamp, getDocs
} from '@angular/fire/firestore';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RfmCustomer {
    userId:        string;
    email:         string;
    name:          string;
    orders:        number;
    revenue:       number;
    lastOrderDate: Date;
    R: number; F: number; M: number;
    rfmScore: number;
    segment:  RfmSegment;
}

export type RfmSegment =
    'champions' | 'loyal' | 'at_risk' | 'lost' | 'new' | 'potential' | 'promising';

export type RfmTimeframe = 'mtd' | 'past_month' | 'ytd' | '6m' | '12m' | 'all';

const SEGMENT_META: Record<RfmSegment, { label: string; color: string; bg: string; desc: string; criteria: string }> = {
    champions: {
        label: 'Champions',       color: '#4ade80', bg: 'rgba(74,222,128,.12)',
        desc:     'Bought recently, buy often, and spend the most.',
        criteria: 'R ≥ 4 · F ≥ 4 · M ≥ 4',
    },
    loyal: {
        label: 'Loyal Customers', color: '#a5b4fb', bg: 'rgba(165,180,251,.1)',
        desc:     'Regular buyers with a strong purchase history.',
        criteria: 'R ≥ 3 · F ≥ 3',
    },
    at_risk: {
        label: 'At Risk',         color: '#fb923c', bg: 'rgba(251,146,60,.1)',
        desc:     'Past big spenders who haven\'t purchased recently.',
        criteria: 'R ≤ 2 · F ≥ 3',
    },
    lost: {
        label: 'Lost',            color: '#f87171', bg: 'rgba(248,113,113,.1)',
        desc:     'Haven\'t bought in a long time — need a win-back promo.',
        criteria: 'R ≤ 2 · F ≤ 2',
    },
    new: {
        label: 'New Customers',   color: '#34d399', bg: 'rgba(52,211,153,.1)',
        desc:     'Bought very recently but only once or twice.',
        criteria: 'R ≥ 4 · F ≤ 2',
    },
    potential: {
        label: 'Potential Loyal', color: '#c4b5fd', bg: 'rgba(196,181,253,.1)',
        desc:     'Recent buyers with decent spend — loyalty program candidates.',
        criteria: 'R ≥ 3 · F ≥ 2 · M ≥ 3',
    },
    promising: {
        label: 'Promising',       color: '#fbbf24', bg: 'rgba(251,191,36,.1)',
        desc:     'Recent shoppers, not yet frequent — nurture with follow-up.',
        criteria: 'R ≥ 3 · F ≤ 2',
    },
};

const TF_OPTIONS: { value: RfmTimeframe; label: string }[] = [
    { value: 'mtd',        label: 'MTD'        },
    { value: 'past_month', label: 'Past Month' },
    { value: 'ytd',        label: 'YTD'        },
    { value: '6m',         label: 'Last 6 Mo'  },
    { value: '12m',        label: 'Last 12 Mo' },
    { value: 'all',        label: 'All Time'   },
];

function getDateRange(tf: RfmTimeframe): Date {
    const now = new Date();
    switch (tf) {
        case 'mtd': {
            // Start of current month
            return new Date(now.getFullYear(), now.getMonth(), 1);
        }
        case 'past_month': {
            // Start of previous month
            return new Date(now.getFullYear(), now.getMonth() - 1, 1);
        }
        case 'ytd': {
            // Jan 1 of current year
            return new Date(now.getFullYear(), 0, 1);
        }
        case '6m': {
            const d = new Date(now);
            d.setMonth(d.getMonth() - 6);
            return d;
        }
        case '12m': {
            const d = new Date(now);
            d.setFullYear(d.getFullYear() - 1);
            return d;
        }
        case 'all':
        default:
            return new Date(0); // epoch — no filter
    }
}

/** End date: for 'past_month' we cap at end of that month, otherwise now */
function getEndDate(tf: RfmTimeframe): Date | null {
    if (tf !== 'past_month') return null; // null = no upper bound
    const now = new Date();
    // Last day of previous month
    return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
}

function classifyRFM(R: number, F: number, M: number): RfmSegment {
    if (R >= 4 && F >= 4 && M >= 4) return 'champions';
    if (R >= 3 && F >= 3)           return 'loyal';
    if (R >= 4 && F <= 2)           return 'new';
    if (R >= 3 && F >= 2 && M >= 3) return 'potential';
    if (R >= 3 && F <= 2)           return 'promising';
    if (R <= 2 && F >= 3)           return 'at_risk';
    return 'lost';
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
    selector: 'app-mkt-segments',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './mkt-segments.component.html',
    styleUrls: ['./mkt-segments.component.css'],
})
export class MktSegmentsComponent {
    private firestore = inject(Firestore);
    private router    = inject(Router);

    // ── State ──────────────────────────────────────────────────────────────────

    isLoading     = signal(true);
    customers     = signal<RfmCustomer[]>([]);
    activeSegment = signal<RfmSegment | 'all'>('all');
    error         = signal<string | null>(null);
    timeframe     = signal<RfmTimeframe>('ytd'); // sensible default: current year
    docsRead      = signal(0);                    // transparency: show how many docs were read

    readonly segmentMeta = SEGMENT_META;
    readonly segmentKeys = Object.keys(SEGMENT_META) as RfmSegment[];
    readonly tfOptions   = TF_OPTIONS;

    // ── Computed ───────────────────────────────────────────────────────────────

    readonly segmentCounts = computed(() => {
        const counts: Record<string, number> = {};
        for (const c of this.customers()) {
            counts[c.segment] = (counts[c.segment] || 0) + 1;
        }
        return counts;
    });

    readonly filtered = computed(() => {
        const seg = this.activeSegment();
        if (seg === 'all') return this.customers();
        return this.customers().filter(c => c.segment === seg);
    });

    readonly totalCustomers = computed(() => this.customers().length);
    readonly totalRevenue   = computed(() => this.customers().reduce((s, c) => s + c.revenue, 0));
    readonly avgOrderValue  = computed(() => {
        const t = this.customers().reduce((s, c) => s + c.orders, 0);
        return t > 0 ? this.totalRevenue() / t : 0;
    });

    getMeta(seg: RfmSegment | 'all') {
        if (seg === 'all') return null;
        return SEGMENT_META[seg];
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    constructor() {
        // Initial load with default timeframe
        this.load(this.timeframe());
    }

    // ── Public actions ─────────────────────────────────────────────────────────

    setTimeframe(tf: RfmTimeframe) {
        if (tf === this.timeframe()) return;
        this.timeframe.set(tf);
        this.activeSegment.set('all');
        this.load(tf);
    }

    // ── RFM engine ─────────────────────────────────────────────────────────────

    private async load(tf: RfmTimeframe) {
        this.isLoading.set(true);
        this.error.set(null);
        this.customers.set([]);

        try {
            await this.buildRFM(tf);
        } catch (e: any) {
            this.error.set(e?.message ?? 'Failed to load segments');
        } finally {
            this.isLoading.set(false);
        }
    }

    private async buildRFM(tf: RfmTimeframe) {
        const startDate  = getDateRange(tf);
        const endDate    = getEndDate(tf);
        const startTs    = Timestamp.fromDate(startDate);

        // Build query — only read orders within the selected timeframe
        const constraints: any[] = [
            where('status', '!=', 'cancelled'),
            orderBy('status'),
            orderBy('createdAt', 'desc'),
            where('createdAt', '>=', startTs),
        ];

        if (endDate) {
            constraints.push(where('createdAt', '<=', Timestamp.fromDate(endDate)));
        }

        const snap = await getDocs(
            query(collection(this.firestore, 'orders'), ...constraints)
        );

        this.docsRead.set(snap.size);

        // Aggregate per customer
        const map = new Map<string, { email: string; name: string; orders: any[] }>();
        snap.forEach(doc => {
            const d = doc.data() as any;
            const uid   = d.userId || d.uid || d.guestId || doc.id;
            const email = d.customerEmail || d.email || '';
            const name  = d.customerName  || d.name  || email || uid.slice(0, 8);
            if (!map.has(uid)) map.set(uid, { email, name, orders: [] });
            map.get(uid)!.orders.push(d);
        });

        if (map.size === 0) { this.customers.set([]); return; }

        // Compute RFM vectors
        const now = Date.now();
        const allRecencies: number[] = [];
        const allFreqs:     number[] = [];
        const allRevenues:  number[] = [];

        const raw: {
            uid: string; email: string; name: string;
            recency: number; freq: number; rev: number; lastDate: Date;
        }[] = [];

        map.forEach((val, uid) => {
            const freq = val.orders.length;
            const rev  = val.orders.reduce((s: number, o: any) => s + (o.total || o.totalAmount || 0), 0);
            const lastTs   = val.orders[0]?.createdAt;
            const lastDate = lastTs instanceof Timestamp
                ? lastTs.toDate()
                : new Date((lastTs?.seconds ?? 0) * 1000 || now);
            const recency  = Math.floor((now - lastDate.getTime()) / 86400000);

            allRecencies.push(recency);
            allFreqs.push(freq);
            allRevenues.push(rev);
            raw.push({ uid, email: val.email, name: val.name, recency, freq, rev, lastDate });
        });

        // Quintile scoring (1–5)
        const scoreQ = (val: number, arr: number[], invert = false): number => {
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = sorted.findIndex(v => v >= val);
            const pct = (sorted.length > 1 ? idx / (sorted.length - 1) : 0);
            const q = Math.ceil(pct * 4) + 1;
            return invert ? (6 - q) : q;
        };

        const result: RfmCustomer[] = raw.map(r => {
            const R = scoreQ(r.recency, allRecencies, true);
            const F = scoreQ(r.freq,    allFreqs);
            const M = scoreQ(r.rev,     allRevenues);
            const segment = classifyRFM(R, F, M);
            return {
                userId: r.uid, email: r.email, name: r.name,
                orders: r.freq, revenue: r.rev, lastOrderDate: r.lastDate,
                R, F, M, rfmScore: R + F + M, segment,
            };
        });

        result.sort((a, b) => b.rfmScore - a.rfmScore);
        this.customers.set(result);
    }

    // ── Formatters ─────────────────────────────────────────────────────────────

    fmtMXN(v: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
        }).format(v);
    }

    daysAgo(d: Date): string {
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        return `${days}d ago`;
    }

    /** Navigate to campaign builder pre-filled with the active segment */
    createCampaignForSegment() {
        const seg  = this.activeSegment();
        const meta = this.getMeta(seg);
        this.router.navigate(['/marketing/campaigns/new'], {
            queryParams: { segment: seg, audience: meta?.label ?? seg }
        });
    }
}
