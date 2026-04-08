import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { QrAnalyticsService, QrScan } from '../../../admin/coupons/coupon-analytics/qr-analytics.service';

interface JourneyStep {
    id:       string;
    label:    string;
    sublabel: string;
    icon:     'scan' | 'cart' | 'wa' | 'checkout' | 'order';
    reached:  boolean;
    active:   boolean;  // the "deepest" step reached
    time?:    string;
    value?:   string;
    color:    string;
}

@Component({
    selector: 'app-scan-detail',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './scan-detail.component.html',
    styleUrls: ['./scan-detail.component.css'],
})
export class ScanDetailComponent implements OnInit {
    private route  = inject(ActivatedRoute);
    private router = inject(Router);
    private svc    = inject(QrAnalyticsService);

    couponId = '';
    scanId   = '';

    scan    = signal<QrScan | null>(null);
    coupon  = signal<any>(null);
    loading = signal(true);
    error   = signal('');

    ngOnInit() {
        this.couponId = this.route.snapshot.paramMap.get('couponId') ?? '';
        this.scanId   = this.route.snapshot.paramMap.get('scanId')   ?? '';
        if (!this.couponId || !this.scanId) {
            this.router.navigate(['/marketing/coupons']);
            return;
        }
        this.load();
    }

    private async load() {
        this.loading.set(true);
        try {
            const [coupon, scan] = await Promise.all([
                this.svc.getCoupon(this.couponId),
                this.svc.getScan(this.couponId, this.scanId),
            ]);
            this.coupon.set(coupon);
            if (!scan) { this.error.set('Escaneo no encontrado.'); return; }
            this.scan.set(scan);
        } catch (e: any) {
            this.error.set('Error al cargar el escaneo.');
            console.error(e);
        } finally {
            this.loading.set(false);
        }
    }

    back() {
        this.router.navigate(['/marketing/coupons/qr', this.couponId]);
    }


    // ── Journey builder ────────────────────────────────────────────────────────

    journeySteps(s: QrScan): JourneyStep[] {
        const hasCart     = (s.cartValue ?? 0) > 0 || (s.cartItems?.length ?? 0) > 0;
        const hasCheckout = s.cartStatus === 'checkout_started';
        const hasOrder    = !!s.orderId;
        const hasWA       = !!s.waClicked;

        // Determine the deepest step for "active" highlight
        const depth = hasOrder ? 'order' : hasCheckout ? 'checkout' : hasWA ? 'wa' : hasCart ? 'cart' : 'scan';

        const steps: JourneyStep[] = [
            {
                id: 'scan',
                label: 'Escaneo QR',
                sublabel: s.city ? `Desde ${s.city}` : 'Sin geolocalización',
                icon: 'scan',
                reached: true,
                active: depth === 'scan',
                time:  this.fmtDate(s.scannedAt),
                color: '#6366f1',
            },
            {
                id: 'cart',
                label: 'Carrito',
                sublabel: hasCart ? `${s.cartItems?.length ?? 1} producto(s)` : 'No agregó al carrito',
                icon: 'cart',
                reached: hasCart,
                active: depth === 'cart',
                value: hasCart ? this.fmtMXN(s.cartValue ?? 0) : undefined,
                color: '#3b82f6',
            },
            {
                id: 'wa',
                label: 'WhatsApp',
                sublabel: hasWA ? 'Abrió WhatsApp' : 'No contactó',
                icon: 'wa',
                reached: hasWA,
                active: depth === 'wa',
                color: '#25d366',
            },
            {
                id: 'checkout',
                label: 'Checkout',
                sublabel: hasCheckout ? 'Inició checkout' : 'No llegó al checkout',
                icon: 'checkout',
                reached: hasCheckout,
                active: depth === 'checkout',
                color: '#f59e0b',
            },
            {
                id: 'order',
                label: 'Orden',
                sublabel: hasOrder ? `ID: …${s.orderId!.slice(-6).toUpperCase()}` : 'Sin conversión',
                icon: 'order',
                reached: hasOrder,
                active: depth === 'order',
                value: hasOrder ? this.fmtMXN(s.orderTotal ?? 0) : undefined,
                color: '#22c55e',
            },
        ];

        return steps;
    }

    conversionLabel(s: QrScan): { text: string; css: string } {
        if (s.orderId)                              return { text: 'Convertido',    css: 'badge-success' };
        if (s.cartStatus === 'checkout_started')    return { text: 'En checkout',   css: 'badge-warn'    };
        if ((s.cartValue ?? 0) > 0)                 return { text: 'En carrito',    css: 'badge-info'    };
        if (s.waClicked)                            return { text: 'Contactó WA',   css: 'badge-wa'      };
        return                                             { text: 'Solo escaneó',   css: 'badge-dim'     };
    }

    // ── Formatters ─────────────────────────────────────────────────────────────
    fmtMXN(n: number): string {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
    }

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
        if (mins  < 2)  return 'Justo ahora';
        if (mins  < 60) return `Hace ${mins}m`;
        if (hours < 24) return `Hace ${hours}h`;
        return `Hace ${days}d`;
    }

    resolveItemName(item: any): string {
        const n = item.name;
        if (!n) return 'Producto';
        if (typeof n === 'string') return n;
        if (typeof n === 'object') return n['es'] ?? n['en'] ?? Object.values(n)[0] as string ?? 'Producto';
        return String(n);
    }
}
