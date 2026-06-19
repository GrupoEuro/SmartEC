/**
 * analytics.ts — Sales Forecasting Engine
 *
 * Forecasting model: Holt-Winters Triple Exponential Smoothing (additive)
 *   + CY velocity multiplier (corrects for YoY growth)
 *   + Day-of-week seasonal index (captures weekly rhythm)
 *   + Rolling bias correction (self-corrects from past forecast error)
 *
 * Firestore writes:
 *   analytics_daily/{YYYY-MM-DD}.forecastRevenue / forecastOrders / forecastUnits
 *   monthly_stats/{YYYY-MM}/projections/{DD}   (legacy EOM snapshot — kept for compat)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';


// ─── Holt-Winters Triple Exponential Smoothing (Additive variant) ─────────────
//
// Best model for daily retail sales with weekly seasonality.
// References: Hyndman & Athanasopoulos "Forecasting: Principles and Practice",
//             Winters (1960), Gardner (1985).
//
// Parameters (α, β, γ) are set empirically for daily e-commerce with
// weekly seasonality (m=7). Validated against 6+ months of tire retail data.
//
//   α = 0.3  — level smoothing (moderate responsiveness)
//   β = 0.05 — trend smoothing (slow — trend is stable in mature e-com)
//   γ = 0.2  — seasonal smoothing (medium — preserve weekly pattern, allow drift)
//
// ─────────────────────────────────────────────────────────────────────────────

interface HWState {
    level:    number;
    trend:    number;
    seasonal: number[];   // length = m (7 for weekly)
    mape:     number;     // Mean Absolute Percentage Error on training data
}

/**
 * Train a Holt-Winters Triple Exponential Smoothing model (additive) on a
 * sequence of daily revenue values. Returns trained state for forecasting.
 *
 * Requires at least 2 full seasonal periods (≥ 14 data points) to initialize.
 *
 * @param data  Array of daily revenue values, oldest first
 * @param m     Seasonal period (7 = weekly)
 * @param alpha Level smoothing factor
 * @param beta  Trend smoothing factor
 * @param gamma Seasonal smoothing factor
 */
function trainHoltWinters(
    data:  number[],
    m      = 7,
    alpha  = 0.3,
    beta   = 0.05,
    gamma  = 0.2,
): HWState | null {
    if (data.length < 2 * m) return null;  // Need ≥ 2 full periods

    // ── 1. Initialization (classic decomposition start) ───────────────────────
    // Level = average of first complete period
    let level = 0;
    for (let i = 0; i < m; i++) level += data[i];
    level /= m;

    // Trend = average of (second-period avg - first-period avg) / m
    let level2 = 0;
    for (let i = m; i < 2 * m && i < data.length; i++) level2 += data[i];
    level2 /= m;
    let trend = (level2 - level) / m;

    // Seasonal indices = initial value / level
    // Use all available complete periods for a better estimate
    const nCompletePeriodsForInit = Math.min(Math.floor(data.length / m), 4);
    const seasonal: number[] = new Array(m).fill(0);
    for (let p = 0; p < nCompletePeriodsForInit; p++) {
        let periodAvg = 0;
        for (let i = p * m; i < (p + 1) * m && i < data.length; i++) periodAvg += data[i];
        periodAvg /= m;
        if (periodAvg <= 0) continue;
        for (let i = 0; i < m; i++) {
            const idx = p * m + i;
            if (idx < data.length) seasonal[i] += (data[idx] / periodAvg);
        }
    }
    for (let i = 0; i < m; i++) seasonal[i] /= nCompletePeriodsForInit;

    // ── 2. Training pass (update equations) ───────────────────────────────────
    let totalAbsPctErr = 0;
    let errCount = 0;

    let L = level;
    let T = trend;
    const S = [...seasonal];

    for (let t = m; t < data.length; t++) {
        const y = data[t];
        if (y <= 0) continue;  // Skip zero-revenue days (holidays, outages)

        const sIdx  = t % m;
        const prevL = L;

        // Forecast for this point (for MAPE tracking)
        const forecast = (L + T) * S[sIdx];

        // Update level
        L = alpha * (y / S[sIdx]) + (1 - alpha) * (L + T);
        // Update trend
        T = beta * (L - prevL) + (1 - beta) * T;
        // Update seasonal
        S[sIdx] = gamma * (y / L) + (1 - gamma) * S[sIdx];

        // Track MAPE
        if (forecast > 0) {
            totalAbsPctErr += Math.abs((y - forecast) / y);
            errCount++;
        }
    }

    const mape = errCount > 0 ? (totalAbsPctErr / errCount) * 100 : 15;

    return { level: L, trend: T, seasonal: S, mape };
}

/**
 * Produce h-step-ahead forecasts using a trained Holt-Winters state.
 * The seasonalStartIdx offsets which day-of-week the first forecast falls on.
 */
function hwForecast(state: HWState, h: number, seasonalStartIdx: number, m = 7): number[] {
    const out: number[] = [];
    let { level: L, trend: T } = state;
    for (let i = 1; i <= h; i++) {
        const sIdx = (seasonalStartIdx + i - 1) % m;
        const val = (L + T * i) * state.seasonal[sIdx];
        out.push(Math.max(0, val));
    }
    return out;
}

// ─── Day-of-Week Seasonal Index ───────────────────────────────────────────────
//
// Augments HW forecast with an explicit DoW multiplier.
// Built from ≥ 8 weeks of history so it's statistically meaningful.
// Day encoding: 0 = Monday … 6 = Sunday (ISO)
//
function buildDowIndex(dailyDates: string[], dailySales: number[]): number[] {
    const buckets: number[][] = Array.from({ length: 7 }, () => []);
    for (let i = 0; i < dailyDates.length; i++) {
        if (dailySales[i] <= 0) continue;
        const dt = new Date(dailyDates[i] + 'T12:00:00');
        const dow = (dt.getDay() + 6) % 7;  // 0=Mon … 6=Sun
        buckets[dow].push(dailySales[i]);
    }
    const means = buckets.map(b => b.length > 0 ? b.reduce((a, v) => a + v, 0) / b.length : 0);
    const overallMean = means.reduce((a, v) => a + v, 0) / 7;
    if (overallMean <= 0) return new Array(7).fill(1);
    return means.map(m2 => m2 / overallMean);
}

// ─── Rolling Bias Correction ──────────────────────────────────────────────────
//
// Uses the last N days of (actual / forecast) ratios to detect systematic bias.
// If the model has consistently over/under-predicted by X%, the next forecast
// is divided by the rolling mean of past accuracy ratios.
//
// This is model-agnostic — works on top of any base model.
//
function computeBiasCorrection(accuracyRatios: number[], window = 14): number {
    if (accuracyRatios.length === 0) return 1;
    const recent = accuracyRatios.slice(-window);
    const mean = recent.reduce((a, v) => a + v, 0) / recent.length;
    // Clamp correction to ±30% to avoid overcorrection on noise
    return Math.min(1.3, Math.max(0.7, mean));
}

// ─── Core Forecast Engine ─────────────────────────────────────────────────────

interface DailyForecastResult {
    /** Array of per-day forecast revenue for the entire month (0-based, day 1 = index 0) */
    dailyRevenue:       number[];
    dailyOrders:        number[];
    dailyUnits:         number[];
    eomProjection:      number;    // sum of actuals-to-date + forecast remainder
    method:             'holt_winters_hybrid' | 'velocity_dow' | 'straight_line';
    hwMape:             number;    // training MAPE (lower = better model fit)
    velocityMultiplier: number;
}

/**
 * Compute daily forecast targets for every remaining day in the month.
 *
 * Strategy priority (best → fallback):
 *   1. Holt-Winters + velocity multiplier + DoW index + bias correction
 *   2. Velocity multiplier + DoW index (if <14 LY data points)
 *   3. Straight-line run-rate (if no LY data at all)
 *
 * @param cyMtdSales     CY revenue accumulated up to and including today (elapsed fraction)
 * @param cyMtdOrders    CY orders MTD
 * @param cyMtdUnits     CY units MTD
 * @param lyDates        ISO dates for the LY extended series (≥90 days)
 * @param lyRevenue      LY daily revenue matching lyDates
 * @param lyMonthRevenue LY daily revenue just for this calendar month (full month, all days)
 * @param lyMonthOrders  LY daily orders matching lyMonthRevenue
 * @param lyMonthUnits   LY daily units matching lyMonthRevenue
 * @param todayIdx       0-based index of today within the month (0 = day 1)
 * @param fractional     Fraction of today already elapsed (0.0–1.0)
 * @param totalDays      Total days in the current month
 * @param todayDow       Day-of-week for today (0=Mon…6=Sun)
 * @param biasRatios     Recent (actual/forecast) ratios from analytics_daily
 */
function computeDailyForecasts(opts: {
    cyMtdSales:      number;
    cyMtdOrders:     number;
    cyMtdUnits:      number;
    lyDates:         string[];
    lyRevenue:       number[];
    lyMonthRevenue:  number[];   // full month, length = totalDays
    lyMonthOrders:   number[];
    lyMonthUnits:    number[];
    todayIdx:        number;
    fractional:      number;
    totalDays:       number;
    todayDow:        number;
    biasRatios:      number[];
}): DailyForecastResult {
    const {
        cyMtdSales, cyMtdOrders, cyMtdUnits,
        lyDates, lyRevenue,
        lyMonthRevenue, lyMonthOrders, lyMonthUnits,
        todayIdx, fractional, totalDays, todayDow, biasRatios,
    } = opts;

    const remainingDays = totalDays - todayIdx - 1;   // days after today (exclusive)
    const dailyRevenue  = new Array(totalDays).fill(0);
    const dailyOrders   = new Array(totalDays).fill(0);
    const dailyUnits    = new Array(totalDays).fill(0);

    // ── CY elapsed LY MTD (same fraction as CY) ───────────────────────────────
    let lySalesMTD = 0;
    for (let i = 0; i < todayIdx; i++) lySalesMTD += (lyMonthRevenue[i] ?? 0);
    lySalesMTD += (lyMonthRevenue[todayIdx] ?? 0) * fractional;

    const velocityMultiplier = lySalesMTD > 0 ? cyMtdSales / lySalesMTD : 1;

    // ── Attempt Holt-Winters on extended LY series ────────────────────────────
    const hwState = trainHoltWinters(lyRevenue);

    // ── Day-of-Week index from extended LY data ────────────────────────────────
    const dowIndex = buildDowIndex(lyDates, lyRevenue);

    // ── Bias correction from recent accuracy ratios ────────────────────────────
    const biasCorrection = computeBiasCorrection(biasRatios);

    // ── Build per-day forecasts for ALL days in the month ─────────────────────
    // Past days & today: use actuals if available (caller fills those in);
    // future days: forecast.

    // LY orders/units ratio for distributing revenue → orders → units
    const lyMonthTotalRev = lyMonthRevenue.reduce((a, v) => a + v, 0);
    const lyMonthTotalOrd = lyMonthOrders.reduce((a, v) => a + v, 0);
    const lyMonthTotalUnt = lyMonthUnits.reduce((a, v) => a + v, 0);
    const globalAvgTicket = lyMonthTotalOrd > 0 ? lyMonthTotalRev / lyMonthTotalOrd : 800;
    const globalAvgUnitsPerOrder = lyMonthTotalOrd > 0 ? lyMonthTotalUnt / lyMonthTotalOrd : 4;

    let method: DailyForecastResult['method'] = 'straight_line';
    let hwMape = 15;

    if (hwState && lyDates.length >= 14) {
        method = 'holt_winters_hybrid';
        hwMape = hwState.mape;

        // HW forecasts from end of training data onward.
        // We want forecasts for the remaining days in the CURRENT month.
        // The seasonal start offset for day (todayIdx+1) of the month:
        // todayDow = dow of today (0-Mon); day i has dow (todayDow + (i - todayIdx)) % 7
        const hStepsNeeded = totalDays - todayIdx;  // today + remaining
        const hwValues = hwForecast(hwState, hStepsNeeded, todayDow % 7);

        for (let i = todayIdx; i < totalDays; i++) {
            const hIdx = i - todayIdx;
            const hwBase = hwValues[hIdx] ?? 0;

            // DoW adjustment
            const dayDow = (todayDow + (i - todayIdx)) % 7;
            const dowAdj = dowIndex[dayDow] ?? 1;

            // Blend: 60% HW, 40% LY-raw (keeps seasonal spikes from LY)
            const lyRaw = lyMonthRevenue[i] ?? hwBase;
            const blended = 0.6 * hwBase + 0.4 * lyRaw;

            // Apply velocity multiplier + DoW fine-tune + bias correction
            const rev = blended * velocityMultiplier * dowAdj / biasCorrection;

            dailyRevenue[i] = Math.max(0, rev);

            // Derive orders & units from LY ratios for this specific day
            const lyDayOrd = lyMonthOrders[i] ?? 0;
            const lyDayUnt = lyMonthUnits[i] ?? 0;
            const lyDayRev = lyMonthRevenue[i] ?? 0;
            if (lyDayOrd > 0 && lyDayRev > 0) {
                dailyOrders[i] = Math.round(dailyRevenue[i] / (lyDayRev / lyDayOrd));
                dailyUnits[i]  = Math.round(dailyOrders[i] * (lyDayUnt / lyDayOrd));
            } else {
                dailyOrders[i] = Math.round(dailyRevenue[i] / globalAvgTicket);
                dailyUnits[i]  = Math.round(dailyOrders[i] * globalAvgUnitsPerOrder);
            }
        }

    } else if (lySalesMTD > 0) {
        // ── Fallback A: Velocity + DoW ─────────────────────────────────────────
        method = 'velocity_dow';

        // LY remaining sum for distribution
        let lyRemaining = 0;
        for (let i = todayIdx + 1; i < totalDays; i++) lyRemaining += (lyMonthRevenue[i] ?? 0);

        const budgetRemaining = lyRemaining * velocityMultiplier;

        for (let i = todayIdx + 1; i < totalDays; i++) {
            const lyDay = lyMonthRevenue[i] ?? 0;
            const dayDow = (todayDow + (i - todayIdx)) % 7;
            const dowAdj = dowIndex[dayDow] ?? 1;
            const share = lyRemaining > 0 ? lyDay / lyRemaining : (1 / remainingDays);

            dailyRevenue[i] = Math.max(0, budgetRemaining * share * dowAdj / biasCorrection);
            const lyDayOrd = lyMonthOrders[i] ?? 0;
            const lyDayRev = lyMonthRevenue[i] ?? 0;
            if (lyDayOrd > 0 && lyDayRev > 0) {
                dailyOrders[i] = Math.round(dailyRevenue[i] / (lyDayRev / lyDayOrd));
                dailyUnits[i]  = Math.round(dailyOrders[i] * ((lyMonthUnits[i] ?? 0) / lyDayOrd));
            } else {
                dailyOrders[i] = Math.round(dailyRevenue[i] / globalAvgTicket);
                dailyUnits[i]  = Math.round(dailyOrders[i] * globalAvgUnitsPerOrder);
            }
        }

    } else {
        // ── Fallback B: Straight-line run-rate ─────────────────────────────────
        method = 'straight_line';
        const elapsed = todayIdx + fractional;
        if (elapsed > 0.1) {
            const dailyRate = cyMtdSales / elapsed;
            for (let i = todayIdx + 1; i < totalDays; i++) {
                dailyRevenue[i] = dailyRate;
                dailyOrders[i]  = Math.round(dailyRate / globalAvgTicket);
                dailyUnits[i]   = Math.round(dailyOrders[i] * globalAvgUnitsPerOrder);
            }
        }
    }

    // EOM projection = CY actual + forecasted remainder
    let forecastedRemainder = 0;
    for (let i = todayIdx + 1; i < totalDays; i++) forecastedRemainder += dailyRevenue[i];
    // Add today's projected total (actuals so far + forecast for rest of today)
    const lyTodayFull = lyMonthRevenue[todayIdx] ?? 0;
    const todayProjected = lyTodayFull > 0
        ? cyMtdSales + ((lyTodayFull * (1 - fractional)) * velocityMultiplier)
        : cyMtdSales / (fractional > 0 ? fractional : 1);

    const eomProjection = cyMtdSales + forecastedRemainder;

    return { dailyRevenue, dailyOrders, dailyUnits, eomProjection, method, hwMape, velocityMultiplier };
}


// ─── Helper: load LY extended series from analytics_daily ────────────────────

async function loadLyExtendedSeries(
    lyYear: number,
    month: number,   // 1-based
): Promise<{ dates: string[]; revenue: number[]; monthRevenue: number[]; monthOrders: number[]; monthUnits: number[] }> {

    // Extended window: 90 days ending last day of the LY month (for HW training)
    const lyMonthEnd  = new Date(lyYear, month - 1 + 1, 0);  // last day of LY month
    const lyWindowStart = new Date(lyYear, month - 1, 1);
    lyWindowStart.setDate(lyWindowStart.getDate() - 62);      // ~2 months back

    const startStr = lyWindowStart.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    const endStr   = lyMonthEnd.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' });

    const snap = await db.collection('analytics_daily')
        .where('date', '>=', startStr)
        .where('date', '<=', endStr)
        .orderBy('date', 'asc')
        .get();

    const dates: string[]   = [];
    const revenue: number[] = [];
    const totalDaysInMonth  = new Date(lyYear, month - 1 + 1, 0).getDate();
    const monthRevenue: number[] = new Array(totalDaysInMonth).fill(0);
    const monthOrders:  number[] = new Array(totalDaysInMonth).fill(0);
    const monthUnits:   number[] = new Array(totalDaysInMonth).fill(0);

    const lyMonthStr = `${lyYear}-${String(month).padStart(2, '0')}`;

    snap.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
        const d = doc.data();
        dates.push(d.date);
        revenue.push(d.totalRevenue ?? 0);

        if (d.month === lyMonthStr) {
            const dayNum = parseInt(d.date.split('-')[2], 10);
            if (dayNum >= 1 && dayNum <= totalDaysInMonth) {
                monthRevenue[dayNum - 1] = d.totalRevenue ?? 0;
                monthOrders [dayNum - 1] = d.totalOrders  ?? 0;
                monthUnits  [dayNum - 1] = d.totalUnits   ?? 0;
            }
        }
    });

    return { dates, revenue, monthRevenue, monthOrders, monthUnits };
}

/** Load recent bias ratios (actual / forecast) from analytics_daily */
async function loadBiasRatios(lookbackDays = 28): Promise<number[]> {
    const end   = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - lookbackDays);

    const snap = await db.collection('analytics_daily')
        .where('date', '>=', start.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }))
        .where('date', '<',  end.toLocaleDateString('sv-SE',   { timeZone: 'America/Mexico_City' }))
        .orderBy('date', 'asc')
        .get();

    const ratios: number[] = [];
    snap.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
        const d = doc.data();
        const acc = d.forecastAccuracy as number | undefined;
        // forecastAccuracy = actual / forecast; valid range 0.1–5.0
        if (acc && isFinite(acc) && acc > 0.1 && acc < 5.0) {
            ratios.push(acc);
        }
    });
    return ratios;
}


// ─── snapshotProjections ──────────────────────────────────────────────────────

export const snapshotProjections = functions
    .pubsub.schedule('55 23 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
        const fs   = db;
        const now  = new Date();
        const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));

        const year  = mxNow.getFullYear();
        const month = mxNow.getMonth() + 1;  // 1-based
        const monthStr   = `${year}-${String(month).padStart(2, '0')}`;
        const currentDay = String(mxNow.getDate()).padStart(2, '0');

        const totalDaysInMonth = new Date(year, month, 0).getDate();
        const todayIdx         = mxNow.getDate() - 1;  // 0-based
        const fractional       = (mxNow.getHours() / 24) + (mxNow.getMinutes() / 1440);
        const todayDow         = (mxNow.getDay() + 6) % 7;  // 0=Mon…6=Sun

        // ── 1. Read CY MTD actuals from monthly_stats ─────────────────────────
        const currentDocRef = fs.collection('monthly_stats').doc(monthStr);
        const currentDoc    = await currentDocRef.get();
        if (!currentDoc.exists) {
            console.log(`[snapshotProjections] No monthly_stats for ${monthStr}`);
            return;
        }

        const data      = currentDoc.data() || {};
        const mtdSales  = data.sales  || 0;
        const mtdPieces = data.pieces || 0;
        const mtdOrders = data.orders || 0;

        if (mtdSales <= 0) {
            console.log(`[snapshotProjections] No sales to project for ${monthStr}-${currentDay}`);
            return;
        }

        // ── 2. Load LY extended data + bias ratios ────────────────────────────
        const lyYear = year - 1;
        const [lyData, biasRatios] = await Promise.all([
            loadLyExtendedSeries(lyYear, month),
            loadBiasRatios(28),
        ]);

        // ── 3. Run forecast engine ─────────────────────────────────────────────
        const result = computeDailyForecasts({
            cyMtdSales:     mtdSales,
            cyMtdOrders:    mtdOrders,
            cyMtdUnits:     mtdPieces,
            lyDates:        lyData.dates,
            lyRevenue:      lyData.revenue,
            lyMonthRevenue: lyData.monthRevenue,
            lyMonthOrders:  lyData.monthOrders,
            lyMonthUnits:   lyData.monthUnits,
            todayIdx,
            fractional,
            totalDays: totalDaysInMonth,
            todayDow,
            biasRatios,
        });

        const ts = admin.firestore.FieldValue.serverTimestamp();

        // ── 4. Legacy EOM snapshot (backward compat) ──────────────────────────
        const snapshotRef = currentDocRef.collection('projections').doc(currentDay);
        const projectedOrders = Math.round(mtdOrders * (result.eomProjection / (mtdSales || 1)));
        const projectedPieces = Math.round(mtdPieces * (result.eomProjection / (mtdSales || 1)));

        await snapshotRef.set({
            predictedSales:         result.eomProjection,
            predictedPieces:        projectedPieces,
            predictedOrders:        projectedOrders,
            actualSalesAtSnapshot:  mtdSales,
            fractionalDay:          todayIdx + fractional,
            forecastMethod:         result.method,
            hwMape:                 result.hwMape,
            velocityMultiplier:     result.velocityMultiplier,
            biasRatioCount:         biasRatios.length,
            timestamp:              ts,
        });

        // ── 5. Write tomorrow's forecast target to analytics_daily ────────────
        //    (this is the key new write — enables the 3-line comparison chart)
        const tomorrow = new Date(mxNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
        const tomorrowIdx = todayIdx + 1;

        if (tomorrowIdx < totalDaysInMonth) {
            const tomorrowRev = result.dailyRevenue[tomorrowIdx];
            const tomorrowOrd = result.dailyOrders [tomorrowIdx];
            const tomorrowUnt = result.dailyUnits  [tomorrowIdx];

            await fs.collection('analytics_daily').doc(tomorrowStr).set({
                forecastRevenue:    tomorrowRev,
                forecastOrders:     tomorrowOrd,
                forecastUnits:      tomorrowUnt,
                forecastSetAt:      ts,
                forecastMethod:     result.method,
                forecastHwMape:     result.hwMape,
            }, { merge: true });

            console.log(`[snapshotProjections] Forecast for ${tomorrowStr}: ` +
                `revenue=$${tomorrowRev.toFixed(0)}, orders=${tomorrowOrd}, units=${tomorrowUnt} ` +
                `[method=${result.method}, hwMape=${result.hwMape.toFixed(1)}%, ` +
                `velocityMx=${result.velocityMultiplier.toFixed(2)}, ` +
                `biasCorrection=${biasRatios.length > 0}]`);
        }

        console.log(`[snapshotProjections] EOM projection for ${monthStr}-${currentDay}: ` +
            `$${result.eomProjection.toFixed(0)} (method: ${result.method})`);
    });


// ─── backfillDailyForecasts ───────────────────────────────────────────────────
//
// Callable: retroactively computes forecast targets for all days in a given
// month that have actuals but no forecastRevenue. Safe to re-run.
// Does NOT overwrite days that already have forecastRevenue set.
//
// Input: { month: '2026-05', overwrite?: boolean }
//
// ─────────────────────────────────────────────────────────────────────────────

export const backfillDailyForecasts = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }
        const role = context.auth.token?.role;
        if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
            throw new functions.https.HttpsError('permission-denied', 'Admin required.');
        }

        const fs           = db;
        const targetMonth  = (data?.month as string) || '';
        const overwrite    = !!(data?.overwrite);

        if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
            throw new functions.https.HttpsError('invalid-argument', 'month must be YYYY-MM.');
        }

        const [year, month] = targetMonth.split('-').map(Number);
        const totalDays      = new Date(year, month, 0).getDate();
        const lyYear         = year - 1;

        // Load LY extended data (used for all daily computations)
        const [lyData, biasRatios] = await Promise.all([
            loadLyExtendedSeries(lyYear, month),
            loadBiasRatios(28),
        ]);

        // Load all analytics_daily docs for the target month
        const fromStr = `${targetMonth}-01`;
        const toStr   = `${targetMonth}-${String(totalDays).padStart(2, '0')}`;
        const monthSnap = await fs.collection('analytics_daily')
            .where('date', '>=', fromStr)
            .where('date', '<=', toStr)
            .orderBy('date', 'asc')
            .get();

        // Build cumulative CY running totals to simulate what each day's forecast
        // would have been if we had run it on the night before.
        const docsByDate: Record<string, admin.firestore.DocumentSnapshot> = {};
        monthSnap.forEach(doc => { docsByDate[doc.data().date] = doc; });

        const batch = fs.batch();
        let written = 0;
        let skipped = 0;

        let cySalesCumul  = 0;
        let cyOrdersCumul = 0;
        let cyUnitsCumul  = 0;

        for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
            const dateStr = `${targetMonth}-${String(dayNum).padStart(2, '0')}`;
            const doc = docsByDate[dateStr];

            if (!doc) {
                // No actuals for this day yet — skip future days
                continue;
            }

            const d = doc.data()!;

            // If already has forecastRevenue and not forcing overwrite, skip
            if (!overwrite && d.forecastRevenue !== undefined) {
                // Still accumulate actuals for cumulative tracking
                cySalesCumul  += d.totalRevenue ?? 0;
                cyOrdersCumul += d.totalOrders  ?? 0;
                cyUnitsCumul  += d.totalUnits   ?? 0;
                skipped++;
                continue;
            }

            // todayIdx for forecast is (dayNum - 2) since we're forecasting
            // what we'd have written the night BEFORE this day (at 23:55 of dayNum-1).
            // The forecast for dayNum is computed using cumulative actuals through dayNum-1.
            const forecastForDayIdx = dayNum - 1;   // 0-based index of dayNum in the month
            const prevDayEnd = forecastForDayIdx - 1;  // last complete day available

            if (prevDayEnd < 0) {
                // Day 1 of the month — no actuals yet; use straight-line from LY only
                const todayIdx    = 0;
                const fractional  = 0;
                const todayDate   = new Date(`${dateStr}T12:00:00`);
                const todayDow    = (todayDate.getDay() + 6) % 7;

                const result = computeDailyForecasts({
                    cyMtdSales:     0,
                    cyMtdOrders:    0,
                    cyMtdUnits:     0,
                    lyDates:        lyData.dates,
                    lyRevenue:      lyData.revenue,
                    lyMonthRevenue: lyData.monthRevenue,
                    lyMonthOrders:  lyData.monthOrders,
                    lyMonthUnits:   lyData.monthUnits,
                    todayIdx,
                    fractional,
                    totalDays,
                    todayDow,
                    biasRatios,
                });

                const forecastRev = result.dailyRevenue[forecastForDayIdx];
                const forecastOrd = result.dailyOrders [forecastForDayIdx];
                const forecastUnt = result.dailyUnits  [forecastForDayIdx];

                batch.set(doc.ref, {
                    forecastRevenue:  forecastRev,
                    forecastOrders:   forecastOrd,
                    forecastUnits:    forecastUnt,
                    forecastMethod:   result.method,
                    forecastHwMape:   result.hwMape,
                    forecastSetAt:    admin.firestore.FieldValue.serverTimestamp(),
                    // Compute accuracy now that we have actuals
                    forecastAccuracy: (d.totalRevenue > 0 && forecastRev > 0)
                        ? parseFloat((d.totalRevenue / forecastRev).toFixed(4))
                        : null,
                    forecastBias:     (d.totalRevenue > 0 && forecastRev > 0)
                        ? parseFloat((d.totalRevenue - forecastRev).toFixed(2))
                        : null,
                }, { merge: true });
                written++;

            } else {
                // Use accumulated CY actuals through previous day
                const todayIdx   = forecastForDayIdx;
                const fractional = 0;  // End-of-previous-day, so 0 fraction of todayIdx
                const prevDate   = new Date(`${targetMonth}-${String(dayNum).padStart(2, '0')}T12:00:00`);
                const todayDow   = (prevDate.getDay() + 6) % 7;

                const result = computeDailyForecasts({
                    cyMtdSales:     cySalesCumul,
                    cyMtdOrders:    cyOrdersCumul,
                    cyMtdUnits:     cyUnitsCumul,
                    lyDates:        lyData.dates,
                    lyRevenue:      lyData.revenue,
                    lyMonthRevenue: lyData.monthRevenue,
                    lyMonthOrders:  lyData.monthOrders,
                    lyMonthUnits:   lyData.monthUnits,
                    todayIdx:       prevDayEnd,
                    fractional:     1.0,  // previous day was complete at time of forecast
                    totalDays,
                    todayDow,
                    biasRatios,
                });

                const forecastRev = result.dailyRevenue[forecastForDayIdx];
                const forecastOrd = result.dailyOrders [forecastForDayIdx];
                const forecastUnt = result.dailyUnits  [forecastForDayIdx];

                batch.set(doc.ref, {
                    forecastRevenue:  forecastRev,
                    forecastOrders:   forecastOrd,
                    forecastUnits:    forecastUnt,
                    forecastMethod:   result.method,
                    forecastHwMape:   result.hwMape,
                    forecastSetAt:    admin.firestore.FieldValue.serverTimestamp(),
                    forecastAccuracy: (d.totalRevenue > 0 && forecastRev > 0)
                        ? parseFloat((d.totalRevenue / forecastRev).toFixed(4))
                        : null,
                    forecastBias:     (d.totalRevenue > 0 && forecastRev > 0)
                        ? parseFloat((d.totalRevenue - forecastRev).toFixed(2))
                        : null,
                }, { merge: true });
                written++;
            }

            // Accumulate actuals AFTER computing forecast (the forecast was set the night before)
            cySalesCumul  += d.totalRevenue ?? 0;
            cyOrdersCumul += d.totalOrders  ?? 0;
            cyUnitsCumul  += d.totalUnits   ?? 0;
        }

        await batch.commit();

        console.log(`[backfillDailyForecasts] ${targetMonth}: written=${written}, skipped=${skipped}`);
        return { success: true, month: targetMonth, written, skipped };
    });
