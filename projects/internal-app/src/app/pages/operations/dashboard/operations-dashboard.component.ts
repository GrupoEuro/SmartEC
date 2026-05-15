import { Component, inject, OnInit, OnDestroy, AfterViewInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Firestore, doc, getDoc, collection, getDocs, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import confetti from 'canvas-confetti';

import { OrderService } from '../../../core/services/order.service';
import { Order, OrderStatus } from '../../../core/models/order.model';
import { OrderPriorityService } from '../../../core/services/order-priority.service';
import { OrderAssignmentService } from '../../../core/services/order-assignment.service';
import { AdminPageHeaderComponent } from '../../admin/shared/admin-page-header/admin-page-header.component';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { ToastService } from '../../../core/services/toast.service';
import { GoogleMapsModule, MapMarker, MapInfoWindow } from '@angular/google-maps';
import { ViewChild, ElementRef } from '@angular/core';
import { MetricsBigqueryService } from '../metrics/services/metrics-bigquery.service';

// Register Chart.js components
Chart.register(...registerables);

export interface StateMetric {
    name: string;
    lat: number;
    lng: number;
    orders: number;
    pieces: number;
    sales: number;
    /** Pre-computed SVG data-URL — used as MapMarker icon. Never rebuilt on CD cycles. */
    markerIcon?: string;
    /** Pre-computed pixel size of the SVG so the anchor can be centered. */
    markerSize?: number;
}

export interface CityGeographicDetail {
    zipCode: string;
    city: string;
    orders: number;
    pieces: number;
    sales: number;
}

export interface StateGeographicDetail {
    state: string;
    orders: number;
    pieces: number;
    sales: number;
    isExpanded?: boolean;
    cities: CityGeographicDetail[];
}

interface DashboardStats {
    totalOrders: number;
    pendingOrders: number;
    processingOrders: number;
    shippedToday: number;
    monthlySales: number;
    monthlyPiecesSold: number;
}

interface SLAStats {
    total: number;
    onTime: number;
    overdue: number;
    approaching: number;
    complianceRate: number;
}

interface PriorityStats {
    standard: number;
    express: number;
    rush: number;
}

interface StaffWorkload {
    staffName: string;
    assignedOrders: number;
    inProgress: number;
    completed: number;
}

import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ActiveCampaignsWidgetComponent } from '../shared/active-campaigns-widget/active-campaigns-widget.component';
import { ActiveCouponsWidgetComponent } from '../shared/active-coupons-widget/active-coupons-widget.component';
import { AiReferrerWidgetComponent } from '../shared/ai-referrer-widget/ai-referrer-widget.component';
import { EuroMindChatComponent } from './euromind-chat/euromind-chat.component';

const MEXICO_STATES_COORDS: Record<string, { lat: number, lng: number }> = {
    'AGUASCALIENTES': { lat: 21.8853, lng: -102.2916 },
    'BAJA CALIFORNIA': { lat: 30.8406, lng: -115.2838 },
    'BAJA CALIFORNIA SUR': { lat: 26.0444, lng: -111.6661 },
    'CAMPECHE': { lat: 18.8055, lng: -90.2694 },
    'CHIAPAS': { lat: 16.7480, lng: -92.9372 },
    'CHIHUAHUA': { lat: 28.6320, lng: -106.0691 },
    'COAHUILA': { lat: 27.0587, lng: -101.7068 },
    'COLIMA': { lat: 19.1223, lng: -104.0028 },
    'CIUDAD DE MEXICO': { lat: 19.4326, lng: -99.1332 },
    'CDMX': { lat: 19.4326, lng: -99.1332 },
    'DISTRITO FEDERAL': { lat: 19.4326, lng: -99.1332 },
    'DURANGO': { lat: 24.0277, lng: -104.6532 },
    'GUANAJUATO': { lat: 21.0190, lng: -101.2574 },
    'GUERRERO': { lat: 17.5516, lng: -99.5010 },
    'HIDALGO': { lat: 20.0911, lng: -98.7624 },
    'JALISCO': { lat: 20.6595, lng: -103.3490 },
    'ESTADO DE MEXICO': { lat: 19.3268, lng: -99.7042 },
    'MEXICO': { lat: 19.3268, lng: -99.7042 },
    'MICHOACAN': { lat: 19.2274, lng: -101.8311 },
    'MICHOACAN DE OCAMPO': { lat: 19.2274, lng: -101.8311 },
    'MORELOS': { lat: 18.9186, lng: -99.2342 },
    'NAYARIT': { lat: 21.5037, lng: -104.8947 },
    'NUEVO LEON': { lat: 25.5922, lng: -99.9962 },
    'OAXACA': { lat: 17.0732, lng: -96.7266 },
    'PUEBLA': { lat: 19.0414, lng: -98.2063 },
    'QUERETARO': { lat: 20.5888, lng: -100.3899 },
    'QUINTANA ROO': { lat: 19.4447, lng: -87.8227 },
    'SAN LUIS POTOSI': { lat: 22.1565, lng: -100.9855 },
    'SINALOA': { lat: 25.1721, lng: -107.4795 },
    'SONORA': { lat: 29.2972, lng: -110.3309 },
    'TABASCO': { lat: 17.8409, lng: -92.6189 },
    'TAMAULIPAS': { lat: 24.2669, lng: -98.8363 },
    'TLAXCALA': { lat: 19.3139, lng: -98.2411 },
    'VERACRUZ': { lat: 19.1738, lng: -96.1342 },
    'YUCATAN': { lat: 20.9754, lng: -89.6170 },
    'ZACATECAS': { lat: 22.7709, lng: -102.5832 }
};

@Component({
    selector: 'app-operations-dashboard',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent, GoogleMapsModule, MapMarker, MapInfoWindow, ActiveCampaignsWidgetComponent, ActiveCouponsWidgetComponent, AiReferrerWidgetComponent, EuroMindChatComponent],
    templateUrl: './operations-dashboard.component.html',
    styleUrls: ['./operations-dashboard.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
    private orderService      = inject(OrderService);
    private priorityService   = inject(OrderPriorityService);
    private assignmentService = inject(OrderAssignmentService);
    private firestore         = inject(Firestore);
    private toast             = inject(ToastService);
    private translate         = inject(TranslateService);
    private bqService         = inject(MetricsBigqueryService);

    euromindReport = signal<any>(null);

    timeframe = signal<'MTD' | 'PM' | 'YTD'>('MTD');
    channelFilter = signal<'ALL' | 'mercadolibre' | 'web' | 'pos' | 'amazon' | 'on_behalf'>('ALL');
    showProjection = signal<boolean>(true);
    allFetchedOrders: Order[] = [];

    // Easter Egg Milestones
    dailyMilestone = signal<'50K' | '100K' | null>(null);
    monthlyMilestone = signal<boolean>(false);
    fireworksMessage = signal<string | null>(null);

    // Channel breakdown — always computed on ALL orders regardless of active filter
    channelBreakdown = signal<{
        channel: string;
        label: string;
        icon: string;
        color: string;
        orders: number;
        revenue: number;
        pending: number;
        // MeLi 2×2 segment matrix: fulfillment mode × listing tier
        // Each order belongs to exactly ONE bucket.
        meliFullClassic?:     number; // Meli Full + Classic listing
        meliFullPremium?:     number; // Meli Full + Premium listing
        meliMerchantClassic?: number; // We ship  + Classic listing
        meliMerchantPremium?: number; // We ship  + Premium listing

    }[]>([]);

    // — Year-over-Year comparison —
    /** Raw LY period data fetched from monthly_stats. Uses daily subcollection for exact date match. */
    lyPeriodStats = signal<{ sales: number; orders: number; pieces: number } | null>(null);

    /** True when the current partial month uses a full-month aggregate fallback (no days/ subcollection yet). */
    lyUsingApprox = signal<boolean>(false);

    /** Per-day sales array for same-month LY (MTD overlay line). Index 0 = day 1. */
    lyDailyData = signal<number[]>([]);

    /** Human-readable label for the LY period, adapts to MTD vs YTD.
     *  MTD exact  → 'abr 1–18, 2025'
     *  YTD exact  → 'ene–abr 18, 2025'
     *  Approx (no days/ subcollection yet) → '~abr 2025'
     */
    lyPeriodLabel = computed(() => {
        const now    = new Date();
        const lyYear = now.getFullYear() - 1;
        const approx = this.lyUsingApprox() ? '~' : '';
        if (this.timeframe() === 'MTD') {
            const ly = new Date(lyYear, now.getMonth(), 1);
            const monthName = ly.toLocaleDateString('es-MX', { month: 'short' });
            return `${approx}${monthName} 1–${now.getDate()}, ${lyYear}`;
        } else if (this.timeframe() === 'PM') {
            // Last month of last year
            const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
            const prevYear  = now.getMonth() === 0 ? lyYear - 1 : lyYear;
            const lastDay   = new Date(prevYear, prevMonth + 1, 0).getDate();
            const monthName = new Date(prevYear, prevMonth, 1).toLocaleDateString('es-MX', { month: 'short' });
            return `${approx}${monthName} 1–${lastDay}, ${prevYear}`;
        } else {
            const start = new Date(lyYear, 0, 1).toLocaleDateString('es-MX', { month: 'short' });
            const curMonthName = new Date(lyYear, now.getMonth(), 1).toLocaleDateString('es-MX', { month: 'short' });
            return `${approx}${start}–${curMonthName} ${now.getDate()}, ${lyYear}`;
        }
    });

    /** YoY sales delta %. Positive = growth. null = no LY data. */
    yoyDelta = computed<number | null>(() => {
        const ly = this.lyPeriodStats();
        if (!ly || ly.sales <= 0) return null;
        return ((this.stats().monthlySales - ly.sales) / ly.sales) * 100;
    });

    /** YoY orders delta %. */
    yoyOrdersDelta = computed<number | null>(() => {
        const ly = this.lyPeriodStats();
        if (!ly || ly.orders <= 0) return null;
        return ((this.stats().totalOrders - ly.orders) / ly.orders) * 100;
    });

    /** YoY pieces delta %. */
    yoyPiecesDelta = computed<number | null>(() => {
        const ly = this.lyPeriodStats();
        if (!ly || ly.pieces <= 0) return null;
        return ((this.stats().monthlyPiecesSold - ly.pieces) / ly.pieces) * 100;
    });

    stats = signal<DashboardStats>({
        totalOrders: 0,
        pendingOrders: 0,
        processingOrders: 0,
        shippedToday: 0,
        monthlySales: 0,
        monthlyPiecesSold: 0
    });

    /** End-of-month projection: only shown for MTD mid-month (not PM/YTD — those are complete periods). */
    mtdProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const mtdSales = this.stats().monthlySales;
        if (mtdSales <= 0) return null;

        const now = new Date();
        const todayDay = now.getDate();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const fractionalDayPart = (now.getHours() / 24) + (now.getMinutes() / 1440);

        // ── Strategy A: Velocity Multiplier using LY daily data ────────────────
        // velocityMultiplier = (CY MTD sales) / (LY sales over same elapsed period)
        // Remaining projection = future LY days × multiplier
        const lyData = this.lyDailyData();
        if (lyData && lyData.length === totalDays) {
            let lySalesMTD = 0;
            for (let i = 0; i < todayDay - 1; i++) lySalesMTD += lyData[i];
            lySalesMTD += lyData[todayDay - 1] * fractionalDayPart;

            if (lySalesMTD > 0) {
                const velocityMultiplier = mtdSales / lySalesMTD;
                // Today's remaining portion + all future days, scaled by multiplier
                let futureLySales = lyData[todayDay - 1] * (1 - fractionalDayPart);
                for (let i = todayDay; i < totalDays; i++) futureLySales += lyData[i];
                return mtdSales + (futureLySales * velocityMultiplier);
            }
        }

        // ── Strategy B: Straight-line run-rate (no LY data available) ──────────
        // Elapsed = complete days + fraction of today consumed
        const fractionalDay = (todayDay - 1) + fractionalDayPart;
        if (fractionalDay <= 0.1) return null;
        return (mtdSales / fractionalDay) * totalDays;
    });

    /**
     * Today's actual totals so far (CY).
     */
    todaySalesTotalSignal = signal<number>(0);
    todaySalesActual = computed<number>(() => this.todaySalesTotalSignal());

    todayOrdersCountSignal = signal<number>(0);
    todayOrdersActual = computed<number>(() => this.todayOrdersCountSignal());

    todayPiecesCountSignal = signal<number>(0);
    todayPiecesActual = computed<number>(() => this.todayPiecesCountSignal());

    /**
     * Today's full-day sales projection.
     *
     * Formula priority:
     * 1. LY same calendar day × velocity multiplier → scales LY day by current run-rate
     * 2. Straight-line hourly run-rate: (sales so far) / (hours elapsed) × 24
     */
    todayProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const todaySales = this.todaySalesActual();
        const now = new Date();
        const hoursElapsed = now.getHours() + now.getMinutes() / 60;
        if (hoursElapsed < 0.5) return null; // too early, no meaningful data

        // ── Strategy A: LY same day × velocity multiplier ─────────────────────
        const lyData = this.lyDailyData();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (lyData && lyData.length === totalDays) {
            const lyToday = lyData[now.getDate() - 1]; // LY sales on the same calendar day
            if (lyToday > 0) {
                // Velocity multiplier from the full MTD picture
                const mtdSales = this.stats().monthlySales;
                const todayDay = now.getDate();
                const fractionalDayPart = now.getHours() / 24 + now.getMinutes() / 1440;
                let lySalesMTD = 0;
                for (let i = 0; i < todayDay - 1; i++) lySalesMTD += lyData[i];
                lySalesMTD += lyData[todayDay - 1] * fractionalDayPart;

                if (lySalesMTD > 0 && mtdSales > 0) {
                    const velocityMultiplier = mtdSales / lySalesMTD;
                    const futureLyToday = lyToday * (1 - fractionalDayPart);
                    return todaySales + (futureLyToday * velocityMultiplier);
                }
            }
        }

        // ── Strategy B: Straight-line hourly run-rate ──────────────────────────
        return (todaySales / hoursElapsed) * 24;
    });

    todayOrdersProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const todayOrders = this.todayOrdersActual();
        const todaySalesProj = this.todayProjection();
        const todaySalesAct = this.todaySalesActual();
        
        // Strategy A: Scale by the sales projection ratio
        if (todaySalesProj && todaySalesAct > 0) {
            const ratio = todaySalesProj / todaySalesAct;
            return Math.round(todayOrders * ratio);
        }
        
        // Strategy B: Straight-line hourly
        const hoursElapsed = new Date().getHours() + new Date().getMinutes() / 60;
        if (hoursElapsed < 0.5) return null;
        return Math.round((todayOrders / hoursElapsed) * 24);
    });

    todayPiecesProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const todayPieces = this.todayPiecesActual();
        const todaySalesProj = this.todayProjection();
        const todaySalesAct = this.todaySalesActual();
        
        if (todaySalesProj && todaySalesAct > 0) {
            const ratio = todaySalesProj / todaySalesAct;
            return Math.round(todayPieces * ratio);
        }
        
        const hoursElapsed = new Date().getHours() + new Date().getMinutes() / 60;
        if (hoursElapsed < 0.5) return null;
        return Math.round((todayPieces / hoursElapsed) * 24);
    });


    mtdPiecesProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const mtdPieces = this.stats().monthlyPiecesSold;
        if (mtdPieces <= 0) return null;

        const mtdSales = this.stats().monthlySales;
        const projSales = this.mtdProjection();
        if (projSales && mtdSales > 0) {
            const ratio = projSales / mtdSales;
            return Math.round(mtdPieces * ratio);
        }

        const now = new Date();
        const fractionalDay = now.getDate() - 1 + (now.getHours() / 24) + (now.getMinutes() / 1440);
        if (fractionalDay <= 0.1) return null;
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return Math.round((mtdPieces / fractionalDay) * totalDays);
    });

    mtdOrdersProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const mtdOrders = this.stats().totalOrders;
        if (mtdOrders <= 0) return null;

        const mtdSales = this.stats().monthlySales;
        const projSales = this.mtdProjection();
        if (projSales && mtdSales > 0) {
            const ratio = projSales / mtdSales;
            return Math.round(mtdOrders * ratio);
        }

        const now = new Date();
        const fractionalDay = now.getDate() - 1 + (now.getHours() / 24) + (now.getMinutes() / 1440);
        if (fractionalDay <= 0.1) return null;
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return Math.round((mtdOrders / fractionalDay) * totalDays);
    });

    /**
     * Sales Velocity Monitor — answers "Is everything OK today?"
     *
     * Compares today's cumulative sales vs. yesterday at the EXACT same hour
     * (same-hour apples-to-apples), derives a health status, a % delta, and
     * a specific actionable insight string for the operations team.
     *
     * Data sources:
     *  - allFetchedOrders (live MTD orders from Firestore)
     *  - lyDailyData      (last-year per-day totals from BigQuery)
     *
     * Status thresholds:
     *  ahead    > +10%  of yesterday same-hour pace
     *  ok       -15% to +10%
     *  warning  -35% to -15%
     *  critical < -35%
     */
    salesVelocity = computed<{
        todaySales:           number;
        todayRate:            number;   // $ per hour today
        yesterdayAtSameHour:  number;   // yesterday's total up to this hour
        yesterdayFull:        number;   // yesterday's complete day total
        yesterdayRate:        number | null;
        vsYesterdayPct:       number | null;
        vsYesterdayAbs:       number | null;
        lyToday:              number | null;
        lyTodayPartial:       number | null;
        lyRate:               number | null;
        vsLyPct:              number | null;
        hoursElapsed:         number;
        status:               'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        insight:              string;
        insightDetail:        string;
    } | null>(() => {
        // Inject reactive dependency so this re-runs on live order updates
        this.todaySalesTotalSignal();
        
        if (this.timeframe() !== 'MTD') return null;

        const now          = new Date();
        const hoursElapsed = now.getHours() + now.getMinutes() / 60;
        if (hoursElapsed < 0.5) return null; // too early in the day

        const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed'];

        const todayY = now.getFullYear();
        const todayM = now.getMonth();
        const todayD = now.getDate();

        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        const yestY = yest.getFullYear();
        const yestM = yest.getMonth();
        const yestD = yest.getDate();

        let todaySales          = 0;
        let yesterdayAtSameHour = 0;
        let yesterdayFull       = 0;

        this.allFetchedOrders.forEach(o => {
            if (NON_REVENUE.includes(o.status as string)) return;
            const d = this.getJsDate(o.createdAt);
            const isToday     = d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD;
            const isYesterday = d.getFullYear() === yestY  && d.getMonth() === yestM  && d.getDate() === yestD;

            if (isToday) {
                todaySales += o.total || 0;
            }
            if (isYesterday) {
                yesterdayFull += o.total || 0;
                // Same-hour comparison: only count yesterday orders up to the current hour/minute
                if ((d.getHours() + d.getMinutes() / 60) <= hoursElapsed) {
                    yesterdayAtSameHour += o.total || 0;
                }
            }
        });

        const todayRate     = todaySales / hoursElapsed;
        const yesterdayRate = yesterdayAtSameHour > 0 ? yesterdayAtSameHour / hoursElapsed : null;

        // LY same calendar day total
        const lyData = this.lyDailyData();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const lyToday = (lyData && lyData.length === totalDays) ? lyData[todayD - 1] : null;

        // % deltas
        const vsYesterdayPct = yesterdayAtSameHour > 0
            ? ((todaySales - yesterdayAtSameHour) / yesterdayAtSameHour) * 100
            : null;
        const vsYesterdayAbs = yesterdayAtSameHour > 0
            ? todaySales - yesterdayAtSameHour
            : null;
            
        // Compare today's partial sales to the same proportion of LY's full day
        const lyTodayPartial = lyToday ? lyToday * (hoursElapsed / 24) : null;
        const lyRate = lyToday ? lyToday / 24 : null;
        const vsLyPct = lyTodayPartial && lyTodayPartial > 0
            ? ((todaySales - lyTodayPartial) / lyTodayPartial) * 100
            : null;

        // Health status
        let status: 'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        if (vsYesterdayPct === null)      status = 'no-data';
        else if (vsYesterdayPct >= 10)    status = 'ahead';
        else if (vsYesterdayPct >= -15)   status = 'ok';
        else if (vsYesterdayPct >= -35)   status = 'warning';
        else                              status = 'critical';

        // Primary insight
        const fmtCur = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        let insight = '';
        let insightDetail = '';

        if (status === 'no-data') {
            insight = 'Sin datos de ayer para comparar.';
            insightDetail = 'Asegúrate de que los pedidos de ayer estén sincronizados.';
        } else if (status === 'ahead') {
            insight = `✅ Ritmo superior al de ayer — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por encima`;
            insightDetail = `Ayer a las ${now.getHours()}h llevabas ${fmtCur(yesterdayAtSameHour)}. Hoy: ${fmtCur(todaySales)}.`;
        } else if (status === 'ok') {
            insight = `🟢 Ritmo normal — en línea con ayer`;
            insightDetail = `Diferencia de ${fmtCur(Math.abs(vsYesterdayAbs!))} vs ayer a la misma hora. Ritmo: ${fmtCur(Math.round(todayRate))}/hr.`;
        } else if (status === 'warning') {
            insight = `⚠️ Ritmo lento — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por debajo de ayer`;
            insightDetail = `Ayer a esta hora: ${fmtCur(yesterdayAtSameHour)} → hoy: ${fmtCur(todaySales)}. Faltan ${fmtCur(Math.abs(vsYesterdayAbs!))} para igualar el ritmo.`;
        } else {
            insight = `🚨 Ritmo crítico — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por debajo de ayer`;
            insightDetail = `Ayer a esta hora cerrabas ${fmtCur(yesterdayAtSameHour)}. Hoy solo ${fmtCur(todaySales)}. Revisa canal MeLi y tienda.`;
        }

        return {
            todaySales, todayRate,
            yesterdayAtSameHour, yesterdayFull, yesterdayRate,
            vsYesterdayPct, vsYesterdayAbs,
            lyToday, lyTodayPartial, lyRate, vsLyPct,
            hoursElapsed, status, insight, insightDetail
        };
    });

    toggleProjection() {
        this.showProjection.set(!this.showProjection());
        if (this.timeframe() === 'MTD' && this.trendChart) {
            this.applyFilters();
        }
    }

    slaStats = signal<SLAStats>({
        total: 0,
        onTime: 0,
        overdue: 0,
        approaching: 0,
        complianceRate: 100
    });

    priorityStats = signal<PriorityStats>({
        standard: 0,
        express: 0,
        rush: 0
    });

    staffWorkload = signal<StaffWorkload[]>([]);
    overdueOrders = signal<Order[]>([]);
    recentOrders = signal<Order[]>([]);
    expandedOrderId = signal<string | null>(null);
    isLoading = signal(true);

    toggleOrderExpand(id: string) {
        this.expandedOrderId.set(this.expandedOrderId() === id ? null : id);
    }

    // Geographic Map Properties
    stateMetricsSignal = signal<StateMetric[]>([]);
    @ViewChild('infoWindow') infoWindow?: MapInfoWindow;
    activeStateMetric: StateMetric | null = null;
    private _maxOrders = 1; // updated in generateHeatmapData

    // Geographic Details Table
    showGeographicTable = signal(false);
    stateGeographicDetailsSignal = signal<StateGeographicDetail[]>([]);
    sortColumn = signal<'orders' | 'pieces' | 'sales'>('pieces');
    sortDirection = signal<'asc' | 'desc'>('desc');
    
    mapOptions: any = {
        center: { lat: 23.6345, lng: -102.5528 }, // Center of Mexico
        zoom: 4.8,
        // NO mapId — when mapId is present Google Maps ignores styles[].
        // We use MapMarker (not AdvancedMarker) so no mapId is needed.
        disableDefaultUI: true,
        backgroundColor: '#27272a', // zinc-800
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
            { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
            { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
            { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
            { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
            { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
            { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
            { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
            { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
        ]
    };

    /** Builds an SVG data-URL icon for MapMarker sized proportionally to order count. */
    buildMarkerIcon(metric: StateMetric): { url: string; size: number } {
        // ── Sizing ─────────────────────────────────────────────────────────────
        // Small enough that the map stays readable even with 32 states plotted.
        // Using sqrt(ratio) keeps proportional feel without ballooning big states.
        const MIN_R = 7;
        const MAX_R = 19;
        const ratio = this._maxOrders > 1 ? metric.orders / this._maxOrders : 1;
        const r     = MIN_R + (MAX_R - MIN_R) * Math.sqrt(ratio);
        // Canvas size adds 4px padding on each side for the glow halo
        const pad   = 4;
        const size  = Math.round(r * 2 + pad * 2);
        const cx    = size / 2;
        const cy    = size / 2;

        // ── Color ──────────────────────────────────────────────────────────────
        // Low → cool teal (180°), mid → green (120°), high → amber (50°)
        // Saturation/lightness bump slightly at high end for visual pop.
        const hue  = Math.round(180 - ratio * 130);
        const sat  = 75 + ratio * 15;   // 75 → 90%
        const lit  = 42 + ratio * 6;    // 42 → 48%

        // ── Opacity strategy ───────────────────────────────────────────────────
        // Semi-transparent fills let the map show through when bubbles overlap.
        // Border stays opaque so each bubble stays individually distinct.
        const fillOpacity = 0.74;

        const fontSize = Math.max(7, Math.round(r * 0.64));
        const label    = String(metric.orders);

        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`,
            `<defs>`,
            // Soft outer glow — gives depth without taking space
            `<filter id="gl" x="-50%" y="-50%" width="200%" height="200%">`,
            `<feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="b"/>`,
            `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>`,
            `</filter>`,
            // Text drop shadow for legibility on any background
            `<filter id="ts" x="-30%" y="-30%" width="160%" height="160%">`,
            `<feDropShadow dx="0" dy="0.5" stdDeviation="1.2" flood-color="rgba(0,0,0,0.9)"/>`,
            `</filter>`,
            `</defs>`,
            // Very subtle dark halo — separates bubble from map without a heavy ring
            `<circle cx="${cx}" cy="${cy}" r="${r + 1.5}"`,
            ` fill="rgba(0,0,0,0.22)"/>`,
            // Main fill — semi-transparent
            `<circle cx="${cx}" cy="${cy}" r="${r}"`,
            ` fill="hsl(${hue},${sat}%,${lit}%)"`,
            ` fill-opacity="${fillOpacity}"`,
            ` stroke="rgba(255,255,255,0.85)"`,
            ` stroke-width="1.4"`,
            ` filter="url(#gl)"/>`,
            // Count — bold, shadowed, always white
            `<text x="${cx}" y="${cy}"`,
            ` text-anchor="middle" dominant-baseline="central"`,
            ` font-size="${fontSize}" font-weight="900" fill="white"`,
            ` font-family="Inter,system-ui,sans-serif"`,
            ` filter="url(#ts)">${label}</text>`,
            `</svg>`
        ].join('');

        return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, size };
    }

    /** Opens the info window near the clicked MapMarker. */
    openInfoWindowAtMarker(marker: MapMarker, metric: StateMetric) {
        this.activeStateMetric = metric;
        if (this.infoWindow) {
            this.infoWindow.open(marker);
        }
    }

    // Chart instances
    private topProductsChart?: Chart;
    private priorityChart?: Chart;
    private trendChart?: Chart;

    /** Live Firestore subscription — unsubscribed on destroy or timeframe change. */
    private liveOrdersSub?: Subscription;

    /** ALL products unsorted — set by calculateTopProducts(). */
    private allProductsSorted = signal<{ name: string; units: number; revenue: number }[]>([]);
    topProductsMode = signal<'units' | 'amount'>('units');

    /** Top 5 products re-computed whenever mode or underlying data changes. */
    topProducts = computed(() => {
        const mode = this.topProductsMode();
        return [...this.allProductsSorted()]
            .sort((a, b) => mode === 'amount' ? b.revenue - a.revenue : b.units - a.units)
            .slice(0, 5);
    });

    setTopProductsMode(mode: 'units' | 'amount') {
        if (this.topProductsMode() === mode) return;
        this.topProductsMode.set(mode);
        // topProducts computed re-runs automatically; just sync the chart
        if (this.topProductsChart) this.updateTopProductsChart();
    }


    ngOnInit() {
        this.loadDashboardData();
        this.loadEuromindReport();
    }

    async loadEuromindReport() {
        try {
            const q = query(
                collection(this.firestore, 'euromind_reports'), 
                where('type', '==', 'weekly'), 
                orderBy('createdAt', 'desc'), 
                limit(1)
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
                this.euromindReport.set(snap.docs[0].data());
            }
        } catch (e) {
            console.error('Error loading euromind report:', e);
        }
    }

    ngAfterViewInit() {
        // Initialization moved to after data loads to prevent race conditions
        // with the @if (!isLoading()) block in the template.
    }

    ngOnDestroy() {
        // Cleanup charts
        this.topProductsChart?.destroy();
        this.priorityChart?.destroy();
        this.trendChart?.destroy();
        // Unsubscribe from live Firestore stream
        this.liveOrdersSub?.unsubscribe();
    }

    private getJsDate(timestamp: any): Date {
        if (!timestamp) return new Date();
        return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    }

    private getTimestampMillis(timestamp: any): number {
        if (!timestamp) return Date.now();
        // Firestore Timestamp object
        if (timestamp && typeof timestamp.toMillis === 'function') return timestamp.toMillis();
        // Firestore server-timestamp sentinels are plain objects without toMillis — return now
        if (timestamp && typeof timestamp === 'object' && !timestamp._seconds && !timestamp.seconds) return Date.now();
        // Date object
        if (timestamp instanceof Date) return isNaN(timestamp.getTime()) ? Date.now() : timestamp.getTime();
        // Numeric millis
        if (typeof timestamp === 'number') return isNaN(timestamp) ? Date.now() : timestamp;
        // String ISO — parse safely
        const parsed = new Date(timestamp).getTime();
        return isNaN(parsed) ? Date.now() : parsed;
    }

    setTimeframe(tf: 'MTD' | 'PM' | 'YTD') {
        if (this.timeframe() !== tf) {
            this.timeframe.set(tf);
            this.loadDashboardData();
        }
    }

    setChannelFilter(filter: 'ALL' | 'mercadolibre' | 'web' | 'pos' | 'amazon' | 'on_behalf') {
        if (this.channelFilter() !== filter) {
            this.channelFilter.set(filter);
            this.applyFilters();
        }
    }

    loadDashboardData() {
        this.isLoading.set(true);

        const today = new Date();
        let endDate = new Date(today);
        endDate.setHours(23, 59, 59, 999);

        let startDate: Date;
        if (this.timeframe() === 'MTD') {
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        } else if (this.timeframe() === 'PM') {
            // Full previous calendar month
            const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
            const prevYear  = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
            startDate = new Date(prevYear, prevMonth, 1);
            endDate = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
        } else {
            startDate = new Date(today.getFullYear(), 0, 1);
        }

        // Reset LY daily overlay
        this.lyDailyData.set([]);
        this.lyUsingApprox.set(false);

        // Kick off LY reads in parallel (non-blocking)
        this.loadLyComparison();
        if (this.timeframe() === 'MTD') {
            this.loadLyDailyForMTD();
        }

        // Cancel any previous live subscription before opening a new one.
        this.liveOrdersSub?.unsubscribe();

        // Real-time Firestore stream — auto-updates when MeLi webhook orders land.
        // NOTE: no debounceTime here — we need isLoading to turn false quickly so
        // the chart canvas becomes visible BEFORE Chart.js initializes. Debouncing
        // was causing Chart.js to render on a 0-height invisible canvas.
        this.liveOrdersSub = this.orderService
            .getOrdersByDateRangeLive(startDate, endDate)
            .subscribe({
                next: (orders) => {
                    this.allFetchedOrders = orders;
                    this.isLoading.set(false);   // Make canvas visible FIRST
                    this.applyFilters();          // Then schedule chart render
                },
                error: (error: any) => {
                    console.error('Error loading dashboard data:', error);
                    this.toast.error(this.translate.instant('OPERATIONS.DASHBOARD.ERROR_LOADING'));
                    this.isLoading.set(false);
                }
            });
    }

    /**
     * Fetch last year's equivalent period from monthly_stats.
     *
     * MTD  → 1 getDoc  (last year same month)
     * YTD  → up to 12 parallel getDoc calls (Jan through current month of last year), summed
     *
     * Never throws — graceful degradation to null.
     */
    /**
     * Fetch last year's equivalent period using BigQuery.
     */
    private async loadLyComparison(): Promise<void> {
        try {
            const now = new Date();
            let fromDateStr = '';
            let toDateStr = '';
            
            if (this.timeframe() === 'MTD') {
                fromDateStr = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                toDateStr = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            } else if (this.timeframe() === 'PM') {
                const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
                const lyYear = now.getMonth() === 0 ? now.getFullYear() - 2 : now.getFullYear() - 1;
                fromDateStr = `${lyYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
                const lastDay = new Date(lyYear, prevMonth + 1, 0).getDate();
                toDateStr = `${lyYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            } else {
                fromDateStr = `${now.getFullYear() - 1}-01-01`;
                toDateStr = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }

            const kpis = await this.bqService.querySummaryKpisBetween(fromDateStr, toDateStr);
            
            let sales = 0, orders = 0, pieces = 0, hasAny = false;
            kpis.forEach((k: any) => {
                sales += k.revenue || 0;
                orders += k.orders || 0;
                pieces += k.units || 0;
                hasAny = true;
            });

            this.lyPeriodStats.set(hasAny ? { sales, orders, pieces } : null);
            this.lyUsingApprox.set(false);
        } catch (err) {
            console.warn('[Dashboard] LY comparison read failed (non-critical):', err);
            this.lyPeriodStats.set(null);
            this.lyUsingApprox.set(false);
        }
    }

    /**
     * Load per-day LY sales for MTD overlay line on trend chart.
     */
    private async loadLyDailyForMTD(): Promise<void> {
        try {
            const now = new Date();
            const lyYear = now.getFullYear() - 1;
            const lyMon = String(now.getMonth() + 1).padStart(2, '0');
            const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

            const fromDateStr = `${lyYear}-${lyMon}-01`;
            const toDateStr = `${lyYear}-${lyMon}-${String(totalDaysInMonth).padStart(2, '0')}`;

            const trend: any[] = await (this.bqService as any).queryDailyTrendBetween(fromDateStr, toDateStr);
            const dailySales: number[] = new Array(totalDaysInMonth).fill(0);
            
            let hasAny = false;
            trend.forEach((t: any) => {
                const day = parseInt(t.order_date.split('-')[2], 10);
                if (day >= 1 && day <= totalDaysInMonth) {
                    dailySales[day - 1] += t.revenue || 0;
                    hasAny = true;
                }
            });

            if (hasAny) {
                this.lyDailyData.set(dailySales);
                // The historical data has arrived. Redraw the entire chart so 
                // the projection curve recalculates based on this new data!
                if (this.trendChart) this.applyFilters();
            }
        } catch (err) {
            console.warn('[Dashboard] LY daily MTD read failed (non-critical):', err);
        }
    }

    // LY overlay natively handled inside createTrendChart()


    private chartRenderTimeout: any;

    applyFilters() {
        const filter = this.channelFilter();
        let filteredOrders = this.allFetchedOrders;
        
        if (filter !== 'ALL') {
            const targetChannel = filter === 'web' ? 'storefront' : filter;
            filteredOrders = this.allFetchedOrders.filter(o => 
                o.sourceChannel === targetChannel || (!o.sourceChannel && targetChannel === 'storefront')
            );
        }

        this.calculateStats(filteredOrders);
        this.calculateSLAStats(filteredOrders);
        this.calculatePriorityStats(filteredOrders);
        this.calculateStaffWorkload(filteredOrders);
        this.calculateOverdueOrders(filteredOrders);
        this.calculateTopProducts(filteredOrders);
        this.generateHeatmapData(filteredOrders);
        this.calculateChannelBreakdown(this.allFetchedOrders); // always on ALL

        this.recentOrders.set(filteredOrders.slice(0, 5));

        if (this.chartRenderTimeout) {
            clearTimeout(this.chartRenderTimeout);
        }

        // requestAnimationFrame ensures the DOM has been painted (isLoading = false
        // → invisible class removed) before Chart.js reads canvas dimensions.
        requestAnimationFrame(() => {
            this.chartRenderTimeout = setTimeout(() => {
                console.log('[Dashboard] Chart render tick — trendChart canvas:', !!document.getElementById('trendChart'));
                try { if (document.getElementById('topProductsChart')) this.createTopProductsChart(); } catch(e) { console.error('[Dashboard] topProductsChart error:', e); }
                try { if (document.getElementById('priorityChart'))    this.createPriorityChart(); }    catch(e) { console.error('[Dashboard] priorityChart error:', e); }
                try { if (document.getElementById('trendChart'))       this.createTrendChart(filteredOrders); } catch(e) { console.error('[Dashboard] trendChart error:', e); }
            }, 100);
        });
    }



    /**
     * Build per-channel stats from ALL fetched orders.
     * Includes MeLi-specific sub-segments (Premium/Classic/Full/Merchant).
     */
    calculateChannelBreakdown(orders: Order[]) {
        const CHANNELS = [
            { channel: 'mercadolibre', label: 'MercadoLibre', icon: 'shopping-cart', color: '#ffe600' },
            { channel: 'storefront',   label: 'Tienda Web',    icon: 'globe',         color: '#6366f1' },
            { channel: 'pos',          label: 'POS / Mostrador', icon: 'credit-card', color: '#10b981' },
            { channel: 'amazon',       label: 'Amazon',        icon: 'package',       color: '#f59e0b' },
            { channel: 'on_behalf',    label: 'Venta Asistida',icon: 'briefcase',     color: '#ec4899' },
        ];

        const breakdown = CHANNELS.map(ch => {
            const chOrders = orders.filter(o =>
                (o.sourceChannel ?? 'storefront') === ch.channel ||
                // legacy: orders without sourceChannel default to storefront
                (!o.sourceChannel && ch.channel === 'storefront')
            );

            // GHOST_STATUSES: not real committed orders — excluded from both count AND revenue
            const GHOST_STATUSES = ['payment_failed', 'pending_payment'];
            const countableChOrders = chOrders.filter(o => !GHOST_STATUSES.includes(o.status as string));

            // EXCLUDED_FROM_REVENUE: real orders but money not confirmed/retained yet
            const EXCLUDED_FROM_REVENUE = ['cancelled', 'refunded', 'returned', 'refund_pending'];
            const revenue = countableChOrders
                .filter(o => !EXCLUDED_FROM_REVENUE.includes(o.status as string))
                .reduce((s, o) => s + (o.total ?? 0), 0);

            const pending = countableChOrders.filter(o => o.status === 'pending').length;

            // MeLi-specific sub-segment counts
            // MeLi 2×2 orthogonal segments: fulfillment mode × listing tier
            // A is "Meli Full" when fulfillmentType === 'platform' (meliShipMode === 'fulfillment')
            // A is "Merchant" when fulfillmentType === 'merchant' or unset (legacy)
            // B is 'premium' | 'classic' | 'free' from meliListingType
            const isMeli = ch.channel === 'mercadolibre';
            const isFull     = (o: Order) => o.fulfillmentType === 'platform';
            const isMerchant = (o: Order) => o.fulfillmentType !== 'platform'; // 'merchant' or undefined (legacy defaults to merchant)
            const listingType = (o: Order) => (o as any).meliListingType as 'premium' | 'classic' | 'free' | undefined;

            const meliFullClassic     = isMeli ? chOrders.filter(o => isFull(o)     && listingType(o) !== 'premium').length : undefined;
            const meliFullPremium     = isMeli ? chOrders.filter(o => isFull(o)     && listingType(o) === 'premium').length : undefined;
            const meliMerchantClassic = isMeli ? chOrders.filter(o => isMerchant(o) && listingType(o) !== 'premium').length : undefined;
            const meliMerchantPremium = isMeli ? chOrders.filter(o => isMerchant(o) && listingType(o) === 'premium').length : undefined;


            return {
                ...ch,
                orders:  countableChOrders.length,  // only real committed orders
                revenue,
                pending,
                meliFullClassic,
                meliFullPremium,
                meliMerchantClassic,
                meliMerchantPremium,
            };

        }).filter(ch => ch.orders > 0); // hide channels with zero real activity

        this.channelBreakdown.set(breakdown);
    }


    toggleGeographicTable() {
        this.showGeographicTable.update(v => !v);
    }

    sortGeographicTable(column: 'orders' | 'pieces' | 'sales') {
        if (this.sortColumn() === column) {
            this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortColumn.set(column);
            this.sortDirection.set('desc');
        }
        
        this.applySorting();
    }

    private applySorting() {
        const column = this.sortColumn();
        const direction = this.sortDirection() === 'asc' ? 1 : -1;
        
        this.stateGeographicDetailsSignal.update(states => {
            return [...states].sort((a, b) => {
                const valA = a[column];
                const valB = b[column];
                return (valA - valB) * direction;
            });
        });
    }

    toggleStateRow(stateName: string) {
        this.stateGeographicDetailsSignal.update(states => {
            return states.map(s => {
                if (s.state === stateName) {
                    return { ...s, isExpanded: !s.isExpanded };
                }
                return s;
            });
        });
    }

    private generateHeatmapData(orders: Order[]) {
        const stateCounts: Record<string, { pieces: number, orders: number, sales: number }> = {};
        const stateHierarchies: Record<string, StateGeographicDetail> = {};

        // MeLi returns many variant spellings for state names.
        // This alias map normalizes them all to the keys used in MEXICO_STATES_COORDS.
        const STATE_ALIASES: Record<string, string> = {
            'CIUDAD DE MEXICO': 'CIUDAD DE MEXICO',
            'CDMX': 'CIUDAD DE MEXICO',
            'DISTRITO FEDERAL': 'CIUDAD DE MEXICO',
            'DF': 'CIUDAD DE MEXICO',
            'ESTADO DE MEXICO': 'ESTADO DE MEXICO',
            'MEX': 'ESTADO DE MEXICO',
            'MEXICO': 'ESTADO DE MEXICO',
            'MICHOACAN DE OCAMPO': 'MICHOACAN',
            'MICHOACAN': 'MICHOACAN',
            'MICHOCAN': 'MICHOACAN',
            'COAHUILA DE ZARAGOZA': 'COAHUILA',
            'VERACRUZ DE IGNACIO DE LA LLAVE': 'VERACRUZ',
            'NUEVO LEON': 'NUEVO LEON',
            'NL': 'NUEVO LEON',
            'QUERETARO DE ARTEAGA': 'QUERETARO',
            'BAJA CALIFORNIA NORTE': 'BAJA CALIFORNIA',
            'BC': 'BAJA CALIFORNIA',
            'BCS': 'BAJA CALIFORNIA SUR',
            'SAN LUIS POTOSI': 'SAN LUIS POTOSI',
            'SLP': 'SAN LUIS POTOSI',
        };

        let geoSkipped = 0;
        let geoMapped  = 0;

        orders.forEach(o => {
            // Skip ghost orders: payment_failed (card rejected) and pending_payment (checkout abandoned)
            if (['cancelled', 'returned', 'refunded', 'payment_failed', 'pending_payment'].includes(o.status as string)) return;
            
            const state = o.shippingAddress?.state;
            if (!state) { geoSkipped++; return; }
            
            // Normalize: strip accents, uppercase, trim
            const raw = state.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            // Resolve alias first, then try the coord map directly
            const normalizedState = STATE_ALIASES[raw] ?? raw;
            const coords = MEXICO_STATES_COORDS[normalizedState]
                        ?? MEXICO_STATES_COORDS[normalizedState.replace(' DE OCAMPO', '').replace(' DE ZARAGOZA', '')];
            
            if (coords) {
                geoMapped++;
                const totalPieces = (o.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
                const salesValue = o.total || 0;
                
                if (!stateCounts[normalizedState]) {
                    stateCounts[normalizedState] = { pieces: 0, orders: 0, sales: 0 };
                }
                
                stateCounts[normalizedState].pieces += totalPieces;
                stateCounts[normalizedState].orders += 1;
                stateCounts[normalizedState].sales += salesValue;
                
                // Granular details for the nested expandable table
                const zip = o.shippingAddress?.zipCode || 'N/A';
                const city = o.shippingAddress?.city || 'N/A';
                
                // Initialize State Header if it doesn't exist
                if (!stateHierarchies[normalizedState]) {
                    stateHierarchies[normalizedState] = {
                        state: normalizedState,
                        orders: 0,
                        pieces: 0,
                        sales: 0,
                        isExpanded: false,
                        cities: []
                    };
                }
                
                // Update State Aggregates
                stateHierarchies[normalizedState].pieces += totalPieces;
                stateHierarchies[normalizedState].orders += 1;
                stateHierarchies[normalizedState].sales += salesValue;

                // Update or Initialize City within the State
                let cityEntry = stateHierarchies[normalizedState].cities.find(c => c.city === city && c.zipCode === zip);
                if (!cityEntry) {
                    cityEntry = {
                        city: city,
                        zipCode: zip,
                        orders: 0,
                        pieces: 0,
                        sales: 0
                    };
                    stateHierarchies[normalizedState].cities.push(cityEntry);
                }

                cityEntry.pieces += totalPieces;
                cityEntry.orders += 1;
                cityEntry.sales += salesValue;
            }
        });

        console.log(`[GeoMap] Orders mapped: ${geoMapped} | Skipped (no state): ${geoSkipped}`);

        // Build state metrics for AdvancedMarker bubbles
        const stateMetrics: StateMetric[] = [];
        Object.keys(stateCounts).forEach(state => {
            const coords = MEXICO_STATES_COORDS[state] || MEXICO_STATES_COORDS[state.replace(' DE OCAMPO', '').replace(' DE ZARAGOZA', '')];
            stateMetrics.push({
                name: state,
                lat: coords.lat,
                lng: coords.lng,
                orders: stateCounts[state].orders,
                pieces: stateCounts[state].pieces,
                sales: stateCounts[state].sales
            });
        });

        // Track max for proportional bubble sizing
        this._maxOrders = stateMetrics.reduce((m, s) => Math.max(m, s.orders), 1);

        // Pre-build ALL marker SVG data URLs exactly once here.
        // CRITICAL: do NOT call buildMarkerIcon() from the template — Angular CD would
        // regenerate URLs on every cycle, causing redundant DOM updates.
        stateMetrics.forEach(m => {
            const icon = this.buildMarkerIcon(m);
            m.markerIcon = icon.url;
            m.markerSize = icon.size;
        });

        this.stateMetricsSignal.set(stateMetrics);
        
        // Convert to array and sort nested cities inside each state
        const stateArray = Object.values(stateHierarchies).map(stateObj => {
            // Sort nested cities by pieces sold descending always
            stateObj.cities.sort((a, b) => b.pieces - a.pieces);
            return stateObj;
        });

        this.stateGeographicDetailsSignal.set(stateArray);
        this.applySorting(); // Apply initial sorting

    }

    calculateStats(orders: Order[]) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let sales = 0;
        let piecesSold = 0;
        let pendingOrders = 0;
        let processingOrders = 0;

        // GHOST STATUSES — these are NOT real committed orders:
        // - payment_failed:   MP rejected the card. No money moved. Phantom.
        // - pending_payment:  Customer opened checkout but never submitted payment.
        //                     Nothing committed — treat as abandoned cart, not an order.
        const GHOST_STATUSES = ['payment_failed', 'pending_payment'];
        const countableOrders = orders.filter(o => !GHOST_STATUSES.includes(o.status as string));
        let totalOrders = countableOrders.length;

        countableOrders.forEach(o => {
            if (o.status === 'pending') pendingOrders++;
            if (o.status === 'processing') processingOrders++;

            // Exclude cancelled, refunded, returned, and pending_payment from revenue.
            // refund_pending = customer requested cancel — money not yet returned, but
            // we exclude it to avoid double-counting when refund later completes.
            const EXCLUDED_FROM_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending'];
            if (!EXCLUDED_FROM_REVENUE.includes(o.status as string)) {
                sales += o.total || 0;
                if (o.items && Array.isArray(o.items)) {
                    o.items.forEach(item => {
                        piecesSold += item.quantity || 0;
                    });
                }
            }
        });

        const stats: DashboardStats = {
            totalOrders,
            pendingOrders,
            processingOrders,
            shippedToday: orders.filter(o => {
                if (o.status !== 'shipped') return false;
                const orderDate = this.getJsDate(o.updatedAt);
                orderDate.setHours(0, 0, 0, 0);
                return orderDate.getTime() === today.getTime();
            }).length,
            monthlySales: sales, // Kept property name for interface stability, represents active timeframe
            monthlyPiecesSold: piecesSold
        };

        this.stats.set(stats);

        // Calculate today's actual totals — feeds todaySalesActual / todayOrdersActual / todayPiecesActual signals.
        const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed'];
        
        let todaySalesSum = 0;
        let todayOrdersCount = 0;
        let todayPiecesSum = 0;
        
        orders.forEach(o => {
            if (NON_REVENUE.includes(o.status as string)) return;
            const d = this.getJsDate(o.createdAt);
            if (d.getFullYear() === today.getFullYear() && 
                d.getMonth() === today.getMonth() && 
                d.getDate() === today.getDate()) {
                
                todaySalesSum += o.total || 0;
                todayOrdersCount++;
                if (o.items && Array.isArray(o.items)) {
                    o.items.forEach(item => {
                        todayPiecesSum += item.quantity || 0;
                    });
                }
            }
        });
        
        this.todaySalesTotalSignal.set(todaySalesSum);
        this.todayOrdersCountSignal.set(todayOrdersCount);
        this.todayPiecesCountSignal.set(todayPiecesSum);

        // Populate specific widget stats respecting timeframe
        // These are now called directly from applyFilters
        // this.calculateSLAStats(orders);
        // this.calculatePriorityStats(orders);
        // this.calculateStaffWorkload(orders);
        // this.calculateOverdueOrders(orders);
    }

    getStatusBadgeClass(status: string): string {
        const classes: Record<string, string> = {
            // Legacy order statuses
            'pending':         'status-pending',
            'processing':      'status-processing',
            'shipped':         'status-shipped',
            'delivered':       'status-delivered',
            'cancelled':       'status-cancelled',
            'refunded':        'status-refunded',
            'returned':        'status-returned',
            // Web storefront statuses (MercadoPago checkout)
            'pending_payment': 'status-pending',
            'paid':            'status-delivered',
            'payment_failed':  'status-cancelled',
            // Cancellation / refund flow
            'refund_pending':  'status-returned',
        };
        return classes[status] || 'status-pending';
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = this.getJsDate(date);
        return d.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    async calculateSLAStats(orders: Order[]) {
        try {
            // ── Priority overrides (only for non-MeLi orders) ────────────────────
            let startDate = new Date();
            let endDate = new Date();
            if (orders.length > 0) {
                // Use reduce instead of Math.min/max(...spread) to avoid
                // call-stack overflow when there are hundreds of orders
                const timestamps = orders.map(o => this.getTimestampMillis(o.createdAt || o.updatedAt));
                const minMs = timestamps.reduce((a, b) => a < b ? a : b, timestamps[0]);
                const maxMs = timestamps.reduce((a, b) => a > b ? a : b, timestamps[0]);
                startDate = new Date(minMs);
                endDate   = new Date(maxMs);
            } else {
                if (this.timeframe() === 'MTD') {
                    startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
                } else if (this.timeframe() === 'PM') {
                    const pmMonth = startDate.getMonth() === 0 ? 11 : startDate.getMonth() - 1;
                    const pmYear = startDate.getMonth() === 0 ? startDate.getFullYear() - 1 : startDate.getFullYear();
                    startDate = new Date(pmYear, pmMonth, 1);
                } else {
                    startDate = new Date(startDate.getFullYear(), 0, 1);
                }
            }

            let priorityOverridesMap = new Map<string, number>();
            try {
                priorityOverridesMap = await this.priorityService.getSLAOverridesMap(startDate, endDate);
            } catch (overridesError: any) {
                // Non-critical — SLA overrides are optional enrichment data.
                // Log once quietly; don't re-throw so the rest of the SLA calc proceeds.
                console.warn('[SLA] Could not load priority overrides — continuing without them.', overridesError?.message ?? overridesError);
            }

            const now = Date.now();
            const sixHoursFromNow = now + (6 * 60 * 60 * 1000);

            let onTime = 0;
            let overdue = 0;
            let approaching = 0;
            let validOrdersForSLA = 0;

            // Diagnostic counters
            let dbg = { meli_platform: 0, meli_delayed: 0, meli_completed_ok: 0, meli_active_nativeSla: 0, meli_active_no_sla: 0, nonMeli: 0, skipped_cancelled: 0 };

            orders.forEach(order => {
                // ── Skip terminal non-actionable statuses ────────────────────────
                if (['cancelled', 'refunded', 'returned'].includes(order.status)) {
                    dbg.skipped_cancelled++;
                    return;
                }

                const isMeli = order.sourceChannel === 'mercadolibre';
                // @ts-ignore
                const nativeSla: any = order.nativeSla ?? null;
                // @ts-ignore
                const meliDelayed: boolean = order.meliDelayed === true;
                const isCompleted = ['shipped', 'delivered'].includes(order.status);

                // ── 1. MeLi Full / Platform-fulfilled — always on time (MeLi handles logistics) ──
                if (order.fulfillmentType === 'platform') {
                    dbg.meli_platform++;
                    validOrdersForSLA++;
                    onTime++;
                    return;
                }

                // ── 2. MeLi orders ───────────────────────────────────────────────
                if (isMeli) {
                    // MeLi's delay flag is THE authoritative signal — only trust for active orders.
                    // Completed orders with delay flag that still shipped are edge cases; skip flag.
                    if (meliDelayed && !isCompleted) {
                        dbg.meli_delayed++;
                        validOrdersForSLA++;
                        overdue++;
                        return;
                    }

                    // Completed MeLi orders:
                    // If MeLi didn't flag it as delayed → it shipped on time by MeLi's own system.
                    // DO NOT attempt timestamp comparison: nativeSla is the DISPATCH DEADLINE (past date
                    // for completed orders), and shippedAt is frequently null even when shipped.
                    // MeLi is the SLA authority — trust their system.
                    if (isCompleted) {
                        dbg.meli_completed_ok++;
                        validOrdersForSLA++;
                        onTime++;
                        return;
                    }

                    // Active MeLi orders (pending / processing):
                    // Use nativeSla ONLY IF it's a FUTURE deadline (i.e., dispatch window is still open).
                    // If nativeSla is in the past but MeLi hasn't flagged meliDelayed → MeLi considers
                    // it in-progress, not overdue. Exclude from scoring to prevent false positives.
                    if (nativeSla) {
                        const slaMs = this.getTimestampMillis(nativeSla);
                        const isFutureDeadline = slaMs > (now - 2 * 60 * 60 * 1000); // allow 2h grace
                        if (isFutureDeadline) {
                            dbg.meli_active_nativeSla++;
                            validOrdersForSLA++;
                            if (now > slaMs) {
                                overdue++;
                            } else if (slaMs <= sixHoursFromNow) {
                                approaching++;
                                onTime++;
                            } else {
                                onTime++;
                            }
                        } else {
                            // nativeSla is old/past but MeLi hasn't flagged it → exclude from scoring
                            // MeLi would have set meliDelayed if it was truly late
                            dbg.meli_active_no_sla++;
                        }
                        return;
                    }

                    // Active MeLi with no nativeSla → no reliable deadline, exclude from scoring
                    dbg.meli_active_no_sla++;
                    return;
                }

                // ── 3. Non-MeLi orders ───────────────────────────────────────────
                dbg.nonMeli++;
                let slaDeadlineMs: number | null = null;

                // Manual staff override takes precedence
                if (order.id && priorityOverridesMap.has(order.id)) {
                    slaDeadlineMs = priorityOverridesMap.get(order.id)!;
                } else {
                    // Completed non-MeLi: check if shipped within SLA window
                    const defaultSLAHours = order.priorityLevel === 'rush' ? 24 : (order.priorityLevel === 'express' ? 48 : 72);
                    const createdAt = this.getTimestampMillis(order.createdAt);
                    slaDeadlineMs = createdAt + (defaultSLAHours * 60 * 60 * 1000);
                }

                if (isCompleted) {
                    // For completed non-MeLi: check updatedAt as proxy for ship time
                    const completionTime = this.getTimestampMillis((order as any).shippedAt || order.updatedAt || order.createdAt);
                    validOrdersForSLA++;
                    if (completionTime > slaDeadlineMs!) {
                        overdue++;
                    } else {
                        onTime++;
                    }
                    return;
                }

                // Active non-MeLi
                validOrdersForSLA++;
                if (now > slaDeadlineMs!) {
                    overdue++;
                } else if (slaDeadlineMs! <= sixHoursFromNow) {
                    approaching++;
                    onTime++;
                } else {
                    onTime++;
                }
            });

            const complianceRate = validOrdersForSLA > 0
                ? ((onTime + approaching) / validOrdersForSLA) * 100
                : 100;

            console.log(`[SLA] Total=${orders.length} Valid=${validOrdersForSLA} | onTime=${onTime} approaching=${approaching} overdue=${overdue} | compliance=${Math.round(complianceRate)}%`);
            console.log(`[SLA] Breakdown: platform=${dbg.meli_platform} meliDelayed=${dbg.meli_delayed} meliCompletedOK=${dbg.meli_completed_ok} meliActiveWithSLA=${dbg.meli_active_nativeSla} meliNoSLA=${dbg.meli_active_no_sla} nonMeli=${dbg.nonMeli} cancelled=${dbg.skipped_cancelled}`);

            this.slaStats.set({
                total: validOrdersForSLA,
                onTime,
                overdue,
                approaching,
                complianceRate: Math.round(complianceRate * 100) / 100
            });

            if (this.topProductsChart) {
                this.updateTopProductsChart();
            }

        } catch (error) {
            // Log to console for devtools visibility but do NOT toast:
            // this function runs on every Firestore real-time update, so a toast here
            // would spam the UI every time any order document changes.
            console.error('[SLA] Error calculating SLA stats (non-fatal):', error);
        }
    }


    calculatePriorityStats(orders: Order[]) {
        try {
            const stats: PriorityStats = {
                standard: orders.filter(o => o.priorityLevel === 'standard').length,
                express: orders.filter(o => o.priorityLevel === 'express').length,
                rush: orders.filter(o => o.priorityLevel === 'rush').length
            };

            // If no orders have priority levels set, default all to standard
            const total = stats.standard + stats.express + stats.rush;
            if (total === 0 && orders.length > 0) {
                stats.standard = orders.length;
            }

            this.priorityStats.set(stats);
            // Update chart if it exists
            if (this.priorityChart) {
                this.updatePriorityChart();
            }
        } catch (error) {
            console.error('Error calculating priority stats:', error);
        }
    }

    calculateStaffWorkload(orders: Order[]) {
        try {
            // Group orders by assigned staff
            const workloadMap = new Map<string, StaffWorkload>();

            orders.forEach(order => {
                if (order.assignedToName) {
                    const existing = workloadMap.get(order.assignedToName) || {
                        staffName: order.assignedToName,
                        assignedOrders: 0,
                        inProgress: 0,
                        completed: 0
                    };

                    existing.assignedOrders++;
                    if (order.status === 'processing') existing.inProgress++;
                    if (order.status === 'shipped' || order.status === 'delivered') existing.completed++;

                    workloadMap.set(order.assignedToName, existing);
                }
            });

            this.staffWorkload.set(Array.from(workloadMap.values()));
        } catch (error) {
            console.error('Error calculating staff workload:', error);
            this.toast.error('Error calculating staff metrics');
        }
    }

    calculateOverdueOrders(orders: Order[]) {
        try {
            const now = Date.now();
            const overdue = orders.filter(o => {
                // Completed / cancelled orders are never "actively overdue"
                if (['shipped', 'delivered', 'cancelled', 'returned', 'refunded'].includes(o.status)) return false;

                const isMeli = o.sourceChannel === 'mercadolibre';
                // @ts-ignore
                const meliDelayed: boolean = o.meliDelayed === true;
                // @ts-ignore
                const nativeSla: any = o.nativeSla ?? null;

                // MeLi's own delay flag — most authoritative signal
                if (meliDelayed) return true;

                // Has a real dispatch deadline from MeLi
                if (nativeSla) {
                    return now > this.getTimestampMillis(nativeSla);
                }

                // MeLi order with no nativeSla and no delay flag → NOT overdue
                // (we have no reliable deadline; MeLi is the SLA authority)
                if (isMeli) return false;

                // Non-MeLi active order: use 72h calendar fallback
                const defaultSLAHours = o.priorityLevel === 'rush' ? 24 : (o.priorityLevel === 'express' ? 48 : 72);
                const createdAt = this.getTimestampMillis(o.createdAt);
                return now > createdAt + (defaultSLAHours * 60 * 60 * 1000);
            });
            this.overdueOrders.set(overdue.slice(0, 5));
        } catch (error) {
            console.error('Error calculating overdue orders:', error);
        }
    }

    getSLAComplianceColor(): string {
        const rate = this.slaStats().complianceRate;
        if (rate >= 90) return '#28a745';
        if (rate >= 75) return '#ffc107';
        return '#dc3545';
    }

    getPriorityColor(priority: 'standard' | 'express' | 'rush'): string {
        switch (priority) {
            case 'standard': return '#667eea';
            case 'express': return '#f5576c';
            case 'rush': return '#fa709a';
            default: return '#6c757d';
        }
    }

    calculateTopProducts(orders: Order[]) {
        const productMap = new Map<string, { units: number; revenue: number }>();

        orders.forEach(order => {
            // Skip ghost orders: payment_failed (card rejected) and pending_payment (checkout abandoned)
            if (['cancelled', 'refunded', 'returned', 'payment_failed', 'pending_payment'].includes(order.status as string)) return;
            (order.items || []).forEach((item: any) => {
                const key = item.productName || item.name || item.sku || 'Producto sin nombre';
                const units = item.quantity || 1;
                const revenue = (item.price || item.unitPrice || 0) * units;
                const existing = productMap.get(key);
                if (existing) {
                    existing.units += units;
                    existing.revenue += revenue;
                } else {
                    productMap.set(key, { units, revenue });
                }
            });
        });

        // Store ALL products; topProducts computed signal will re-sort & slice by mode
        const all = Array.from(productMap.entries())
            .map(([name, data]) => ({ name, ...data }));

        this.allProductsSorted.set(all);

        // Update chart if already rendered (topProducts() now reflects new data + current mode)
        if (this.topProductsChart) {
            this.updateTopProductsChart();
        }
    }

    // Chart creation methods
    private createTopProductsChart() {
        const canvas = document.getElementById('topProductsChart') as HTMLCanvasElement;
        if (!canvas) return;

        if (this.topProductsChart) {
            this.topProductsChart.destroy();
            this.topProductsChart = undefined;
        }

        for (const id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'topProductsChart') {
                instance.destroy();
            }
        }

        const products = this.topProducts();
        if (products.length === 0) return;

        // Truncate long product names for readability
        const mode     = this.topProductsMode();
        const isAmount = mode === 'amount';
        const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;
        const labels   = products.map(p => truncate(p.name, 28));
        const data     = isAmount ? products.map(p => p.revenue) : products.map(p => p.units);
        const palette  = [
            '#818cf8', // indigo-400
            '#a78bfa', // violet-400
            '#c084fc', // purple-400
            '#e879f9', // fuchsia-400
            '#f472b6', // pink-400
        ];

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: isAmount ? 'Ingresos (MXN)' : 'Unidades vendidas',
                    data,
                    backgroundColor: palette,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y' as const,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => {
                                const p = products[ctx.dataIndex];
                                const rev = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(p.revenue);
                                return isAmount
                                    ? ` ${rev} · ${p.units} uds`
                                    : ` ${p.units} uds · ${rev}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: '#3f3f46' },
                        ticks: {
                            color: '#a1a1aa',
                            callback: isAmount
                                ? (v: any) => '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)
                                : undefined,
                            stepSize: isAmount ? undefined : 1,
                            precision: isAmount ? undefined : 0
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: '#e4e4e7',
                            font: { size: 11 }
                        }
                    }
                }
            }
        };

        this.topProductsChart = new Chart(canvas, config);
    }

    private createPriorityChart() {
        const canvas = document.getElementById('priorityChart') as HTMLCanvasElement;
        if (!canvas) return;

        if (this.priorityChart) {
            this.priorityChart.destroy();
            this.priorityChart = undefined;
        }

        for (let id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'priorityChart') {
                instance.destroy();
            }
        }

        const stats = this.priorityStats();
        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels: [
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.STANDARD'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.EXPRESS'),
                    this.translate.instant('OPERATIONS.DASHBOARD.METRICS.RUSH')
                ],
                datasets: [{
                    label: this.translate.instant('OPERATIONS.DASHBOARD.TOTAL_ORDERS'),
                    data: [stats.standard, stats.express, stats.rush],
                    backgroundColor: [
                        '#3b82f6', // blue-500
                        '#8b5cf6', // violet-500
                        '#ec4899'  // pink-500
                    ],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#3f3f46' // border-zinc-700
                        },
                        ticks: {
                            color: '#a1a1aa' // text-zinc-400
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#a1a1aa' // text-zinc-400
                        }
                    }
                }
            }
        };

        this.priorityChart = new Chart(canvas, config);
    }

    private createTrendChart(orders: Order[]) {
        const canvas = document.getElementById('trendChart') as HTMLCanvasElement;
        console.log('[TrendChart] Called — orders:', orders.length, '| canvas found:', !!canvas);
        if (!canvas) return;

        if (this.trendChart) {
            this.trendChart.destroy();
            this.trendChart = undefined;
        }

        for (let id in Chart.instances) {
            const instance = Chart.instances[id];
            if (instance && instance.canvas && instance.canvas.id === 'trendChart') {
                instance.destroy();
            }
        }

        const today = new Date();
        const currentYear = today.getFullYear();

        const labels: string[] = [];
        let dataLength = 0;
        let getIndexFn: (d: Date) => number;

        if (this.timeframe() === 'MTD') {
            const currentMonth = today.getMonth();
            const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            dataLength = totalDaysInMonth; // Lock X-axis to full month

            for (let i = 1; i <= totalDaysInMonth; i++) {
                const date = new Date(currentYear, currentMonth, i);
                labels.push(date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }));
            }
            getIndexFn = (d: Date) => {
                if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
                    return d.getDate() - 1;
                }
                return -1; // Out of bounds
            };
        } else if (this.timeframe() === 'PM') {
            const pmMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
            const pmYear = today.getMonth() === 0 ? currentYear - 1 : currentYear;
            const daysInMonth = new Date(pmYear, pmMonth + 1, 0).getDate();
            dataLength = daysInMonth;

            for (let i = 1; i <= daysInMonth; i++) {
                const date = new Date(pmYear, pmMonth, i);
                labels.push(date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }));
            }
            getIndexFn = (d: Date) => {
                if (d.getFullYear() === pmYear && d.getMonth() === pmMonth) {
                    return d.getDate() - 1;
                }
                return -1; // Out of bounds
            };
        } else {
            // YTD Logic
            const currentMonthIndex = today.getMonth(); // 0 to today's month
            dataLength = currentMonthIndex + 1;

            for (let i = 0; i <= currentMonthIndex; i++) {
                const date = new Date(currentYear, i, 1);
                let monthStr = date.toLocaleDateString('es-MX', { month: 'short' });
                labels.push(monthStr.charAt(0).toUpperCase() + monthStr.slice(1));
            }
            getIndexFn = (d: Date) => {
                if (d.getFullYear() === currentYear) {
                    return d.getMonth();
                }
                return -1; // Out of bounds
            };
        }

        const pendingData: number[] = new Array(dataLength).fill(0);
        const processingData: number[] = new Array(dataLength).fill(0);
        const shippedData: number[] = new Array(dataLength).fill(0);
        const deliveredData: number[] = new Array(dataLength).fill(0);
        const cancelledData: number[] = new Array(dataLength).fill(0);
        const salesData: number[] = new Array(dataLength).fill(0);

        orders.forEach(o => {
            const orderDate = this.getJsDate(o.createdAt || o.updatedAt);
            const index = getIndexFn(orderDate);

            if (index >= 0 && index < dataLength) {
                // payment_failed = ghost order; skip all chart buckets
                if (o.status === 'payment_failed') { /* skip */ }
                else if (o.status === 'pending' || o.status === 'pending_payment') pendingData[index]++;
                else if (o.status === 'processing') processingData[index]++;
                else if (o.status === 'shipped') shippedData[index]++;
                else if (o.status === 'delivered' || o.status === 'paid') deliveredData[index]++;
                else if (o.status === 'cancelled' || o.status === 'refunded' || o.status === 'returned' || o.status === 'refund_pending') cancelledData[index]++;

                const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'payment_failed', 'pending_payment', 'refund_pending'];
                if (!NON_REVENUE.includes(o.status as string)) {
                    salesData[index] += (o.total || 0);
                }
            }
        });

        const safeSalesData = salesData.map(val => Number.isNaN(val) ? 0 : val);
        console.log('[TrendChart] dataLength:', dataLength, '| salesData total:', safeSalesData.reduce((a, b) => a + b, 0).toFixed(0), '| first 7 days:', safeSalesData.slice(0, 7));

        this.checkMilestones(safeSalesData);

        const datasets: any[] = [
            {
                type: 'line',
                label: 'Net Sales ($)',
                data: safeSalesData,
                borderColor: '#2dd4bf', // teal-400
                backgroundColor: '#2dd4bf',
                tension: 0.4,
                spanGaps: true,
                yAxisID: 'y1',
                borderWidth: 3,
                pointBackgroundColor: '#2dd4bf',
                pointBorderColor: '#fff',
                pointRadius: 4,
                order: 0
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.PENDING'),
                data: pendingData,
                backgroundColor: '#ffc107',
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.PROCESSING'),
                data: processingData,
                backgroundColor: '#17a2b8',
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.SHIPPED'),
                data: shippedData,
                backgroundColor: '#8b5cf6', // Purple/Violet to distinguish from Delivered
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.DELIVERED'),
                data: deliveredData,
                backgroundColor: '#10b981', // Emerald Green
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.CANCELLED_RETURNED'),
                data: cancelledData,
                backgroundColor: '#dc3545', // Danger Red
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            }
        ];

        if (this.timeframe() === 'MTD' && this.showProjection()) {
            const now = new Date();
            const todayIdx = now.getDate() - 1; // 0-based index of today
            const projData = new Array(dataLength).fill(null);
            const fractionalDayPart = (now.getHours() / 24) + (now.getMinutes() / 1440);

            // Anchor projection line at yesterday's actual complete sales so the line connects visually.
            if (todayIdx > 0 && todayIdx - 1 < dataLength) {
                projData[todayIdx - 1] = safeSalesData[todayIdx - 1];
            }

            // Set today's projection using the computed full-day projection.
            if (todayIdx < dataLength) {
                projData[todayIdx] = this.todayProjection() ?? safeSalesData[todayIdx];
            }

            const lyData = this.lyDailyData();
            if (lyData && lyData.length === dataLength) {
                // Build LY MTD up-to-and-including today's fraction
                let lySalesMTD = 0;
                for (let i = 0; i < todayIdx; i++) lySalesMTD += lyData[i];
                lySalesMTD += lyData[todayIdx] * fractionalDayPart;

                const mtdSales = this.stats().monthlySales;
                const velocityMultiplier = lySalesMTD > 0 && mtdSales > 0
                    ? mtdSales / lySalesMTD
                    : 1;

                // Fill future days (starting from tomorrow)
                for (let i = todayIdx + 1; i < dataLength; i++) {
                    projData[i] = lyData[i] * velocityMultiplier;
                }
            } else {
                // Fallback: straight-line average.
                // Elapsed = complete days + today's fraction (same denominator as mtdProjection computed)
                const mtdSales = this.stats().monthlySales;
                const elapsed = todayIdx + fractionalDayPart; // e.g. day 7 noon → 6.5
                const averageDaily = mtdSales / Math.max(elapsed, 0.1);
                for (let i = todayIdx + 1; i < dataLength; i++) {
                    projData[i] = averageDaily;
                }
            }

            datasets.push({
                type: 'line',
                label: 'Proyección Diaria ($)',
                data: projData,
                borderColor: '#f59e0b', // amber-500
                backgroundColor: 'transparent',
                borderDash: [5, 5],
                tension: 0.4,
                spanGaps: true,
                yAxisID: 'y1',
                borderWidth: 2,
                pointBackgroundColor: '#f59e0b',
                pointRadius: 3,
                order: 0
            });
        }


        const lyDataObj = this.lyDailyData();
        if (lyDataObj && lyDataObj.length === dataLength) {
            const lyYear = new Date().getFullYear() - 1;
            datasets.unshift({
                type: 'line',
                label: `Ventas ${lyYear}`,
                data: lyDataObj,
                borderColor: '#94a3b8',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 4],
                tension: 0.4,
                spanGaps: true,
                yAxisID: 'y1',
                pointRadius: 3,
                pointBackgroundColor: '#94a3b8',
                order: 0,
                // @ts-ignore
                _isLY: true
            });
        }

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.dataset.type === 'line') {
                                    label += new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(context.parsed.y || 0);
                                } else {
                                    label += context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        stacked: true,
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        min: 0,
                        suggestedMax: safeSalesData.length > 0 ? (Math.max(...safeSalesData) * 1.25) + 50 : 1000,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: function(value) {
                                return '$' + (Number(value) / 1000).toFixed(0) + 'k';
                            }
                        }
                    }
                }
            }
        };

        // ── Best-day star annotation (inline plugin — must be in top-level plugins at creation) ─
        const bestDayIdx = safeSalesData.reduce(
            (best, v, i) => v > safeSalesData[best] ? i : best, 0
        );
        const bestDayPlugin = {
            id: 'bestDayStar',
            afterDatasetsDraw(chart: any) {
                const { ctx, scales, chartArea } = chart;
                const xScale  = scales['x'];
                if (!xScale || !chartArea) return;

                const bv = safeSalesData[bestDayIdx];
                if (!bv) return;

                const x = xScale.getPixelForValue(bestDayIdx);
                const topY = chartArea.top;
                const bottomY = chartArea.bottom;

                // 1. Draw premium vertical dashed line
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([5, 5]);
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(253, 224, 71, 0.3)'; // Subtle yellow glow
                ctx.stroke();
                ctx.restore();

                ctx.save();
                
                // 2. Format text
                const fmtBv = bv >= 1_000 ? '$' + (bv / 1_000).toFixed(0) + 'K' : '$' + Math.round(bv);
                ctx.font = 'bold 10px system-ui, sans-serif';
                const textWidth = ctx.measureText(fmtBv).width;
                
                // 3. Draw pill background in the guaranteed empty space at the top (due to suggestedMax 1.25x)
                const boxWidth = textWidth + 16;
                const boxHeight = 20;
                const boxY = topY + 10;
                
                ctx.fillStyle = 'rgba(20, 20, 20, 0.8)'; // Dark glass
                ctx.strokeStyle = 'rgba(253, 224, 71, 0.6)'; // Yellow border
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x - boxWidth/2, boxY, boxWidth, boxHeight, 6);
                ctx.fill();
                ctx.stroke();

                // 4. Draw text inside pill
                ctx.fillStyle = '#fde047';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(fmtBv, x, boxY + boxHeight/2);

                // 5. Draw glowing star directly below the pill
                ctx.shadowColor = 'rgba(253, 224, 71, 1)';
                ctx.shadowBlur = 12;
                ctx.font = '16px serif';
                ctx.fillText('⭐', x, boxY + boxHeight + 14);

                ctx.restore();
            }
        };

        // Inline plugins must live in the top-level `plugins` array of the config,
        // NOT in options.plugins — this is the only way Chart.js fires the hooks.
        (config as any).plugins = [bestDayPlugin];

        this.trendChart = new Chart(canvas, config);

    }

    private updateTopProductsChart() {
        if (!this.topProductsChart) return;
        const products  = this.topProducts();
        const isAmount  = this.topProductsMode() === 'amount';
        const truncate  = (s: string, n: number) => s.length > n ? s.slice(0, n) + '\u2026' : s;
        this.topProductsChart.data.labels = products.map(p => truncate(p.name, 28));
        this.topProductsChart.data.datasets[0].data = isAmount
            ? products.map(p => p.revenue)
            : products.map(p => p.units);
        this.topProductsChart.data.datasets[0].label = isAmount ? 'Ingresos (MXN)' : 'Unidades vendidas';
        // Update x-axis tick format
        const xAxis = this.topProductsChart.options?.scales?.['x'] as any;
        if (xAxis?.ticks) {
            xAxis.ticks.callback = isAmount
                ? (v: any) => '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)
                : undefined;
            xAxis.ticks.stepSize   = isAmount ? undefined : 1;
            xAxis.ticks.precision  = isAmount ? undefined : 0;
        }
        this.topProductsChart.update();
    }


    private updatePriorityChart() {
        if (!this.priorityChart) return;
        const stats = this.priorityStats();
        this.priorityChart.data.datasets[0].data = [stats.standard, stats.express, stats.rush];
        this.priorityChart.update();
    }

    private checkMilestones(safeSalesData: number[]) {
        if (this.timeframe() !== 'MTD') {
            this.dailyMilestone.set(null);
            this.monthlyMilestone.set(false);
            return;
        }

        const now = new Date();
        const todayIdx = now.getDate() - 1;
        const todaySales = safeSalesData[todayIdx] || 0;
        const monthlySales = this.stats().monthlySales || 0;

        // Daily Milestones
        if (todaySales >= 100_000) {
            this.dailyMilestone.set('100K');
            this.triggerAutomaticFireworks('100K', now);
        } else if (todaySales >= 50_000) {
            this.dailyMilestone.set('50K');
            this.triggerAutomaticFireworks('50K', now);
        } else {
            this.dailyMilestone.set(null);
        }

        // Monthly Milestone
        if (monthlySales >= 1_000_000) {
            this.monthlyMilestone.set(true);
            this.triggerAutomaticFireworks('1M', now);
        } else {
            this.monthlyMilestone.set(false);
        }
    }

    private triggerAutomaticFireworks(type: '50K' | '100K' | '1M', date: Date) {
        let key = '';
        if (type === '1M') {
            key = `fireworks_triggered_1M_${date.getFullYear()}-${date.getMonth()}`;
        } else {
            key = `fireworks_triggered_${type}_${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        }

        if (!localStorage.getItem(key)) {
            localStorage.setItem(key, 'true');
            setTimeout(() => this.playFireworks(type), 1500);
        }
    }

    playFireworks(type: '50K' | '100K' | '1M') {
        const duration = type === '1M' ? 8000 : (type === '100K' ? 4000 : 2000);
        const end = Date.now() + duration;

        let msg = '';
        if (type === '50K') msg = '¡$50,000 MXN en un solo día! 🚀';
        if (type === '100K') msg = '¡RÉCORD: $100,000 MXN de ventas hoy! 🔥';
        if (type === '1M') msg = '🏆 ¡HITO HISTÓRICO: 1 MILLÓN DE PESOS! 🏆';
        this.fireworksMessage.set(msg);

        const colors = type === '1M' 
            ? ['#fde047', '#f59e0b', '#fbbf24', '#ffffff'] // Golden/White for 1M
            : ['#14b8a6', '#8b5cf6', '#ec4899', '#fde047']; // Vibrant brand colors for daily

        // Create a custom instance to disable web workers to comply with CSP (prevents blob: worker error)
        const myConfetti = (confetti as any).create(undefined, {
            useWorker: false,
            resize: true
        });

        const frame = () => {
            myConfetti({
                particleCount: type === '1M' ? 8 : (type === '100K' ? 5 : 3),
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: colors,
                zIndex: 9999
            });
            myConfetti({
                particleCount: type === '1M' ? 8 : (type === '100K' ? 5 : 3),
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: colors,
                zIndex: 9999
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            } else {
                this.fireworksMessage.set(null);
            }
        };
        
        frame();
    }
}
