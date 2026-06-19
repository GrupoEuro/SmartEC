import { Component, inject, OnInit, OnDestroy, AfterViewInit, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Firestore, doc, getDoc, collection, getDocs, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import confetti from 'canvas-confetti';

import { OrderService } from '../../../core/services/order.service';
import { GlobalOrderCacheService } from '../../../core/services/global-order-cache.service';
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
    private globalOrderCache  = inject(GlobalOrderCacheService);
    private firestore         = inject(Firestore);
    private toast             = inject(ToastService);
    private translate         = inject(TranslateService);
    private bqService         = inject(MetricsBigqueryService);

    euromindReport = signal<any>(null);

    timeframe = signal<'MTD' | 'PM' | 'YTD'>('MTD');
    channelFilter = signal<'ALL' | 'mercadolibre' | 'web' | 'pos' | 'amazon' | 'on_behalf'>('ALL');
    showProjection = signal<boolean>(true);
    /**
     * IMPORTANT — Signal Contract:
     * This plain array is NOT an Angular signal, but `salesVelocity` and
     * `yesterdaySnapshot` computed signals depend on it indirectly via
     * `todaySalesTotalSignal`. Whenever `allFetchedOrders` is reassigned,
     * `calculateStats()` must also be called to bump `todaySalesTotalSignal`,
     * which triggers the computeds. Never update `allFetchedOrders` without
     * also calling `applyFilters()` → `calculateStats()`.
     */
    allFetchedOrders: Order[] = [];
    readonly Math = Math;  // expose for template progress-bar clamping


    // Easter Egg Milestones
    dailyMilestone = signal<'50K' | '100K' | null>(null);
    monthlyMilestone = signal<boolean>(false);
    fireworksMessage = signal<string | null>(null);

    // Yesterday Snapshot State
    showYesterdaySnapshot = signal<boolean>(false);

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

    /**
     * FULL prior-month totals (e.g. entire June 2025 when viewing June 2026 MTD).
     * Loaded from monthly_stats/{YYYY-MM} aggregate doc — single Firestore read.
     * Used by the "Mes Completo AA" comparison banner.
     */
    lyFullMonthStats = signal<{ sales: number; orders: number; pieces: number; month: string } | null>(null);
    private lyFullMonthLoadedForKey: string | null = null;

    /**
     * Memoization key for loadLyDailyForMTD — tracks which YYYY-MM has already
     * been fetched this session so we don't re-query on every timeframe toggle.
     */
    private lyDataLoadedForMonth: string | null = null;

    /**
     * Per-day FORECAST revenue targets for the current month, loaded from
     * analytics_daily/{YYYY-MM-DD}.forecastRevenue.  Index 0 = day 1.
     * Only populated in MTD mode.
     */
    dailyForecastData = signal<number[]>([]);

    /** Raw analytics_daily rows (for accuracy summary computation) */
    private dailyForecastRaw = signal<Array<{
        date: string;
        forecastRevenue: number;
        forecastAccuracy: number | null;
        forecastBias: number | null;
        forecastMethod: string | null;
    }>>([]);

    /**
     * Forecast accuracy summary for the current MTD period.
     * Computed from the dailyForecastRaw signal so it updates reactively.
     */
    forecastAccuracySummary = computed(() => {
        const rows = this.dailyForecastRaw();
        const withAccuracy = rows.filter(r => r.forecastAccuracy !== null && r.forecastAccuracy > 0);
        if (withAccuracy.length === 0) return null;

        const mape = withAccuracy.reduce((sum, r) => {
            return sum + Math.abs((r.forecastAccuracy! - 1) * 100);
        }, 0) / withAccuracy.length;

        const beatDays = withAccuracy.filter(r => r.forecastAccuracy! >= 1).length;

        // Day-of-week breakdown (0=Mon…6=Sun)
        const DOW_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const dowBuckets: number[][] = Array.from({ length: 7 }, () => []);
        withAccuracy.forEach(r => {
            const dt = new Date(r.date + 'T12:00:00');
            const dow = (dt.getDay() + 6) % 7;
            dowBuckets[dow].push(r.forecastAccuracy!);
        });
        const dowAvg = dowBuckets.map((b, i) => ({
            name: DOW_NAMES[i],
            avg: b.length > 0 ? b.reduce((a, v) => a + v, 0) / b.length : null,
            count: b.length,
        })).filter(d => d.avg !== null);

        const bestDow  = dowAvg.reduce((best, d) => !best || d.avg! > best.avg! ? d : best, dowAvg[0]);
        const worstDow = dowAvg.reduce((worst, d) => !worst || d.avg! < worst.avg! ? d : worst, dowAvg[0]);

        // Last 7 days trend
        const last7 = withAccuracy.slice(-7);
        const last7Mape = last7.length > 0
            ? last7.reduce((s, r) => s + Math.abs((r.forecastAccuracy! - 1) * 100), 0) / last7.length
            : null;

        return {
            mape:       parseFloat(mape.toFixed(1)),
            beatDays,
            totalDays:  withAccuracy.length,
            bestDow:    bestDow  ? { name: bestDow.name,  pct: parseFloat(((bestDow.avg!  - 1) * 100).toFixed(1)) } : null,
            worstDow:   worstDow ? { name: worstDow.name, pct: parseFloat(((worstDow.avg! - 1) * 100).toFixed(1)) } : null,
            last7Mape:  last7Mape !== null ? parseFloat(last7Mape.toFixed(1)) : null,
            improving:  last7Mape !== null && last7Mape < mape,
        };
    });

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

    /**
     * Fraction of the current month that has elapsed (0–1), factoring in intra-day progress.
     * Day 1 at noon ≈ 0.016. Day 15 at midnight ≈ 0.483. Day 30 EOD ≈ 1.0.
     * Used by the "Mes Completo AA" pace bars to color-code whether MTD is on track.
     * Returns null outside MTD so bars don't render for PM/YTD.
     */
    lyPaceExpected = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const now       = new Date();
        const todayDay  = now.getDate();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        // Include intra-day fraction so the bar advances smoothly during the day
        const fracDay   = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
        return (todayDay - 1 + fracDay) / totalDays;   // 0-1 fraction
    });

    stats = signal<DashboardStats>({
        totalOrders: 0,
        pendingOrders: 0,
        processingOrders: 0,
        shippedToday: 0,
        monthlySales: 0,
        monthlyPiecesSold: 0
    });

    /**
     * End-of-month projection: only shown for MTD mid-month (not PM/YTD — those are complete periods).
     *
     * Strategy priority (best → fallback):
     *   1. Stored forecast line: sum of stored dailyForecastData for remaining days
     *      (nightly Holt-Winters ensemble with calendar effects + bias correction)
     *   2. Velocity Multiplier: CY prior completed days / LY prior completed days
     *   3. Straight-line run-rate: mtdSales / elapsed × totalDays
     */
    mtdProjection = computed<number | null>(() => {
        if (this.timeframe() !== 'MTD') return null;
        const mtdSales = this.stats().monthlySales;
        if (mtdSales <= 0) return null;

        const now = new Date();
        const todayDay = now.getDate();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const fractionalDayPart = (now.getHours() / 24) + (now.getMinutes() / 1440);

        // ── Strategy 1: Stored forecast line from nightly ensemble ─────────────
        // dailyForecastData[i] = forecasted revenue for day (i+1) of the month.
        // Sum remaining days' forecasts and add to current MTD actuals.
        const storedForecast = this.dailyForecastData();
        if (storedForecast.length === totalDays) {
            let forecastedRemainder = 0;
            let hasValues = false;
            // Rest of today (partial)
            const todayForecast = storedForecast[todayDay - 1] || 0;
            if (todayForecast > 0) {
                forecastedRemainder += todayForecast * (1 - fractionalDayPart);
                hasValues = true;
            }
            // All future days
            for (let i = todayDay; i < totalDays; i++) {
                if (storedForecast[i] > 0) {
                    forecastedRemainder += storedForecast[i];
                    hasValues = true;
                }
            }
            if (hasValues && forecastedRemainder > 0) {
                return mtdSales + forecastedRemainder;
            }
        }

        // ── Strategy 2: Velocity Multiplier using LY daily data ────────────────
        const lyData = this.lyDailyData();
        if (lyData && lyData.length === totalDays && todayDay > 1) {
            let lyPriorDays = 0;
            for (let i = 0; i < todayDay - 1; i++) lyPriorDays += lyData[i];

            const todaySales = this.todaySalesActual();
            const cyPriorDays = mtdSales - todaySales;

            if (lyPriorDays > 0 && cyPriorDays > 0) {
                const velocityMultiplier = cyPriorDays / lyPriorDays;
                let futureLySales = lyData[todayDay - 1] * (1 - fractionalDayPart);
                for (let i = todayDay; i < totalDays; i++) futureLySales += lyData[i];
                return mtdSales + (futureLySales * velocityMultiplier);
            }
        }

        // ── Strategy 3: Straight-line run-rate (no LY data / day 1) ──────────
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
        // Velocity multiplier is computed from COMPLETED prior days only (days 1…yesterday).
        // This avoids the inflated-multiplier bug where mtdSales (full CY days + today)
        // was divided by lySalesMTD that included only a small partial-hour fraction of LY today,
        // making the multiplier unrealistically large and blowing up the projection.
        const lyData = this.lyDailyData();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (lyData && lyData.length === totalDays) {
            const todayDay = now.getDate();
            const fractionalDayPart = now.getHours() / 24 + now.getMinutes() / 1440;
            const lyToday = lyData[todayDay - 1]; // LY full-day sales on this calendar day

            if (lyToday > 0 && todayDay > 1) {
                // Sum only fully-completed LY days (i < todayDay - 1 → days 1…yesterday)
                let lyPriorDays = 0;
                for (let i = 0; i < todayDay - 1; i++) lyPriorDays += lyData[i];

                // CY sales for the same completed days (exclude today's in-progress sales)
                const mtdSales = this.stats().monthlySales;
                const cyPriorDays = mtdSales - todaySales;

                if (lyPriorDays > 0 && cyPriorDays > 0) {
                    // Multiplier purely from apples-to-apples completed days
                    const velocityMultiplier = cyPriorDays / lyPriorDays;
                    // Project remaining portion of today using LY shape × multiplier
                    const futureLyToday = lyToday * (1 - fractionalDayPart);
                    return todaySales + (futureLyToday * velocityMultiplier);
                }
            }
        }

        // ── Strategy B: Straight-line hourly run-rate (no LY data / day 1) ─────
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
     * Average daily sales for the selected period.
     * - MTD: monthlySales / fractional days elapsed (includes today in progress)
     * - PM:  monthlySales / total days in that month
     * - YTD: monthlySales / days elapsed so far this year
     * Returns null if there are no sales yet.
     */
    avgDailySales = computed<number | null>(() => {
        const sales = this.stats().monthlySales;
        if (sales <= 0) return null;

        const now = new Date();
        const tf  = this.timeframe();

        if (tf === 'MTD') {
            // Include today's partial day so the number updates in real-time
            const fractionalDay = now.getDate() - 1 + (now.getHours() / 24) + (now.getMinutes() / 1440);
            if (fractionalDay < 0.1) return null;
            return sales / fractionalDay;
        }

        if (tf === 'PM') {
            // Previous month — figure out how many days it had
            const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const daysInPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
            return sales / daysInPrevMonth;
        }

        if (tf === 'YTD') {
            // Days elapsed since Jan 1 (including today as partial)
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const msElapsed   = now.getTime() - startOfYear.getTime();
            const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
            if (daysElapsed < 0.1) return null;
            return sales / daysElapsed;
        }

        return null;
    });

    /**
     * Average ticket delta: compares MTD avg ticket vs last year same period.
     * Positive = bigger orders this year, negative = smaller.
     * Returns null when no LY data or no current orders.
     */
    avgTicketDelta = computed<{ current: number; ly: number; pct: number } | null>(() => {
        const stats = this.stats();
        if (stats.totalOrders <= 0 || stats.monthlySales <= 0) return null;
        const lyStats = this.lyPeriodStats();
        if (!lyStats || lyStats.orders <= 0 || lyStats.sales <= 0) return null;

        const current = stats.monthlySales / stats.totalOrders;
        const ly      = lyStats.sales / lyStats.orders;
        const pct     = ((current - ly) / ly) * 100;
        return { current, ly, pct };
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
        todaySales:              number;
        todayRate:               number;   // $ per hour today
        projectedClose:          number;   // todayRate * 24
        todayOrderCount:         number;
        avgTicket:               number;
        yesterdayAtSameHour:     number;
        yesterdayFull:           number;
        yesterdayOrderCount:     number;
        yesterdayRate:           number | null;
        vsYesterdayPct:          number | null;
        vsYesterdayAbs:          number | null;
        vsYesterdayMultiplier:   number | null;
        projVsYesterdayFull:     number | null;  // projected close vs yesterday full day
        lyToday:                 number | null;
        lyTodayPartial:          number | null;
        lyRate:                  number | null;
        vsLyPct:                 number | null;
        vsLyMultiplier:          number | null;
        hoursElapsed:            number;
        hourlyBuckets:           number[];  // 24 buckets, today's sales per hour
        yesterdayHourlyBuckets:  number[];  // 24 buckets, yesterday's sales per hour
        channelBreakdown:        Record<string, number>;
        status:                  'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        insight:                 string;
        insightDetail:           string;
    } | null>(() => {
        this.todaySalesTotalSignal();

        const now          = new Date();
        const hoursElapsed = now.getHours() + now.getMinutes() / 60;
        // Show a meaningful early-morning state instead of null
        const tooEarly = hoursElapsed < 0.25;

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
        let todayOrderCount     = 0;
        let yesterdayAtSameHour = 0;
        let yesterdayFull       = 0;
        let yesterdayOrderCount = 0;
        const hourlyBuckets          = new Array(24).fill(0);
        const yesterdayHourlyBuckets = new Array(24).fill(0);
        const channelBreakdown: Record<string, number> = {};

        this.allFetchedOrders.forEach(o => {
            if (NON_REVENUE.includes(o.status as string)) return;
            const d          = this.getJsDate(o.createdAt);
            const isToday    = d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD;
            const isYesterday = d.getFullYear() === yestY  && d.getMonth() === yestM  && d.getDate() === yestD;
            const amt        = o.total || 0;

            if (isToday) {
                todaySales += amt;
                todayOrderCount++;
                hourlyBuckets[d.getHours()] += amt;
                const ch = (o as any).sourceChannel || 'other';
                channelBreakdown[ch] = (channelBreakdown[ch] || 0) + amt;
            }
            if (isYesterday) {
                yesterdayFull += amt;
                yesterdayOrderCount++;
                yesterdayHourlyBuckets[d.getHours()] += amt;
                if ((d.getHours() + d.getMinutes() / 60) <= hoursElapsed) {
                    yesterdayAtSameHour += amt;
                }
            }
        });

        if (tooEarly) {
            return {
                todaySales: 0, todayRate: 0, projectedClose: 0,
                todayOrderCount: 0, avgTicket: 0,
                yesterdayAtSameHour: 0, yesterdayFull: yesterdayFull,
                yesterdayOrderCount: 0, yesterdayRate: null,
                vsYesterdayPct: null, vsYesterdayAbs: null, vsYesterdayMultiplier: null,
                projVsYesterdayFull: null,
                lyToday: null, lyTodayPartial: null, lyRate: null, vsLyPct: null, vsLyMultiplier: null,
                hoursElapsed: 0, hourlyBuckets, yesterdayHourlyBuckets, channelBreakdown,
                status: 'no-data' as const,
                insight: '🌅 Día recién iniciado — sin ventas aún',
                insightDetail: `Ayer cerró en $${yesterdayFull.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}.`,
            };
        }

        const todayRate       = hoursElapsed > 0 ? todaySales / hoursElapsed : 0;
        const projectedClose  = todayRate * 24;
        const avgTicket       = todayOrderCount > 0 ? todaySales / todayOrderCount : 0;
        const yesterdayRate   = yesterdayAtSameHour > 0 ? yesterdayAtSameHour / hoursElapsed : null;

        // LY same calendar day total
        const lyData    = this.lyDailyData();
        const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const lyToday   = (lyData && lyData.length === totalDays) ? lyData[todayD - 1] : null;

        const vsYesterdayPct        = yesterdayAtSameHour > 0 ? ((todaySales - yesterdayAtSameHour) / yesterdayAtSameHour) * 100 : null;
        const vsYesterdayAbs        = yesterdayAtSameHour > 0 ? todaySales - yesterdayAtSameHour : null;
        const vsYesterdayMultiplier = yesterdayAtSameHour > 0 ? todaySales / yesterdayAtSameHour : null;
        const projVsYesterdayFull   = yesterdayFull > 0 ? projectedClose - yesterdayFull : null;

        const lyTodayPartial = lyToday ? lyToday * (hoursElapsed / 24) : null;
        const lyRate         = lyToday ? lyToday / 24 : null;
        const vsLyPct        = lyTodayPartial && lyTodayPartial > 0 ? ((todaySales - lyTodayPartial) / lyTodayPartial) * 100 : null;
        const vsLyMultiplier  = lyTodayPartial && lyTodayPartial > 0 ? todaySales / lyTodayPartial : null;

        // Tightened thresholds
        let status: 'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        if (vsYesterdayPct === null)      status = 'no-data';
        else if (vsYesterdayPct >= 5)     status = 'ahead';
        else if (vsYesterdayPct >= -10)   status = 'ok';
        else if (vsYesterdayPct >= -25)   status = 'warning';
        else                              status = 'critical';

        const fmtCur = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`;
        let insight = '', insightDetail = '';

        if (status === 'no-data') {
            insight       = 'Sin datos de ayer para comparar.';
            insightDetail = 'Asegúrate de que los pedidos de ayer estén sincronizados.';
        } else if (status === 'ahead') {
            insight       = `✅ Ritmo superior — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por encima de ayer`;
            insightDetail = `Ayer a las ${now.getHours()}h: ${fmtCur(yesterdayAtSameHour)} → Hoy: ${fmtCur(todaySales)}. Proyección cierre: ${fmtCur(projectedClose)}.`;
        } else if (status === 'ok') {
            insight       = `🟢 Ritmo normal — en línea con ayer`;
            insightDetail = `Diferencia de ${fmtCur(Math.abs(vsYesterdayAbs!))} vs ayer misma hora. Proyección: ${fmtCur(projectedClose)} vs cierre ayer ${fmtCur(yesterdayFull)}.`;
        } else if (status === 'warning') {
            insight       = `⚠️ Ritmo lento — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por debajo de ayer`;
            insightDetail = `Ayer: ${fmtCur(yesterdayAtSameHour)} → Hoy: ${fmtCur(todaySales)}. A este ritmo cerrarías en ${fmtCur(projectedClose)} vs ${fmtCur(yesterdayFull)} de ayer.`;
        } else {
            insight       = `🚨 Ritmo crítico — ${Math.abs(vsYesterdayPct!).toFixed(0)}% por debajo de ayer`;
            insightDetail = `Ayer a esta hora: ${fmtCur(yesterdayAtSameHour)} → Hoy: ${fmtCur(todaySales)}. Proyección: ${fmtCur(projectedClose)}. Revisa canal MeLi y tienda.`;
        }

        return {
            todaySales, todayRate, projectedClose,
            todayOrderCount, avgTicket,
            yesterdayAtSameHour, yesterdayFull,
            yesterdayOrderCount, yesterdayRate,
            vsYesterdayPct, vsYesterdayAbs, vsYesterdayMultiplier,
            projVsYesterdayFull,
            lyToday, lyTodayPartial, lyRate, vsLyPct, vsLyMultiplier,
            hoursElapsed, hourlyBuckets, yesterdayHourlyBuckets, channelBreakdown,
            status, insight, insightDetail,
        };
    });

    /**
     * Preprocessed sparkline data for the hourly bar chart in Pulso de Ventas.
     *
     * - Normalizes bar heights relative to the peak bucket (not total sales).
     * - Renders only hours 6–21 (business window) to remove dead midnight bars.
     * - Exposes currentHourIndex so the template can highlight the active bar.
     */
    sparklineData = computed<{
        bars: { hour: number; sales: number; heightPct: number; isCurrent: boolean; isPeak: boolean }[];
        maxSales: number;
        currentHourIndex: number;
    } | null>(() => {
        const sv = this.salesVelocity();
        if (!sv || sv.todayOrderCount === 0) return null;

        const START_HOUR = 6;
        const END_HOUR   = 21; // inclusive
        const now        = new Date();
        const currentHour = now.getHours();

        const slice = sv.hourlyBuckets.slice(START_HOUR, END_HOUR + 1);
        // Use shared peak across today + yesterday so both sparklines share the same Y-scale
        const yesterdaySlice = sv.yesterdayHourlyBuckets.slice(START_HOUR, END_HOUR + 1);
        const maxSales = Math.max(...slice, ...yesterdaySlice, 1); // avoid /0

        const bars = slice.map((sales, i) => {
            const hour = START_HOUR + i;
            return {
                hour,
                sales,
                heightPct: sales > 0 ? Math.max((sales / maxSales) * 100, 4) : 0,
                isCurrent: hour === currentHour,
                isPeak:    sales === Math.max(...slice, 1) && sales > 0,
            };
        });

        const currentHourIndex = Math.max(0, Math.min(currentHour - START_HOUR, bars.length - 1));
        return { bars, maxSales, currentHourIndex };
    });

    /**
     * Sparkline data for the "Ayer misma hora" column.
     *
     * Key design decisions:
     * - Uses the SAME shared peak (max of today + yesterday combined) as `sparklineData`
     *   so both charts have identical Y-scales — directly comparable side-by-side.
     * - Bars up to (and including) the current hour = full opacity ("already elapsed").
     * - Bars after the current hour = `beyondCutoff: true` so the template dims them.
     *   This makes clear that those hours exist in yesterday's data but are outside
     *   the comparison window.
     * - `isPeak` marks the highest business-hours bucket for the whole day (full day).
     */
    yesterdaySparklineData = computed<{
        bars: { hour: number; sales: number; heightPct: number; beyondCutoff: boolean; isPeak: boolean }[];
        maxSales: number;
        cutoffHour: number;
    } | null>(() => {
        const sv = this.salesVelocity();
        if (!sv || sv.yesterdayOrderCount === 0) return null;

        const START_HOUR  = 6;
        const END_HOUR    = 21;
        const now         = new Date();
        const currentHour = now.getHours();

        const todaySlice = sv.hourlyBuckets.slice(START_HOUR, END_HOUR + 1);
        const yesterdaySlice = sv.yesterdayHourlyBuckets.slice(START_HOUR, END_HOUR + 1);

        // Shared peak across both days so Y-scales are identical
        const sharedMax = Math.max(...todaySlice, ...yesterdaySlice, 1);
        // Peak within yesterday's full-day slice (for crown marker)
        const yesterdayMax = Math.max(...yesterdaySlice, 1);

        const bars = yesterdaySlice.map((sales, i) => {
            const hour = START_HOUR + i;
            return {
                hour,
                sales,
                heightPct: sales > 0 ? Math.max((sales / sharedMax) * 100, 4) : 0,
                beyondCutoff: hour > currentHour,
                isPeak: sales === yesterdayMax && sales > 0,
            };
        });

        return { bars, maxSales: sharedMax, cutoffHour: currentHour };
    });

    yesterdaySnapshot = computed<{
        yesterdaySales:        number;
        antierSales:           number;
        vsAntierPct:           number | null;
        vsAntierMultiplier:    number | null;
        lyYesterday:           number | null;
        vsLyPct:               number | null;
        yesterdayDate:         string;   // "16 may" for toggle button
        status:                'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        insight:               string;
    } | null>(() => {
        this.todaySalesTotalSignal();

        const now = new Date();
        const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed'];

        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        const yestY = yest.getFullYear();
        const yestM = yest.getMonth();
        const yestD = yest.getDate();
        const yesterdayDate = yest.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).toUpperCase();

        const antier = new Date(now);
        antier.setDate(antier.getDate() - 2);
        const antierY = antier.getFullYear();
        const antierM = antier.getMonth();
        const antierD = antier.getDate();

        let yesterdaySales = 0;
        let antierSales = 0;

        this.allFetchedOrders.forEach(o => {
            if (NON_REVENUE.includes(o.status as string)) return;
            const d = this.getJsDate(o.createdAt);
            const isYesterday = d.getFullYear() === yestY && d.getMonth() === yestM && d.getDate() === yestD;
            const isAntier    = d.getFullYear() === antierY && d.getMonth() === antierM && d.getDate() === antierD;
            if (isYesterday) yesterdaySales += o.total || 0;
            if (isAntier)    antierSales += o.total || 0;
        });

        const lyData      = this.lyDailyData();
        const totalDays   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const lyYesterday = (lyData && lyData.length === totalDays && yestD > 0) ? lyData[yestD - 1] : null;

        const vsAntierPct        = antierSales > 0 ? ((yesterdaySales - antierSales) / antierSales) * 100 : null;
        const vsAntierMultiplier = antierSales > 0 ? yesterdaySales / antierSales : null;
        const vsLyPct            = lyYesterday && lyYesterday > 0 ? ((yesterdaySales - lyYesterday) / lyYesterday) * 100 : null;

        let status: 'ahead' | 'ok' | 'warning' | 'critical' | 'no-data';
        if (vsAntierPct === null)    status = 'no-data';
        else if (vsAntierPct >= 5)   status = 'ahead';
        else if (vsAntierPct >= -10) status = 'ok';
        else if (vsAntierPct >= -25) status = 'warning';
        else                         status = 'critical';

        let insight = '';
        if (status === 'no-data') insight = 'Sin datos de antier.';
        else if (status === 'ahead')    insight = `✅ Ayer cerró ${Math.abs(vsAntierPct!).toFixed(0)}% por encima de antier.`;
        else if (status === 'ok')       insight = `🟢 Ayer cerró estable vs antier.`;
        else if (status === 'warning')  insight = `⚠️ Ayer cerró ${Math.abs(vsAntierPct!).toFixed(0)}% por debajo de antier.`;
        else                            insight = `🚨 Ayer cerró ${Math.abs(vsAntierPct!).toFixed(0)}% por debajo de antier.`;

        return { yesterdaySales, antierSales, vsAntierPct, vsAntierMultiplier, lyYesterday, vsLyPct, yesterdayDate, status, insight };
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

    /**
     * Midnight rollover timers.
     * midnightTimer  — one-shot setTimeout that fires at 00:00 local time.
     * midnightInterval — 24h setInterval that keeps the window fresh if the tab
     *                    stays open across multiple midnights.
     * Both are cleared in ngOnDestroy.
     */
    private midnightTimer: any;
    private midnightInterval: any;

    /**
     * 5-minute Pulso auto-refresh interval.
     *
     * Problem solved: the hourly sparkline bars, current-hour marker, and rate/
     * projection values in the Pulso de Ventas panel only update when the
     * Firestore tail emits a new/updated order. During quiet periods (e.g. 45 min
     * with no orders), the hour marker doesn't advance, rates freeze, and the
     * projection becomes stale.
     *
     * This interval bumps `todaySalesTotalSignal` every 5 minutes (re-setting the
     * same value) to force `salesVelocity`, `sparklineData`, and other computed
     * signals to re-evaluate with a fresh `new Date()`. Zero Firestore reads —
     * it only recalculates from the already-cached `allFetchedOrders` array.
     */
    private pulsoRefreshInterval: any;

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
        this.scheduleMidnightRollover();
        this.startPulsoRefresh();
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
        // Cancel midnight rollover timers
        clearTimeout(this.midnightTimer);
        clearInterval(this.midnightInterval);
        // Cancel Pulso auto-refresh
        clearInterval(this.pulsoRefreshInterval);
    }

    /**
     * Schedules a one-shot timer that fires at exactly 00:00 local time.
     *
     * Problem solved: if the dashboard is already open when midnight passes, the
     * date window (startDate/endDate) computed at session start becomes stale —
     * it still points to yesterday, so calculateStats() finds zero orders matching
     * "today" and shows $0 sales until the user manually refreshes.
     *
     * This method:
     *   1. Calculates milliseconds until the next midnight.
     *   2. Sets a one-shot setTimeout that calls loadDashboardData() at 00:00,
     *      which rebuilds the window with a fresh `new Date()`.
     *   3. After the first rollover, installs a 24h interval for subsequent nights.
     *
     * Zero extra Firestore reads — it simply triggers the same loadDashboardData()
     * that a manual navigation-away-and-back would trigger.
     */
    private scheduleMidnightRollover(): void {
        const now = new Date();
        const nextMidnight = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,   // tomorrow at...
            0, 0, 0, 0           // ...00:00:00.000
        );
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        console.log(`[Dashboard] Midnight rollover scheduled in ${Math.round(msUntilMidnight / 60000)} min.`);

        this.midnightTimer = setTimeout(() => {
            console.log('[Dashboard] Midnight rollover — reloading date window.');
            // Invalidate LY memoization keys so the new day picks up fresh data
            this.lyDataLoadedForMonth = null;
            this.lyFullMonthLoadedForKey = null;
            this.loadDashboardData();

            // Keep refreshing every subsequent midnight
            this.midnightInterval = setInterval(() => {
                console.log('[Dashboard] 24h rollover — reloading date window.');
                this.lyDataLoadedForMonth = null;
                this.lyFullMonthLoadedForKey = null;
                this.loadDashboardData();
            }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    /**
     * Bumps `todaySalesTotalSignal` every 5 minutes to keep Pulso de Ventas
     * computeds fresh (hour marker, rate, projection) even when no new orders
     * arrive. Zero Firestore reads.
     */
    private startPulsoRefresh(): void {
        this.pulsoRefreshInterval = setInterval(() => {
            // Re-set the same value to trigger computed re-evaluation with fresh `new Date()`
            this.todaySalesTotalSignal.update(v => v);
        }, 5 * 60 * 1000); // every 5 minutes
    }

    /** Returns true if both dates fall on the same calendar day. */
    private isSameDay(d1: Date, d2: Date): boolean {
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth()    === d2.getMonth() &&
               d1.getDate()     === d2.getDate();
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

        // ── Pulso de Ventas guard ────────────────────────────────────────────
        // Pulso always needs today + yesterday in allFetchedOrders.
        // For PM/YTD the window above may exclude recent days, so we expand it
        // to always include at least yesterday.
        //
        // CRITICAL EXCEPTION — do NOT cross a month boundary on MTD.
        // On day 1 of a new month (e.g. June 1):
        //   startDate  = June 1  00:00:00
        //   yesterday  = May 31  08:xx:xx  (current time minus 1 day)
        //   startDate > yesterday → TRUE → guard would set startDate = May 31
        // This pulled an entire prior month of orders into the MTD window,
        // inflating MTD sales by ~75 k. Guard is only safe when yesterday is
        // in the same calendar month as the period start.
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (startDate > yesterday && yesterday.getMonth() === startDate.getMonth()) {
            startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        }

        // Reset LY daily overlay + forecast data
        this.lyDailyData.set([]);
        this.lyUsingApprox.set(false);
        this.dailyForecastData.set([]);

        // Kick off LY reads in parallel (non-blocking)
        this.loadLyComparison();
        this.loadLyFullMonth();   // full prior-month totals for the comparison banner
        if (this.timeframe() === 'MTD') {
            this.loadLyDailyForMTD();
            this.loadDailyForecastForMTD();
        }

        // Cancel any previous hybrid subscription before opening a new one.
        this.liveOrdersSub?.unsubscribe();

        // Invalidate the hybrid cache so the one-shot re-fetches for the new
        // date window (e.g. when switching MTD → PM → MTD).
        this.globalOrderCache.invalidateHybrid();

        // ── Hybrid stream ─────────────────────────────────────────────────────
        // Phase 1: getDocs loads all orders for the period once (one read per session).
        // Phase 2: a narrow 48h onSnapshot tail delivers new/updated orders in
        // near-real-time with ~50 docs per event instead of 900.
        // Net result: ~92% fewer order reads vs a full-range onSnapshot.
        this.liveOrdersSub = this.globalOrderCache
            .getHybrid(startDate, endDate)
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

            // ── Try BigQuery for LY period KPIs ────────────────────────────────
            let sales = 0, orders = 0, pieces = 0, hasAny = false;
            try {
                const kpis = await this.bqService.querySummaryKpisBetween(fromDateStr, toDateStr);
                kpis.forEach((k: any) => {
                    sales += k.revenue || 0;
                    orders += k.orders || 0;
                    pieces += k.units || 0;
                    hasAny = true;
                });
            } catch (bqErr) {
                console.warn('[Dashboard] BQ LY KPI read failed, will try Firestore fallback:', bqErr);
            }

            // ── Fallback: aggregate analytics_daily for the same period ─────────
            if (!hasAny) {
                try {
                    const ref  = collection(this.firestore, 'analytics_daily');
                    const q    = query(ref,
                        where('date', '>=', fromDateStr),
                        where('date', '<=', toDateStr),
                        orderBy('date', 'asc'),
                    );
                    const snap = await getDocs(q);
                    snap.forEach(docSnap => {
                        const d = docSnap.data();
                        sales  += d['totalRevenue'] ?? 0;
                        orders += d['totalOrders']  ?? 0;
                        pieces += d['totalUnits']   ?? 0;
                        hasAny  = true;
                    });
                    if (hasAny) {
                        console.log(`[Dashboard] LY KPIs loaded from analytics_daily (BQ fallback): ${fromDateStr}–${toDateStr}`);
                    }
                } catch (fsErr) {
                    console.warn('[Dashboard] Firestore LY KPI fallback failed:', fsErr);
                }
            }

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
     *
     * Priority:
     *   1. BigQuery (fast, covers historical periods once BQ export runs)
     *   2. analytics_daily Firestore collection (fallback — always has current & LY data)
     */
    private async loadLyDailyForMTD(): Promise<void> {
        // ── Memoization guard ─────────────────────────────────────────────────
        // Skip the Firestore fetch if we already have data for the current month.
        // This avoids re-reading monthly_stats/*/days on every timeframe toggle.
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (this.lyDataLoadedForMonth === currentMonthKey && this.lyDailyData().length > 0) {
            console.log(`[Dashboard] LY daily data already loaded for ${currentMonthKey} — skipping re-fetch.`);
            return;
        }

        try {
            const lyYear = now.getFullYear() - 1;
            const lyMon = String(now.getMonth() + 1).padStart(2, '0');
            const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

            const fromDateStr = `${lyYear}-${lyMon}-01`;
            const toDateStr   = `${lyYear}-${lyMon}-${String(totalDaysInMonth).padStart(2, '0')}`;

            // ── Try BigQuery first ─────────────────────────────────────────────
            let dailySales: number[] = new Array(totalDaysInMonth).fill(0);
            let hasAny = false;

            try {
                const trend: any[] = await (this.bqService as any).queryDailyTrendBetween(fromDateStr, toDateStr);
                trend.forEach((t: any) => {
                    const day = parseInt(t.order_date.split('-')[2], 10);
                    if (day >= 1 && day <= totalDaysInMonth) {
                        dailySales[day - 1] += t.revenue || 0;
                        hasAny = true;
                    }
                });
            } catch (bqErr) {
                console.warn('[Dashboard] BQ LY daily read failed, will try Firestore fallback:', bqErr);
            }

            // ── Fallback: analytics_daily Firestore collection ─────────────────
            if (!hasAny) {
                try {
                    const ref = collection(this.firestore, 'analytics_daily');
                    const q   = query(ref,
                        where('date', '>=', fromDateStr),
                        where('date', '<=', toDateStr),
                        orderBy('date', 'asc'),
                    );
                    const snap = await getDocs(q);
                    dailySales = new Array(totalDaysInMonth).fill(0);
                    snap.forEach(docSnap => {
                        const d = docSnap.data();
                        const day = parseInt((d['date'] as string).split('-')[2], 10);
                        if (day >= 1 && day <= totalDaysInMonth) {
                            dailySales[day - 1] = d['totalRevenue'] ?? 0;
                            if (dailySales[day - 1] > 0) hasAny = true;
                        }
                    });
                    if (hasAny) {
                        console.log(`[Dashboard] LY daily loaded from analytics_daily (BQ fallback): ${lyYear}-${lyMon}`);
                    }
                } catch (fsErr) {
                    console.warn('[Dashboard] Firestore LY daily fallback failed:', fsErr);
                }
            }

            // ── Fallback 3: monthly_stats/{YYYY-MM}/days subcollection ─────────
            // This older structure is written by backfillMonthlyStats and
            // aggregateDailyStats cron. More likely to have historical data
            // than analytics_daily when the newer cron hasn't backfilled yet.
            if (!hasAny) {
                try {
                    const monthlyStatsRef = collection(
                        this.firestore,
                        `monthly_stats/${lyYear}-${lyMon}/days`
                    );
                    const msSnap = await getDocs(monthlyStatsRef);
                    dailySales = new Array(totalDaysInMonth).fill(0);
                    msSnap.forEach(docSnap => {
                        const d = docSnap.data();
                        const day = parseInt(docSnap.id, 10);
                        if (day >= 1 && day <= totalDaysInMonth) {
                            dailySales[day - 1] = d['sales'] ?? 0;
                            if (dailySales[day - 1] > 0) hasAny = true;
                        }
                    });
                    if (hasAny) {
                        console.log(`[Dashboard] LY daily loaded from monthly_stats (fallback 3): ${lyYear}-${lyMon}`);
                    }
                } catch (msErr) {
                    console.warn('[Dashboard] monthly_stats LY fallback failed:', msErr);
                }
            }

            if (hasAny) {
                this.lyDailyData.set(dailySales);
                // Mark this month as loaded so loadLyDailyForMTD() is a no-op on
                // subsequent timeframe toggles within the same session.
                this.lyDataLoadedForMonth = currentMonthKey;
                // Redraw: guard on orders being loaded rather than chart existence.
                // Fixes the race where LY data arrives before the first chart render —
                // if orders aren't loaded yet, the chart will use lyDailyData() when
                // it IS created (signal is already set by then).
                if (this.allFetchedOrders.length > 0) this.applyFilters();
            }
        } catch (err) {
            console.warn('[Dashboard] LY daily MTD read failed (non-critical):', err);
        }
    }

    // LY overlay natively handled inside createTrendChart()

    /**
     * Load the FULL prior-year equivalent month totals from monthly_stats/{YYYY-MM}.
     * For MTD → reads the entire June 2025 doc.
     * For PM  → reads the entire May 2025 doc.
     * For YTD → reads the YTD month range and sums (or just shows the matching month).
     *
     * Uses memoization so re-renders / timeframe toggles within the same session
     * do not re-query Firestore.
     */
    private async loadLyFullMonth(): Promise<void> {
        const now      = new Date();
        const lyYear   = now.getFullYear() - 1;

        // Determine which LY month to show the FULL picture for
        let lyMonthNum: number;   // 0-based
        let lyMonthYear = lyYear;

        if (this.timeframe() === 'PM') {
            // PM compares to same month LY (e.g. May 2026 MTD vs May 2025 full)
            const prevMon = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
            lyMonthNum = prevMon;
            lyMonthYear = now.getMonth() === 0 ? lyYear - 1 : lyYear;
        } else {
            // MTD and YTD both compare to the current month LY
            lyMonthNum = now.getMonth();
        }

        const lyMon     = String(lyMonthNum + 1).padStart(2, '0');
        const lyMonthStr = `${lyMonthYear}-${lyMon}`;
        const cacheKey  = `${lyMonthStr}`;

        if (this.lyFullMonthLoadedForKey === cacheKey) return;  // already loaded this session

        try {
            // Primary: monthly_stats/{YYYY-MM} aggregate doc
            const docRef  = doc(this.firestore, `monthly_stats/${lyMonthStr}`);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const d = docSnap.data();
                const sales   = d['sales']   ?? d['revenue']   ?? 0;
                const orders  = d['orders']  ?? 0;
                const pieces  = d['pieces']  ?? d['units']     ?? 0;

                if (sales > 0 || orders > 0) {
                    this.lyFullMonthStats.set({ sales, orders, pieces, month: lyMonthStr });
                    this.lyFullMonthLoadedForKey = cacheKey;
                    console.log(`[Dashboard] LY full month loaded: ${lyMonthStr} → $${sales.toFixed(0)}, ${orders} pedidos, ${pieces} pzas`);
                    return;
                }
            }

            // Fallback: analytics_daily aggregate for the full month
            const totalDaysInMonth = new Date(lyMonthYear, lyMonthNum + 1, 0).getDate();
            const fromStr = `${lyMonthStr}-01`;
            const toStr   = `${lyMonthStr}-${String(totalDaysInMonth).padStart(2, '0')}`;

            const ref  = collection(this.firestore, 'analytics_daily');
            const q    = query(ref,
                where('date', '>=', fromStr),
                where('date', '<=', toStr),
            );
            const snap = await getDocs(q);

            let sales = 0, orders = 0, pieces = 0;
            snap.forEach(d => {
                const data = d.data();
                sales   += data['totalRevenue'] ?? 0;
                orders  += data['totalOrders']  ?? 0;
                pieces  += data['totalPieces']  ?? data['totalUnits'] ?? 0;
            });

            if (sales > 0 || orders > 0) {
                this.lyFullMonthStats.set({ sales, orders, pieces, month: lyMonthStr });
                this.lyFullMonthLoadedForKey = cacheKey;
                console.log(`[Dashboard] LY full month (analytics_daily fallback): ${lyMonthStr} → $${sales.toFixed(0)}`);
            } else {
                this.lyFullMonthStats.set(null);
                console.warn(`[Dashboard] LY full month not found for ${lyMonthStr}`);
            }
        } catch (err) {
            console.warn('[Dashboard] loadLyFullMonth failed (non-critical):', err);
            this.lyFullMonthStats.set(null);
        }
    }

    /**
     * Load per-day forecast targets for the current month from analytics_daily.
     * Each doc may have forecastRevenue (set the previous night) and
     * forecastAccuracy (set by the daily cron after actuals close).
     *
     * Populates:
     *   - dailyForecastData  → for the 3-line chart (forecast line)
     *   - dailyForecastRaw   → for the accuracy summary computed signal
     */
    private async loadDailyForecastForMTD(): Promise<void> {
        try {
            const now         = new Date();
            const year        = now.getFullYear();
            const mon         = String(now.getMonth() + 1).padStart(2, '0');
            const totalDays   = new Date(year, now.getMonth() + 1, 0).getDate();
            const fromDateStr = `${year}-${mon}-01`;
            const toDateStr   = `${year}-${mon}-${String(totalDays).padStart(2, '0')}`;

            const ref = collection(this.firestore, 'analytics_daily');
            const q   = query(ref,
                where('date', '>=', fromDateStr),
                where('date', '<=', toDateStr),
                orderBy('date', 'asc'),
            );
            const snap = await getDocs(q);

            const forecastArr: number[] = new Array(totalDays).fill(0);
            const rawRows: Array<{
                date: string;
                forecastRevenue: number;
                forecastAccuracy: number | null;
                forecastBias: number | null;
                forecastMethod: string | null;
            }> = [];

            snap.forEach(docSnap => {
                const d     = docSnap.data();
                const date  = d['date'] as string;
                const dayNum = parseInt(date.split('-')[2], 10);
                if (dayNum >= 1 && dayNum <= totalDays) {
                    const fRev = (d['forecastRevenue'] as number) ?? 0;
                    forecastArr[dayNum - 1] = fRev;
                    if (fRev > 0) {
                        rawRows.push({
                            date,
                            forecastRevenue:  fRev,
                            forecastAccuracy: d['forecastAccuracy'] ?? null,
                            forecastBias:     d['forecastBias']     ?? null,
                            forecastMethod:   d['forecastMethod']   ?? null,
                        });
                    }
                }
            });

            const hasAny = forecastArr.some(v => v > 0);
            if (hasAny) {
                this.dailyForecastData.set(forecastArr);
                this.dailyForecastRaw.set(rawRows);
                if (this.trendChart) this.applyFilters();
            }
        } catch (err) {
            console.warn('[Dashboard] Daily forecast MTD read failed (non-critical):', err);
        }
    }

    /**
     * Trailing-debounce handle for chart renders.
     *
     * Problem solved: a single data load triggers applyFilters() up to 3× in rapid
     * succession (initial stream emit + LY data arrival + forecast data arrival).
     * Each call previously destroyed and recreated all 3 Chart.js instances, causing
     * a visible canvas flash. A 300ms trailing debounce collapses all calls within
     * the same burst into one render cycle.
     *
     * Data calculations (calculateStats, etc.) still run synchronously on every call
     * so signal values are always up to date — only the expensive chart rebuild is
     * deferred and collapsed.
     */
    private chartRenderTimeout: any;
    /** Snapshot of filtered orders captured at the last applyFilters() call.
     *  Used by the debounced render so it operates on the freshest data set. */
    private lastFilteredOrders: Order[] = [];

    applyFilters() {
        const filter = this.channelFilter();
        let filteredOrders = this.allFetchedOrders;
        
        if (filter !== 'ALL') {
            const targetChannel = filter === 'web' ? 'storefront' : filter;
            filteredOrders = this.allFetchedOrders.filter(o => 
                o.sourceChannel === targetChannel || (!o.sourceChannel && targetChannel === 'storefront')
            );
        }

        // ── Synchronous data calculations — always run immediately ────────────
        this.calculateStats(filteredOrders);
        this.calculateSLAStats(filteredOrders);
        this.calculatePriorityStats(filteredOrders);
        this.calculateStaffWorkload(filteredOrders);
        this.calculateOverdueOrders(filteredOrders);
        this.calculateTopProducts(filteredOrders);
        this.generateHeatmapData(filteredOrders);
        this.calculateChannelBreakdown(this.allFetchedOrders); // always on ALL

        this.recentOrders.set(filteredOrders.slice(0, 5));

        // ── Debounced chart render — collapses rapid successive calls ─────────
        // Store the latest filtered set so the render always uses fresh data.
        this.lastFilteredOrders = filteredOrders;
        clearTimeout(this.chartRenderTimeout);
        this.chartRenderTimeout = setTimeout(() => {
            // requestAnimationFrame ensures isLoading=false has been painted
            // and the canvas elements are visible before Chart.js reads dimensions.
            requestAnimationFrame(() => {
                console.log('[Dashboard] Chart render tick — trendChart canvas:', !!document.getElementById('trendChart'));
                // Use incremental update() when charts already exist (avoids destroy/recreate flash)
                // Fall back to full create when chart doesn't exist yet (first load after skeleton)
                try {
                    if (document.getElementById('topProductsChart')) {
                        this.topProductsChart ? this.updateTopProductsChart() : this.createTopProductsChart();
                    }
                } catch(e) { console.error('[Dashboard] topProductsChart error:', e); }
                try {
                    if (document.getElementById('priorityChart')) {
                        this.priorityChart ? this.updatePriorityChart() : this.createPriorityChart();
                    }
                } catch(e) { console.error('[Dashboard] priorityChart error:', e); }
                // Trend chart always recreates — its dataset count and inline plugin change
                // dynamically (projection lines appear/disappear based on timeframe and data)
                // making incremental update() unreliable.
                try { if (document.getElementById('trendChart')) this.createTrendChart(this.lastFilteredOrders); } catch(e) { console.error('[Dashboard] trendChart error:', e); }
            });
        }, 300);
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
            // Also exclude cancelled/refunded/returned/refund_pending to align with main KPI card
            const GHOST_STATUSES = ['payment_failed', 'pending_payment'];
            const EXCLUDED_FROM_REVENUE = ['cancelled', 'refunded', 'returned', 'refund_pending'];
            const countableChOrders = chOrders.filter(o => 
                !GHOST_STATUSES.includes(o.status as string) &&
                !EXCLUDED_FROM_REVENUE.includes(o.status as string)
            );

            const revenue = countableChOrders.reduce((s, o) => s + (o.total ?? 0), 0);

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

            const meliFullClassic     = isMeli ? countableChOrders.filter(o => isFull(o)     && listingType(o) !== 'premium').length : undefined;
            const meliFullPremium     = isMeli ? countableChOrders.filter(o => isFull(o)     && listingType(o) === 'premium').length : undefined;
            const meliMerchantClassic = isMeli ? countableChOrders.filter(o => isMerchant(o) && listingType(o) !== 'premium').length : undefined;
            const meliMerchantPremium = isMeli ? countableChOrders.filter(o => isMerchant(o) && listingType(o) === 'premium').length : undefined;


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

        // GHOST STATUSES — these are NOT real committed orders:
        // - payment_failed:   MP rejected the card. No money moved. Phantom.
        // - pending_payment:  Customer opened checkout but never submitted payment.
        //                     Nothing committed — treat as abandoned cart, not an order.
        // Also exclude cancelled, refunded, returned, and refund_pending from KPI card totals
        // to maintain consistency with revenue/pieces and match backend aggregation logic.
        const GHOST_STATUSES = ['payment_failed', 'pending_payment'];
        const EXCLUDED_FROM_REVENUE = ['cancelled', 'refunded', 'returned', 'refund_pending'];
        const NON_REVENUE = [...GHOST_STATUSES, ...EXCLUDED_FROM_REVENUE];

        // ── Single-pass aggregation ──────────────────────────────────────────
        // Merges what were previously separate iterations:
        //   • KPI totals (sales, pieces, pending, processing)
        //   • shippedToday count
        //   • Today's actual sales/orders/pieces for velocity signals
        // Reduces from 3 full iterations to 1.
        let sales = 0;
        let piecesSold = 0;
        let pendingOrders = 0;
        let processingOrders = 0;
        let totalOrders = 0;
        let shippedToday = 0;
        let todaySalesSum = 0;
        let todayOrdersCount = 0;
        let todayPiecesSum = 0;

        for (const o of orders) {
            const status = o.status as string;
            const isGhost    = GHOST_STATUSES.includes(status);
            const isExcluded = EXCLUDED_FROM_REVENUE.includes(status);

            // ── shippedToday: use shippedAt when available (more accurate than updatedAt) ──
            if (status === 'shipped') {
                const shipDate = this.getJsDate((o as any).shippedAt ?? o.updatedAt);
                if (this.isSameDay(shipDate, today)) {
                    shippedToday++;
                }
            }

            // ── KPI totals (skip ghost + excluded) ──
            if (!isGhost && !isExcluded) {
                totalOrders++;
                if (status === 'pending')    pendingOrders++;
                if (status === 'processing') processingOrders++;

                sales += o.total || 0;
                if (o.items && Array.isArray(o.items)) {
                    for (const item of o.items) {
                        piecesSold += item.quantity || 0;
                    }
                }
            }

            // ── Today's actual totals (for velocity signals) ──
            if (!NON_REVENUE.includes(status)) {
                const d = this.getJsDate(o.createdAt);
                if (this.isSameDay(d, today)) {
                    todaySalesSum += o.total || 0;
                    todayOrdersCount++;
                    if (o.items && Array.isArray(o.items)) {
                        for (const item of o.items) {
                            todayPiecesSum += item.quantity || 0;
                        }
                    }
                }
            }
        }

        const stats: DashboardStats = {
            totalOrders,
            pendingOrders,
            processingOrders,
            shippedToday,
            monthlySales: sales, // Kept property name for interface stability, represents active timeframe
            monthlyPiecesSold: piecesSold
        };

        this.stats.set(stats);
        this.todaySalesTotalSignal.set(todaySalesSum);
        this.todayOrdersCountSignal.set(todayOrdersCount);
        this.todayPiecesCountSignal.set(todayPiecesSum);
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
        const returnedData:  number[] = new Array(dataLength).fill(0);
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
                else if (o.status === 'cancelled') cancelledData[index]++;
                else if (o.status === 'returned' || o.status === 'refunded' || o.status === 'refund_pending') returnedData[index]++;

                const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'payment_failed', 'pending_payment', 'refund_pending'];
                if (!NON_REVENUE.includes(o.status as string)) {
                    salesData[index] += (o.total || 0);
                }
            }
        });

        const safeSalesData = salesData.map(val => Number.isNaN(val) ? 0 : val);
        console.log('[TrendChart] dataLength:', dataLength, '| salesData total:', safeSalesData.reduce((a, b) => a + b, 0).toFixed(0), '| first 7 days:', safeSalesData.slice(0, 7));

        this.checkMilestones(safeSalesData);

        // Null out future days so the teal Net Sales line ends cleanly at today
        // instead of crashing to $0 for days that haven't happened yet.
        const todayDayIdx = this.timeframe() === 'MTD' ? new Date().getDate() - 1 : dataLength - 1;
        const chartSalesData: (number | null)[] = safeSalesData.map((v, i) => i <= todayDayIdx ? v : null);

        const datasets: any[] = [
            {
                type: 'line',
                label: 'Net Sales ($)',
                data: chartSalesData,
                borderColor: '#2dd4bf', // teal-400
                backgroundColor: '#2dd4bf',
                tension: 0.4,
                spanGaps: false,
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
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.CANCELLED'),
                data: cancelledData,
                backgroundColor: '#dc3545', // Danger Red
                borderWidth: 0,
                order: 1,
                yAxisID: 'y'
            },
            {
                type: 'bar',
                label: this.translate.instant('OPERATIONS.DASHBOARD.METRICS.RETURNED'),
                data: returnedData,
                backgroundColor: '#f97316', // Orange — visually distinct from cancelled red
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
            // ── Stored historical forecast (from analytics_daily.forecastRevenue) ──
            // For days that already have a committed forecast written by snapshotProjections,
            // use those stored values as the anchor for the solid forecast line.
            const storedForecast = this.dailyForecastData();
            const hasStoredForecast = storedForecast.length === dataLength && storedForecast.some(v => v > 0);

            if (hasStoredForecast) {
                // Past days: use stored forecast directly
                for (let i = 0; i < todayIdx; i++) {
                    if (storedForecast[i] > 0) projData[i] = storedForecast[i];
                }
            }

            // Today + future: use velocity model (existing logic)
            if (todayIdx >= 0 && todayIdx < dataLength) {
                projData[todayIdx] = this.todayProjection() ?? safeSalesData[todayIdx];
            }

            const lyData = this.lyDailyData();
            if (lyData && lyData.length === dataLength) {
                let lySalesMTD = 0;
                for (let i = 0; i < todayIdx; i++) lySalesMTD += lyData[i];
                lySalesMTD += lyData[todayIdx] * fractionalDayPart;

                const mtdSales = this.stats().monthlySales;
                const velocityMultiplier = lySalesMTD > 0 && mtdSales > 0
                    ? mtdSales / lySalesMTD
                    : 1;

                // ── DOW suppression guard ──────────────────────────────────────────
                // With fewer than 7 CY data points (first week of month), the DOW lookup
                // anchors future Sundays to today's partial-day sales — far below the
                // extrapolated weekday average — creating deep false cliffs every 7 days.
                // Rely purely on the LY seasonal shape (scaled by velocity multiplier)
                // until we have at least one complete week of CY data.
                const useDowBlend = todayIdx >= 6;

                for (let i = todayIdx + 1; i < dataLength; i++) {
                    // Day-of-week projection: average the last 2 CY occurrences of the
                    // same day-of-week to capture recent weekly patterns.
                    const targetDate = new Date(now.getFullYear(), now.getMonth(), i + 1);
                    const targetDow  = targetDate.getDay(); // 0=Sun … 6=Sat
                    let dowSum = 0, dowCount = 0;
                    if (useDowBlend) {
                        for (let d = todayIdx; d >= 0 && dowCount < 2; d--) {
                            const candidateDate = new Date(now.getFullYear(), now.getMonth(), d + 1);
                            if (candidateDate.getDay() === targetDow && safeSalesData[d] > 0) {
                                dowSum += safeSalesData[d];
                                dowCount++;
                            }
                        }
                    }
                    const dowProjection  = dowCount > 0 ? dowSum / dowCount : null;
                    // LY seasonal signal: last year's same day scaled by current velocity.
                    // Critical for end-of-month spikes that repeat year-over-year.
                    const lyProjection   = (lyData && lyData[i] > 0) ? lyData[i] * velocityMultiplier : null;

                    if (dowProjection !== null && lyProjection !== null) {
                        // 50/50 blend: DOW anchors to recent CY pace; LY captures seasonal shape
                        projData[i] = 0.5 * dowProjection + 0.5 * lyProjection;
                    } else {
                        projData[i] = dowProjection ?? lyProjection
                            ?? ((hasStoredForecast && storedForecast[i] > 0) ? storedForecast[i] : lyData[i] * velocityMultiplier);
                    }
                }
            } else {
                const mtdSales = this.stats().monthlySales;
                const elapsed = todayIdx + fractionalDayPart;
                const averageDaily = mtdSales / Math.max(elapsed, 0.1);
                // Same DOW suppression: no blend in first week, stored forecast or flat average.
                const useDowNoLY = todayIdx >= 6;
                for (let i = todayIdx + 1; i < dataLength; i++) {
                    // DOW fallback when no LY data available
                    let dowSum = 0, dowCount = 0;
                    if (useDowNoLY) {
                        const targetDate = new Date(now.getFullYear(), now.getMonth(), i + 1);
                        const targetDow  = targetDate.getDay();
                        for (let d = todayIdx; d >= 0 && dowCount < 2; d--) {
                            const candidateDate = new Date(now.getFullYear(), now.getMonth(), d + 1);
                            if (candidateDate.getDay() === targetDow && safeSalesData[d] > 0) {
                                dowSum += safeSalesData[d];
                                dowCount++;
                            }
                        }
                    }
                    projData[i] = dowCount > 0 ? dowSum / dowCount
                        : ((hasStoredForecast && storedForecast[i] > 0) ? storedForecast[i] : averageDaily);
                }
            }

            if (hasStoredForecast) {
                // ── CASE A: Historical forecast data available ─────────────────────
                // Solid amber: only TODAY's projected full-day value (anchors dashed line).
                // Past days intentionally left null — a retroactively-computed forecast
                // next to actual bars creates a misleading "miss" on executive dashboards.
                // The LY gray line provides the correct YoY historical context instead.
                const solidProjData  = new Array(dataLength).fill(null);
                const dashedProjData = new Array(dataLength).fill(null);

                // Fill dashed line for today + all future days
                for (let i = todayIdx; i < dataLength; i++) {
                    if (projData[i] !== null) {
                        dashedProjData[i] = projData[i];
                    }
                }
                // Solid anchor: yesterday connects to today so the dashed line has an origin
                if (todayIdx > 0 && projData[todayIdx] !== null) {
                    solidProjData[todayIdx - 1] = safeSalesData[todayIdx - 1]; // yesterday's actual
                    solidProjData[todayIdx]     = projData[todayIdx];           // today's projection
                }

                // Solid: committed past forecast
                datasets.push({
                    type: 'line',
                    label: 'Pronóstico ($)',
                    data: solidProjData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.08)',
                    borderDash: [],
                    tension: 0.35,
                    spanGaps: false,
                    yAxisID: 'y1',
                    borderWidth: 2.5,
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#fff',
                    pointRadius: 3,
                    order: 0,
                });

                // Dashed: future projection
                datasets.push({
                    type: 'line',
                    label: 'Proyección ($)',
                    data: dashedProjData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderDash: [5, 4],
                    tension: 0.35,
                    spanGaps: false,
                    yAxisID: 'y1',
                    borderWidth: 1.8,
                    pointBackgroundColor: '#f59e0b',
                    pointRadius: 2,
                    order: 0,
                });

            } else {
                // ── CASE B: No historical forecast yet (backfill pending) ───────────
                // Show a single dashed "Proyección" line — no duplicate in legend.
                datasets.push({
                    type: 'line',
                    label: 'Proyección ($)',
                    data: projData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderDash: [5, 4],
                    tension: 0.4,
                    spanGaps: true,
                    yAxisID: 'y1',
                    borderWidth: 2,
                    pointBackgroundColor: '#f59e0b',
                    pointRadius: 3,
                    order: 0,
                });
            }
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

    private triggeredThisSession = new Set<string>();

    private triggerAutomaticFireworks(type: '50K' | '100K' | '1M', date: Date) {
        let key = '';
        if (type === '1M') {
            key = `fireworks_triggered_1M_${date.getFullYear()}-${date.getMonth()}`;
        } else {
            key = `fireworks_triggered_${type}_${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        }

        if (!this.triggeredThisSession.has(key) && !localStorage.getItem(key)) {
            this.triggeredThisSession.add(key);
            localStorage.setItem(key, 'true');
            setTimeout(() => this.playFireworks(type), 1500);
        } else {
            this.triggeredThisSession.add(key);
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
