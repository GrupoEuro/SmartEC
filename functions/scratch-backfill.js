/**
 * scratch-backfill.js
 * Runs backfillDailyForecasts directly via Admin SDK for May 2026.
 * Usage: node scratch-backfill.js
 */
const admin = require('firebase-admin');
const serviceAccount = require('./src/tiendapraxis-firebase-adminsdk-fbsvc-7da9fe38eb.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Holt-Winters helpers (inline, matching analytics.ts logic) ──────────────

function hwTriple(series, m, alpha = 0.3, beta = 0.1, gamma = 0.2, periods = 31) {
    if (series.length < m * 2) return new Array(periods).fill(series.reduce((a, b) => a + b, 0) / series.length || 0);
    // Initial level = mean of first season
    let L = series.slice(0, m).reduce((a, b) => a + b, 0) / m;
    // Initial trend = average slope between first two seasons
    let T = 0;
    for (let i = 0; i < m; i++) T += (series[m + i] - series[i]) / m;
    T /= m;
    // Initial seasonal indices
    const S = [];
    for (let i = 0; i < m; i++) {
        const mean = series.slice(i, series.length - (series.length % m || m) + i + m).reduce((a, b) => a + b, 0) / Math.floor(series.length / m);
        S.push(series[i] / Math.max(mean, 1));
    }
    // Smooth
    let prevL = L;
    for (let t = m; t < series.length; t++) {
        const st = series[t];
        const si = S[t % m];
        const newL = alpha * (st / Math.max(si, 0.01)) + (1 - alpha) * (prevL + T);
        const newT = beta * (newL - prevL) + (1 - beta) * T;
        S[t % m] = gamma * (st / Math.max(newL, 1)) + (1 - gamma) * si;
        prevL = newL;
        T = newT;
        L = newL;
    }
    // Forecast
    const forecast = [];
    for (let h = 1; h <= periods; h++) {
        forecast.push(Math.max(0, (L + h * T) * S[(series.length + h - 1) % m]));
    }
    return forecast;
}

async function loadLySeries(lyYear, month) {
    const mon = String(month).padStart(2, '0');
    const start = `${lyYear}-${mon}-01`;
    const daysInMonth = new Date(lyYear, month, 0).getDate();
    const end   = `${lyYear}-${mon}-${String(daysInMonth).padStart(2, '0')}`;

    const snap = await db.collection('analytics_daily')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'asc')
        .get();

    const arr = new Array(daysInMonth).fill(0);
    snap.forEach(doc => {
        const d = doc.data();
        const day = parseInt(d.date.split('-')[2], 10);
        if (day >= 1 && day <= daysInMonth) arr[day - 1] = d.totalRevenue || 0;
    });
    return arr;
}

async function loadBiasRatios(lookbackDays = 28) {
    const end   = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - lookbackDays);

    const snap = await db.collection('analytics_daily')
        .where('date', '>=', start.toISOString().slice(0, 10))
        .where('date', '<',  end.toISOString().slice(0, 10))
        .orderBy('date', 'asc')
        .get();

    const ratios = [];
    snap.forEach(doc => {
        const d = doc.data();
        const acc = d.forecastAccuracy;
        if (typeof acc === 'number' && acc > 0.1 && acc < 5.0) ratios.push(acc);
    });
    return ratios;
}

async function run() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const mon   = String(month).padStart(2, '0');

    console.log(`\n🔄  Backfilling forecasts for ${year}-${mon}...`);

    // Load LY series for HW training
    const lyYear = year - 1;
    console.log(`   Loading LY (${lyYear}-${mon}) data from analytics_daily...`);
    const lySeries = await loadLySeries(lyYear, month);
    const lyTotal  = lySeries.reduce((a, b) => a + b, 0);
    console.log(`   LY total: $${lyTotal.toFixed(2)} across ${lySeries.filter(v => v > 0).length} days`);

    // Load CY actuals so far
    const fromStr = `${year}-${mon}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const toStr   = `${year}-${mon}-${String(daysInMonth).padStart(2, '0')}`;

    const cySnap = await db.collection('analytics_daily')
        .where('date', '>=', fromStr)
        .where('date', '<=', toStr)
        .orderBy('date', 'asc')
        .get();

    const cyActuals = new Map();
    cySnap.forEach(doc => {
        const d = doc.data();
        cyActuals.set(d.date, { rev: d.totalRevenue || 0, orders: d.totalOrders || 0, units: d.totalUnits || 0 });
    });
    console.log(`   CY actuals loaded: ${cyActuals.size} days`);

    // Velocity multiplier
    let cySales = 0, lySalesMTD = 0;
    cyActuals.forEach((v, date) => { cySales += v.rev; });
    const todayDay = now.getDate();
    for (let i = 0; i < todayDay - 1; i++) lySalesMTD += lySeries[i];
    const velocityMultiplier = lySalesMTD > 0 ? cySales / lySalesMTD : 1;
    console.log(`   Velocity multiplier: ${velocityMultiplier.toFixed(4)}x (CY $${cySales.toFixed(0)} / LY $${lySalesMTD.toFixed(0)})`);

    // HW forecast
    let hwForecast = [];
    if (lyTotal > 0) {
        hwForecast = hwTriple(lySeries, 7, 0.3, 0.1, 0.2, daysInMonth);
        hwForecast = hwForecast.map(v => v * velocityMultiplier);
        console.log(`   HW forecast computed (${hwForecast.length} days)`);
    } else {
        console.log('   ⚠ No LY data — using straight-line fallback');
        const dailyAvg = cySales / Math.max(todayDay - 1, 1);
        hwForecast = new Array(daysInMonth).fill(dailyAvg * velocityMultiplier);
    }

    // Bias correction
    const biasRatios = await loadBiasRatios(28);
    let biasCorrection = 1;
    if (biasRatios.length >= 3) {
        biasCorrection = biasRatios.reduce((a, b) => a + b, 0) / biasRatios.length;
        console.log(`   Bias correction: ${biasCorrection.toFixed(4)}x (from ${biasRatios.length} samples)`);
    }

    // Write forecasts
    const batch = db.batch();
    let written = 0;

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${mon}-${String(day).padStart(2, '0')}`;
        const forecastRevenue = hwForecast[day - 1] * biasCorrection;

        // Skip days that already have a forecast (overwrite=false)
        const existing = cyActuals.get(dateStr);

        const ref = db.collection('analytics_daily').doc(dateStr);
        const snap = await ref.get();
        const data = snap.data() || {};
        if (data.forecastRevenue && data.forecastRevenue > 0) {
            console.log(`   ↷  ${dateStr}: already has forecast $${data.forecastRevenue.toFixed(0)}, skipping`);
            continue;
        }

        batch.set(ref, {
            date: dateStr,
            forecastRevenue:  Math.max(0, forecastRevenue),
            forecastOrders:   Math.round(forecastRevenue / 850),  // ~avg ticket
            forecastUnits:    Math.round(forecastRevenue / 550),
            forecastMethod:   'holt-winters-v1-backfill',
            forecastSetAt:    admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        written++;
        console.log(`   ✓  ${dateStr}: $${forecastRevenue.toFixed(0)}`);

        // Firestore batch limit = 500
        if (written % 400 === 0) { await batch.commit(); }
    }

    await batch.commit();
    console.log(`\n✅  Backfill complete — ${written} days written to analytics_daily`);
    process.exit(0);
}

run().catch(err => { console.error('❌ Backfill failed:', err); process.exit(1); });
