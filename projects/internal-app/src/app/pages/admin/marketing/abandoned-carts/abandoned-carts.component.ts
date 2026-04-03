import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    AbandonedCartsService, AbandonedCart, CartStage, CartAudience, JourneyEvent
} from './abandoned-carts.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

type TimeframeKey = '24h' | '7d' | '30d' | 'MTD' | 'PAST_MONTH' | 'YTD';
type ValueTierKey = 'all' | 'low' | 'mid' | 'high';

const TIMEFRAME_MS: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d':  7  * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

function calendarFrom(key: TimeframeKey): number | null {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    if (key === 'MTD')        return new Date(y, m, 1).getTime();
    if (key === 'PAST_MONTH') return new Date(y, m - 1, 1).getTime();
    if (key === 'YTD')        return new Date(y, 0, 1).getTime();
    return null; // rolling-window keys handled by TIMEFRAME_MS
}

function calendarTo(key: TimeframeKey): number | null {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    if (key === 'PAST_MONTH') return new Date(y, m, 0, 23, 59, 59, 999).getTime();
    if (key === 'MTD' || key === 'YTD') return now.getTime();
    return null;
}

@Component({
    selector: 'app-abandoned-carts',
    standalone: true,
    imports: [CommonModule, DatePipe, AppIconComponent],
    templateUrl: './abandoned-carts.component.html',
    styleUrls: ['./abandoned-carts.component.css']
})
export class AbandonedCartsComponent implements OnInit, OnDestroy {
    private svc = inject(AbandonedCartsService);

    // ── Raw data ────────────────────────────────────────────────────────────
    private allCarts = toSignal(this.svc.getAbandonedCarts(), { initialValue: [] as AbandonedCart[] });

    // ── Filter state ────────────────────────────────────────────────────────
    audienceFilter  = signal<CartAudience | 'all'>('all');
    timeframeFilter = signal<TimeframeKey>('7d');
    valueFilter     = signal<ValueTierKey>('all');
    sourceFilter    = signal<string>('all');

    // ── UI state ────────────────────────────────────────────────────────────
    expandedId    = signal<string | null>(null);
    isRefreshing  = signal(false);
    private refreshTimer: any;

    // ── Journey panel state ─────────────────────────────────────────────────
    journeyCart    = signal<AbandonedCart | null>(null);
    journeyEvents  = signal<JourneyEvent[]>([]);
    journeyLoading = signal(false);
    journeyOpen    = signal(false);

    // ── Filtered carts ──────────────────────────────────────────────────────
    filteredCarts = computed(() => {
        const now      = Date.now();
        const tf       = this.timeframeFilter();
        const audience = this.audienceFilter();
        const valueTier = this.valueFilter();
        const source   = this.sourceFilter();

        // Calendar-based range (MTD / PAST_MONTH / YTD)
        const fromMs = calendarFrom(tf);
        const toMs   = calendarTo(tf);
        // Rolling window
        const windowMs = TIMEFRAME_MS[tf] ?? null;

        return this.allCarts().filter(c => {
            if (fromMs !== null && toMs !== null) {
                if (c.lastSeenMs < fromMs || c.lastSeenMs > toMs) return false;
            } else if (windowMs !== null) {
                if ((now - c.lastSeenMs) > windowMs) return false;
            }
            if (audience !== 'all' && c.audience !== audience) return false;
            if (valueTier === 'low'  && c.cartValue >= 500)  return false;
            if (valueTier === 'mid'  && (c.cartValue < 500 || c.cartValue >= 2000)) return false;
            if (valueTier === 'high' && c.cartValue < 2000)  return false;
            if (source !== 'all' && c.source.toLowerCase() !== source.toLowerCase()) return false;
            return true;
        });
    });

    // ── KPIs ────────────────────────────────────────────────────────────────
    totalAbandoned = computed(() => this.filteredCarts().length);

    revenueAtRisk = computed(() =>
        this.filteredCarts().reduce((sum, c) => sum + c.cartValue, 0)
    );

    recoverable = computed(() =>
        this.filteredCarts().filter(c => c.audience === 'authenticated' || !!c.email).length
    );

    avgTimeToAbandon = computed(() => {
        const carts = this.filteredCarts().filter(c => c.firstAddedMs && c.lastSeenMs > c.firstAddedMs!);
        if (!carts.length) return 0;
        const totalMins = carts.reduce((s, c) => s + Math.floor((c.lastSeenMs - c.firstAddedMs!) / 60000), 0);
        return Math.round(totalMins / carts.length);
    });

    // ── Unique sources for filter dropdown ─────────────────────────────────
    uniqueSources = computed(() => {
        const sources = new Set(this.allCarts().map(c => c.source.toLowerCase()));
        return ['all', ...Array.from(sources).sort()];
    });

    // ── Percentage helpers ──────────────────────────────────────────────────
    guestPct = computed(() => {
        const t = this.filteredCarts().length;
        if (!t) return 0;
        return Math.round(this.filteredCarts().filter(c => c.audience === 'guest').length / t * 100);
    });
    checkoutPct = computed(() => {
        const t = this.filteredCarts().length;
        if (!t) return 0;
        return Math.round(this.filteredCarts().filter(c => c.stage === 'checkout_started').length / t * 100);
    });

    // ── QR-sourced carts KPI ─────────────────────────────────────────────────
    qrSourcedPct = computed(() => {
        const t = this.filteredCarts().length;
        if (!t) return 0;
        return Math.round(
            this.filteredCarts().filter(c =>
                c._raw?.attribution?.utm?.utm_medium === 'qr' ||
                c._raw?.attribution?.utm?.utm_source === 'qr'
            ).length / t * 100
        );
    });

    ngOnInit() {
        this.refreshTimer = setInterval(() => this.refresh(), 5 * 60 * 1000);
    }

    ngOnDestroy() {
        clearInterval(this.refreshTimer);
    }

    refresh() {
        this.isRefreshing.set(true);
        setTimeout(() => this.isRefreshing.set(false), 600);
    }

    toggleExpand(id: string) {
        this.expandedId.set(this.expandedId() === id ? null : id);
    }

    setAudience(v: CartAudience | 'all')  { this.audienceFilter.set(v); }
    setTimeframe(v: TimeframeKey)          { this.timeframeFilter.set(v); }
    setValueTier(v: ValueTierKey)          { this.valueFilter.set(v); }
    setSource(v: string)                   { this.sourceFilter.set(v); }

    // ── Journey panel ────────────────────────────────────────────────────────

    async openJourney(cart: AbandonedCart, event: MouseEvent) {
        event.stopPropagation(); // don't collapse the row
        this.journeyCart.set(cart);
        this.journeyEvents.set([]);
        this.journeyLoading.set(true);
        this.journeyOpen.set(true);

        try {
            const events = await this.svc.getJourney(cart);
            this.journeyEvents.set(events);
        } catch (e) {
            console.error('[Journey] Failed to load:', e);
        } finally {
            this.journeyLoading.set(false);
        }
    }

    closeJourney() {
        this.journeyOpen.set(false);
        this.journeyCart.set(null);
    }

    openJourneyWhatsApp(cart: AbandonedCart) {
        const items  = cart.items.slice(0, 2).map(i => i.name).join(', ');
        const value  = this.formatMXN(cart.cartValue);
        const city   = cart.city ? ` desde ${cart.city}` : '';
        const msg    = `Hola! Vimos que dejaste tu carrito con ${cart.items.length} producto(s) ` +
                       `(${items}) por un total de ${value}${city}. ` +
                       `¿Te podemos ayudar a completar tu compra? 😊`;
        window.open(`https://wa.me/5214442004677?text=${encodeURIComponent(msg)}`, '_blank');
    }

    openRecoveryEmail(cart: AbandonedCart) {
        if (!cart.email) return;
        const items   = cart.items.slice(0, 3).map(i => i.name).join(', ');
        const value   = this.formatMXN(cart.cartValue);
        const subject = encodeURIComponent(`Tu carrito te está esperando — ${value}`);
        const body    = encodeURIComponent(
            `Hola ${cart.displayName || ''},\n\n` +
            `Notamos que dejaste artículos en tu carrito de Importadora Euro:\n` +
            `${items}${cart.items.length > 3 ? ` y ${cart.items.length - 3} más` : ''}\n` +
            `Total: ${value}\n\n` +
            `Completa tu compra aquí: https://www.importadoraeuro.com/checkout\n\n` +
            `¿Tienes alguna duda? Escríbenos, con gusto te ayudamos.\n\n` +
            `Equipo Importadora Euro`
        );
        window.open(`mailto:${cart.email}?subject=${subject}&body=${body}`, '_blank');
    }

    journeyEventColor(type: JourneyEvent['type']): string {
        const map: Record<string, string> = {
            qr_scan:           'var(--journey-qr)',
            cart_add:          'var(--journey-cart)',
            cart_update:       'var(--journey-cart)',
            cart_remove:       'var(--journey-wa)',
            checkout_started:  'var(--journey-checkout)',
            whatsapp_click:    'var(--journey-wa)',
            cleared_by_user:   'var(--journey-dead)',
            abandoned:         'var(--journey-dead)',
        };
        return map[type] ?? 'var(--color-primary)';
    }

    // ── Display helpers ────────────────────────────────────────────────────

    formatMXN(value: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value);
    }

    formatIdle(minutes: number): string {
        if (minutes < 60) return `${minutes}m ago`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
    }

    formatDuration(minutes: number): string {
        if (minutes < 60) return `${minutes} min`;
        return `${Math.round(minutes / 60)} hr`;
    }

    stageLabel(stage: CartStage): string {
        return stage === 'checkout_started' ? 'Checkout Started' : 'Browsing';
    }

    getSourceIcon(source: string): string {
        const s = source.toLowerCase();
        if (s.includes('google'))          return 'search';
        if (s.includes('qr'))              return 'qr-code';
        if (s.includes('facebook') ||
            s.includes('instagram') ||
            s.includes('twitter'))         return 'share-2';
        if (s.includes('email') ||
            s.includes('mail'))            return 'mail';
        return 'globe';
    }

    journeyIconName(icon: string): string {
        const map: Record<string, string> = {
            'qr-code':        'qr-code',
            'shopping-cart':  'shopping-cart',
            'credit-card':    'credit-card',
            'message-circle': 'message-circle',
            'alert-circle':   'alert-circle',
            'minus-circle':   'minus-circle',
            'trash-2':        'trash-2',
            'edit-2':         'edit-2',
            'user-check':     'user-check',
            'check-circle':   'check-circle',
        };
        return map[icon] ?? icon;
    }
}
